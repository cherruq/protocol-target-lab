#!/usr/bin/env python3
"""MIT. Fresh causal ARP validation over the real fixed-return VXLAN endpoint."""
import argparse
import hashlib
import ipaddress
import json
import secrets
import select
import signal
import socket
import struct
import sys
import time
import urllib.parse
from vxlan_wire import Transport,summary,load_config,canonical_hash,decode,PacketError

METHODS=('ARP','RESERVED_BITS','REQUEST_THA','INVALID_REQUEST')
class Observer:
    def __init__(self,args,cfg):self.args=args;self.cfg=cfg
    def get(self,path,deadline):
        left=min(1,deadline-time.monotonic())
        if left<=0:raise TimeoutError('observer absolute deadline')
        end=time.monotonic()+left
        conn=socket.create_connection((self.args.observer_host,self.args.observer_port),timeout=left)
        def remaining():
            budget=end-time.monotonic()
            if budget<=0:raise TimeoutError('observer absolute1s deadline exceeded')
            conn.settimeout(budget)
        try:
            remaining();conn.sendall(('GET '+path+' HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n').encode('ascii'))
            data=bytearray()
            while b'\r\n\r\n' not in data:
                remaining();chunk=conn.recv(4096)
                if not chunk:raise ValueError('observer EOF before HTTP headers')
                data.extend(chunk)
                if len(data)>8192:raise ValueError('observer header budget exceeded')
            head,body=bytes(data).split(b'\r\n\r\n',1)
            lines=head.decode('ascii').split('\r\n')
            if len(lines[0].split(' '))<2 or lines[0].split(' ')[1]!='200':raise ValueError('observer HTTP status rejected')
            lengths=[line.split(':',1)[1].strip() for line in lines[1:] if line.lower().startswith('content-length:')]
            if len(lengths)!=1 or not lengths[0].isdigit() or len(lengths[0])>5:raise ValueError('observer Content-Length missing/invalid')
            length=int(lengths[0])
            if length>65536:raise ValueError('observer response too large')
            while len(body)<length:
                remaining();chunk=conn.recv(min(4096,length-len(body)))
                if not chunk:raise ValueError('observer truncated body')
                body+=chunk
            if len(body)!=length:raise ValueError('observer excess body')
            remaining();obj=json.loads(body)
        finally:conn.close()
        if obj.get('schema_version')!=1 or obj.get('protocol')!='vxlan' or obj.get('boot_id')!=self.args.expected_boot_id or obj.get('runtime_id')!=self.args.expected_runtime_id:raise ValueError('observer source boot/runtime identity mismatch')
        if path=='/v1/status':
            if obj.get('config_sha256')!=canonical_hash(self.cfg) or not obj.get('worker_ready_after_bind') or not 0<=obj.get('event_loop_age_ms',999999)+(time.monotonic()-(end-left))*1000<=2000:raise ValueError('observer config/readiness/main-loop heartbeat mismatch')
        return obj
    def status(self,deadline):return self.get('/v1/status',deadline)

def request_bytes(cfg,method,round_number):
    im=bytes.fromhex(cfg['inner_mac'].replace(':',''));rm=bytes.fromhex(cfg['requester_mac'].replace(':',''))
    nonce=secrets.token_bytes(16)
    flags=0x18 if method=='RESERVED_BITS' else 8
    reserved=b'\x01\x02\x03\x04' if method=='RESERVED_BITS' else bytes(4)
    destination=im if method=='ARP' and round_number==2 else b'\xff'*6
    tha=(b'\xff'*6 if round_number==1 else bytes.fromhex('02123456789a')) if method=='REQUEST_THA' else bytes(6)
    vni=cfg['vni'];tpa=socket.inet_aton(cfg['inner_ip']);reason=None
    if method=='INVALID_REQUEST':
        if round_number==1:vni=(vni+1)&0xffffff;reason='wrong_vni'
        else:tpa=tpa[:3]+bytes([tpa[3]^1]);reason='wrong_target_ip'
    vx=bytes([flags])+reserved[:3]+vni.to_bytes(3,'big')+reserved[3:]
    raw=vx+destination+rm+b'\x08\x06'+struct.pack('!HHBBH',1,0x0800,6,4,1)+rm+socket.inet_aton(cfg['requester_ip'])+tha+tpa+nonce+b'\0\0'
    normal=b'\x08\0\0\0'+cfg['vni'].to_bytes(3,'big')+b'\0'+rm+im+b'\x08\x06'+struct.pack('!HHBBH',1,0x0800,6,4,2)+im+socket.inet_aton(cfg['inner_ip'])+rm+socket.inet_aton(cfg['requester_ip'])+bytes(cfg['reply_padding'])
    expected=bytearray(normal);mode=cfg['scenario']['mode']
    if mode=='silent':wire=None
    elif mode=='short-header':wire=normal[:7]
    elif mode=='short-arp':wire=normal[:49]
    else:
        if mode=='wrong-vni':expected[4:7]=((cfg['vni']+1)&0xffffff).to_bytes(3,'big')
        elif mode=='clear-i':expected[0]&=0xf7
        else:
            offset={'wrong-eth-dst':13,'wrong-sha':35,'wrong-spa':39,'wrong-tha':45,'wrong-tpa':49}.get(mode)
            if offset is not None:expected[offset]^=1
        wire=bytes(expected)
    return raw,normal,wire,reason

