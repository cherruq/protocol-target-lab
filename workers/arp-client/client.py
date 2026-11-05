#!/usr/bin/env python3
"""MIT. Inverse ARP responder: actual incoming request plus fresh source proof."""
import argparse
import hashlib
import fcntl
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
from arp_wire import Transport,summary,load_config,canonical_hash,case_budgets,positive,mac,FILTER,filter_hash,METHODS

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
        if obj.get('schema_version')!=1 or obj.get('protocol')!='arp-client' or obj.get('boot_id')!=self.args.expected_boot_id or obj.get('runtime_id')!=self.args.expected_runtime_id:raise ValueError('observer source boot/runtime identity mismatch')
        if path=='/v1/status':
            if obj.get('config_sha256')!=canonical_hash(self.cfg) or not obj.get('worker_ready_after_bind') or not 0<=obj.get('event_loop_age_ms',999999)+(time.monotonic()-(end-left))*1000<=2000:raise ValueError('observer config/readiness/main-loop heartbeat mismatch')
        return obj
    def status(self,deadline):return self.get('/v1/status',deadline)

def expected_request(c):
    sm=mac(c['source_mac']);dm=mac(c['server_mac']);sip=socket.inet_aton(c['source_ip']);dip=socket.inet_aton(c['server_ip']);mode=c['mode']
    et,op,dst,spa,tha,tpa=(0x8035,3,b'\xff'*6,bytes(4),sm,bytes(4)) if mode=='rarp' else (0x0806,8,dm,sip,dm,bytes(4)) if mode=='inarp' else (0x0806,1,b'\xff'*6,sip,bytes(6),dip)
    s=c['request_scenario']['mode']
    if s=='wrong-target-ip':tpa=tpa[:3]+bytes([tpa[3]^1])
    if s in ('wrong-target-mac','unknown-tha'):tha=tha[:5]+bytes([tha[5]^1])
    if s=='nonzero-rarp-proto':spa=bytes.fromhex('01020304');tpa=bytes.fromhex('05060708')
    if s=='nonzero-whois-tha':tha=b'\xff'*6
    raw=dst+sm+struct.pack('!HHHBBH',et,1,0x0800,6,4,op)+sm+spa+tha+tpa+bytes(18)
    return raw[:37] if s=='short-arp' else raw

def peer_role_ips(c):
    """OS endpoint conflicts include the actual complete request TPA, not intent."""
    values={c[k] for k in ('source_ip','server_ip','assigned_ip')}
    raw=expected_request(c)
    if len(raw)>=42:values.add(socket.inet_ntoa(raw[38:42]))
    return values

def response_bytes(c,wrong=None):
    et,op=(0x8035,4) if c['mode']=='rarp' else (0x0806,9 if c['mode']=='inarp' else 2)
    spa=socket.inet_aton(c['server_ip']);tpa=socket.inet_aton(c['assigned_ip'] if c['mode']=='rarp' else c['source_ip'])
    if wrong=='spa':spa=spa[:3]+bytes([spa[3]^1])
    if wrong=='tpa':tpa=tpa[:3]+bytes([tpa[3]^1])
    return mac(c['source_mac'])+mac(c['server_mac'])+struct.pack('!HHHBBH',et,1,0x0800,6,4,op)+mac(c['server_mac'])+spa+mac(c['source_mac'])+tpa+secrets.token_bytes(16)+bytes(2)

def matched_request(raw,expected):
    if raw==expected:return 'exact'
    if len(expected)==37 and len(raw)==60 and raw[:37]==expected and raw[37:]==bytes(23):return 'driver_zero_padded60'
    return None

def collect_events(observer,cursor,deadline):
    events=[];next_id=cursor+1
    for _ in range(16):
        page=observer.get('/v1/events?'+urllib.parse.urlencode({'after_event_id':cursor,'limit':16}),deadline)
        rows=page['events']
        if any(type(e.get('event_id')) is not int or e['event_id']<=cursor for e in rows):raise ValueError('event cursor order mismatch')
        events.extend(rows);next_id=page['next_event_id']
        if len(events)>256:raise ValueError('causal event budget exceeded')
        if not page['truncated']:return events,next_id
        if not rows:raise ValueError('truncated observer page without progress')
        cursor=rows[-1]['event_id']
    raise ValueError('event pagination budget exceeded')

