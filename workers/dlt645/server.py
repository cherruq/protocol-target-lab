#!/usr/bin/env python3
"""Long-running finite DL/T645-2007 software meter over TCP, without serial hardware."""
import argparse
import asyncio
import json
import os
import queue
import signal
import sys
import threading
import time
from common import bytes_info,redacted_length,safe_config,sanitize,validate_config
from meter import DltError,DltStream,MeterConfig,MeterState,SecurityFixture,handle_request

class MeterServer:
    def __init__(self,config):
        self.config=config;sec=config['security'];fixture=None
        if sec['mode']=='fixture':fixture=SecurityFixture(int(sec['request_di'],16),int(sec['response_di'],16),bytes.fromhex(sec['operator']),bytes.fromhex(sec['request_hex']),bytes.fromhex(sec['response_hex']))
        self.core=MeterConfig(config['meter_address'],config['period_minutes'],config['energy_hundredths'],config['programming_key_enabled'],fixture)
        self.state=MeterState.create(self.core,time.monotonic());self.lock=asyncio.Lock();self.writers=set();self.tasks=set();self.log_queue=queue.Queue(maxsize=256);self.log_dropped=0;self.next_connection=0;self.stopping=False;self.fatal=None
    def emit(self,event,**fields):
        record=sanitize(dict(event=event,**fields))
        try:self.log_queue.put_nowait(record)
        except queue.Full:self.log_dropped+=1
    def fail(self,error):
        if not self.stopping and not self.fatal.done():self.fatal.set_exception(RuntimeError(str(error)[:512]))
    async def session(self,reader,writer):
        if len(self.writers)>=self.config['max_connections']:
            self.emit('connection_rejected',reason='concurrent_limit');writer.close();return
        self.writers.add(writer);task=asyncio.current_task();self.tasks.add(task);self.next_connection+=1;ident=self.next_connection
        stream=DltStream(max_buffer=4096,interbyte_timeout=.5);last_rx=time.monotonic();self.emit('connection_open',connection=ident,source=list(writer.get_extra_info('peername')))
        try:
            while not self.stopping:
                now=time.monotonic()
                for event in stream.expire(now):self.emit('framing',connection=ident,detail=event)
                if now-last_rx>=30:self.emit('connection_idle',connection=ident);break
                try:data=await asyncio.wait_for(reader.read(1024),min(.1,30-(now-last_rx)))
                except asyncio.TimeoutError:continue
                if not data:break
                now=time.monotonic();last_rx=now;self.emit('received',connection=ident,raw=redacted_length(data))
                batch=stream.feed(data,now)
                for event in batch.events:self.emit('framing',connection=ident,detail=event)
                for frame in batch.frames:
                    # A transaction includes native reply draining and pending software-baud commit.
                    async with self.lock:
                        now=time.monotonic()
                        for event in self.state.tick(now):self.emit('state_audit',connection=ident,detail=event)
                        self.emit('request',connection=ident,address=frame.address.hex(),control=frame.control,function=frame.function,data=redacted_length(frame.data),raw=bytes_info(frame.raw))
                        decision=handle_request(frame,self.state,self.core,now)
                        for event in decision.events:self.emit('protocol_audit',connection=ident,detail=event)
                        reply=decision.reply
                        if reply is None:continue
                        raw=reply.raw;writer.write(raw);await asyncio.wait_for(writer.drain(),3)
                        self.emit('reply_sent',connection=ident,control=reply.control,data=redacted_length(reply.data),raw=bytes_info(raw),crypto_verified=False if reply.control==0x83 else None)
                        if reply.pending_baud is not None:
                            now=time.monotonic();before=self.state.snapshot(now);self.state.baud=reply.pending_baud;self.state.generation+=1
                            self.emit('state_audit',connection=ident,detail=dict(event='state_committed',operation='baud_after_ack',before=before,after=self.state.snapshot(now),physical_baud_verified=False))
                    await asyncio.sleep(0)
        except (OSError,ConnectionError,asyncio.TimeoutError,DltError) as exc:self.emit('connection_error',connection=ident,error_type=type(exc).__name__)
        except Exception as exc:self.fail('meter session failed: '+str(exc))
        finally:
            # Free the slot before FIN is observable, so max_connections=1 can reconnect safely.
            self.writers.discard(writer);self.tasks.discard(task);writer.close();self.emit('connection_closed',connection=ident,partial=redacted_length(bytes(stream.buffer)))
    async def timers(self):
        while not self.stopping:
            await asyncio.sleep(.05)
            async with self.lock:
                for event in self.state.tick(time.monotonic()):self.emit('state_audit',detail=event)

def logger(server,loop):
    try:
        while True:
            item=server.log_queue.get()
            if item is None:return
            print(json.dumps(item,separators=(',',':'),allow_nan=False),flush=True)
    except Exception as exc:loop.call_soon_threadsafe(server.fail,'stdout logger failed: '+str(exc)[:256])

async def serve(config,bind='0.0.0.0',port=20645):
    loop=asyncio.get_running_loop();server=MeterServer(config);server.fatal=loop.create_future();stop=asyncio.Event();listener=None;serving=None;timer=None;stopping=None
    for sig in (signal.SIGTERM,signal.SIGINT):loop.add_signal_handler(sig,stop.set)
    thread=threading.Thread(target=logger,args=(server,loop),daemon=True);thread.start()
    try:
        listener=await asyncio.start_server(server.session,bind,port,limit=4096,backlog=128)
        serving=asyncio.create_task(listener.serve_forever());timer=asyncio.create_task(server.timers());stopping=asyncio.create_task(stop.wait())
        server.emit('ready',implementation='finite-software-meter-2007',config=safe_config(config),state=server.state.snapshot(time.monotonic()),physical_serial_verified=False,crypto_verified=False)
        done,_=await asyncio.wait([serving,timer,stopping,server.fatal],return_when=asyncio.FIRST_COMPLETED)
        if server.fatal in done:await server.fatal
        if serving in done or timer in done:raise RuntimeError('critical meter listener/timer stopped')
    finally:
        server.stopping=True
        if listener:listener.close();await listener.wait_closed()
        for task in (serving,timer,stopping):
            if task:task.cancel()
        for writer in tuple(server.writers):writer.close()
        for task in tuple(server.tasks):task.cancel()
        if server.tasks:await asyncio.gather(*tuple(server.tasks),return_exceptions=True)
        server.emit('stopped',state=server.state.snapshot(time.monotonic()),log_dropped=server.log_dropped)
        try:server.log_queue.put_nowait(None)
        except queue.Full:server.log_queue.get_nowait();server.log_queue.put_nowait(None)
        thread.join(timeout=1)
        for sig in (signal.SIGTERM,signal.SIGINT):loop.remove_signal_handler(sig)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--config-json',default=os.environ.get('PLAB_CONFIG_JSON'));args=parser.parse_args()
    try:
        if args.config_json is None:raise ValueError('config JSON required')
        asyncio.run(serve(validate_config(json.loads(args.config_json))));return 0
    except (ValueError,TypeError,OSError,RuntimeError) as exc:print(json.dumps(dict(event='worker_error',error=str(exc)[:512])),flush=True);return 1
if __name__=='__main__':sys.exit(main())
