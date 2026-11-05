#!/usr/bin/env python3
"""MIT. Persistent finite MPLS/IPv4 Echo target; no kernel routing changes."""
import argparse
from collections import deque
import json,os,queue,re,select,signal,socket,threading,time,urllib.parse,uuid
from mpls_wire import *

class Worker:
    def __init__(self,cfg,runtime):
        self.cfg=cfg;self.runtime=runtime;self.boot=str(uuid.uuid4());self.born=time.monotonic();self.heartbeat=self.born;self.lock=threading.RLock();self.stopping=threading.Event();self.ready=False;self.fatal=None;self.transport=None;self.observer=None;self.observer_thread=None
        self.events=deque(maxlen=256);self.next_id=1;self.next_request=1;self.evictions=0;self.last_request=None;self.last_output=None;self.addresses=[];self.real_gateways=[]
        self.counters={k:0 for k in ('rx_frames','accepted','rejected','expired','tx_submitted','suppressed','tx_error','ignored','log_dropped')};self.logs=queue.Queue(256);self.slots=threading.BoundedSemaphore(8);self.logger=threading.Thread(target=self.log_loop,daemon=True);self.logger.start()
    def event(self,kind,request_id,request_sha,frame,**fields):
        with self.lock:
            event={'event_id':self.next_id,'monotonic_ms_since_boot':int((time.monotonic()-self.born)*1000),'kind':kind,'request_id':request_id,'request_sha256':request_sha,'frame':summary(frame),**fields};self.next_id+=1
            if len(self.events)==256:self.evictions+=1
            self.events.append(event)
            if kind in ('accepted','rejected'):self.last_request=event
            else:self.last_output=event
            try:self.logs.put_nowait({'event':'mpls',**event})
            except queue.Full:self.counters['log_dropped']+=1
            return event
    def status(self):
        with self.lock:
            return {'schema_version':1,'protocol':'mpls','boot_id':self.boot,'runtime_id':self.runtime,'config_sha256':canonical_hash(self.cfg),'worker_ready_after_bind':self.ready,'uptime_ms':int((time.monotonic()-self.born)*1000),'event_loop_age_ms':int((time.monotonic()-self.heartbeat)*1000),'interface':self.transport.interface if self.transport else None,'link_mode':self.cfg['link']['mode'],'scenario':self.cfg['scenario']['mode'],'label':self.cfg['label'],'reply_ttl':self.cfg['reply_ttl'],'filter':self.transport.proof() if self.transport else None,'packet_auxdata':True,'counters':dict(self.counters),'last_request':self.last_request,'last_output':self.last_output,'next_event_id':self.next_id,'cache_evictions':self.evictions,'actual_ipv4':self.addresses[:128],'actual_ipv4_truncated':len(self.addresses)>128,'actual_gateways':self.real_gateways}
    def query_events(self,after,limit,request_sha=None):
        with self.lock:
            matched=[e for e in self.events if e['event_id']>after and (request_sha is None or e['request_sha256']==request_sha)];result={'schema_version':1,'protocol':'mpls','boot_id':self.boot,'runtime_id':self.runtime,'events':[],'matched':len(matched),'returned':0,'truncated':False,'next_event_id':self.next_id,'cache_evictions':self.evictions}
            for event in matched[:limit]:
                result['events'].append(event)
                if len(json.dumps(result,separators=(',',':')).encode())>64000:result['events'].pop();break
            result['returned']=len(result['events']);result['truncated']=len(matched)>result['returned'];return result
    def process(self,raw,meta):
        with self.lock:
            if meta['packet_type']==4:self.counters['ignored']+=1;return
            self.counters['rx_frames']+=1;rid=self.next_request;self.next_request+=1;sha=summary(raw)['sha256'];p=None
            try:
                if meta['truncated']:raise PacketError('truncated_capture')
                if meta['interface']!=self.transport.interface['name'] or meta['ifindex']!=self.transport.interface['ifindex'] or meta['hardware_type']!=1:raise PacketError('wrong_interface')
                if meta.get('vlan_valid'):raise PacketError('unsupported_vlan')
                if len(raw)-14>self.transport.interface['mtu']:raise PacketError('frame_exceeds_actual_mtu')
                p=decode_request(raw)
                if meta['hardware_address']!=p['ethernet_source']:raise PacketError('source_metadata_mismatch')
                validate_request(p,self.cfg)
            except PacketError as error:
                self.counters['rejected']+=1;self.counters['expired']+=str(error)=='mpls_ttl_expired';self.event('rejected',rid,sha,raw,reason=str(error),metadata=meta,decoded=decoded(p) if p else None);return
            self.counters['accepted']+=1;self.event('accepted',rid,sha,raw,metadata=meta,decoded=decoded(p));ipid=self.counters['accepted']&65535;wire=reply_frame(p,self.cfg,ipid)
            if wire is None:self.counters['suppressed']+=1;self.event('suppressed',rid,sha,b'',scenario=self.cfg['scenario']['mode'],reply_ip_identifier=ipid);return
            try:self.transport.send(wire)
            except OSError as error:
                self.counters['tx_error']+=1;self.event('tx_error',rid,sha,wire,errno=error.errno,error=str(error)[:256],reply_ip_identifier=ipid,scenario=self.cfg['scenario']['mode'],submitted=False);return
            self.counters['tx_submitted']+=1;self.event('tx_submitted',rid,sha,wire,reply_ip_identifier=ipid,scenario=self.cfg['scenario']['mode'],submitted=True)
    def refresh_addresses(self):
        role_preflight(self.cfg);addresses=ipv4_addresses();gateways=[]
        for line in Path('/proc/net/route').read_text().splitlines()[1:]:
            row=line.split()
            if len(row)>=3 and int(row[2],16):gateways.append(socket.inet_ntoa(struct.pack('<I',int(row[2],16))))
        if len(gateways)>128:raise ValueError('actual gateway proof budget')
        with self.lock:self.addresses=addresses;self.real_gateways=sorted(set(gateways))
    def run(self):
        try:
            self.refresh_addresses();name=self.cfg['link'].get('interface','eth0');self.transport=Transport(name,self.cfg['source_mac'],True)
            self.observer=socket.socket();self.observer.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);self.observer.bind(('0.0.0.0' if self.cfg['link']['mode']=='docker-bridge' else '127.0.0.1',18089));self.observer.listen(16);self.observer.settimeout(.2);self.observer_thread=threading.Thread(target=self.serve,daemon=True);self.observer_thread.start();self.ready=True
            self.logs.put_nowait({'event':'ready','boot_id':self.boot,'runtime_id':self.runtime,'config_sha256':canonical_hash(self.cfg),'interface':self.transport.interface,'filter':self.transport.proof()});last=0
            while not self.stopping.is_set():
                if self.fatal:raise RuntimeError(self.fatal)
                with self.lock:self.heartbeat=time.monotonic()
                if time.monotonic()-last>=.5:self.refresh_addresses();last=time.monotonic()
                select.select([self.transport.socket],[],[],.02)
                for _ in range(32):
                    if self.stopping.is_set():break
                    try:raw,meta=self.transport.receive()
                    except BlockingIOError:break
                    self.process(raw,meta)
            return 0
        except BaseException as error:
            self.fatal=type(error).__name__+': '+str(error)[:256]
            try:self.logs.put_nowait({'event':'fatal','error':self.fatal})
            except queue.Full:pass
            return 1
        finally:
            self.ready=False;self.stopping.set()
            if self.transport:self.transport.close()
            if self.observer:self.observer.close()
            if self.observer_thread:self.observer_thread.join(.4)
            try:self.logs.put_nowait({'event':'stopped','counters':self.counters,'error':self.fatal})
            except queue.Full:pass
            self.logger.join(.4)
    def log_loop(self):
        try:
            while True:
                item=self.logs.get()
                if item is None:return
                print(json.dumps(item,separators=(',',':')),flush=True)
        except Exception as e:self.fatal='stdout logger failed: '+type(e).__name__
    def serve_connection(self,conn):
        deadline=time.monotonic()+1
        try:
            data=bytearray()
            while b'\r\n\r\n' not in data:
                left=deadline-time.monotonic()
                if left<=0:raise TimeoutError()
                conn.settimeout(left);chunk=conn.recv(min(1024,8193-len(data)))
                if not chunk:return
                data.extend(chunk)
                if len(data)>8192:raise ValueError('headers too large')
            head=bytes(data).split(b'\r\n\r\n',1)[0].decode('ascii')
            lines=head.split('\r\n');method,target,version=lines[0].split(' ')
            if version not in ('HTTP/1.0','HTTP/1.1'):raise ValueError('HTTP version')
            for line in lines[1:]:
                key,sep,value=line.partition(':')
                if not sep or key.lower()=='transfer-encoding' or (key.lower()=='content-length' and value.strip()!='0'):raise ValueError('request body not accepted')
            code=200
            if method!='GET':code=405;obj={'error':'read-only GET only'}
            else:
                url=urllib.parse.urlsplit(target)
                if url.scheme or url.netloc or url.fragment or not target.startswith('/'):raise ValueError('relative request target required')
                if url.path=='/v1/status' and not url.query:obj=self.status()
                elif url.path=='/v1/events':
                    q=urllib.parse.parse_qs(url.query,strict_parsing=True)
                    if not {'after','limit'}<=set(q) or set(q)-{'after','limit'} or any(len(v)!=1 for v in q.values()):raise ValueError('event query parameters')
                    if any(not re.fullmatch(r'[0-9]{1,20}',q[k][0]) for k in ('after','limit')):raise ValueError('event query numbers')
                    after,limit=(int(q[k][0]) for k in ('after','limit'))
                    request_sha=None
                    if request_sha is not None and not re.fullmatch('[0-9a-f]{64}',request_sha):raise ValueError('request SHA query')
                    if not 0<=after<=2**63-1 or not 1<=limit<=16:raise ValueError('query range')
                    obj=self.query_events(after,limit,request_sha)
                else:code=404;obj={'error':'unknown read-only endpoint'}
            body=json.dumps(obj,separators=(',',':')).encode()
            if len(body)>65536:raise ValueError('response budget exceeded')
            remaining=deadline-time.monotonic()
            if remaining<=0:return
            conn.settimeout(remaining)
            conn.sendall(f'HTTP/1.1 {code} Response\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\nConnection: close\r\nAllow: GET\r\n\r\n'.encode()+body)
        except (OSError,ValueError,UnicodeError):pass
        finally:conn.close();self.slots.release()
    def serve(self):
        try:
            while not self.stopping.is_set():
                try:conn,_=self.observer.accept()
                except socket.timeout:continue
                except OSError:
                    if self.stopping.is_set():return
                    raise
                if not self.slots.acquire(blocking=False):conn.close();continue
                try:threading.Thread(target=self.serve_connection,args=(conn,),daemon=True).start()
                except BaseException:conn.close();self.slots.release();raise
        except BaseException as e:self.fatal='observer listener failed: '+type(e).__name__

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--config-json',required=True);a=p.parse_args()
    try:
        c=load_config(a.config_json);runtime=os.environ.get('PLAB_RUNTIME_ID','')
        if not re.fullmatch('[a-f0-9]{32}',runtime):raise ValueError('PLAB_RUNTIME_ID32 lowercase hex required')
    except (ValueError,TypeError) as error:print(json.dumps({'event':'config_error','error':str(error)[:256]}));return 2
    w=Worker(c,runtime)
    def stop(*_):w.stopping.set()
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop);return w.run()
if __name__=='__main__':raise SystemExit(main())
