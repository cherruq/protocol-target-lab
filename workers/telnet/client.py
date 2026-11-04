#!/usr/bin/env python3
"""Independent bounded Telnet wire probe against the real server and its INFO metadata."""
import argparse
import json
import secrets
import signal
import socket
import struct
import sys
import time
from telnet_wire import *

METHODS=('CONNECT','ECHO','OPTIONS','UNKNOWN_OPTION')
class Deadline(Exception):pass
class Parser(argparse.ArgumentParser):
    def error(self,message):raise ValueError(message)

class Session:
    def __init__(self,host,port):
        self.sock=socket.create_connection((host,port),timeout=3);self.sock.settimeout(3)
        self.decoder=Decoder();self.app=bytearray();self.events=[];self.trace=[];self.sent=set();self.allowed={BINARY,SGA};self.received=0
        self.token=secrets.token_hex(4);self.term='PLAB-'+self.token;self.cols=255+256*secrets.randbelow(3);self.rows=24+secrets.randbelow(40);self.tspeed=f'{9600+100*secrets.randbelow(900)},{9600+100*secrets.randbelow(900)}';self.display='plab-'+self.token+':0';self.environment={'PLAB_TEST':self.token,'TERM':self.term}
    def send(self,data,fragment=False):
        self.trace.append(dict(direction='send',**preview(data)))
        if len(self.trace)>128:raise ValueError('Telnet trace event limit exceeded')
        if fragment:
            # Every IAC, verb and SB payload can be split across TCP writes.
            for at in range(0,len(data),2):self.sock.sendall(data[at:at+2]);time.sleep(.002)
        else:self.sock.sendall(data)
    def send_option(self,command,option):
        if (command,option) not in self.sent:
            self.sent.add((command,option));self.send(negotiation(command,option),True)
    def sub(self,option,data):self.send(subnegotiation(option,data),True)
    def pump(self):
        raw=self.sock.recv(4096)
        if not raw:raise EOFError('Telnet connection closed')
        self.received+=len(raw)
        if self.received>1024*1024:raise ValueError('Telnet session exceeds wire byte limit')
        self.trace.append(dict(direction='receive',**preview(raw)))
        if len(self.trace)>128:raise ValueError('Telnet trace event limit exceeded')
        plain,events=self.decoder.feed(raw);self.app.extend(plain)
        if len(self.app)>65536:raise ValueError('Telnet application response exceeds bound')
        for event,command,value in events:
            if len(self.events)>=128:raise ValueError('Telnet negotiation event limit exceeded')
            self.events.append(dict(event=event,command=command,option=value if event=='negotiation' else command if event=='subnegotiation' else None,payload=preview(value) if isinstance(value,bytes) else None))
            if event=='negotiation':
                if command==DO:
                    self.send_option(WILL if value in self.allowed else WONT,value)
                    if value==NAWS and value in self.allowed:self.sub(NAWS,struct.pack('!HH',self.cols,self.rows))
                elif command==WILL:self.send_option(DO if value in (BINARY,SGA,1) else DONT,value)
            elif event=='subnegotiation' and command in self.allowed and value[:1]==b'\1':
                if command==TTYPE:self.sub(TTYPE,b'\0'+self.term.encode())
                elif command==TSPEED:self.sub(TSPEED,b'\0'+self.tspeed.encode())
                elif command==XDISPLOC:self.sub(XDISPLOC,b'\0'+self.display.encode())
                elif command==NEW_ENVIRON:
                    data=b'\0'+b''.join(b'\0'+k.encode()+b'\1'+v.encode() for k,v in self.environment.items())
                    self.sub(NEW_ENVIRON,data)
    def line(self):
        while b'\r\n' not in self.app:self.pump()
        at=self.app.index(b'\r\n');line=bytes(self.app[:at]);del self.app[:at+2];return line
    def info(self):
        self.send(b'INFO\r\n');value=json.loads(self.line())
        if not isinstance(value,dict):raise ValueError('INFO did not return a JSON object')
        return value
    def wait_event(self,command,option):
        while not any(e['event']=='negotiation' and e['command']==command and e['option']==option for e in self.events):self.pump()
    def close(self):self.sock.close()