def run_check(args,c,observer,transport,method,round_number,start_cursor,global_deadline,budget_ms):
    start=time.monotonic();deadline=min(global_deadline-2,start+budget_ms/1000);result={'name':method+'/round-'+str(round_number),'passed':False,'request':{'method':method,'mode':c['mode'],'request_scenario':c['request_scenario']['mode']},'response':{}}
    cursor=start_cursor;sent=[];control_left=1.0
    try:
        def control_status():
            nonlocal control_left
            if control_left<=0:raise TimeoutError('aggregate case observer budget exhausted')
            began=time.monotonic()
            try:return observer.status(min(deadline,began+control_left))
            finally:control_left-=time.monotonic()-began
        # A previous proof cursor is not this case's baseline after scheduling delay.
        baseline_began=time.monotonic();baseline=control_status();start_cursor=baseline['next_event_id']-1
        baseline_query=baseline['counters']['queries_sent']
        # Drop pre-case queued packets, without ever accepting outgoing as incoming.
        for _ in range(256):
            try:transport.receive()
            except BlockingIOError:break
        else:raise ValueError('peer input backlog prevents fresh request proof')
        expected=expected_request(c);ignored=0;received=None
        while received is None:
            left=deadline-time.monotonic()
            if left<=0:raise TimeoutError('fresh actual incoming target request deadline')
            if not select.select([transport.socket],[],[],min(.02,left))[0]:continue
            for _ in range(32):
                if time.monotonic()>=deadline:raise TimeoutError('absolute case deadline under input load')
                try:raw,meta=transport.receive()
                except BlockingIOError:break
                relation=matched_request(raw,expected)
                if not relation or meta['packet_type']==4 or meta['truncated'] or meta['hardware_type']!=1 or meta['ifindex']!=transport.interface['ifindex'] or meta['hardware_address']!=c['source_mac']:
                    ignored+=1
                    if ignored>4096:raise ValueError('foreign Ethernet observation budget exceeded')
                    continue
                captured_at=time.monotonic();live=control_status();pending=live.get('pending')
                if pending is None:
                    history=live.get('last_mapping')
                    if history and history['query_id']>baseline_query:raise ValueError('external response resolved captured request before inverse peer')
                    continue
                # Confirm a fresh live attempt; never borrow an expired older timeout.
                capture_source_upper=baseline['uptime_ms']+int((captured_at-baseline_began)*1000)+2
                if pending['query_id']<=baseline_query or pending['deadline_ms']<=live['uptime_ms'] or pending['sent_ms']>capture_source_upper:continue
                if pending['unexpected_responses']:raise ValueError('external attributable response already affected this fresh attempt')
                received=(raw,meta,relation,captured_at,pending,live['uptime_ms']);break
        raw,meta,relation,captured,anchor,anchor_uptime=received
        anchored_query=anchor['query_id']
        result['request'].update(target_submitted_wire=summary(expected),actual_incoming_wire=summary(raw),packet_address=meta,wire_relation=relation,ignored_other_frames=ignored,live_source_anchor={'query_id':anchored_query,'source_uptime_ms':anchor_uptime,'sent_ms':anchor['sent_ms'],'deadline_ms':anchor['deadline_ms']})
        def send(wrong=None):
            wire=response_bytes(c,wrong);transport.send(wire);sent.append({'variant':wrong or 'canonical_normal','wire':summary(wire)})
        if method=='MAPPING':send()
        elif method=='REJECT_REPLY':
            send('spa' if round_number==1 else 'tpa')
            if positive(c):
                until=time.monotonic()+.1
                while time.monotonic()<until:
                    if time.monotonic()>=deadline:raise TimeoutError('absolute reject-to-good gap deadline')
                    select.select([],[],[],min(.01,until-time.monotonic()))
            send()
        wait_timeout=method=='TIMEOUT' or (method in ('MAPPING','REJECT_REPLY') and not positive(c))
        if wait_timeout:
            # A response is intentionally withheld for TIMEOUT; use actual source timeout event for proof.
            until=captured+c['timeout_ms']/1000
            while time.monotonic()<until:
                if time.monotonic()>=deadline:raise TimeoutError('absolute source-timeout wait deadline')
                select.select([],[],[],min(.02,until-time.monotonic()))
        if control_left<=0:raise TimeoutError('aggregate case observer budget exhausted')
        proof_deadline=min(deadline,time.monotonic()+control_left);all_events=[]
        while True:
            if time.monotonic()>=proof_deadline:raise TimeoutError('source causal proof absolute deadline')
            all_events,next_id=collect_events(observer,start_cursor,proof_deadline)
            hashes={x['wire']['raw_sha256'] for x in sent}
            reply_events=[e for e in all_events if e.get('response_sha256') in hashes]
            if any(e['query_id']!=anchored_query for e in reply_events):raise ValueError('Reply belongs to a different attempt than the live captured query')
            qid=anchored_query
            selected=[e for e in all_events if e['query_id']==qid]
            query=[e for e in selected if e['kind']=='query_sent']
            if len(query)==1 and query[0]['event_id']>start_cursor:
                q=query[0]
                if q.get('wire',{}).get('raw_sha256')!=summary(expected)['raw_sha256'] or q.get('attempt_id')!=qid:raise ValueError('submitted request/attempt proof mismatch')
                mappings=[e for e in selected if e['kind']=='mapping_resolved'];timeouts=[e for e in selected if e['kind']=='query_timeout'];rejections=[e for e in selected if e['kind']=='rejected']
                if method=='OBSERVE_REQUEST':complete=True
                elif positive(c) and method in ('MAPPING','REJECT_REPLY'):
                    complete=len(mappings)==1
                    if timeouts:raise ValueError('reply failed before absolute query deadline')
                    if complete:
                        good=sent[-1]['wire']['raw_sha256'];value=mappings[0]['mapping']
                        if value['response_sha256']!=good or mappings[0].get('response_sha256')!=good:raise ValueError('mapping did not receive this fresh actual Reply')
                        expected_kind='assigned_ip_for_target_mac' if c['mode']=='rarp' else 'server_ip_for_known_mac' if c['mode']=='inarp' else 'server_mac_for_target_ip'
                        if (value['mapping_kind'],value['mapping_mac'],value['mapping_ip'])!=(expected_kind,c['source_mac'] if c['mode']=='rarp' else c['server_mac'],c['assigned_ip'] if c['mode']=='rarp' else c['server_ip']):raise ValueError('mapping role mismatch')
                        if method=='REJECT_REPLY':
                            bad=[e for e in rejections if e.get('response_sha256')==sent[0]['wire']['raw_sha256']]
                            if len(bad)!=1 or bad[0]['event_id']>=mappings[0]['event_id']:raise ValueError('bad Reply not rejected before valid mapping')
                else:
                    if mappings:raise ValueError('unexpected mapping for negative/silence test')
                    complete=len(timeouts)==1
                    if complete:
                        timeout=timeouts[0];expected_unexpected=len(sent) if not positive(c) else 0
                        if timeout['unexpected_responses']!=expected_unexpected or timeout['negative_silent']!=(not positive(c) and not sent):raise ValueError('negative candidate/control counter split mismatch')
                        if sent:
                            for reply in sent:
                                rejected=[e for e in rejections if e.get('response_sha256')==reply['wire']['raw_sha256'] and e.get('unexpected')]
                                if len(rejected)!=1:raise ValueError('complete negative Reply not actually rejected/attributed')
                if complete:
                    for reply in sent:
                        actual=[e for e in selected if e['kind']=='received' and e.get('response_sha256')==reply['wire']['raw_sha256'] and e.get('response_candidate')]
                        if len(actual)!=1:raise ValueError('Reply send is missing actual incoming source observation')
                    result['response']={'query_id':qid,'attempt_id':qid,'peer_sent':sent,'causal_events':selected,'source_boot_id':args.expected_boot_id,'protocol_has_transaction_id':False,'late_identical_response_is_ambiguous':True,'response_ack_sent':False}
                    result['passed']=True;cursor=next_id-1;break
            select.select([],[],[],min(.01,max(0,proof_deadline-time.monotonic())))
    except Exception as error:result['error']=type(error).__name__+': '+str(error)[:300];result['response']['peer_sent']=sent
    result['seconds']=round(time.monotonic()-start,6);return result,cursor

