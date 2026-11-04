#!/usr/bin/env python3
"""Independent bounded DL/T645-2007 TCP client; readonly ALL and explicit reversible writes."""
import argparse
import json
import secrets
import signal
import socket
import sys
import time
from common import bytes_info,remaining,validate_config

CORE=('READ_ADDRESS','READ_DATA','STREAM','ERROR_RESPONSE')
METHODS=(*CORE,'WRITE_PERIOD','SECURITY_FIXTURE')
ENERGY=0x00010000;PERIOD=0x04000103;AA=b'\xaa'*6
class Parser(argparse.ArgumentParser):
    def error(self,message):raise ValueError(message)
def bcd_value(data):
    value=0
    for n,byte in enumerate(data):
        if byte>>4>9 or byte&15>9:raise ValueError('invalid BCD response')
        value+=((byte>>4)*10+(byte&15))*(100**n)
    return value
def address_text(data):
    if len(data)!=6:raise ValueError('invalid meter address width')
    bcd_value(data);text=data[::-1].hex()
    if text=='999999999999':raise ValueError('broadcast is not a meter address')
    return text
def frame(address,control,data=b''):
    if len(address)!=6 or len(data)>255:raise ValueError('outbound frame bounds')
    body=b'\x68'+address+b'\x68'+bytes([control,len(data)])+bytes((v+0x33)&255 for v in data)
    return body+bytes([sum(body)&255,0x16])
