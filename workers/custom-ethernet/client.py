#!/usr/bin/env python3
"""MIT. Real inverse Ethernet peer; observer is evidence, never a protocol ACK."""
import argparse
import json
import ipaddress
import select
import signal
import time
import urllib.parse
from ethernet_wire import *

class GlobalDeadline(TimeoutError):pass

class Observer:
    def __init__(self,host,port,boot,runtime,cfg):self.host=host;self.port=port;self.boot=boot;self.runtime=runtime;self.cfg=canonical_hash(cfg);self.remaining=1.;self.phase=0
    def get(self,path):
        start=time.monotonic();deadline=min(start+self.remaining,self.phase)
        if deadline<=start:raise TimeoutError('shared observer/check deadline')
        sock=None
        try:
            sock=socket.create_connection((self.host,self.port),timeout=deadline-start)
            sock.settimeout(max(.0001,deadline-time.monotonic()));sock.sendall(('GET '+path+' HTTP/1.1\r\nHost: observer\r\nConnection: close\r\n\r\n').encode('ascii'))
            data=bytearray()
            while b'\r\n\r\n' not in data:
                left=deadline-time.monotonic()
                if left<=0:raise TimeoutError('absolute observer budget')
                sock.settimeout(left);chunk=sock.recv(1024)
                if not chunk:raise ValueError('short observer headers')
                data.extend(chunk)
                if len(data)>8192:raise ValueError('observer headers exceed8KiB')
            head,body=bytes(data).split(b'\r\n\r\n',1);lines=head.decode('ascii').split('\r\n')
            if lines[0].split(' ')[1]!='200':raise ValueError('observer HTTP status')
            headers={}
            for line in lines[1:]:
                key,sep,value=line.partition(':');key=key.lower()
                if not sep or key in headers:raise ValueError('observer malformed/duplicate header')
                headers[key]=value.strip()
            if 'transfer-encoding' in headers or not re.fullmatch('[0-9]{1,6}',headers.get('content-length','')):raise ValueError('observer fixed framing required')
            size=int(headers['content-length'])
            if size>65536:raise ValueError('observer response exceeds64KiB')
            data=bytearray(body)
            while len(data)<size:
                left=deadline-time.monotonic()
                if left<=0:raise TimeoutError('absolute observer budget')
                sock.settimeout(left);chunk=sock.recv(min(4096,size-len(data)))
                if not chunk:raise ValueError('short observer body')
                data.extend(chunk)
            if len(data)!=size:raise ValueError('observer extra body bytes')
            v=json.loads(data)
            if v.get('boot_id')!=self.boot or v.get('runtime_id')!=self.runtime:raise ValueError('source boot/runtime identity changed')
            if v.get('protocol')!='custom-ethernet' or v.get('schema_version')!=1:raise ValueError('observer schema mismatch')
            if path=='/v1/status':
                if v.get('config_sha256')!=self.cfg or not v.get('worker_ready_after_bind') or v.get('event_loop_age_ms',99999)>2000:raise ValueError('source config/readiness/heartbeat mismatch')
            return v
        finally:
            if sock:sock.close()
            self.remaining-=time.monotonic()-start

def restore_response(raw,flags,ancillary):
    """Capture integrity and actual AUXDATA only; configured raw TX is opaque."""
    if flags&(socket.MSG_TRUNC|socket.MSG_CTRUNC):raise PacketError('truncated_capture')
    if len(raw)>MAX_FRAME or len(raw)>=SNAPLEN:raise PacketError('original_frame_oversize')
    if len(raw)<14:raise PacketError('short_ethernet')
    aux=None;seen=False
    for level,kind,data in ancillary:
        if level==263 and kind==8:
            if seen or len(data)<20:raise PacketError('invalid_auxdata')
            seen=True
            status,length,snap,net,macoff,tci,tpid=struct.unpack('IIIHHHH',data[:20])
            if status&(1<<4):aux={'tci':tci,'tpid':tpid if status&(1<<6) else 0x8100,'tpid_from_auxdata':bool(status&(1<<6))}
    frame=raw if aux is None else raw[:12]+struct.pack('!HH',aux['tpid'],aux['tci'])+raw[12:]
    if len(frame)>MAX_FRAME:raise PacketError('normalized_frame_oversize')
    decoded={'opaque':True,'destination_mac':mac_text(frame[:6]),'source_mac':mac_text(frame[6:12]),'outer_ether_type':int.from_bytes(frame[12:14],'big'),'vlan':None if aux is None else {'auxdata':aux}}
    return frame,decoded