def run_check(args,cfg,observer,method,round_number,global_deadline):
    start=time.monotonic();deadline=min(global_deadline,start+3);transport=None
    result={'name':method+'/round-'+str(round_number),'passed':False,'request':{'method':method,'target':[args.host,args.port],'scenario':cfg['scenario']},'response':{}}
    try:
        before=observer.status(deadline)
        excluded=(cfg['port'],cfg['source_port']) if cfg['bind_ip']==cfg['peer_ip'] else ()
        transport=Transport(cfg['peer_ip'],cfg['peer_port'],excluded=excluded)
        before=observer.status(deadline)
        request,normal,expected,rejection=request_bytes(cfg,method,round_number);info=summary(request);sha=info['raw_sha256']
        result['request'].update(**info,source=[cfg['peer_ip'],transport.source_port],fixed_reply_endpoint=[cfg['peer_ip'],cfg['peer_port']])
        cursor=before['next_event_id']-1;events=[];rx=[];received_wire=None;received_hash=None;discarded=0
        transport.send(request,args.host,args.port);sent=time.monotonic();quiet_end=sent+.5;next_observe=0
        while True:
            now=time.monotonic()
            if now>=deadline:raise TimeoutError('absolute3s check deadline exceeded')
            ready=select.select([transport.receiver,transport.sender],[],[],min(.02,deadline-now))[0]
            for sock in ready:
                for _ in range(32):
                    if time.monotonic()>=deadline:raise TimeoutError('absolute check deadline under UDP load')
                    try:raw,meta=transport.receive(sender=sock is transport.sender)
                    except BlockingIOError:break
                    if meta['source']!=[cfg['bind_ip'],cfg['source_port']]:
                        discarded+=1
                        if discarded>64:raise ValueError('foreign UDP observation budget exceeded')
                        continue
                    if meta['truncated_datagram']:raise ValueError('truncated actual response')
                    if sock is transport.sender:raise ValueError('target replied to Request source port instead of fixed peer_port')
                    if rejection is not None or expected is None:raise ValueError('unexpected target Reply for rejected/silent Request')
                    if raw!=expected:raise ValueError('actual target wire does not match exact configured mode transform')
                    if received_wire is not None:raise ValueError('duplicate target Reply for single Request')
                    received_wire=raw;received_hash=summary(raw)['raw_sha256'];row={**meta,**summary(raw)}
                    try:row['decoded']=decode(raw).fields()
                    except PacketError as error:row['expected_decode_error']=str(error)
                    rx.append(row)
            now=time.monotonic()
            if now>=next_observe:
                observer.status(deadline)
                path='/v1/events?'+urllib.parse.urlencode({'after_event_id':cursor,'limit':16,'request_sha256':sha})
                page=observer.get(path,deadline)
                if page['truncated']:raise ValueError('unexpected excess causal events for a single Request')
                events=page['events'];next_observe=now+.05
            accepted=[e for e in events if e['kind']=='rx_accepted'];rejected=[e for e in events if e['kind']=='rx_rejected'];sends=[e for e in events if e['kind']=='tx_actual'];suppressed=[e for e in events if e['kind']=='tx_suppressed']
            complete=False
            if rejection is not None:
                if accepted or sends or suppressed:raise ValueError('invalid Request caused business acceptance/output')
                complete=len(rejected)==1 and rejected[0].get('reason')==rejection
            else:
                if rejected:raise ValueError('valid Request unexpectedly rejected')
                if len(accepted)==1:
                    if expected is None:complete=len(suppressed)==1 and not sends
                    elif len(sends)==1 and not suppressed and received_wire is not None:complete=sends[0].get('raw_sha256')==received_hash
            if complete and now>=quiet_end:
                ids={e['request_id'] for e in events}
                if len(ids)!=1 or any(e['request_sha256']!=sha or e['event_id']<=cursor for e in events):raise ValueError('causal Request identity mismatch')
                for event in sends+suppressed:
                    intent=event.get('normal_reply_intent',{})
                    if intent.get('raw_sha256')!=summary(normal)['raw_sha256'] or event.get('source')!=[cfg['bind_ip'],cfg['source_port']] or event.get('destination')!=[cfg['peer_ip'],cfg['peer_port']]:raise ValueError('normal intent/fixed endpoints mismatch')
                final=observer.status(deadline)
                result['response'].update(no_wire_response=received_wire is None,wire=rx,request_id=next(iter(ids)),causal_events=events,source_boot_id=final['boot_id'],fixed_return_verified=received_wire is not None,no_direct_echo_observed=True,quiet_observed_seconds=round(now-sent,6),discarded_foreign_packets=discarded)
                result['passed']=True;break
    except Exception as error:result['error']=type(error).__name__+': '+str(error)[:300]
    finally:
        if transport is not None:transport.close()
    result['seconds']=round(time.monotonic()-start,6)
    return result

