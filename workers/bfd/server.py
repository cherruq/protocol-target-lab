#!/usr/bin/env python3
"""MIT. Bounded real single-hop BFD worker and loopback-only read-only observer."""
import argparse
from collections import deque
import hashlib
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
from bfd_wire import Transport,decode,wire_summary,load_config,canonical_hash,PacketError,STATES
from state import Session

class Worker:
    def __init__(self,cfg,runtime):
        self.cfg=cfg;self.runtime=runtime;self.boot=str(uuid.uuid4());self.born=time.monotonic();self.heartbeat=self.born
        self.lock=threading.RLock();self.stopping=threading.Event();self.ready=False;self.fatal=None
        self.events=deque(maxlen=256);self.next_id=1;self.evictions=0
        self.counters={k:0 for k in ('rx_total','accepted','rejected','tx_periodic','tx_final','suppressed','log_dropped')}
        self.logs=queue.Queue(256);self.logger=threading.Thread(target=self.log_loop,daemon=True);self.logger.start()
        self.session=Session(cfg,self.event);self.transport=None;self.observer=None;self.observer_thread=None;self.slots=threading.BoundedSemaphore(8)
    def log_loop(self):
        try:
            while True:
                item=self.logs.get()
                if item is None:return
                print(json.dumps(item,separators=(',',':')),flush=True)
        except Exception as e:self.fatal='stdout logger failed: '+type(e).__name__
    def event(self,kind,**data):
        with self.lock:
            if len(self.events)==256:self.evictions+=1
            event={'event_id':self.next_id,'epoch_id':self.session.epoch_id,'monotonic_ms_since_boot':int((time.monotonic()-self.born)*1000),'kind':kind,**data}
            self.next_id+=1;self.events.append(event)
            try:self.logs.put_nowait({'event':'bfd',**event})
            except queue.Full:self.counters['log_dropped']+=1
    def status(self):
        with self.lock:
            now=time.monotonic();s=self.session
            ms=lambda t:None if t is None else int((t-self.born)*1000)
            return {'schema_version':1,'protocol':'bfd','boot_id':self.boot,'runtime_id':self.runtime,'config_sha256':canonical_hash(self.cfg),'worker_ready_after_bind':self.ready,'uptime_ms':int((now-self.born)*1000),'event_loop_age_ms':int((now-self.heartbeat)*1000),'receiver':{'bind_ip':self.cfg['bind_ip'],'port':3784,'source_port':self.cfg['source_port'],'interface':self.cfg['interface'],'ifindex':self.transport.ifindex if self.transport else None},'local_state':STATES[s.state],'diagnostic':s.diagnostic,'remote_state':STATES[s.remote_state],'remote_discriminator':s.remote_discriminator,'last_valid_age_ms':None if s.last_valid is None else int((now-s.last_valid)*1000),'negotiated_tx_us':None if s.tx_interval() is None else int(s.tx_interval()*1000000),'receive_detection_us':int(s.detection_time()*1000000),'epoch_id':s.epoch_id,'epoch_peer_discriminator':s.epoch_peer_discriminator,'scenario':{'mode':self.cfg['scenario']['mode'],'phase':s.phase,'armed_at_ms':ms(s.armed),'trigger_at_ms':ms(s.trigger),'end_at_ms':ms(s.end),'poll_started':s.poll_started,'poll_actual_sent':s.poll_actual_sent,'poll_completed':s.poll_completed,'windows_started':s.windows_started},'counters':dict(self.counters),'next_event_id':self.next_id,'cache_evictions':self.evictions}
    def query_events(self,epoch,after,limit):
        with self.lock:
            matched=[e for e in self.events if e['epoch_id']==epoch and e['event_id']>after]
            result={'schema_version':1,'protocol':'bfd','boot_id':self.boot,'runtime_id':self.runtime,'epoch_id':epoch,'events':[],'matched':len(matched),'returned':0,'truncated':False,'next_event_id':self.next_id,'cache_evictions':self.evictions}
            for e in matched[:limit]:
                result['events'].append(e)
                if len(json.dumps(result,separators=(',',':')).encode())>64000:
                    result['events'].pop();break
            result['returned']=len(result['events']);result['truncated']=len(matched)>result['returned']
            return result
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
                    if set(q)!={'epoch_id','after_event_id','limit'} or any(len(v)!=1 or not re.fullmatch(r'[0-9]{1,20}',v[0]) for v in q.values()):raise ValueError('event query parameters')
                    epoch,after,limit=(int(q[k][0]) for k in ('epoch_id','after_event_id','limit'))
                    if not 0<=epoch<=2**63-1 or not 0<=after<=2**63-1 or not 1<=limit<=16:raise ValueError('query range')
                    obj=self.query_events(epoch,after,limit)
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
    def send(self,now,final=False):
        s=self.session;p=s.control(final);raw,ttl=s.transform(p,now)
        fields={'source':[self.cfg['bind_ip'],self.cfg['source_port']],'destination':[self.cfg['peer_ip'],3784],'ttl':ttl,'periodic':not final,'intended_control':p.fields(),'scenario_phase':s.phase}
        if raw is None:self.counters['suppressed']+=1;self.event('tx_suppressed',**fields)
        else:
            self.transport.send(raw,self.cfg['peer_ip'],ttl)
            self.counters['tx_final' if final else 'tx_periodic']+=1
            self.event('tx_actual',**fields,**wire_summary(raw))
        s.submitted(p,now,not final,raw is not None)
    def run(self):
        try:
            self.transport=Transport(self.cfg['bind_ip'],self.cfg['interface'],self.cfg['source_port'])
            self.observer=socket.socket();self.observer.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
            self.observer.bind(('127.0.0.1',18084));self.observer.listen(16);self.observer.settimeout(.2)
            self.observer_thread=threading.Thread(target=self.serve,daemon=True);self.observer_thread.start()
            self.ready=True;self.event('worker_ready',boot_id=self.boot,runtime_id=self.runtime,config_sha256=canonical_hash(self.cfg))
            while not self.stopping.is_set():
                if self.fatal:raise RuntimeError(self.fatal)
                with self.lock:
                    now=time.monotonic();self.heartbeat=now;self.session.tick(now)
                    if self.session.tx_interval() is not None and now>=self.session.next_send:self.send(now)
                select.select([self.transport.receiver],[],[],.02)
                for _ in range(32):
                    try:raw,meta=self.transport.receive()
                    except BlockingIOError:break
                    with self.lock:
                        now=time.monotonic();self.heartbeat=now;self.session.tick(now);self.counters['rx_total']+=1
                        try:
                            self.transport.validate(meta,self.cfg['peer_ip']);p=decode(raw)
                            final=self.session.receive(p,now)
                        except PacketError as error:
                            self.counters['rejected']+=1;self.event('rx_rejected',reason=str(error),**meta,**wire_summary(raw));continue
                        self.counters['accepted']+=1;self.event('rx_accepted',control=p.fields(),**meta,**wire_summary(raw))
                        if final:self.send(now,True)
            return 0
        except BaseException as error:
            self.fatal=type(error).__name__+': '+str(error)[:256]
            try:self.event('fatal',error=self.fatal)
            except Exception:pass
            return 1
        finally:
            self.ready=False;self.stopping.set()
            if self.observer:self.observer.close()
            if self.transport:self.transport.close()
            if self.observer_thread:self.observer_thread.join(timeout=1)
            try:self.logs.put(None,timeout=.1)
            except queue.Full:pass
            self.logger.join(timeout=1)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--config-json',required=True)
    args=parser.parse_args()
    try:
        cfg=load_config(args.config_json);runtime=os.environ.get('PLAB_RUNTIME_ID','')
        if not re.fullmatch('[0-9a-f]{32}',runtime):raise ValueError('PLAB_RUNTIME_ID must be32 lowercase hex characters')
    except (ValueError,TypeError) as e:print(json.dumps({'event':'config_error','error':str(e)[:256]}),flush=True);return 2
    w=Worker(cfg,runtime)
    def stop(_sig,_frame):w.stopping.set()
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    return w.run()
if __name__=='__main__':raise SystemExit(main())
