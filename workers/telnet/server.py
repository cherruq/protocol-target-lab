#!/usr/bin/env python3
"""Real telnetlib3 negotiation and a finite ECHO/INFO/CLOSE laboratory application."""
import argparse
import asyncio
import importlib.metadata
import json
import logging
import signal
import sys
import telnetlib3
from telnet_wire import SubnegotiationBudget,validate_config


def log(event,**fields):print(json.dumps(dict(event=event,**fields),separators=(',',':')),flush=True)
def bounded(value):return str(value).encode('utf-8',errors='replace')[:256].decode('utf-8',errors='replace')

async def serve(config):
    active=set();stop=asyncio.Event()
    class LabServer(telnetlib3.TelnetServer):
        def connection_made(self,transport):
            self.accepted=len(active)<config['max_connections'];self.environ={};self.observed=set();self.sb_budget=SubnegotiationBudget()
            super().connection_made(transport)
            if not self.accepted:
                log('connection_rejected',reason='max_connections',limit=config['max_connections']);transport.close();return
            active.add(self);log('connected',active=len(active))
        def data_received(self,data):
            if not self.accepted:return
            # Guard fragmented SB before native parsing, with a per-frame (not lifetime) budget.
            try:
                for at in range(0,len(data),1024):
                    part=data[at:at+1024];self.sb_budget.feed(part)
                    super().data_received(part)
                    if self._transport.get_write_buffer_size()>65536:raise ValueError('native output exceeds 65536-byte buffer budget')
                    if not self.accepted:return
            except Exception as exc:
                log('connection_closed',reason='invalid_or_oversize_telnet',error=bounded(exc));self._transport.abort()
        def connection_lost(self,exc):
            active.discard(self);super().connection_lost(exc)
        def on_naws(self,rows,cols):super().on_naws(rows,cols);self.observed.add('NAWS')
        def on_ttype(self,value):super().on_ttype(value);self.observed.add('TTYPE')
        def on_tspeed(self,rx,tx):super().on_tspeed(rx,tx);self.observed.add('TSPEED')
        def on_xdisploc(self,value):super().on_xdisploc(value);self.observed.add('XDISPLOC')
        def on_environ(self,mapping):
            proposed=dict(self.environ);proposed.update({str(k).upper():str(v) for k,v in mapping.items() if v})
            if len(proposed)>16 or sum(len(k.encode())+len(v.encode()) for k,v in proposed.items())>8192 or any(len(k.encode())>256 or len(v.encode())>256 for k,v in proposed.items()):
                log('connection_closed',reason='environ_metadata_budget');self.accepted=False;self._transport.abort();return
            super().on_environ(mapping);self.observed.add('NEW_ENVIRON')
            for key in list(mapping)[:16]:self.environ[bounded(key.upper())]=bounded(self.get_extra_info(key.upper(),''))
        def info(self):
            return dict(implementation='telnetlib3',version='4.0.3',term=bounded(self.get_extra_info('TERM',self.get_extra_info('term'))),ttype=bounded(self.get_extra_info('ttype1','')),rows=self.get_extra_info('rows'),cols=self.get_extra_info('cols'),tspeed=bounded(self.get_extra_info('tspeed','')),xdisploc=bounded(self.get_extra_info('xdisploc','')),environ=dict(self.environ),callbacks=sorted(self.observed),ayt='unhandled')
    async def shell(reader,writer):
        protocol=writer.protocol
        if not protocol.accepted:writer.close();return
        writer.write(b'PLAB TELNET '+config['banner'].encode('utf-8')+b'\r\n');await writer.drain()
        line=bytearray()
        try:
            while True:
                chunk=await reader.read(1024)
                if not chunk:break
                for byte in chunk:
                    if byte==10 and line.endswith(b'\r'):
                        command=bytes(line[:-1]);line.clear()
                        if command.startswith(b'ECHO '):writer.write(command[5:]+b'\r\n')
                        elif command==b'INFO':writer.write(json.dumps(protocol.info(),separators=(',',':')).encode()+b'\r\n')
                        elif command==b'CLOSE':return
                        else:writer.write(b'ERROR unknown command\r\n')
                        await writer.drain()
                    else:
                        line.append(byte)
                        if len(line)>config['max_line_bytes'] and not (len(line)==config['max_line_bytes']+1 and byte==13):
                            writer.write(b'ERROR line too long\r\n');await writer.drain();log('connection_closed',reason='max_line_bytes',limit=config['max_line_bytes']);return
        except (ConnectionError,EOFError):pass
        finally:writer.close()
    loop=asyncio.get_running_loop()
    for sig in (signal.SIGTERM,signal.SIGINT):loop.add_signal_handler(sig,stop.set)
    server=await telnetlib3.create_server(host='0.0.0.0',port=2323,protocol_factory=LabServer,shell=shell,encoding=False,connect_maxwait=.2,timeout=0,limit=config['max_line_bytes']+2,compression=False)
    log('ready',implementation='telnetlib3',version=importlib.metadata.version('telnetlib3'),internal_port=2323,config=config,ayt='unhandled')
    try:await stop.wait()
    finally:
        server.close();await server.wait_closed()
        for protocol in tuple(active):protocol.writer.close()
        await asyncio.sleep(0);log('stopped',active=len(active))

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--config-json',required=True);args=parser.parse_args()
    try:config=validate_config(json.loads(args.config_json));asyncio.run(serve(config))
    except (ValueError,TypeError,OSError) as exc:log('configuration_error',error=str(exc)[:1024]);return 2
    return 0

if __name__=='__main__':
    logging.basicConfig(level=logging.ERROR,stream=sys.stderr)
    sys.exit(main())
