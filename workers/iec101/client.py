#!/usr/bin/env python3
"""MIT: independent FT1.2 master checks against the native dual PTY target."""
import argparse
import concurrent.futures
import hashlib
import json
import signal
import socket
import sys
import time
from common import decode_frame,fixed,gi_request,load_config,variable

METHODS=('RESET_STATUS','CLASS2','GI','STREAM')
class Session:
    def __init__(self,host,port,profile,width,deadline):
        self.deadline=deadline; self.profile=profile; self.width=width; self.fcb=1
        self.buffer=bytearray(); self.sent=[]; self.received=[]
        self.sock=socket.create_connection((host,port),timeout=self.remaining())
        self.sock.setsockopt(socket.IPPROTO_TCP,socket.TCP_NODELAY,1)
    def remaining(self):
        left=self.deadline-time.monotonic()
        if left<=0: raise TimeoutError('absolute phase deadline exceeded')
        return min(3,left)
    def send(self,raw,split=False):
        self.sock.settimeout(self.remaining())
        self.sent.append({'hex':raw.hex(),'length':len(raw),'fragmented':split})
        if split:
            self.sock.sendall(raw[:1]); time.sleep(.02)
            self.sock.settimeout(self.remaining()); self.sock.sendall(raw[1:3]); time.sleep(.02)
            self.sock.settimeout(self.remaining()); self.sock.sendall(raw[3:])
        else: self.sock.sendall(raw)
    def receive(self):
        while True:
            if self.buffer:
                start=self.buffer[0]
                if start==0xe5: n=1
                elif start==0x10: n=self.width+4
                elif start==0x68:
                    n=self.buffer[1]+6 if len(self.buffer)>=2 else None
                else: raise ValueError('unknown FT1.2 response start')
                if n is not None and len(self.buffer)>=n:
                    raw=bytes(self.buffer[:n]); del self.buffer[:n]
                    parsed=decode_frame(raw,self.width)
                    self.received.append({'hex':raw.hex(),'length':len(raw),**parsed})
                    if parsed['kind']!='e5':
                        if parsed['link_address']!=self.profile['link_address']: raise ValueError('wrong link address')
                        if parsed['dfc']: raise ValueError('native DFC busy; verification unavailable')
                    return parsed
            self.sock.settimeout(self.remaining())
            data=self.sock.recv(1024)
            if not data: raise ConnectionError('EOF before native response')
            self.buffer.extend(data)
            if len(self.buffer)>4096: raise ValueError('bounded receive buffer exceeded')
    def reset(self,split=False):
        self.send(fixed(0x40,self.profile['link_address'],self.width),split)
        r=self.receive()
        if r['kind']!='e5' and (r['function']!=0 or r['asdu'] is not None): raise ValueError('Reset missing native ACK')
        self.fcb=1
    def status(self):
        self.send(fixed(0x49,self.profile['link_address'],self.width)); r=self.receive()
        if r['kind']!='fixed' or r['function']!=11: raise ValueError('Status must return native FC11')
        return r
    def poll(self,which,duplicate=None):
        control=0x50|(self.fcb<<5)|(10 if which==1 else 11)
        raw=fixed(control,self.profile['link_address'],self.width) if duplicate is None else duplicate
        self.send(raw); r=self.receive()
        if r['kind']!='e5' and r['function'] not in (8,9): raise ValueError('poll must return FC8/FC9/E5')
        if duplicate is None: self.fcb^=1
        return r,raw
    def check_asdu(self,a,cot):
        p=self.profile
        if a is None or a['type']!=1 or a['cot']!=cot or a['common_address']!=p['common_address'] or a['originator_address']!=(p['originator_address'] if self.width==2 else None) or a['ioa']!=p['point']['ioa'] or a['value']!=p['point']['value'] or a['quality']!=0:
            raise ValueError('native monitoring ASDU mismatch')
    def class2(self):
        r,raw=self.poll(2); self.check_asdu(r['asdu'],3)
        duplicate,_=self.poll(2,raw)
        if duplicate!=r: raise ValueError('duplicate FCB did not replay cached native ASDU')
        empty,_=self.poll(2)
        if empty['asdu'] is not None: raise ValueError('class2 queue not consumed exactly once')
        return {'point':r['asdu'],'duplicate_fcb_replayed':True,'empty_response':empty}
    def gi(self,split=False):
        frame=variable(0x53|(self.fcb<<5),self.profile['link_address'],self.width,gi_request(self.profile,self.width))
        self.send(frame,split); ack=self.receive()
        if ack['kind']!='e5' and (ack['function']!=0 or ack['asdu'] is not None): raise ValueError('confirmed GI missing native ACK')
        self.fcb^=1
        found={}; observations=[]
        # Actual ACD prioritizes class1; class2 advances the native lazy GI.
        previous=ack
        for _ in range(12):
            which=1 if previous.get('acd',False) else 2
            r,_=self.poll(which); previous=r; a=r['asdu']; observations.append(r)
            if a is not None:
                if a['type']==1:
                    if a['cot']==20:
                        if 'activation_confirmation' not in found: raise ValueError('GI data before ACT_CON')
                        self.check_asdu(a,20); found['data']=a
                    elif a['cot']==3: self.check_asdu(a,3)
                    else: raise ValueError('unexpected monitoring COT')
                elif a['type']==100:
                    if a['common_address']!=self.profile['common_address'] or a['originator_address']!=(self.profile['originator_address'] if self.width==2 else None) or a['cot'] not in (7,10): raise ValueError('GI confirmation address/COT mismatch')
                    if a['cot']==10 and 'data' not in found: raise ValueError('ACT_TERM before GI data')
                    found['activation_confirmation' if a['cot']==7 else 'activation_termination']=a
            if len(found)==3: return {'gi':found,'polls':observations,'link_ack_only_is_success':False}
        raise ValueError('GI did not produce native ACT_CON, M_SP COT20 and ACT_TERM')
    def stream(self):
        self.reset(split=True)
        self.send(fixed(0x49,self.profile['link_address'],self.width)*2)
        for _ in range(2):
            r=self.receive()
            if r['kind']!='fixed' or r['function']!=11: raise ValueError('coalesced Status reply mismatch')
        return {'fragmented_fixed':True,'coalesced_status_count':2,**self.gi(split=True)}
    def close(self):
        try:
            if self.buffer: raise ValueError('unconsumed extra/partial native response')
            self.sock.shutdown(socket.SHUT_WR)
            while True:
                self.sock.settimeout(self.remaining())
                data=self.sock.recv(1024)
                if not data: return
                raise ValueError('unexpected bytes during orderly close')
        finally: self.sock.close()