class Session:
    def __init__(self,host,port,deadline,trace):
        self.deadline=deadline;self.trace=trace;self.buffer=bytearray();self.sock=socket.create_connection((host,port),timeout=remaining(deadline));self.sock.setsockopt(socket.IPPROTO_TCP,socket.TCP_NODELAY,1)
    def record(self,direction,raw,control=None):
        if len(self.trace)>=256:raise ValueError('client trace budget exceeded')
        self.trace.append(dict(direction=direction,transport='TCP serial bytes',raw=bytes_info(raw),control=control))
    def send(self,raw,split=False):
        if split:
            for byte in raw:
                self.sock.settimeout(remaining(self.deadline));self.sock.sendall(bytes([byte]));time.sleep(.002)
        else:self.sock.settimeout(remaining(self.deadline));self.sock.sendall(raw)
        self.record('send',raw)
    def receive(self):
        while True:
            while self.buffer and self.buffer[0]==0xfe:del self.buffer[0]
            if self.buffer and self.buffer[0]!=0x68:raise ValueError('unexpected response noise')
            if len(self.buffer)>=10:
                size=12+self.buffer[9]
                if self.buffer[7]!=0x68:raise ValueError('response second start invalid')
                if len(self.buffer)>=size:
                    raw=bytes(self.buffer[:size]);del self.buffer[:size];self.record('receive',raw,raw[8])
                    if raw[-1]!=0x16 or sum(raw[:-2])&255!=raw[-2]:raise ValueError('response checksum/end invalid')
                    addr=raw[1:7];address_text(addr);data=bytes((v-0x33)&255 for v in raw[10:-2])
                    return addr,raw[8],data
            self.sock.settimeout(remaining(self.deadline));data=self.sock.recv(1024)
            if not data:raise ConnectionError('connection closed before complete response')
            self.buffer.extend(data)
            if len(self.buffer)>4096:raise ValueError('response buffer budget exceeded')
    def request(self,address,control,data=b'',split=False):self.send(frame(address,control,data),split);return self.receive()
    def current_address(self):
        addr,control,data=self.request(AA,0x13)
        if control!=0x93 or data!=addr:raise ValueError('READ_ADDRESS must return current same valid address in header/data')
        return addr
    def read(self,addr,di,width):
        address,control,data=self.request(addr,0x11,di.to_bytes(4,'little'))
        if address!=addr or control!=0x91 or len(data)!=4+width or data[:4]!=di.to_bytes(4,'little'):raise ValueError('READ_DATA response address/control/DI/width mismatch')
        return data[4:]
    def period(self,addr):
        value=bcd_value(self.read(addr,PERIOD,1))
        if not 1<=value<=99:raise ValueError('period outside software profile')
        return value
    def write_period(self,addr,value):
        body=PERIOD.to_bytes(4,'little')+b'\2\0\0\0'+b'\0'*4+bytes([(value//10)*16+value%10])
        address,control,data=self.request(addr,0x14,body)
        if address!=addr or control!=0x94 or data:raise ValueError('WRITE_PERIOD not accepted (software key/password may have changed)')
    def close(self):
        try:
            if self.buffer:raise ValueError('unexpected extra response bytes at session close')
            self.sock.shutdown(socket.SHUT_WR)
            self.sock.settimeout(remaining(self.deadline))
            if self.sock.recv(1024):raise ValueError('unexpected response after write-halfclose')
        finally:self.sock.close()

def validate_read(addr,reply,di,width):
    target,control,data=reply
    if target!=addr or control!=0x91 or data[:4]!=di.to_bytes(4,'little') or len(data)!=4+width:raise ValueError('coalesced read response mismatch')
    return bcd_value(data[4:])
def validate_error(addr,reply):
    target,control,data=reply
    if target!=addr or control!=0xd1 or data!=b'\2':raise ValueError('expected real unknown-DI D1 error 02')

def check(host,port,config,method,number,deadline,health=False):
    started=time.monotonic();phase=min(deadline,started+3);trace=[];session=None;old_period=None;attempted=False;restored=None
    result=dict(name=f'{method}/round-{number}',passed=False,request=dict(method=method,path='meter'),response=dict(software_only=True,physical_serial_verified=False),trace=trace)
    try:
        if method=='WRITE_PERIOD' and not config['programming_key_enabled']:raise ValueError('WRITE_PERIOD requires enabled simulated programming key')
        if method=='SECURITY_FIXTURE' and config['security']['mode']!='fixture':raise ValueError('SECURITY_FIXTURE requires explicit fixture mode; crypto is never verified')
        # A failed mutation phase leaves a separate bounded recovery budget, all within total30s.
        session=Session(host,port,min(phase,started+1.5) if method=='WRITE_PERIOD' else phase,trace);addr=session.current_address();result['response']['meter_address']=address_text(addr)
        if health:
            result['response']['energy_hundredths']=bcd_value(session.read(addr,ENERGY,4))
        elif method=='READ_DATA':
            result['response'].update(energy_hundredths=bcd_value(session.read(addr,ENERGY,4)),period_minutes=session.period(addr))
        elif method=='ERROR_RESPONSE':
            validate_error(addr,session.request(addr,0x11,(0xdeadbeef).to_bytes(4,'little')));result['response'].update(error_control=0xd1,error_code=2,energy_hundredths=bcd_value(session.read(addr,ENERGY,4)))
        elif method=='STREAM':
            session.send(b'\xfe'*4+frame(addr,0x11,ENERGY.to_bytes(4,'little')),split=True);energy=validate_read(addr,session.receive(),ENERGY,4)
            dis=(PERIOD,0x000000e3,0x00000035,0x000000cb);session.send(b''.join(frame(addr,0x11,di.to_bytes(4,'little')) for di in dis));period=validate_read(addr,session.receive(),PERIOD,1)
            if not 1<=period<=99:raise ValueError('stream period outside software profile')
            for _ in dis[1:]:validate_error(addr,session.receive())
            partial=frame(addr,0x11,ENERGY.to_bytes(4,'little'))[:9];session.send(partial);time.sleep(.62)
            after=bcd_value(session.read(addr,ENERGY,4));result['response'].update(energy_hundredths=energy,period_minutes=period,after_partial_timeout_energy=after,encoded_data_special_bytes=[0x16,0x68,0xfe])
        elif method=='WRITE_PERIOD':
            old_period=session.period(addr);new_period=old_period%99+1;attempted=True;session.write_period(addr,new_period)
            if session.period(addr)!=new_period:raise ValueError('written period not actually readable')
            result['response'].update(original_period=old_period,written_period=new_period,write_verified=True)
        elif method=='SECURITY_FIXTURE':
            sec=config['security'];body=int(sec['request_di'],16).to_bytes(4,'little')+bytes.fromhex(sec['operator'])+bytes.fromhex(sec['request_hex']);target,control,data=session.request(addr,3,body)
            expected=int(sec['response_di'],16).to_bytes(4,'little')+bytes.fromhex(sec['response_hex'])
            if target!=addr or control!=0x83 or data!=expected:raise ValueError('security transport fixture reply mismatch')
            result['response'].update(fixture_verified=True,crypto_verified=False,reply_data=bytes_info(data))
        result['passed']=True
    except Exception as exc:result['error']=str(exc)[:512]
    finally:
        if attempted and old_period is not None:
            try:
                recovery=min(deadline,started+3)
                if session is not None:
                    session.deadline=recovery
                    try:session.close()
                    except (OSError,ValueError):session.sock.close()
                    finally:session=None
                # Read-only admission may retry an old socket's asynchronous FIN release;
                # no mutating request is retried or sent before a real AA reply.
                while session is None:
                    remaining(recovery);candidate=None
                    try:
                        candidate=Session(host,port,recovery,trace);current=candidate.current_address();session=candidate
                    except (OSError,ConnectionError):
                        if candidate:candidate.sock.close()
                        time.sleep(min(.02,remaining(recovery)))
                    except BaseException:
                        if candidate:candidate.sock.close()
                        raise
                needs_write=session.period(current)!=old_period
                if needs_write:session.write_period(current,old_period)
                if session.period(current)!=old_period:raise ValueError('restored period does not match original current value')
                result['response']['restore_write_needed']=needs_write
                restored=True
            except Exception as exc:restored=False;result['passed']=False;result['restore_error']=str(exc)[:512]
            result['response']['restored']=restored
        if session is not None:
            session.deadline=min(deadline,started+3)
            try:session.close()
            except Exception as exc:result['passed']=False;result['close_error']=str(exc)[:256]
    result['seconds']=round(time.monotonic()-started,6);return result

def main():
    started=time.monotonic();deadline=started+30;report=dict(passed=False,checks=[])
    signal.signal(signal.SIGALRM,lambda *_:(_ for _ in ()).throw(TimeoutError('overall DL/T645 client deadline exceeded (30 seconds)')));signal.alarm(30)
    try:
        p=Parser(description=__doc__);p.add_argument('--host',required=True);p.add_argument('--port',type=int,required=True);p.add_argument('--method',choices=(*METHODS,'ALL'),default='ALL');p.add_argument('--path',default='meter');p.add_argument('--config-json',required=True);p.add_argument('--health',action='store_true');args=p.parse_args();config=validate_config(json.loads(args.config_json))
        if not 1<=args.port<=65535 or args.path!='meter':raise ValueError('expected valid port and path meter')
        for method in ('READ_ADDRESS',) if args.health else CORE if args.method=='ALL' else (args.method,):
            for number in (1,) if args.health else (1,2):remaining(deadline);report['checks'].append(check(args.host,args.port,config,method,number,deadline,args.health))
    except Exception as exc:report['error']=str(exc)[:512]
    finally:signal.alarm(0)
    passed=sum(c['passed'] for c in report['checks']);report['summary']=dict(total=len(report['checks']),passed=passed,failed=len(report['checks'])-passed);report['passed']=bool(report['checks']) and passed==len(report['checks']) and 'error' not in report;report['seconds']=round(time.monotonic()-started,6)
    raw=json.dumps(report,separators=(',',':'),allow_nan=False)
    if len(raw.encode())>524288:report=dict(passed=False,checks=[],summary=report['summary'],seconds=report['seconds'],error='client report exceeds 512KiB');raw=json.dumps(report,separators=(',',':'))
    print(raw,flush=True);return 0 if report['passed'] else 1
if __name__=='__main__':sys.exit(main())
