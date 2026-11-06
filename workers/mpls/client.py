#!/usr/bin/env python3
"""MIT. Real MPLS request / opaque applied-fault reply checks; no fake ACK."""
import argparse,json,os,select,signal,socket,time,uuid
from mpls_wire import *
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
            if v.get('protocol')!='mpls' or v.get('schema_version')!=1:raise ValueError('observer schema mismatch')
            if path=='/v1/status':
                if v.get('config_sha256')!=self.cfg or not v.get('worker_ready_after_bind') or v.get('event_loop_age_ms',99999)>2000:raise ValueError('source config/readiness/heartbeat mismatch')
            return v
        finally:
            if sock:sock.close()
            self.remaining-=time.monotonic()-start

def quiet_association(raw,c,request):
    """Conservative current-reply association, independent of payload/checksum validity.

    Partial role-only replies have no full wire identifier: fail the quiet test
    conservatively rather than claim a uniquely identified response or ACK.
    """
    if len(raw)<14 or raw[12:14]!=b'\x08\x00':return None
    mode=c['scenario']['mode'];sm=mac(c['source_mac']);dm=mac(c['client_mac']);sip=socket.inet_aton(c['source_ip']);dip=socket.inet_aton(c['client_ip'])
    def flip(value):return value[:-1]+bytes([value[-1]^1])
    src_macs={sm,flip(sm)} if mode=='wrong-eth-src' else {sm};dst_macs={dm,flip(dm)} if mode=='wrong-eth-dst' else {dm}
    src_ips={sip,flip(sip)} if mode=='wrong-ip-src' else {sip};dst_ips={dip,flip(dip)} if mode=='wrong-ip-dst' else {dip}
    mac_roles=raw[6:12] in src_macs and raw[:6] in dst_macs
    if len(raw)<30 or raw[14]>>4!=4 or raw[23]!=1:return None
    ip_roles=len(raw)>=34 and raw[26:30] in src_ips and raw[30:34] in dst_ips
    if not (mac_roles or ip_roles):return None
    if len(raw)<34:
        if mac_roles and raw[26:30] in src_ips and any(raw[30:]==d[:len(raw)-30] for d in dst_ips):return 'partial_ipv4_role_prefix_without_wire_id'
        return None
    ihl=(raw[14]&15)*4
    if not 20<=ihl<=60:return None
    offset=14+ihl
    if len(raw)<offset+1 or raw[offset]!=0:return None
    ids={request['identifier'],(request['identifier']+1)&65535} if mode=='wrong-id' else {request['identifier']}
    seqs={request['sequence'],(request['sequence']+1)&65535} if mode=='wrong-seq' else {request['sequence']}
    if len(raw)>=offset+8:
        if int.from_bytes(raw[offset+4:offset+6],'big') in ids and int.from_bytes(raw[offset+6:offset+8],'big') in seqs:return 'current_icmp_id_sequence_and_roles'
    elif len(raw)>offset+4:
        prefix=raw[offset+4:]
        if any(prefix==struct.pack('!HH',i,q)[:len(prefix)] for i in ids for q in seqs):return 'partial_current_icmp_id_sequence_and_roles'
    payload=request['payload']
    if payload and (payload in raw or len(payload)>1 and payload[1:] in raw):return 'current_payload_nonce_and_roles'
    return None

def boundary_association(raw,c,request):
    # Observer TCP/ARP legitimately shares these MACs. Only reply-profile IPv4/
    # ICMP or a genuinely truncated role-pair header is unexpected at this layer.
    if len(raw)>=12 and raw[:6]==mac(c['client_mac'])and raw[6:12]==mac(c['source_mac']):
        if len(raw)<14:return 'boundary_truncated_ethernet_role_pair_without_wire_id'
        if raw[12:14]==b'\x08\x00'and(len(raw)<34 or raw[23]==1):return 'boundary_icmp_or_short_ipv4_role_pair_without_wire_id'
    return quiet_association(raw,c,request)

def short_tx_evidence(cfg, output):
    """Independent 13-byte oracle: destination6 + source6 + first EtherType byte.

    Only this exact kernel rejection qualifies; other errno, suppression or
    missing/stale proof never becomes a successful boundary check.
    """
    expected=mac(cfg['client_mac'])+mac(cfg['source_mac'])+b'\x08'
    if cfg['scenario']['mode']!='short-ethernet' or output.get('kind')!='tx_error' or type(output.get('errno'))is not int or output['errno']!=22 or output.get('submitted')is not False or output.get('scenario')!='short-ethernet' or output.get('frame')!=summary(expected):
        raise ValueError('not the exact current13-byte Ethernet EINVAL rejection')
    return {'expected_frame':summary(expected),'errno':22,'submitted':False,'wire_receive_verified':False}

