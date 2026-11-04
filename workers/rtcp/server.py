#!/usr/bin/env python3
"""Persistent RTCPv2 SR/SDES UDP receiver with an unpublished read-only evidence observer."""
import argparse
import asyncio
from collections import Counter,OrderedDict,deque
import json
import os
import queue
import re
import secrets
import signal
import sys
import threading
import time
from urllib.parse import parse_qs,urlsplit
from rtcp_wire import PacketError,bytes_info,decode_compound,validate_config

class ReceiverState:
    def __init__(self,config):
        self.config=config;self.boot_id=secrets.token_hex(16);self.counter=0
        self.events=deque(maxlen=256);self.sources=OrderedDict();self.stats=Counter(received=0,accepted=0,rejected=0,compound_bytes=0,event_evictions=0,source_evictions=0,log_dropped=0)
        self.errors=Counter();self.log_queue=queue.Queue(maxsize=256);self.udp_bound=None;self.stopping=False;self.writers=set();self.tasks=set();self.fatal=None
    def emit(self,event):
        try:self.log_queue.put_nowait(event)
        except queue.Full:self.stats['log_dropped']+=1
    def receive(self,data,source):
        self.counter+=1;self.stats['received']+=1
        event=dict(boot_id=self.boot_id,event_id=self.counter,received_monotonic=time.monotonic(),source=[source[0],source[1]],accepted=False,raw=bytes_info(data))
        try:
            if len(data)>self.config['max_packet_size']:raise PacketError('packet_too_large')
            parsed=decode_compound(data);event.update(accepted=True,rtcp=parsed)
        except PacketError as exc:
            code=str(exc);event['error_code']=code;self.errors[code]+=1;self.stats['rejected']+=1
        else:
            self.stats['accepted']+=1;self.stats['compound_bytes']+=len(data)
            primary=parsed['primary_sr'];key=(source[0],source[1],primary['ssrc'])
            if key not in self.sources:
                if len(self.sources)==128:self.sources.popitem(last=False);self.stats['source_evictions']+=1
                self.sources[key]=dict(source=list(source),ssrc=primary['ssrc'],accepted=0,compound_bytes=0)
            state=self.sources[key];state['accepted']+=1;state['compound_bytes']+=len(data)
            state.update(last_ntp64_hex=primary['ntp64_hex'],last_rtp_timestamp=primary['rtp_timestamp'],last_sender_packet_count=primary['sender_packet_count'],last_sender_octet_count=primary['sender_octet_count'],cname_sha256=parsed['cname_data']['sha256']);self.sources.move_to_end(key)
        if len(self.events)==256:self.stats['event_evictions']+=1
        self.events.append(event);self.emit(dict(event='rtcp_received',observation=event))
    @staticmethod
    def prefix(result,key,values,maximum,count_key,truncated_key):
        result[key]=[];result[count_key]=0;result[truncated_key]=bool(values)
        for item in values[:maximum]:
            result[key].append(item);result[count_key]=len(result[key]);result[truncated_key]=len(result[key])<len(values)
            if len(json.dumps(result,separators=(',',':'),allow_nan=False).encode())>65536:
                result[key].pop();result[count_key]=len(result[key]);result[truncated_key]=len(result[key])<len(values);break
        return result
    def status(self):
        values=list(self.sources.values())
        base=dict(schema_version=1,implementation='stdlib-rfc3550-rtcp-v2',packet_profile='sr-sdes',boot_id=self.boot_id,counter=self.counter,udp_bound=self.udp_bound,max_packet_size=self.config['max_packet_size'],stats=dict(self.stats),errors=dict(self.errors),source_count=len(values))
        return self.prefix(base,'sources',values,128,'returned_source_count','sources_truncated')
    def observations(self,after,raw_sha256):
        matches=[e for e in self.events if e['event_id']>after and e['raw']['sha256']==raw_sha256]
        base=dict(schema_version=1,boot_id=self.boot_id,counter=self.counter,earliest_event_id=self.events[0]['event_id'] if self.events else self.counter+1,matched_count=len(matches))
        return self.prefix(base,'events',matches,16,'returned_count','truncated')
    def fail(self,error):
        if not self.stopping and not self.fatal.done():self.fatal.set_exception(RuntimeError(str(error)[:512]))

class RtcpProtocol(asyncio.DatagramProtocol):
    def __init__(self,state):self.state=state
    def datagram_received(self,data,address):
        try:self.state.receive(data,address)
        except Exception as exc:self.state.fail('RTCP receive callback failed: '+str(exc))
    def error_received(self,error):self.state.fail('RTCP listener error: '+str(error))
    def connection_lost(self,error):self.state.fail('RTCP listener closed unexpectedly: '+str(error))