def run_check(args,cfg,name,method,round_number,global_deadline):
    start=time.monotonic(); p=cfg[name]; width=1 if name=='single' else 2
    port=args.port if name=='single' else args.secondary_port
    deadline=min(global_deadline,start+3)
    s=None; result={'name':f'{method}/{name}/round-{round_number}','passed':False,'request':{'channel':name,'host':args.host,'port':port,'method':method},'response':{}}
    try:
        s=Session(args.host,port,p,width,deadline)
        if method=='STREAM': details=s.stream()
        else:
            s.reset()
            details=s.status() if method=='RESET_STATUS' else s.class2() if method=='CLASS2' else s.gi()
        result['response']['result']=details
        result['passed']=True
    except Exception as error: result['error']=type(error).__name__+': '+str(error)[:256]
    finally:
        if s is not None:
            try: s.close()
            except Exception as error:
                result['passed']=False; result['error']='orderly close: '+type(error).__name__+': '+str(error)[:256]
            result['request']['frames']=s.sent
            result['response']['frames']=s.received
    result['seconds']=round(time.monotonic()-start,6)
    return result

def main():
    started=time.monotonic(); checks=[]
    report={'passed':False,'checks':checks,'summary':{'total':0,'passed':0,'failed':0}}
    try:
        def alarm(_sig,_frame): raise TimeoutError('30 second overall deadline exceeded')
        signal.signal(signal.SIGALRM,alarm); signal.alarm(30)
        parser=argparse.ArgumentParser(description=__doc__)
        parser.add_argument('--host',required=True); parser.add_argument('--port',type=int,required=True)
        parser.add_argument('--secondary-port',type=int,required=True)
        parser.add_argument('--method',choices=METHODS+('ALL',),default='ALL')
        parser.add_argument('--path',choices=('dual','single','double'),default='dual')
        parser.add_argument('--config-json',required=True)
        try: args=parser.parse_args()
        except SystemExit as error:
            if error.code==0: return 0
            raise ValueError('invalid client arguments') from None
        cfg=load_config(args.config_json)
        for p in (args.port,args.secondary_port):
            if not 1<=p<=65535: raise ValueError('port out of range')
        channels=('single','double') if args.path=='dual' else (args.path,)
        methods=METHODS if args.method=='ALL' else (args.method,)
        deadline=started+30
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            for method in methods:
                for round_number in (1,2):
                    futures=[pool.submit(run_check,args,cfg,name,method,round_number,deadline) for name in channels]
                    checks.extend(f.result() for f in futures)
        report['passed']=all(c['passed'] for c in checks)
        report['dual_sessions_concurrent']=len(channels)==2
    except Exception as error: report['error']=type(error).__name__+': '+str(error)[:256]
    finally: signal.alarm(0)
    report['summary']={'total':len(checks),'passed':sum(c['passed'] for c in checks),'failed':sum(not c['passed'] for c in checks)}
    report['seconds']=round(time.monotonic()-started,6)
    encoded=json.dumps(report,separators=(',',':'))
    if len(encoded.encode())>524288:
        report={'passed':False,'error':'bounded report size exceeded','summary':report['summary'],'checks':[]}
        encoded=json.dumps(report,separators=(',',':'))
    print(encoded)
    return 0 if report['passed'] else 1
if __name__=='__main__': sys.exit(main())
