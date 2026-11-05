#!/usr/bin/env python3
"""MIT. Persistent active ARP/RARP/InARP requester, never a fake response ACK."""
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
from arp_wire import Transport,decode,summary,load_config,canonical_hash,PacketError,request,positive,mapping,validate_reply,classify

class Worker:
    def __init__(self,cfg,runtime):
        self.cfg=cfg;self.runtime=runtime;self.boot=str(uuid.uuid4());self.born=time.monotonic();self.heartbeat=self.born
        self.lock=threading.RLock();self.stopping=threading.Event();self.ready=False;self.fatal=None
        self.events=deque(maxlen=256);self.next_id=1;self.next_query=1;self.evictions=0;self.pending=None;self.retry=0;self.next_send=self.born;self.last_mapping=None
        self.counters={k:0 for k in ('queries_sent','resolved','timeouts','negative_silent','unexpected_responses','observed_frames','incoming_frames','rejected_frames','ignored_control','ignored_outgoing','log_dropped')}
        self.logs=queue.Queue(256);self.logger=threading.Thread(target=self.log_loop,daemon=True);self.logger.start()
        self.transport=None;self.observer=None;self.observer_thread=None;self.slots=threading.BoundedSemaphore(8)
    def ms(self,now=None):return int(((time.monotonic() if now is None else now)-self.born)*1000)
    def event(self,kind,query_id,**data):
        with self.lock:
            if len(self.events)==256:self.evictions+=1
            e={'event_id':self.next_id,'query_id':query_id,'monotonic_ms_since_boot':self.ms(),'kind':kind,**data}
            self.next_id+=1;self.events.append(e)
            try:self.logs.put_nowait({'event':'arp-client',**e})
            except queue.Full:self.counters['log_dropped']+=1
            return e
    def status(self):
        with self.lock:
            now=time.monotonic();p=self.pending
            pending=None if p is None else {k:v for k,v in p.items() if k not in ('sent_at','deadline')}
            if pending is not None:pending['remaining_ms']=max(0,int((p['deadline']-now)*1000))
            return {'schema_version':1,'protocol':'arp-client','boot_id':self.boot,'runtime_id':self.runtime,'config_sha256':canonical_hash(self.cfg),'worker_ready_after_bind':self.ready,'uptime_ms':self.ms(now),'event_loop_age_ms':max(0,int((now-self.heartbeat)*1000)),'interface':self.transport.interface,'link_mode':self.cfg['link']['mode'],'mode':self.cfg['mode'],'request_scenario':self.cfg['request_scenario']['mode'],'pending':pending,'last_mapping':self.last_mapping,'counters':dict(self.counters),'next_event_id':self.next_id,'cache_evictions':self.evictions,'protocol_has_transaction_id':False,'late_identical_response_is_ambiguous':True,'response_ack_sent':False,'filter':self.transport.proof()}
    def query_events(self,after,limit,query_id=None,response_sha=None):
        with self.lock:
            matched=[e for e in self.events if e['event_id']>after and (query_id is None or e['query_id']==query_id) and (response_sha is None or e.get('response_sha256')==response_sha)]
            result={'schema_version':1,'protocol':'arp-client','boot_id':self.boot,'runtime_id':self.runtime,'events':[],'matched':len(matched),'returned':0,'truncated':False,'next_event_id':self.next_id,'cache_evictions':self.evictions}
            for e in matched[:limit]:
                result['events'].append(e)
                if len(json.dumps(result,separators=(',',':')).encode())>64000:result['events'].pop();break
            result['returned']=len(result['events']);result['truncated']=len(matched)>result['returned'];return result
    def expire(self,now):
        p=self.pending
        if p is None or now<p['deadline']:return
        self.counters['timeouts']+=1;negative_silent=not p['expected_response'] and p['unexpected_responses']==0
        if negative_silent:self.counters['negative_silent']+=1
        self.event('query_timeout',p['query_id'],retry_index=p['retry_index'],deadline_ms=p['deadline_ms'],expected_response=p['expected_response'],unexpected_responses=p['unexpected_responses'],negative_silent=negative_silent)
        self.pending=None
        if p['retry_index']<self.cfg['retries']:self.retry=p['retry_index']+1;self.next_send=now
        else:self.retry=0;self.next_send=now+self.cfg['interval_ms']/1000
    def tick(self,now):
        with self.lock:
            self.heartbeat=now;self.expire(now)
            if self.pending is not None or now<self.next_send:return
            intent,raw=request(self.cfg);self.transport.send(raw);sent=time.monotonic();qid=self.next_query;self.next_query+=1;deadline=sent+self.cfg['timeout_ms']/1000
            self.pending={'query_id':qid,'attempt_id':qid,'retry_index':self.retry,'sent_at':sent,'deadline':deadline,'sent_ms':self.ms(sent),'deadline_ms':self.ms(deadline),'expected_response':positive(self.cfg),'unexpected_responses':0}
            self.counters['queries_sent']+=1
            self.event('query_sent',qid,attempt_id=qid,retry_index=self.retry,sent_ms=self.ms(sent),deadline_ms=self.ms(deadline),expected_response=positive(self.cfg),expected_mapping=mapping(self.cfg) if positive(self.cfg) else None,wire=summary(raw),request_intent=summary(intent))
    def process(self,raw,meta,now=None):
        with self.lock:
            now=time.monotonic() if now is None else now;self.expire(now);self.counters['observed_frames']+=1
            kind=classify(raw,meta,self.cfg,self.transport.interface)
            if kind=='outgoing':self.counters['ignored_outgoing']+=1;return
            self.counters['incoming_frames']+=1;p=self.pending;qid=None if p is None else p['query_id'];sha=summary(raw)['raw_sha256']
            received=self.event('received',qid,wire=summary(raw),packet_address=meta,response_candidate=kind=='candidate',classification=kind,response_sha256=sha)
            if kind=='unrelated':self.counters['ignored_control']+=1;return
            if kind=='malformed':
                self.counters['rejected_frames']+=1;self.event('rejected',qid,reason='malformed_or_metadata',received_event_id=received['event_id'],response_sha256=sha,unexpected=False);return
            unexpected=p is not None and not p['expected_response']
            if unexpected:p['unexpected_responses']+=1;self.counters['unexpected_responses']+=1
            try:
                frame=decode(raw)
                if p is None:raise PacketError('no_pending_query')
                if not p['expected_response']:raise PacketError('negative_query_response')
                validate_reply(frame,self.cfg)
            except PacketError as error:
                self.counters['rejected_frames']+=1;self.event('rejected',qid,reason=str(error),received_event_id=received['event_id'],response_sha256=sha,unexpected=unexpected);return
            value={'query_id':qid,'received_ms':self.ms(now),**mapping(self.cfg),'response_sha256':sha}
            self.last_mapping=value;self.counters['resolved']+=1
            self.event('mapping_resolved',qid,mapping=value,received_event_id=received['event_id'],response_sha256=sha,protocol_has_transaction_id=False,response_ack_sent=False)
            self.pending=None;self.retry=0;self.next_send=now+self.cfg['interval_ms']/1000
    def run(self):
        try:
            name='eth0' if self.cfg['link']['mode']=='docker-bridge' else self.cfg['link']['interface'];self.transport=Transport(name,self.cfg['source_mac'])
            self.observer=socket.socket();self.observer.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
            self.observer.bind(('0.0.0.0' if self.cfg['link']['mode']=='docker-bridge' else '127.0.0.1',18086));self.observer.listen(16);self.observer.settimeout(.2)
            self.observer_thread=threading.Thread(target=self.serve,daemon=True);self.observer_thread.start();self.ready=True
            self.logs.put_nowait({'event':'ready','boot_id':self.boot,'runtime_id':self.runtime,'config_sha256':canonical_hash(self.cfg),'interface':self.transport.interface,'filter':self.transport.proof()})
            while not self.stopping.is_set():
                if self.fatal:raise RuntimeError(self.fatal)
                self.tick(time.monotonic());select.select([self.transport.socket],[],[],.005)
                for _ in range(32):
                    if self.stopping.is_set():break
                    self.tick(time.monotonic())
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
                    if not {'after_event_id','limit'}<=set(q) or set(q)-{'after_event_id','limit','query_id','response_sha256'} or any(len(v)!=1 for v in q.values()):raise ValueError('event query parameters')
                    if any(not re.fullmatch(r'[0-9]{1,20}',q[k][0]) for k in ('after_event_id','limit')):raise ValueError('event query numbers')
                    after,limit=(int(q[k][0]) for k in ('after_event_id','limit'))
                    query_id=q.get('query_id',[None])[0]
                    if query_id is not None:
                        if not re.fullmatch(r'[0-9]{1,20}',query_id):raise ValueError('query_id format')
                        query_id=int(query_id)
                        if query_id>2**63-1:raise ValueError('query_id range')
                    response_sha=q.get('response_sha256',[None])[0]
                    if response_sha is not None and not re.fullmatch('[0-9a-f]{64}',response_sha):raise ValueError('response SHA query')
                    if not 0<=after<=2**63-1 or not 1<=limit<=16:raise ValueError('query range')
                    obj=self.query_events(after,limit,query_id,response_sha)
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
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--config-json',required=True);args=parser.parse_args()
    try:
        cfg=load_config(args.config_json);runtime=os.environ.get('PLAB_RUNTIME_ID','')
        if not re.fullmatch('[0-9a-f]{32}',runtime):raise ValueError('PLAB_RUNTIME_ID requires32 lowercase hex')
    except (ValueError,TypeError) as error:print(json.dumps({'event':'config_error','error':str(error)[:256]}),flush=True);return 2
    worker=Worker(cfg,runtime)
    def stop(_sig,_frame):worker.stopping.set()
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop);return worker.run()
if __name__=='__main__':raise SystemExit(main())