def check_case(host,port,config,method,round_number):
    check=dict(name=f'{method}/round-{round_number}',passed=False,request=dict(method=method,path='session'));started=time.monotonic();session=None;response={}
    try:
        session=Session(host,port)
        banner=session.line();expected=b'PLAB TELNET '+config['banner'].encode()
        response['banner']=banner.decode('utf-8',errors='replace')
        if banner!=expected:raise ValueError('welcome banner mismatch')
        if method=='ECHO':
            data=b'bytes:'+b'\0\t\x1b\xff'+secrets.token_bytes(4).hex().encode()
            check['request']['data']=preview(data)
            session.send(escape(b'ECHO '+data+b'\r\n'),True)
            actual=session.line();response['echo']=preview(actual)
            if actual!=data:raise ValueError('ECHO bytes/IAC unescaping mismatch')
        elif method=='OPTIONS':
            for option in (TTYPE,NAWS,TSPEED,XDISPLOC,NEW_ENVIRON):
                session.allowed.add(option);session.sent.discard((WILL,option));session.send_option(WILL,option)
                # INFO is an application observation, not a fabricated Telnet option ACK.
                for attempt in range(8):
                    info=session.info()
                    if OPTION_NAMES[option] in info.get('callbacks',[]):break
                    time.sleep(.01)
                else:raise ValueError('native callback not observed: '+OPTION_NAMES[option])
            response['info']=info
            expected_info=dict(ttype=session.term,term=session.term,rows=session.rows,cols=session.cols,tspeed=session.tspeed,xdisploc=session.display)
            if any(info.get(k)!=v for k,v in expected_info.items()) or any(info.get('environ',{}).get(k)!=v for k,v in session.environment.items()):raise ValueError('native INFO option values mismatch')
            check['request']['options']=dict(expected_info,environ=session.environment)
        elif method=='UNKNOWN_OPTION':
            session.send(negotiation(WILL,222),True);session.wait_event(DONT,222)
            session.send(negotiation(DO,223),True);session.wait_event(WONT,223)
            response['rejections']=[dict(command='DONT',option=222),dict(command='WONT',option=223)]
        session.send(b'CLOSE\r\n')
        # A close is a real EOF, not an application success string.
        while True:
            try:session.pump()
            except EOFError:break
        response['closed']=True;check['passed']=True
    except (ValueError,TypeError,OSError,EOFError,UnicodeError,struct.error) as exc:check['error']=str(exc)[:1024]
    finally:
        if session is not None:
            response['trace']=session.trace;response['negotiations']=session.events;session.close()
    check['response']=response;check['seconds']=round(time.monotonic()-started,6);return check

def main():
    started=time.monotonic();report=dict(passed=False,checks=[])
    signal.signal(signal.SIGALRM,lambda *_:(_ for _ in ()).throw(Deadline('overall Telnet test deadline exceeded (30 seconds)')));signal.alarm(30)
    try:
        parser=Parser(description=__doc__);parser.add_argument('--host',required=True);parser.add_argument('--port',type=int,required=True);parser.add_argument('--method',choices=(*METHODS,'ALL'),default='ALL');parser.add_argument('--path',default='session');parser.add_argument('--config-json',required=True)
        args=parser.parse_args();config=validate_config(json.loads(args.config_json))
        if not 1<=args.port<=65535:raise ValueError('port: expected 1..65535')
        if args.path!='session':raise ValueError('path: expected session')
        for method in METHODS if args.method=='ALL' else [args.method]:
            for round_number in (1,2):report['checks'].append(check_case(args.host,args.port,config,method,round_number))
        report['target']=dict(host=args.host[:253],port=args.port)
    except (ValueError,TypeError,OSError,Deadline) as exc:report['error']=str(exc)[:1024]
    finally:signal.alarm(0)
    passed=sum(c['passed'] for c in report['checks']);report['summary']=dict(total=len(report['checks']),passed=passed,failed=len(report['checks'])-passed);report['passed']=bool(report['checks']) and passed==len(report['checks']) and 'error' not in report;report['seconds']=round(time.monotonic()-started,6)
    text=json.dumps(report,separators=(',',':'))
    if len(text.encode())>512*1024:
        report=dict(passed=False,checks=[],summary=report['summary'],seconds=report['seconds'],error='Telnet report exceeded 512 KiB limit');text=json.dumps(report,separators=(',',':'))
    print(text,flush=True);return 0 if report['passed'] else 1

if __name__=='__main__':sys.exit(main())