async def observe(reader,writer,state):
    if len(state.writers)>=8:
        writer.close();return
    state.writers.add(writer);state.tasks.add(asyncio.current_task());request_deadline=asyncio.get_running_loop().time()+1
    try:
        status=200;headers={}
        try:
            raw=await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'),1)
            if len(raw)>4096:raise ValueError('headers_too_large')
            lines=raw.decode('ascii').split('\r\n');parts=lines[0].split(' ')
            if len(parts)!=3 or parts[2] not in ('HTTP/1.0','HTTP/1.1'):raise ValueError('invalid_request')
            method,target,_=parts
            if method!='GET':status=405;headers={'Allow':'GET'};result={'error':'read_only_get_required'}
            else:
                for line in lines[1:-2]:
                    if not line or ':' not in line or line[:1].isspace():raise ValueError('invalid_header')
                    key,value=line.split(':',1);key=key.lower()
                    if key in headers:raise ValueError('duplicate_header')
                    headers[key]=value.strip()
                if 'transfer-encoding' in headers or headers.get('content-length','0')!='0':raise ValueError('request_body_not_supported')
                headers={}
                if not target.startswith('/') or target.startswith('//'):raise ValueError('invalid_target')
                parsed=urlsplit(target)
                if parsed.fragment or parsed.netloc:raise ValueError('invalid_target')
                if parsed.path=='/v1/status' and not parsed.query:result=state.status()
                elif parsed.path=='/v1/observations':
                    params=parse_qs(parsed.query,keep_blank_values=True,strict_parsing=True,max_num_fields=2)
                    if set(params)!={'after','raw_sha256'} or any(len(v)!=1 for v in params.values()):raise ValueError('invalid_query')
                    after=params['after'][0];sha=params['raw_sha256'][0]
                    if not re.fullmatch('[0-9]{1,20}',after) or int(after)>2**64-1 or not re.fullmatch('[0-9a-f]{64}',sha):raise ValueError('invalid_query')
                    result=state.observations(int(after),sha)
                else:status=404;result={'error':'not_found'}
        except asyncio.TimeoutError:status=408;headers={};result={'error':'absolute_request_deadline'}
        except (ValueError,UnicodeError,asyncio.LimitOverrunError,asyncio.IncompleteReadError):status=400;headers={};result={'error':'invalid_bounded_request'}
        body=json.dumps(result,separators=(',',':'),allow_nan=False).encode()
        if len(body)>65536:raise RuntimeError('observer response size invariant failed')
        response=(f'HTTP/1.1 {status} Result\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\nConnection: close\r\n'+''.join(f'{k}: {v}\r\n' for k,v in headers.items())+'\r\n').encode()+body
        writer.write(response)
        budget=request_deadline-asyncio.get_running_loop().time()
        if budget>0:await asyncio.wait_for(writer.drain(),budget)
    except (ConnectionError,OSError,asyncio.TimeoutError):pass
    except Exception as exc:state.fail('observer failed: '+str(exc))
    finally:
        writer.close();state.writers.discard(writer);state.tasks.discard(asyncio.current_task())

def logger(state,loop):
    try:
        while True:
            event=state.log_queue.get()
            if event is None:break
            print(json.dumps(event,separators=(',',':'),allow_nan=False),flush=True)
    except Exception as exc:loop.call_soon_threadsafe(state.fail,'stdout logger failed: '+str(exc)[:256])

async def serve(config,udp_port=5005,observer_port=18081,bind='0.0.0.0'):
    loop=asyncio.get_running_loop();state=ReceiverState(config);state.fatal=loop.create_future();stop=asyncio.Event();transport=None;observer=None;serving=None
    for sig in (signal.SIGTERM,signal.SIGINT):loop.add_signal_handler(sig,stop.set)
    thread=threading.Thread(target=logger,args=(state,loop),daemon=True);thread.start()
    try:
        transport,_=await loop.create_datagram_endpoint(lambda:RtcpProtocol(state),local_addr=(bind,udp_port),family=__import__('socket').AF_INET)
        state.udp_bound=list(transport.get_extra_info('sockname'))
        observer=await asyncio.start_server(lambda r,w:observe(r,w,state),bind,observer_port,limit=4096,backlog=16)
        serving=asyncio.create_task(observer.serve_forever());stopping=asyncio.create_task(stop.wait())
        state.emit(dict(event='ready',implementation='stdlib-rfc3550-rtcp-v2',observer_schema=1,boot_id=state.boot_id,udp_bound=state.udp_bound,observer_port=observer_port,config=config,rtcp_sent_packets=0))
        done,_=await asyncio.wait([serving,stopping,state.fatal],return_when=asyncio.FIRST_COMPLETED)
        if state.fatal in done:await state.fatal
        if serving in done:raise RuntimeError('observer listener stopped unexpectedly')
    finally:
        state.stopping=True
        if transport:transport.close()
        if observer:observer.close();await observer.wait_closed()
        if serving:serving.cancel()
        for writer in tuple(state.writers):writer.close()
        for task in tuple(state.tasks):task.cancel()
        if state.tasks:await asyncio.gather(*tuple(state.tasks),return_exceptions=True)
        state.emit(dict(event='stopped',boot_id=state.boot_id,counter=state.counter,stats=dict(state.stats),rtcp_sent_packets=0))
        try:state.log_queue.put_nowait(None)
        except queue.Full:state.log_queue.get_nowait();state.log_queue.put_nowait(None)
        thread.join(timeout=1)
        for sig in (signal.SIGTERM,signal.SIGINT):loop.remove_signal_handler(sig)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--config-json',default=os.environ.get('PLAB_CONFIG_JSON'));args=parser.parse_args()
    try:
        if args.config_json is None:raise ValueError('config JSON is required')
        asyncio.run(serve(validate_config(json.loads(args.config_json))));return 0
    except (ValueError,TypeError,OSError,RuntimeError) as exc:
        print(json.dumps(dict(event='worker_error',error=str(exc)[:512])),flush=True);return 1
if __name__=='__main__':sys.exit(main())