class Client:
    def __init__(self,a,c):self.a=a;self.cfg=c;self.born=time.monotonic();self.deadline=self.born+30;self.transport=None;self.obs=None;self.requests=0;self.responses=0;self.unexpected=0;self.identity=None
    def get(self,path,deadline=None):self.obs.phase=min(self.deadline,deadline or self.deadline);return self.obs.get(path)
    def valid_status(self,s):
        if s['interface']['mac']!=self.cfg['source_mac'] or s['packet_auxdata'] is not True or s['filter']['sha256']!=filter_hash(FILTER) or not s['filter']['attached']:raise ValueError('source actual interface/filter/AUX mismatch')
        if s.get('actual_ipv4_truncated'):raise ValueError('environment_unavailable: actual source address proof truncated')
        identity={k:s[k] for k in ('boot_id','runtime_id','config_sha256','interface','filter')}
        if self.identity is not None and identity!=self.identity:raise ValueError('actual source socket/interface identity changed')
        self.identity=identity;role_preflight(self.cfg,s)
    def drain(self):
        start=time.monotonic()
        for _ in range(256):
            if time.monotonic()-start>.05:raise ValueError('input flood before request')
            try:self.transport.receive()
            except BlockingIOError:return
        raise ValueError('input flood before request')
    def valid_peer_frame(self,raw,meta):
        return not meta['truncated'] and not meta.get('vlan_valid') and meta['packet_type']!=4 and meta['interface']==self.transport.interface['name'] and meta['ifindex']==self.transport.interface['ifindex'] and meta['hardware_type']==1 and len(raw)>=12 and meta['hardware_address']==mac_text(raw[6:12])
    def check(self,method,round_no,boundary=False,deadline=None):
        start=time.monotonic();end=min(self.deadline,start+3,deadline or self.deadline);record={'name':method+' round '+str(round_no),'passed':False,'classification':'failed','verification_layer':'tx_boundary'if boundary else'ethernet_receive','request':{'method':method,'path':'echo','round':round_no},'response':{}};received=[];events=[];sha=None
        try:
            self.drain();before=self.get('/v1/status',end);self.valid_status(before);cursor=before['next_event_id']-1
            ident,seq=struct.unpack('!HH',os.urandom(4));payload=os.urandom(17 if method=='PADDING' else 16);kwargs={}
            if method=='TC_TTL':kwargs={'tc':0 if round_no==1 else 7,'label_ttl':2 if round_no==1 else 255}
            if method=='PADDING':kwargs={'padding':b'\xa5'*11}
            reject=None
            if method=='INVALID_REQUEST':
                if round_no==1:kwargs={'label':16 if self.cfg['label']==1048575 else self.cfg['label']+1};reject='wrong_label'
                else:kwargs={'label_ttl':1};reject='mpls_ttl_expired'
            raw=request_frame(self.cfg,ident,seq,payload,**kwargs);parsed=decode_request(raw);sha=summary(raw)['sha256'];record['request'].update(frame=summary(raw),decoded=decoded(parsed))
            self.transport.send(raw);self.requests+=1;last_poll=0;quiet_end=None;output=None;matched=None
            while time.monotonic()<end:
                select.select([self.transport.socket],[],[],min(.02,max(0,end-time.monotonic())))
                for _ in range(32):
                    try:wire,meta=self.transport.receive()
                    except BlockingIOError:break
                    if self.valid_peer_frame(wire,meta):
                        if len(received)>=256:raise ValueError('peer response capture budget')
                        received.append((wire,meta))
                if time.monotonic()-last_poll>=.05:
                    page=self.get('/v1/events?after='+str(cursor)+'&limit=16',end);last_poll=time.monotonic()
                    if page['cache_evictions']!=before['cache_evictions']:raise ValueError('source event cache evicted during check')
                    if page['events']:cursor=page['events'][-1]['event_id']
                    events.extend(e for e in page['events'] if e['request_sha256']==sha)
                    if len(events)>16:raise ValueError('duplicate/flooded current request source proof')
                request_events=[e for e in events if e['kind'] in ('accepted','rejected')]
                outputs=[e for e in events if e['kind'] in ('tx_submitted','tx_error','suppressed')]
                if len(request_events)>1 or len(outputs)>1:raise ValueError('ambiguous duplicate current request')
                if not request_events:continue
                source=request_events[0]
                if source['frame']['sha256']!=sha or source['frame']['wire_length']!=len(raw):raise ValueError('source received frame differs from actual request')
                if reject:
                    if source['kind']!='rejected' or source.get('reason')!=reject or outputs:raise ValueError('invalid request not rejected with exact reason')
                    if quiet_end is None:quiet_end=time.monotonic()+.5
                else:
                    if source['kind']!='accepted':raise ValueError('source rejected valid request: '+str(source.get('reason')))
                    if not outputs:continue
                    output=outputs[0]
                    if output['request_id']!=source['request_id'] or output['event_id']<=source['event_id']:raise ValueError('source output not linked to current accepted request')
                    if output['kind']=='tx_error':
                        if boundary:
                            record['response']['boundary_evidence']=short_tx_evidence(self.cfg,output)
                            if quiet_end is None:quiet_end=time.monotonic()+.5
                        else:
                            record['response']['source_events']=events;record['environment_unavailable']=True
                            try:short_tx_evidence(self.cfg,output);record['classification']='environment_limited'
                            except ValueError:pass
                            raise ValueError('environment_unavailable: source tx_error errno='+str(output.get('errno'))+' intended_length='+str(output['frame']['wire_length']))
                    elif boundary:raise ValueError('TX_BOUNDARY requires actual kernel EINVAL rejection, not submission or suppression')
                    if boundary:
                        expected=None
                    else:expected=reply_frame(parsed,self.cfg,output['reply_ip_identifier'])
                    if boundary:pass
                    elif expected is None:
                        if output['kind']!='suppressed':raise ValueError('silent scenario did not suppress current request')
                        if quiet_end is None:quiet_end=time.monotonic()+.5
                    else:
                        if output['kind']!='tx_submitted' or output['frame']!=summary(expected):raise ValueError('source actual submitted frame differs from expected applied fault')
                        matches=[]
                        for peer_raw,meta in received:
                            exact=peer_raw==expected;padding=len(peer_raw)-len(expected)
                            padded=len(expected)<60 and len(peer_raw)==60 and peer_raw[:len(expected)]==expected and peer_raw[len(expected):]==bytes(padding)
                            if exact or padded:matches.append((peer_raw,meta,'exact' if exact else 'ethernet_zero_padding',max(0,padding)))
                        if len(matches)>1:raise ValueError('duplicate matching actual replies')
                        if matches:
                            wire,meta,kind,padding=matches[0];matched={'frame':summary(wire),'metadata':meta,'match_kind':kind,'padding_bytes':padding};self.responses+=1;break
                if quiet_end is not None:
                    unexpected=[{'frame':summary(wire),'metadata':meta,'association_reason':reason} for wire,meta in received if (reason:=(boundary_association(wire,self.cfg,parsed)if boundary else quiet_association(wire,self.cfg,parsed))) is not None]
                    if unexpected:
                        self.responses+=len(unexpected);self.unexpected+=len(unexpected);record['response']['unexpected_peer']=unexpected[:8];record['response']['unexpected_peer_total']=len(unexpected);record['response']['unexpected_peer_truncated']=len(unexpected)>8
                        raise ValueError('unexpected actual associated incoming reply during required silence')
                    if time.monotonic()>=quiet_end:break
            else:raise TimeoutError('absolute3-second check deadline: no complete current source+peer proof')
            if not boundary and reject is None and self.cfg['scenario']['mode']!='silent' and matched is None:raise ValueError('missing actual incoming opaque reply')
            record['response'].update(source_events=events,peer=matched,quiet_ms=500 if quiet_end is not None else 0)
            after=self.get('/v1/status',end);self.valid_status(after)
            if boundary:
                proof=record['response']['boundary_evidence'];keys=('accepted','tx_error','tx_submitted','suppressed')
                for key,delta in zip(keys,(1,1,0,0)):
                    if type(before['counters'][key])is not int or type(after['counters'][key])is not int or after['counters'][key]!=before['counters'][key]+delta:raise ValueError('boundary source counter delta mismatch: '+key)
                proof.update(counters_before={k:before['counters'][k]for k in keys},counters_after={k:after['counters'][k]for k in keys},source_identity_unchanged=True,actual_peer_responses=0)
            record['passed']=True;record['classification']='passed'
        except GlobalDeadline:raise
        except Exception as error:record['error']=type(error).__name__+': '+str(error)[:512];record['response'].setdefault('source_events',events)
        record['seconds']=round(time.monotonic()-start,6);return record
    def boundary_check(self,method,round_no):
        start=time.monotonic();end=min(self.deadline,start+3)
        pre=self.check('INVALID_REQUEST',round_no,deadline=end)
        if not pre['passed']:
            return {'name':method+' boundary round '+str(round_no),'passed':False,'classification':'failed','verification_layer':'tx_boundary','error':'before-boundary processing control failed','response':{'controls':[pre]},'seconds':round(time.monotonic()-start,6)}
        result=self.check(method,round_no,boundary=True,deadline=end)
        post=self.check('INVALID_REQUEST',round_no,deadline=end)
        result['name']=method+' boundary round '+str(round_no);result['response']['controls']=[pre,post]
        if not post['passed']:result['passed']=False;result['classification']='failed';result['error']='after-boundary processing control failed: '+post.get('error','unknown')
        result['seconds']=round(time.monotonic()-start,6);return result
    def run(self):
        r={'protocol':'mpls','scenario':self.cfg['scenario']['mode'],'passed':False,'checks':[],'verification_schema':2,'verification_layer':'tx_boundary'if self.a.method=='TX_BOUNDARY'else'ethernet_receive','planned':{'requests':18 if self.a.method=='TX_BOUNDARY'else 8 if self.a.method=='ALL' else 2,'checks':6 if self.a.method=='TX_BOUNDARY'else 8 if self.a.method=='ALL' else 2}}
        try:
            if self.a.method=='TX_BOUNDARY'and self.cfg['scenario']['mode']!='short-ethernet':raise ValueError('TX_BOUNDARY requires applied short-ethernet scenario')
            self.obs=Observer(self.a.observer_host,self.a.observer_port,self.a.expected_boot_id,self.a.expected_runtime_id,self.cfg);s=self.get('/v1/status');self.valid_status(s)
            actual=interface_info(self.a.interface,self.cfg['client_mac'])
            if actual['mac']==s['interface']['mac']:raise ValueError('environment_unavailable: peer requires distinct actual Ethernet interface')
            self.transport=Transport(self.a.interface,self.cfg['client_mac'],False)
            for method in (METHODS[:3]if self.a.method=='TX_BOUNDARY'else METHODS if self.a.method=='ALL' else (self.a.method,)):
                for n in (1,2):r['checks'].append(self.boundary_check(method,n)if self.a.method=='TX_BOUNDARY'else self.check(method,n))
            r['passed']=bool(r['checks']) and all(x['passed'] for x in r['checks']);r['source_identity']=self.identity
        except Exception as e:r['error']=type(e).__name__+': '+str(e)[:512]
        finally:
            if self.transport:self.transport.close()
        checks=r['checks'];r['summary']={'total':len(checks),'passed':sum(x['passed'] for x in checks),'failed':sum(not x['passed']and x.get('classification')!='environment_limited'for x in checks),'environment_limited':sum(x.get('classification')=='environment_limited'for x in checks),'actual_requests':self.requests,'actual_responses':self.responses,'unexpected_responses':self.unexpected};r['outcome']='failed'if r.get('error')or r['summary']['failed']or not checks else'environment_limited'if r['summary']['environment_limited']else'passed';r['seconds']=round(time.monotonic()-self.born,6);return r

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--config-json',required=True);p.add_argument('--interface',required=True);p.add_argument('--observer-host',required=True);p.add_argument('--observer-port',type=int,default=18089);p.add_argument('--expected-boot-id',required=True);p.add_argument('--expected-runtime-id',required=True);p.add_argument('--method',choices=METHODS+('ALL','TX_BOUNDARY'),default='ALL');p.add_argument('--path',choices=('echo',),default='echo');a=p.parse_args()
    def expired(*_):raise GlobalDeadline('absolute30-second total deadline')
    signal.signal(signal.SIGALRM,expired);signal.alarm(30)
    try:
        c=load_config(a.config_json);uuid.UUID(a.expected_boot_id)
        if not re.fullmatch('[0-9a-f]{32}',a.expected_runtime_id):raise ValueError('runtime identity must be32lowerhex')
        ipaddress.IPv4Address(a.observer_host);integer(a.observer_port,1,65535);r=Client(a,c).run()
    except Exception as e:r={'protocol':'mpls','passed':False,'checks':[],'error':type(e).__name__+': '+str(e)[:512],'summary':{'total':0,'passed':0,'failed':0,'actual_requests':0,'actual_responses':0,'unexpected_responses':0}}
    finally:signal.alarm(0)
    raw=json.dumps(r,separators=(',',':'))
    if len(raw.encode())>524288:r={'protocol':'mpls','passed':False,'checks':[],'error':'report exceeds512KiB','summary':{'total':0,'passed':0,'failed':0,'actual_requests':0,'actual_responses':0,'unexpected_responses':0}};raw=json.dumps(r)
    print(raw);return 0 if r['passed'] else 1
if __name__=='__main__':raise SystemExit(main())