def matching_frame(actual,expected,original=None,decoded=None):
    if actual==expected:return 'exact'
    if len(expected)<60 and len(actual)==60 and actual==expected+bytes(60-len(expected)):return 'driver_zero_padding_to60'
    if original is not None and len(expected)<64 and len(original)==60 and len(actual)==64 and decoded and decoded.get('vlan') and decoded['vlan'].get('auxdata') and actual==expected+bytes(64-len(expected)):return 'auxdata_restored_tag_with_driver_padding'
    return None

def drain(t):
    end=time.monotonic()+.05
    for _ in range(256):
        if time.monotonic()>=end:raise ValueError('peer input cannot be drained within bounded window')
        try:t.receive()
        except BlockingIOError:return
    raise ValueError('peer input flood before test')

def exchange(t,o,c,deadline):
    request=bytes.fromhex(c['test_request']['frame_hex']);reply=response_frame(c);drain(t)
    baseline=o.get('/v1/status');cursor=baseline['next_event_id']-1
    sent_at=time.monotonic();t.send(request);rx_deadline=min(deadline,sent_at+.75);observed=None
    while time.monotonic()<rx_deadline:
        select.select([t.socket],[],[],max(0,rx_deadline-time.monotonic()))
        for _ in range(32):
            try:raw,anc,flags,meta=t.receive()
            except BlockingIOError:break
            if meta['packet_type']==4:continue
            try:normalized,decoded=restore_response(raw,flags,anc)
            except PacketError:continue
            relation=matching_frame(normalized,reply,raw,decoded)
            if relation:
                observed={'original':summary(raw),'normalized':summary(normalized),'decoded':decoded,'metadata':meta,'relation':relation};break
        if observed:break
    if observed is None:raise TimeoutError('no actual incoming fixed response on peer interface')
    quiet_end=min(deadline,time.monotonic()+.05)
    while time.monotonic()<quiet_end:
        select.select([t.socket],[],[],max(0,quiet_end-time.monotonic()))
        for _ in range(32):
            try:raw,anc,flags,meta=t.receive()
            except BlockingIOError:break
            if meta['packet_type']==4:continue
            try:n,d=restore_response(raw,flags,anc)
            except PacketError:continue
            if matching_frame(n,reply,raw,d):raise ValueError('duplicate matching incoming response during quiet window')
    proof=None
    while time.monotonic()<deadline:
        events=o.get('/v1/events?after_event_id='+str(cursor)+'&limit=16')
        if events.get('cache_evictions',0)>baseline.get('cache_evictions',0):raise ValueError('source event cache evicted during proof')
        accepted=[e for e in events['events'] if e['kind']=='rx_accepted' and e['normalized']['raw_sha256']==summary(request)['raw_sha256']]
        for event in accepted:
            sent=[e for e in events['events'] if e['kind']=='tx_actual' and e['request_id']==event['request_id'] and e['request_sha256']==event['request_sha256'] and e['raw_sha256']==summary(reply)['raw_sha256']]
            if sent:
                if len(accepted)!=1 or len(sent)!=1:raise ValueError('ambiguous multiple source causal events')
                proof={'received':event,'sent':sent[0]};break
        if proof:break
        time.sleep(min(.01,max(0,deadline-time.monotonic())))
    if proof is None:raise TimeoutError('no fresh exact source receive/send causal proof')
    return {'request':summary(request),'response':observed,'source_proof':proof,'seconds':round(time.monotonic()-sent_at,6)}

