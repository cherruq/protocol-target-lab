#!/usr/bin/env python3
"""MIT. Persistent fixed-response Ethernet target with actual kernel filtering."""
import argparse
from collections import deque
import json
import os
import queue
import re
import select
import signal
import socket
import threading
import time
import urllib.parse
import uuid
from ethernet_wire import *

class Worker:
    def __init__(self,cfg,runtime,expected):
        self.cfg=cfg;self.runtime=runtime;self.expected=expected;self.boot=str(uuid.uuid4());self.born=time.monotonic();self.heartbeat=self.born
        self.lock=threading.RLock();self.stopping=threading.Event();self.ready=False;self.fatal=None
        self.events=deque(maxlen=256);self.next_id=1;self.next_request=1;self.evictions=0
        self.counters={k:0 for k in ('received','outgoing_ignored','rejected','accepted','tx_actual','log_dropped')}
        self.logs=queue.Queue(256);self.logger=threading.Thread(target=self.log_loop,daemon=True);self.logger.start()
        self.transport=None;self.observer=None;self.observer_thread=None;self.slots=threading.BoundedSemaphore(8)
        self.library=None;self.last_received=None;self.last_sent=None;self.filter=None
    def event(self,kind,request_id,request_sha256,**data):
        with self.lock:
            if len(self.events)==256:self.evictions+=1
            event={'event_id':self.next_id,'request_id':request_id,'request_sha256':request_sha256,'monotonic_ms_since_boot':int((time.monotonic()-self.born)*1000),'kind':kind,**data}
            self.next_id+=1;self.events.append(event)
            try:self.logs.put_nowait({'event':'custom-ethernet',**event})
            except queue.Full:self.counters['log_dropped']+=1
    def status(self):
        with self.lock:
            now=time.monotonic()
            return {'schema_version':1,'protocol':'custom-ethernet','boot_id':self.boot,'runtime_id':self.runtime,'config_sha256':canonical_hash(self.cfg),'worker_ready_after_bind':self.ready,'uptime_ms':int((now-self.born)*1000),'event_loop_age_ms':int((now-self.heartbeat)*1000),'interface':self.transport.interface if self.transport else None,'response_mode':self.cfg['response']['mode'],'link_mode':self.cfg['link']['mode'],'filter':self.filter,'library':self.library,'capture_snaplen':SNAPLEN,'recv_budget':SNAPLEN,'max_accepted_original_and_normalized_rx':MAX_FRAME,'counters':dict(self.counters),'last_received':self.last_received,'last_sent':self.last_sent,'next_request_id':self.next_request,'next_event_id':self.next_id,'cache_evictions':self.evictions}
    def query_events(self,after,limit,request_sha=None):
        with self.lock:
            matched=[e for e in self.events if e['event_id']>after and (request_sha is None or e['request_sha256']==request_sha)]
            result={'schema_version':1,'protocol':'custom-ethernet','boot_id':self.boot,'runtime_id':self.runtime,'events':[],'matched':len(matched),'returned':0,'truncated':False,'next_event_id':self.next_id,'cache_evictions':self.evictions}
            for e in matched[:limit]:
                result['events'].append(e)
                if len(json.dumps(result,separators=(',',':')).encode())>64000:result['events'].pop();break
            result['returned']=len(result['events']);result['truncated']=len(matched)>result['returned'];return result
    def process(self,raw,anc,flags,meta):
        with self.lock:
            self.heartbeat=time.monotonic();self.counters['received']+=1
            if meta['packet_type']==4:self.counters['outgoing_ignored']+=1;return
            rid=self.next_request;self.next_request+=1;data=summary(raw);sha=data['raw_sha256'];normalized=None
            try:
                if meta['ifindex']!=self.transport.interface['ifindex'] or meta['hardware_type']!=1:raise PacketError('wrong_interface')
                normalized,decoded=normalize(raw,flags,anc)
                marker=self.cfg['request_marker_hex']
                if marker is not None and not normalized[decoded['payload_offset']:].startswith(bytes.fromhex(marker)):raise PacketError('marker_mismatch')
            except PacketError as error:
                self.counters['rejected']+=1;self.event('rx_rejected',rid,sha,reason=str(error),**meta,**data);return
            self.counters['accepted']+=1
            self.last_received={'request_id':rid,**data,'normalized':summary(normalized),'decoded':decoded}
            self.event('rx_accepted',rid,sha,normalized=summary(normalized),decoded=decoded,**meta,**data)
            reply=response_frame(self.cfg);self.transport.send(reply);self.counters['tx_actual']+=1
            self.last_sent={'request_id':rid,**summary(reply)}
            self.event('tx_actual',rid,sha,response_mode=self.cfg['response']['mode'],**summary(reply))
    def run(self):
        try:
            name=self.cfg['link'].get('interface','eth0');actual=interface_info(name)
            if actual['mac']!=self.cfg['local_mac']:raise ValueError('actual local interface MAC mismatch')
            mtu_check(response_frame(self.cfg),actual['mtu'])
            program,self.library=compile_filter(name,self.cfg['packet_filter'])
            if filter_hash(program)!=self.expected:raise ValueError('compiled filter differs from preflight expected hash')
            self.transport=Transport(name,program,self.cfg['multicast_macs'],self.cfg['promiscuous']);self.filter=self.transport.proof()
            self.observer=socket.socket();self.observer.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
            self.observer.bind(('0.0.0.0' if self.cfg['link']['mode']=='docker-bridge' else '127.0.0.1',18087));self.observer.listen(16);self.observer.settimeout(.2)
            self.observer_thread=threading.Thread(target=self.serve,daemon=True);self.observer_thread.start();self.ready=True
            self.logs.put_nowait({'event':'ready','boot_id':self.boot,'runtime_id':self.runtime,'config_sha256':canonical_hash(self.cfg),'filter_sha256':self.expected})
            while not self.stopping.is_set():
                if self.fatal:raise RuntimeError(self.fatal)
                with self.lock:self.heartbeat=time.monotonic()
                select.select([self.transport.socket],[],[],.02)
                for _ in range(32):
                    try:raw,anc,flags,meta=self.transport.receive()
                    except BlockingIOError:break
                    self.process(raw,anc,flags,meta)
            return 0
        except BaseException as error:
            self.fatal=type(error).__name__+': '+str(error)[:256]
            try:self.logs.put_nowait({'event':'fatal','error':self.fatal})
            except queue.Full:pass
            return 1
        finally:
            self.ready=False;self.stopping.set()
            if self.observer:self.observer.close()
            if self.transport:self.transport.close()
            if self.observer_thread:self.observer_thread.join(timeout=1)
            try:self.logs.put(None,timeout=.1)
            except queue.Full:pass
            self.logger.join(timeout=1)
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
                    if not {'after_event_id','limit'}<=set(q) or set(q)-{'after_event_id','limit','request_sha256'} or any(len(v)!=1 for v in q.values()):raise ValueError('event query parameters')
                    if any(not re.fullmatch(r'[0-9]{1,20}',q[k][0]) for k in ('after_event_id','limit')):raise ValueError('event query numbers')
                    after,limit=(int(q[k][0]) for k in ('after_event_id','limit'))
                    request_sha=q.get('request_sha256',[None])[0]
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
    parser=argparse.ArgumentParser(description=__doc__);config_arguments(parser);parser.add_argument('--expected-filter-sha256',required=True)
    args=parser.parse_args()
    try:
        cfg=config_from_arguments(args);runtime=os.environ.get('PLAB_RUNTIME_ID','')
        if not re.fullmatch('[0-9a-f]{32}',runtime):raise ValueError('PLAB_RUNTIME_ID must be32 lowercase hex characters')
        if not re.fullmatch('[0-9a-f]{64}',args.expected_filter_sha256):raise ValueError('expected filter SHA256 required')
    except (ValueError,TypeError) as error:print(json.dumps({'event':'config_error','error':str(error)[:256]}),flush=True);return 2
    worker=Worker(cfg,runtime,args.expected_filter_sha256)
    def stop(_sig,_frame):worker.stopping.set()
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    return worker.run()
if __name__=='__main__':raise SystemExit(main())
