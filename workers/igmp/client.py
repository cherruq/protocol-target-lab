#!/usr/bin/env python3
"""MIT. Actual IGMP Queries and real native Report observation, never an ACK."""
import argparse
import ipaddress
import json
import select
import signal
import sys
import time
import uuid
from igmp_wire import *

class GlobalDeadline(TimeoutError):pass
class Observer:
    def __init__(self,host,port,boot,runtime,cfg):self.host=host;self.port=port;self.boot=boot;self.runtime=runtime;self.cfg=canonical_hash(cfg);self.remaining=1.;self.phase=0
    def get(self,path):
        start=time.monotonic();deadline=min(start+1,self.phase)
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
            if v.get('protocol')!='igmp' or v.get('schema_version')!=1:raise ValueError('observer schema mismatch')
            if path=='/v1/status':
                if v.get('config_sha256')!=self.cfg or not v.get('worker_ready_after_bind') or v.get('event_loop_age_ms',99999)>2000:raise ValueError('source config/readiness/heartbeat mismatch')
            return v
        finally:
            if sock:sock.close()
            self.remaining-=time.monotonic()-start

class Client:
    def __init__(self,args,cfg):
        self.a=args;self.cfg=cfg;self.start=time.monotonic();self.deadline=self.start+90;self.sequence=0;self.progress_bytes=0;self.queries=0;self.reports=0;self.prequery=0;self.used_events=set();self.ids=set();self.cap=None;self.obs=None
    def progress(self,phase,round_no=None,expected=(),covered=(),warmup=0):
        v={'schema_version':1,'test_run_id':self.a.test_run_id,'sequence':self.sequence,'phase':phase,'round':round_no,'groups_expected':list(expected),'groups_covered':list(covered),'queries_sent':self.queries,'reports_matched':self.reports,'prequery_reports':self.prequery,'warmup_remaining_upper_ms':max(0,int(warmup)),'elapsed_ms':int((time.monotonic()-self.start)*1000),'remaining_ms':max(0,int((self.deadline-time.monotonic())*1000))};self.sequence+=1
        text='PLAB_IGMP_PROGRESS '+json.dumps(v,separators=(',',':'))
        if len(text.encode())<=4096 and self.progress_bytes+len(text.encode())+1<=262144:
            print(text,file=sys.stderr,flush=True);self.progress_bytes+=len(text.encode())+1
    def get(self,path,deadline=None):
        self.obs.phase=min(self.deadline,deadline if deadline is not None else self.deadline);return self.obs.get(path)
    def valid_status(self,s):
        if not s['testability']['available']:raise ValueError('test unavailable: '+str(s['testability']['reason']))
        if s['interface']['primary_ipv4']!=self.a.target_ip or s['interface']['mac']!=self.a.target_mac:raise ValueError('actual target interface identity mismatch')
    def receive(self):
        raw,anc,flags,meta=self.cap.receive()
        if meta['packet_type']==4:return None
        try:p=decode(raw,anc,flags,self.cfg['groups'])
        except PacketError:return None
        if p['source_ip']!=self.a.target_ip or p['source_mac']!=self.a.target_mac or p['igmp_type'] not in (0x12,0x16,0x22):return None
        if p['ttl']!=1 or (p['igmp_type']!=0x12 and not p['router_alert']):return None
        if p['igmp_type']==0x22:
            if p['destination_ip']!='224.0.0.22' or p['destination_mac']!=mac_text(group_mac('224.0.0.22')) or not p['matching_configured_groups']:return None
        elif p['group']!=p['destination_ip'] or p['destination_mac']!=mac_text(group_mac(p['group'])) or p['group'] not in self.cfg['groups']:return None
        return {'decoded':p,'metadata':meta,'received_monotonic_ms':int((time.monotonic()-self.start)*1000)}
    def warmup(self):
        status=self.get('/v1/status');self.valid_status(status);rounds=4 if self.a.method=='ALL' else 2
        if status['testability']['remaining_warmup_upper_ms']+rounds*12000+10000>90000:raise ValueError('test unavailable: conservative warmup plus selected rounds exceeds90 seconds')
        self.cap=Capture(interface_info(self.a.interface,self.a.source_ip),self.cfg['groups']+['224.0.0.1','224.0.0.2','224.0.0.22'])
        while True:
            status=self.get('/v1/status');self.valid_status(status);remaining=status['testability']['remaining_warmup_upper_ms'];self.progress('warmup',warmup=remaining)
            if remaining<=0:return
            until=min(self.deadline,time.monotonic()+min(.5,remaining/1000))
            while time.monotonic()<until:
                select.select([self.cap.socket],[],[],max(0,until-time.monotonic()))
                for _ in range(32):
                    try:p=self.receive()
                    except BlockingIOError:break
                    if p:self.prequery+=1
    def drain(self):
        end=time.monotonic()+.05
        for _ in range(256):
            if time.monotonic()>=end:raise ValueError('input flood before query')
            try:p=self.receive()
            except BlockingIOError:return
            if p and not self.queries:self.prequery+=1
        raise ValueError('input flood before query')
    def check(self,method,round_no):
        begin=time.monotonic();expected=self.cfg['groups'] if method=='GENERAL_QUERY' else self.cfg['groups'][:1];phase='general-query' if method=='GENERAL_QUERY' else 'group-query';record={'name':method+' round '+str(round_no),'passed':False,'request':{'method':method,'path':'membership','groups_expected':expected},'response':{'reports':[],'groups_covered':[]}};covered={};observed=[];events=[]
        try:
            self.drain();before=self.get('/v1/status');self.valid_status(before);cursor=before['next_event_id']-1
            identifier=int.from_bytes(os.urandom(2),'big')
            while identifier in self.ids:identifier=int.from_bytes(os.urandom(2),'big')
            self.ids.add(identifier);raw=query_frame(self.cap.interface,None if method=='GENERAL_QUERY' else expected[0],identifier);parsed=decode(raw,[],0)
            self.cap.send(raw);self.queries+=1;sent=time.monotonic();deadline=min(self.deadline,sent+12)
            record['request'].update(frame=summary(raw),decoded=parsed,query_ipv4_sha256=parsed['ipv4']['sha256']);last_poll=0;last_progress=0
            while time.monotonic()<deadline and len(covered)<len(expected):
                select.select([self.cap.socket],[],[],min(.1,max(0,deadline-time.monotonic())))
                for _ in range(32):
                    try:p=self.receive()
                    except BlockingIOError:break
                    if p and p['decoded']['igmp_type']==0x16 and p['decoded']['group'] in expected:observed.append(p)
                if len(observed)>256:raise ValueError('bounded report input exceeded')
                if time.monotonic()-last_poll>=.2:
                    page=self.get('/v1/events?after_event_id='+str(cursor)+'&limit=16',deadline)
                    if page['cache_evictions']>before['cache_evictions']:raise ValueError('source event cache evicted during query')
                    events.extend(page['events'])
                    if page['events']:cursor=page['events'][-1]['event_id']
                    if len(events)>256:raise ValueError('source query event budget')
                    last_poll=time.monotonic()
                    queries=[e for e in events if e['kind']=='query_in' and e['ipv4_sha256']==parsed['ipv4']['sha256'] and e['decoded']['source_ip']==self.a.source_ip and e['decoded']['source_mac']==self.cap.interface['mac']]
                    if len(queries)>1:raise ValueError('duplicate source query proof')
                    if queries:
                        query=queries[0]
                        for peer in observed:
                            group=peer['decoded']['group']
                            if group in covered:continue
                            matches=[e for e in events if e['kind']=='report_out' and e['event_id']>query['event_id'] and e['event_id'] not in self.used_events and e['ipv4_sha256']==peer['decoded']['ipv4']['sha256'] and e['decoded']['igmp_type']==0x16 and e['decoded']['group']==group and e['decoded']['source_ip']==self.a.target_ip and e['decoded']['source_mac']==self.a.target_mac]
                            if matches:
                                event=matches[0];self.used_events.add(event['event_id']);covered[group]={'peer':peer,'source_query_event':query,'source_native_report_event':event};self.reports+=1
                if time.monotonic()-last_progress>=.5:self.progress(phase,round_no,expected,list(covered));last_progress=time.monotonic()
            record['response']['reports']=list(covered.values());record['response']['groups_covered']=list(covered)
            if len(covered)!=len(expected):raise TimeoutError('12-second query window did not provide all actual native source+peer Report proofs')
            after=self.get('/v1/status',deadline);self.valid_status(after)
            if before['interface']!=after['interface'] or before['kernel']!=after['kernel'] or before['membership']['udp_socket_inode']!=after['membership']['udp_socket_inode'] or before['packet_socket_inode']!=after['packet_socket_inode']:raise ValueError('native source interface/socket/kernel identity changed')
            record['passed']=True;record['response']['query_source_event_id']=queries[0]['event_id']
        except GlobalDeadline:raise
        except Exception as e:record['error']=type(e).__name__+': '+str(e)[:512]
        record['seconds']=round(time.monotonic()-begin,6);return record
    def run(self):
        report={'protocol':'igmp','passed':False,'checks':[],'limitations':['Linux kernel multicast Report; no program ACK or wire transaction identifier.','Fresh query/report window does not prove unique causality under arbitrary external queries.']}
        try:
            actual=interface_info(self.a.interface,self.a.source_ip)
            if actual['primary_ipv4']==self.a.target_ip or actual['mac']==self.a.target_mac:raise ValueError('peer and target actual interface roles must differ')
            self.obs=Observer(self.a.observer_host,self.a.observer_port,self.a.expected_boot_id,self.a.expected_runtime_id,self.cfg);self.warmup()
            for method in (('GENERAL_QUERY','GROUP_QUERY') if self.a.method=='ALL' else (self.a.method,)):
                for n in (1,2):report['checks'].append(self.check(method,n))
            report['passed']=bool(report['checks']) and all(c['passed'] for c in report['checks'])
        except Exception as e:report['error']=type(e).__name__+': '+str(e)[:512]
        finally:
            self.progress('cleanup')
            if self.cap:self.cap.close()
        self.progress('complete' if report['passed'] else 'failed');checks=report['checks'];report['summary']={'total':len(checks),'passed':sum(c['passed'] for c in checks),'failed':sum(not c['passed'] for c in checks),'actual_queries':self.queries,'actual_reports':self.reports,'prequery_reports':self.prequery};report['planned']={'check_groups':4 if self.a.method=='ALL' else 2,'queries':4 if self.a.method=='ALL' else 2,'expected_reports':2*len(self.cfg['groups'])+2 if self.a.method=='ALL' else 2*len(self.cfg['groups']) if self.a.method=='GENERAL_QUERY' else 2};report['seconds']=round(time.monotonic()-self.start,6);return report

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--config-json',required=True);p.add_argument('--interface',required=True);p.add_argument('--source-ip',default='auto');p.add_argument('--target-ip',required=True);p.add_argument('--target-mac',required=True);p.add_argument('--observer-host',required=True);p.add_argument('--observer-port',type=int,default=18088);p.add_argument('--expected-boot-id',required=True);p.add_argument('--expected-runtime-id',required=True);p.add_argument('--method',choices=METHODS,default='ALL');p.add_argument('--path',choices=('membership',),default='membership');p.add_argument('--test-run-id');a=p.parse_args()
    def expired(*_):raise GlobalDeadline('90-second global deadline')
    signal.signal(signal.SIGALRM,expired);signal.alarm(90)
    try:
        c=load_config(a.config_json);a.source_ip=interface_info(a.interface)['primary_ipv4'] if a.source_ip=='auto' else ipv4(a.source_ip);a.target_ip=ipv4(a.target_ip);a.target_mac=mac_text(mac(a.target_mac));ipaddress.IPv4Address(a.observer_host);integer(a.observer_port,1,65535)
        if a.test_run_id is not None:uuid.UUID(a.test_run_id)
        report=Client(a,c).run()
    except Exception as e:report={'passed':False,'checks':[],'error':type(e).__name__+': '+str(e)[:512],'summary':{'total':0,'passed':0,'failed':0,'actual_queries':0,'actual_reports':0,'prequery_reports':0}}
    finally:signal.alarm(0)
    raw=json.dumps(report,separators=(',',':'))
    if len(raw.encode())>524288:raw=json.dumps({'passed':False,'checks':[],'error':'report exceeds512KiB'});report['passed']=False
    print(raw);return 0 if report['passed'] else 1
if __name__=='__main__':raise SystemExit(main())