def main():
    started=time.monotonic();report={'passed':False,'checks':[]};transport=None
    try:
        def alarm(_sig,_frame):raise TimeoutError('absolute30s ARP peer deadline')
        signal.signal(signal.SIGALRM,alarm);signal.alarm(30)
        parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--method',choices=METHODS+('ALL',),default='ALL');parser.add_argument('--path',choices=('peer',),default='peer');parser.add_argument('--config-json',required=True);parser.add_argument('--interface',required=True);parser.add_argument('--observer-host',required=True);parser.add_argument('--observer-port',type=int,default=18086);parser.add_argument('--expected-runtime-id',required=True);parser.add_argument('--expected-boot-id',required=True)
        try:args=parser.parse_args()
        except SystemExit as error:
            if error.code==0:return 0
            raise ValueError('invalid inverse client arguments') from None
        c=load_config(args.config_json);budgets,total=case_budgets(c,args.method);report['computed_budget_ms']=total
        ip=ipaddress.IPv4Address(args.observer_host)
        if ip.is_unspecified or ip.is_multicast or int(ip)==0xffffffff or not 1<=args.observer_port<=65535:raise ValueError('explicit observer IPv4/port required')
        if c['link']['mode']=='docker-bridge':
            # Docker eth0 has an assigned IPv4 endpoint; do not hide its automatic ARP.
            with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as control:
                assigned=socket.inet_ntoa(fcntl.ioctl(control.fileno(),0x8915,struct.pack('256s',args.interface.encode()))[20:24])
            if assigned in peer_role_ips(c):raise ValueError('test unavailable: actual peer OS IPv4 collides with simulated role or request TPA')
        observer=Observer(args,c);transport=Transport(args.interface,c['server_mac']);deadline=started+30
        before=observer.status(min(deadline,started+2));proof=before.get('filter',{})
        if proof.get('instructions')!=FILTER or proof.get('sha256')!=filter_hash(FILTER) or not proof.get('attached'):raise ValueError('source actual kernel filter proof mismatch')
        cursor=before['next_event_id']-1
        for method in METHODS if args.method=='ALL' else (args.method,):
            for round_number in (1,2):
                check,cursor=run_check(args,c,observer,transport,method,round_number,cursor,deadline,budgets[method]);report['checks'].append(check)
                if not check['passed']:raise ValueError('check failed; further peer Replies withheld')
        observer.status(deadline);report['passed']=True;report['all_means_current_mode_and_scenario']=True;report['applied_mode']=c['mode'];report['applied_request_scenario']=c['request_scenario']['mode'];report['peer_interface']=transport.interface
    except Exception as error:report['error']=type(error).__name__+': '+str(error)[:300]
    finally:
        if transport is not None:transport.close()
        signal.alarm(0)
    checks=report['checks'];report['summary']={'total':len(checks),'passed':sum(x['passed'] for x in checks),'failed':sum(not x['passed'] for x in checks)};report['seconds']=round(time.monotonic()-started,6)
    raw=json.dumps(report,separators=(',',':'))
    if len(raw.encode())>524288:raw=json.dumps({'passed':False,'checks':[],'summary':report['summary'],'error':'report512KiB budget exceeded'});report['passed']=False
    print(raw);return 0 if report['passed'] else 1
if __name__=='__main__':sys.exit(main())