def run_check(method,round_no,t,o,c):
    start=time.monotonic();deadline=start+4.;o.remaining=1.;o.phase=deadline
    report={'name':method+' round '+str(round_no),'passed':False,'request':{'method':method,'path':'frame','interface':t.interface,'fixture':summary(bytes.fromhex(c['test_request']['frame_hex']))},'response':{'exchanges':[]}}
    try:
        before=o.get('/v1/status')
        for _ in range(1 if method=='ROUNDTRIP' else 3):report['response']['exchanges'].append(exchange(t,o,c,deadline))
        after=o.get('/v1/status')
        if before['interface']!=after['interface'] or before['filter']!=after['filter'] or before['library']!=after['library']:raise ValueError('source socket/filter/interface identity changed')
        report['response']['source_before']={'boot_id':before['boot_id'],'runtime_id':before['runtime_id'],'next_event_id':before['next_event_id']}
        report['response']['source_after']={'boot_id':after['boot_id'],'runtime_id':after['runtime_id'],'next_event_id':after['next_event_id']}
        report['passed']=True
    except GlobalDeadline:raise
    except Exception as e:report['error']=type(e).__name__+': '+str(e)[:512]
    report['seconds']=round(time.monotonic()-start,6);return report

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--observer-host',required=True);p.add_argument('--observer-port',type=int,default=18087);p.add_argument('--interface',required=True);p.add_argument('--expected-boot-id',required=True);p.add_argument('--expected-runtime-id',required=True);p.add_argument('--method',choices=('ROUNDTRIP','REPEAT','ALL'),default='ALL');p.add_argument('--path',choices=('frame',),default='frame');config_arguments(p)
    a=p.parse_args();start=time.monotonic();checks=[];t=None;report={'protocol':'custom-ethernet','passed':False,'checks':checks,'limitations':['Fixed opaque frames have no wire transaction identifier; late identical frame ambiguity remains.','Observer HTTP is read-only evidence; Ethernet has no application ACK.']}
    def expired(_s,_f):raise GlobalDeadline('30-second global deadline')
    signal.signal(signal.SIGALRM,expired);signal.alarm(30)
    try:
        c=config_from_arguments(a);integer(a.observer_port,1,65535);ipaddress.IPv4Address(a.observer_host);actual=interface_info(a.interface)
        if actual['mac']!=c['peer_mac']:raise ValueError('actual peer interface MAC mismatch')
        mtu_check(bytes.fromhex(c['test_request']['frame_hex']),actual['mtu'])
        reply=response_frame(c);dest=reply[:6];groups=[mac_text(dest)] if dest[0]&1 and dest!=b'\xff'*6 else []
        t=Transport(a.interface,memberships=groups)
        o=Observer(a.observer_host,a.observer_port,a.expected_boot_id,a.expected_runtime_id,c)
        for method in (('ROUNDTRIP','REPEAT') if a.method=='ALL' else (a.method,)):
            for n in (1,2):checks.append(run_check(method,n,t,o,c))
        report['passed']=all(x['passed'] for x in checks)
    except Exception as e:report['error']=type(e).__name__+': '+str(e)[:512]
    finally:
        if t:t.close()
        signal.alarm(0)
    report['summary']={'total':len(checks),'passed':sum(x['passed'] for x in checks),'failed':sum(not x['passed'] for x in checks),'actual_exchanges':sum(len(x['response']['exchanges']) for x in checks)};report['seconds']=round(time.monotonic()-start,6)
    raw=json.dumps(report,separators=(',',':'))
    if len(raw.encode())>524288:raw=json.dumps({'passed':False,'checks':[],'error':'report byte budget exceeded','summary':{'total':0,'passed':0,'failed':0}});report['passed']=False
    print(raw);return 0 if report['passed'] else 1
if __name__=='__main__':raise SystemExit(main())