def main():
    started=time.monotonic();report={'passed':False,'checks':[]}
    try:
        def alarm(_sig,_frame):raise TimeoutError('30s overall VXLAN deadline exceeded')
        signal.signal(signal.SIGALRM,alarm);signal.alarm(30)
        parser=argparse.ArgumentParser(description=__doc__)
        parser.add_argument('--host',required=True);parser.add_argument('--port',type=int,required=True)
        parser.add_argument('--method',choices=METHODS+('ALL',),default='ALL');parser.add_argument('--path',choices=('arp',),default='arp')
        parser.add_argument('--config-json',required=True);parser.add_argument('--observer-host',default='127.0.0.1');parser.add_argument('--observer-port',type=int,default=18085)
        parser.add_argument('--expected-boot-id',required=True);parser.add_argument('--expected-runtime-id',required=True)
        try:args=parser.parse_args()
        except SystemExit as error:
            if error.code==0:return 0
            raise ValueError('invalid client arguments') from None
        cfg=load_config(args.config_json)
        if args.host!=cfg['bind_ip'] or args.port!=cfg['port']:raise ValueError('target must match applied endpoint')
        if not ipaddress.IPv4Address(args.observer_host).is_loopback or not 1<=args.observer_port<=65535:raise ValueError('observer must be loopback control')
        observer=Observer(args,cfg);deadline=started+30
        for method in METHODS if args.method=='ALL' else (args.method,):
            for round_number in (1,2):
                check=run_check(args,cfg,observer,method,round_number,deadline);report['checks'].append(check)
                if not check['passed']:raise ValueError('check failed; no further requests sent')
        report['passed']=all(c['passed'] for c in report['checks']);report['applied_mode']=cfg['scenario']['mode'];report['all_means_current_mode']=True
    except Exception as error:report['error']=type(error).__name__+': '+str(error)[:300]
    finally:signal.alarm(0)
    checks=report['checks'];report['summary']={'total':len(checks),'passed':sum(c['passed'] for c in checks),'failed':sum(not c['passed'] for c in checks)};report['seconds']=round(time.monotonic()-started,6)
    raw=json.dumps(report,separators=(',',':'))
    if len(raw.encode())>524288:report={'passed':False,'checks':[],'summary':report['summary'],'error':'report exceeds512KiB'};raw=json.dumps(report)
    print(raw);return 0 if report['passed'] else 1
if __name__=='__main__':sys.exit(main())
