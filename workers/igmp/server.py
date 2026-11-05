#!/usr/bin/env python3
"""MIT. Persistent native Linux membership holder; never sends a raw report."""
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
from igmp_wire import *

class Worker:
    def __init__(self,cfg,runtime,name,ip):
        self.cfg=cfg;self.runtime=runtime;self.name=name;self.expected_ip=ip;self.boot=str(uuid.uuid4());self.born=time.monotonic();self.heartbeat=self.born
        self.lock=threading.RLock();self.stopping=threading.Event();self.ready=False;self.fatal=None
        self.events=deque(maxlen=256);self.next_id=1;self.evictions=0;self.cap=None;self.member=None;self.observer=None;self.observer_thread=None;self.interface=None;self.requests=[];self.joined={};self.preexisting={};self.groups_current={};self.params_join=None;self.params_current=None;self.changed=False;self.other_refs=False;self.last_query=None;self.last_report=None
        self.counters={k:0 for k in ('queries_in','reports_out','reports_v1_out','reports_v2_out','reports_v3_out','reports_in','ignored','rejected_capture','log_dropped')}
        self.logs=queue.Queue(256);self.logger=threading.Thread(target=self.log_loop,daemon=True);self.logger.start();self.slots=threading.BoundedSemaphore(8)
    def event(self,kind,parsed,meta):
        with self.lock:
            if len(self.events)==256:self.evictions+=1
            event={'event_id':self.next_id,'monotonic_ms_since_boot':int((time.monotonic()-self.born)*1000),'kind':kind,'ipv4_sha256':parsed['ipv4']['sha256'],'decoded':parsed,'metadata':meta};self.next_id+=1;self.events.append(event)
            try:self.logs.put_nowait({'event':'igmp',**event})
            except queue.Full:self.counters['log_dropped']+=1
    def refresh(self):
        current=parameters(self.name);rows=proc_groups(self.name)
        with self.lock:
            self.params_current=current
            if current!=self.params_join:self.changed=True
            self.groups_current={g:rows.get(g,{'users':0}) for g in self.cfg['groups']}
            if any(v['users']!=1 for v in self.groups_current.values()):self.other_refs=True
    def status(self):
        with self.lock:
            now=time.monotonic();membership=[{'group':g,'joined_age_ms':int((now-self.joined[g])*1000),'preexisting_other_refs':self.preexisting[g],'current_kernel_refs':self.groups_current.get(g,{}).get('users',0),'other_refs':max(0,self.groups_current.get(g,{}).get('users',0)-1)} for g in self.joined]
            bounds=warmup_bound(self.params_join) if self.params_join else {};age=min((g['joined_age_ms'] for g in membership),default=0);remaining=max(0,bounds.get('startup_upper_ms',0)-age)
            testable=self.ready and not self.changed and not self.other_refs
            return {'schema_version':1,'protocol':'igmp','boot_id':self.boot,'runtime_id':self.runtime,'config_sha256':canonical_hash(self.cfg),'worker_ready_after_bind':self.ready,'uptime_ms':int((now-self.born)*1000),'event_loop_age_ms':int((now-self.heartbeat)*1000),'kernel':{'origin':'Linux kernel; wrapper holds membership and observes only','release':os.uname().release,'network_namespace':namespace()},'interface':self.interface,'link_mode':self.cfg['link']['mode'],'membership':{'udp_socket_inode':inode(self.member) if self.member else None,'udp_local_address':list(self.member.getsockname()) if self.member else None,'groups':membership,'other_refs_detected':self.other_refs},'parameters':{'at_join':self.params_join,'current':self.params_current,'detected_parameter_changes':self.changed,**bounds},'testability':{'available':testable,'remaining_warmup_upper_ms':remaining,'reason':'observed kernel parameters changed' if self.changed else 'shared or missing group references' if self.other_refs else None},'packet_socket_inode':inode(self.cap.socket) if self.cap else None,'counters':dict(self.counters),'last_query':self.last_query,'last_report':self.last_report,'next_event_id':self.next_id,'cache_evictions':self.evictions}
    def query_events(self,after,limit,request_sha=None):
        with self.lock:
            matched=[e for e in self.events if e['event_id']>after and (request_sha is None or e['ipv4_sha256']==request_sha)];result={'schema_version':1,'protocol':'igmp','boot_id':self.boot,'runtime_id':self.runtime,'events':[],'matched':len(matched),'returned':0,'truncated':False,'next_event_id':self.next_id,'cache_evictions':self.evictions}
            for event in matched[:limit]:
                result['events'].append(event)
                if len(json.dumps(result,separators=(',',':')).encode())>64000:result['events'].pop();break
            result['returned']=len(result['events']);result['truncated']=len(matched)>result['returned'];return result
    def process(self,raw,anc,flags,meta):
        try:p=decode(raw,anc,flags)
        except PacketError:
            with self.lock:self.counters['rejected_capture']+=1
            return
        if meta['ifindex']!=self.interface['ifindex']:return
        outgoing=meta['packet_type']==4
        if p['igmp_type']==0x11 and not outgoing:
            with self.lock:self.counters['queries_in']+=1;self.last_query={'decoded':p,'metadata':meta}
            self.event('query_in',p,meta)
        elif p['igmp_version'] in (1,2,3) and outgoing and p['source_ip']==self.interface['primary_ipv4'] and p['source_mac']==self.interface['mac']:
            with self.lock:
                self.counters['reports_out']+=1;self.counters['reports_v'+str(p['igmp_version'])+'_out']+=1;self.last_report={'decoded':p,'metadata':meta}
            self.event('report_out',p,meta)
        elif p['igmp_version'] in (1,2,3) and not outgoing:
            with self.lock:self.counters['reports_in']+=1
            self.event('report_in',p,meta)
        else:
            with self.lock:self.counters['ignored']+=1
    def run(self):
        try:
            self.interface=interface_info(self.name,self.expected_ip)
            if self.cfg['link']['mode'] in ('docker-bridge','owned-vxlan') and parameters(self.name)['interface_force']!=2:raise ValueError('dedicated interface must have actual force_igmp_version=2')
            if self.cfg['link']['mode']=='owned-vxlan':
                l=self.cfg['link']
                if self.interface['primary_ipv4']!=str(ipaddress.IPv4Interface(l['local_inner_cidr']).ip) or self.interface['mac']!=l['local_inner_mac']:raise ValueError('owned VXLAN resolved actual IP/MAC differs from config')
            self.cap=Capture(self.interface,self.cfg['groups']+['224.0.0.1','224.0.0.2','224.0.0.22'])
            self.member=socket.socket(socket.AF_INET,socket.SOCK_DGRAM,socket.IPPROTO_UDP);self.member.setsockopt(socket.SOL_SOCKET,socket.SO_BINDTODEVICE,self.name.encode()+b'\0');self.member.bind((self.interface['primary_ipv4'],0))
            self.params_join=parameters(self.name);self.params_current=self.params_join
            for group in self.cfg['groups']:
                self.preexisting[group]=proc_groups(self.name).get(group,{}).get('users',0)
                request=struct.pack('=4s4si',socket.inet_aton(group),socket.inet_aton(self.interface['primary_ipv4']),self.interface['ifindex']);self.member.setsockopt(socket.IPPROTO_IP,socket.IP_ADD_MEMBERSHIP,request);self.requests.append(request);self.joined[group]=time.monotonic()
                if self.preexisting[group]:self.other_refs=True
            self.refresh()
            self.observer=socket.socket();self.observer.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);self.observer.bind(('0.0.0.0' if self.cfg['link']['mode']=='docker-bridge' else '127.0.0.1',18088));self.observer.listen(16);self.observer.settimeout(.2);self.observer_thread=threading.Thread(target=self.serve,daemon=True);self.observer_thread.start();self.ready=True
            self.logs.put_nowait({'event':'ready','boot_id':self.boot,'runtime_id':self.runtime,'config_sha256':canonical_hash(self.cfg),'origin':'Linux kernel membership; no application report sender'})
            last=0
            while not self.stopping.is_set():
                if self.fatal:raise RuntimeError(self.fatal)
                with self.lock:self.heartbeat=time.monotonic()
                if time.monotonic()-last>.2:self.refresh();last=time.monotonic()
                select.select([self.cap.socket],[],[],.02)
                for _ in range(32):
                    try:raw,anc,flags,meta=self.cap.receive()
                    except BlockingIOError:break
                    self.process(raw,anc,flags,meta)
            return 0
        except BaseException as e:
            self.fatal=type(e).__name__+': '+str(e)[:256]
            try:self.logs.put_nowait({'event':'fatal','error':self.fatal})
            except queue.Full:pass
            return 1
        finally:
            self.ready=False;self.stopping.set()
            if self.member:
                for request in reversed(self.requests):
                    try:self.member.setsockopt(socket.IPPROTO_IP,socket.IP_DROP_MEMBERSHIP,request)
                    except OSError:pass
                self.member.close();self.member=None
            if self.cap:self.cap.close()
            if self.observer:self.observer.close()
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
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--config-json',required=True);p.add_argument('--interface');p.add_argument('--interface-ip');a=p.parse_args()
    try:
        c=load_config(a.config_json);runtime=os.environ.get('PLAB_RUNTIME_ID','')
        if not re.fullmatch('[a-f0-9]{32}',runtime):raise ValueError('PLAB_RUNTIME_ID32 lowercase hex required')
        name=a.interface or c['link'].get('interface','eth0');ip=a.interface_ip or c['link'].get('interface_ip')
        if c['link']['mode']=='owned-vxlan' and (not a.interface or not a.interface_ip):raise ValueError('owned VXLAN requires resolved interface and primary IP')
        if c['link']['mode']=='host-interface' and (name!=c['link']['interface'] or ip!=c['link']['interface_ip']):raise ValueError('host interface arguments conflict with config')
    except (ValueError,TypeError) as e:print(json.dumps({'event':'config_error','error':str(e)[:256]}));return 2
    w=Worker(c,runtime,name,ip)
    def stop(*_):w.stopping.set()
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop);return w.run()
if __name__=='__main__':raise SystemExit(main())
