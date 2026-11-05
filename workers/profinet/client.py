#!/usr/local/bin/python3
"""One-shot real Ethernet peer for the currently applied three-node PROFINET workspace."""
import argparse,collections,copy,ctypes,hashlib,http.client,ipaddress,json,os,pathlib,secrets,select,signal,socket,struct,sys,time,urllib.parse
from config import METHODS,PROFILE,canonical,digest,mac,suite,validate
import net,ptcp

def summary(raw):return {'length':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'preview_hex':raw[:128].hex(),'truncated':len(raw)>128}
def block(opt,sub,value):return bytes((opt,sub))+len(value).to_bytes(2,'big')+value+b'\0'*(len(value)%2)
def dcp_frame(dst,src,fid,sid,xid,data,delay=0):return (ptcp.mac_bytes(dst)+ptcp.mac_bytes(src)+b'\x88\x92'+struct.pack('!HBBIHH',fid,sid,0,xid,delay,len(data))+data).ljust(60,b'\0')
def parse_dcp(raw):
 if len(raw)<26 or raw[12:14]!=b'\x88\x92':raise ValueError('DCP header')
 fid,sid,typ,xid,delay,size=struct.unpack_from('!HBBIHH',raw,14);end=26+size
 if end>len(raw)or any(raw[end:]):raise ValueError('DCP length/padding')
 cursor=26;blocks={}
 while cursor<end:
  if cursor+4>end:raise ValueError('DCP block header')
  o,s,n=struct.unpack_from('!BBH',raw,cursor);cursor+=4
  if cursor+n>end or(o,s)in blocks:raise ValueError('DCP block length/duplicate')
  blocks[o,s]=raw[cursor:cursor+n];cursor+=n
  if n%2:
   if cursor>=end or raw[cursor]!=0:raise ValueError('DCP block padding')
   cursor+=1
 return {'frame_id':fid,'service':sid,'service_type':typ,'xid':xid,'delay':delay,'blocks':blocks,'pdu_sha256':hashlib.sha256(raw[14:end]).hexdigest()}

def receive_meta(raw,addr):return {'interface':addr[0],'packet_type':addr[2],'hardware_type':addr[3],'hardware_address':':'.join(f'{v:02x}'for v in addr[4]),'source_mac':':'.join(f'{v:02x}'for v in raw[6:12]),'destination_mac':':'.join(f'{v:02x}'for v in raw[:6])}
def attach_profinet_filter(s):
 class Ins(ctypes.Structure):_fields_=[('code',ctypes.c_ushort),('jt',ctypes.c_ubyte),('jf',ctypes.c_ubyte),('k',ctypes.c_uint)]
 class Prog(ctypes.Structure):_fields_=[('length',ctypes.c_ushort),('instructions',ctypes.POINTER(Ins))]
 instructions=(Ins*4)(Ins(40,0,0,12),Ins(21,0,1,0x8892),Ins(6,0,0,0xffffffff),Ins(6,0,0,0));program=Prog(4,instructions);libc=ctypes.CDLL(None,use_errno=True)
 if libc.setsockopt(s.fileno(),socket.SOL_SOCKET,26,ctypes.byref(program),ctypes.sizeof(program))!=0:raise OSError(ctypes.get_errno(),'attach PROFINET peer filter')

class Client:
 def __init__(self,a):
  self.a=a;self.c=validate(json.loads(a.config_json));self.born=time.monotonic();self.deadline=self.born+90;self.s=None;self.requests=0;self.responses=0;self.matched=0;self.other=0;self.unexpected=0;self.checks=[];self.restore=None;self.current_check=None;self.known_signal_end=None;self.failure_evidence=None
 def http(self,path,deadline=None):
  left=min(self.deadline,deadline or self.deadline)-time.monotonic()
  if left<=0:raise TimeoutError('absolute client deadline')
  c=http.client.HTTPConnection(self.a.observer_host,self.a.observer_port,timeout=min(1,left))
  try:
   c.request('GET',path);r=c.getresponse();data=r.read(65537)
   if r.status!=200 or len(data)>65536:raise ValueError('observer HTTP/budget failure')
   obj=json.loads(data)
   if obj.get('boot_id')!=self.a.expected_boot_id or obj.get('runtime_id')!=self.a.expected_runtime_id:raise ValueError('source boot/runtime identity changed')
   return obj
  finally:c.close()
 def status(self,deadline=None):
  v=self.http('/v1/status',deadline)
  if v.get('protocol')!='profinet'or v.get('schema_version')!=1 or v.get('config_sha256')!=digest(self.c)or v.get('worker_ready_after_bind')is not True or not 0<=v['event_loop_age_ms']<=2000:raise ValueError('source readiness/config proof')
  if not v['components']['dcp']['ready']or not 0<=v['components']['dcp']['tick_age_ms']<=2000:raise ValueError('native DCP not ready')
  return v
 def events(self,after,deadline):
  rows=[]
  for _ in range(32):
   v=self.http(f'/v1/events?after={after}&limit=16',deadline);page=v['events'];rows.extend(page)
   if not page or not v['truncated']:return rows
   after=page[-1]['event_id']
  raise ValueError('observer page budget')
 def open(self):
  current=self.status();peer=mac(self.a.peer_mac or self.c['test_peer_mac']);rows=net.interfaces()
  matches=[r for r in rows if r['mac']==peer and(self.a.interface=='auto'or r['name']==self.a.interface)]
  if len(matches)!=1 or matches[0]['hardware_type']!=1:raise ValueError('unique actual Ethernet peer MAC/interface required')
  self.interface=matches[0];self.peer=peer
  if peer in(self.c['dcp']['mac'],self.c['ptcp_n']['mac'],self.c['ptcp_f']['mac']):raise ValueError('peer actual MAC collides with a source node')
  if self.interface['namespace']==current['interfaces']['data']['namespace']:raise ValueError('peer must use a distinct actual network namespace')
  self.s=socket.socket(socket.AF_PACKET,socket.SOCK_RAW,socket.htons(3));self.s.bind((self.interface['name'],0));attach_profinet_filter(self.s);self.s.setblocking(False)
  for g in ptcp.GROUPS:self.s.setsockopt(263,1,struct.pack('IHH8s',self.interface['ifindex'],0,6,ptcp.mac_bytes(g)))
  if self.a.method in('DCP_READ','ALL','DCP_SIGNAL','DCP_WRITE_STATION_TEMP','DCP_WRITE_IP_TEMP'):
   idle_deadline=min(self.deadline,time.monotonic()+3.5)
   while current['components']['dcp'].get('sam_mac')not in(None,self.peer):
    if time.monotonic()>=idle_deadline:raise ValueError('unavailable: native DCP SAM is occupied by another requestor MAC; ongoing external Get/Set may retain its three-second window')
    time.sleep(.05);current=self.status(idle_deadline)
  self.initial=current
 def drain(self):
  for _ in range(256):
   try:self.s.recvfrom(65536)
   except BlockingIOError:return
  raise ValueError('peer receive drain budget')
 def send(self,raw):
  if self.s.send(raw)!=len(raw):raise OSError('short AF_PACKET send')
  self.requests+=1
 def receive(self,deadline):
  left=min(deadline,self.deadline)-time.monotonic()
  if left<=0:return None
  if not select.select([self.s],[],[],left)[0]:return None
  raw,addr=self.s.recvfrom(65536)
  if addr[2]==4 or len(raw)<14 or raw[12:14]!=b'\x88\x92':return b'',None
  return raw,receive_meta(raw,addr)
 def phase(self,name,method,round_no,request,selector,expect_source=None,deadline_ms=3000):
  self.drain();before=self.status();after=before['next_event_id']-1;deadline=min(self.deadline,time.monotonic()+deadline_ms/1000);self.send(request);return before,after,deadline
 def dcp_exchange(self,label,sid,body,fid=0xfefd,expect_pair=None,read_kind=None,deadline=None):
  deadline=min(deadline or self.deadline,time.monotonic()+3);before=self.status(deadline);self.drain();cursor=before['next_event_id']-1;xid=secrets.randbits(32);dst='01:0e:cf:00:00:00'if fid==0xfefe else self.c['dcp']['mac'];raw=dcp_frame(dst,self.peer,fid,sid,xid,body,1 if sid==5 else 0);self.send(raw);observed=[];self.failure_evidence={'request':summary(raw),'actual_incoming':observed};response=None;decoded=None
  for _ in range(256):
   item=self.receive(deadline)
   if item is None:break
   packet,meta=item
   if not packet:continue
   if packet[6:12]!=ptcp.mac_bytes(self.c['dcp']['mac'])or len(packet)<26 or int.from_bytes(packet[18:22],'big')!=xid:continue
   self.responses+=1;observed.append({'frame':summary(packet),'metadata':meta});decoded=parse_dcp(packet)
   if packet[:6]!=ptcp.mac_bytes(self.peer)or decoded['service']!=sid or decoded['service_type']!=1 or decoded['frame_id']!=(0xfeff if fid==0xfefe else 0xfefd)or decoded['delay']!=0:raise ValueError('DCP correlated response headers')
   if sid==4:
    value=decoded['blocks'].get((5,4));expected=bytes(expect_pair)+b'\0'
    if value!=expected:raise ValueError('native SET block ACK error')
   elif read_kind:self.check_read(decoded,read_kind,before)
   response=packet;break
  if response is None:raise TimeoutError('no real correlated native DCP response')
  # Both real request tap and native outgoing canonical PDU must be fresh in source ring.
  proof=[]
  while time.monotonic()<deadline:
   proof=self.events(cursor,deadline);incoming=any(e['node']=='dcp'and e['kind']=='native_tap_in'and e.get('frame',{}).get('sha256')==hashlib.sha256(raw).hexdigest()for e in proof);outgoing=any(e['node']=='dcp'and e['kind']=='native_tap_out'and e.get('metadata',{}).get('xid')==xid and e.get('metadata',{}).get('dcp_pdu_sha256')==decoded['pdu_sha256']for e in proof)
   if incoming and outgoing:break
   time.sleep(.02)
  else:raise ValueError('fresh native request/outgoing PDU proof absent')
  self.matched+=1
  return {'name':label,'passed':True,'request':{'frame':summary(raw),'xid':xid,'service':sid},'response':{'frames':observed,'blocks':[{'option':k[0],'suboption':k[1],'value_hex':v.hex()}for k,v in decoded['blocks'].items()],'native_tap_event_ids':[e['event_id']for e in proof if e['node']=='dcp'and e.get('metadata',{}).get('xid')==xid]}},decoded
 def check_read(self,p,kind,before):
  values=p['blocks'];native=before['components']['dcp'];cur=native['current']
  expected={(2,2):b'\0\0'+cur['station_name'].encode(),(1,2):(b'\0\0'if all(v=='0.0.0.0'for v in cur['ip_suite'].values())else b'\0\1')+b''.join(socket.inet_aton(cur['ip_suite'][k])for k in('ip','netmask','gateway')),(2,3):b'\0\0'+struct.pack('!HH',native['factory']['vendor_id'],native['factory']['device_id']),(2,4):b'\0\0'+bytes((native['factory']['device_role'],0)),(2,5):b'\0\0'+bytes.fromhex(native['factory']['device_options_hex'])}
  if kind.startswith('Identify'):
   expected[2,1]=b'\0\0'+native['factory']['product_name'].encode()
   if not set(expected)<=set(values):raise ValueError('native Identify missing required native property blocks')
   for pair,want in expected.items():
    if values[pair]!=want:raise ValueError('native Identify block/info/current mismatch '+str(pair))
   return
  pair={'GetStationName':(2,2),'GetIPv4':(1,2),'GetDeviceID':(2,3),'GetDeviceRole':(2,4),'GetDeviceOptions':(2,5)}[kind]
  if set(values)!={pair}or values[pair]!=expected[pair]:raise ValueError('DCP GET exact option/block-info/native value mismatch')
 def reads(self):
  for r in range(2):
   for kind in('IdentifyAll','IdentifyCurrentName','GetStationName','GetIPv4','GetDeviceID','GetDeviceRole','GetDeviceOptions'):
    try:
     self.failure_evidence=None
     if kind=='IdentifyAll':sid,body,fid=5,b'\xff\xff\0\0',0xfefe
     elif kind=='IdentifyCurrentName':sid,body,fid=5,block(2,2,self.status()['components']['dcp']['current']['station_name'].encode()),0xfefe
     else:sid,body,fid=3,{'GetStationName':b'\x02\x02','GetIPv4':b'\x01\x02','GetDeviceID':b'\x02\x03','GetDeviceRole':b'\x02\x04','GetDeviceOptions':b'\x02\x05'}[kind],0xfefd
     result,_=self.dcp_exchange(f'{kind}-{r+1}',sid,body,fid,read_kind=kind);self.checks.append(result)
    except Exception as e:self.unexpected=max(self.unexpected,self.responses-self.matched-self.other);self.checks.append({'name':f'{kind}-{r+1}','passed':False,'error':str(e)[:512],'response':self.failure_evidence})
 def ptcp_request(self,method,sequence):
  src=ptcp.mac_bytes(self.peer);domain=src+secrets.token_bytes(16);timestamp=b'\0\0'+int(time.time()).to_bytes(4,'big')+secrets.randbelow(999999999).to_bytes(4,'big');header=lambda fid,group:struct.pack('!6s6sHH12xH2xI',ptcp.mac_bytes(group),src,0x8892,fid,sequence,0)
  if method.endswith('_DELAY'):return [header(0xff40,ptcp.GROUPS[0])+ptcp.encode_tlv(6,src)+b'\0\0']
  fid,group={'PTCP_SYNC':(0x80,ptcp.GROUPS[4]),'PTCP_SYNC_FOLLOW_UP':(0x20,ptcp.GROUPS[2]),'PTCP_ANNOUNCE':(0xff00,ptcp.GROUPS[1])}[method]
  blocks=ptcp.encode_tlv(1,domain)+ptcp.encode_tlv(4,b'\0'*6)if fid==0xff00 else ptcp.encode_tlv(1,domain)+ptcp.encode_tlv(2,timestamp)
  first=header(fid,group)+blocks+b'\0\0'
  return [first,header(0xff20,ptcp.GROUPS[3])+blocks+b'\0\0']if fid==0x20 else[first]
 def ptcp_check(self,method,r):
  self.drain();before=self.status();cursor=before['next_event_id']-1;deadline=min(self.deadline,time.monotonic()+3);seq=secrets.randbits(16);requests=[p.ljust(60,b'\0')for p in self.ptcp_request(method,seq)];qhash=[hashlib.sha256(p).hexdigest()for p in requests];incoming=[];self.failure_evidence={'requests':[summary(p)for p in requests],'actual_incoming':[]}
  for request in requests:self.send(request)
  delay=method.endswith('_DELAY');selected='ptcp_n'if method=='PTCP_N_DELAY'else'ptcp_f';proof=[];evidence=[]
  # Delay collects both live nodes; sync/announce intentionally have no wire reply.
  quiet_end=min(deadline,time.monotonic()+.5)
  while time.monotonic()<deadline:
   item=self.receive(min(deadline,time.monotonic()+.05))
   if item:
    packet,meta=item
    if packet and packet[6:12]in(ptcp.mac_bytes(self.c['ptcp_n']['mac']),ptcp.mac_bytes(self.c['ptcp_f']['mac'])):
     self.responses+=1;incoming.append((packet,meta));self.failure_evidence['actual_incoming'].append({'frame':summary(packet),'metadata':meta})
   proof=self.events(cursor,deadline)
   acceptance={role:[e for e in proof if e['node']==role and e['kind']=='accepted'and e.get('query_sha256')in qhash]for role in('ptcp_n','ptcp_f')}
   tx={role:[e for e in proof if e['node']==role and e['kind']=='tx_submitted'and e.get('query_sha256')in qhash]for role in('ptcp_n','ptcp_f')}
   required_accept=2 if method=='PTCP_SYNC_FOLLOW_UP'else 1
   if all(len(acceptance[role])==required_accept for role in acceptance)and time.monotonic()>=quiet_end:
    if not delay or len(incoming)>=sum(len(tx[role])for role in tx):break
  for role in('ptcp_n','ptcp_f'):
   if len(acceptance[role])!=required_accept:raise ValueError('missing real '+role+' accepted processing event')
  if delay:
   expected=[]
   for role in('ptcp_n','ptcp_f'):
    records=tx[role];mode=self.c[role]['scenario']['mode'];count=(2 if mode=='old-seq-first'else 1)if role=='ptcp_n'else(1 if mode=='missing-follow-up'else 4 if mode=='old-seq-first'else 2)
    if len(records)!=count:raise ValueError('actual applied fault TX count '+role)
    observed=[p for p,m in incoming if p[6:12]==ptcp.mac_bytes(self.c[role]['mac'])]
    if not observed:raise ValueError('no real incoming '+role+' delay response')
    primary=next((p for p in observed if len(p)>=64 and int.from_bytes(p[14:16],'big')in(0xff41,0xff43)),None)
    if primary is None:raise ValueError('primary delay response absent')
    timestamp=int.from_bytes(primary[60:64],'big');result=ptcp.process_frame(requests[0],ptcp.mac_bytes(self.c[role]['mac']),ptcp.PeerState(),delay_mode='without-follow-up'if role=='ptcp_n'else'with-follow-up',scenario=mode,truncated_follow_up_size=self.c['ptcp_f']['truncated_follow_up_size'],timestamp_ns=timestamp)
    if collections.Counter(observed)!=collections.Counter(result.frames):raise ValueError('actual opaque '+role+' fault response mismatch')
    if collections.Counter(e['frame']['sha256']for e in records)!=collections.Counter(hashlib.sha256(p).hexdigest()for p in observed):raise ValueError('fresh request SHA to actual submitted/RX frame proof mismatch')
    for p,m in incoming:
     if p[6:12]==ptcp.mac_bytes(self.c[role]['mac']):evidence.append({'node':role,'selected':role==selected,'frame':summary(p),'metadata':m})
    if role==selected:self.matched+=len(observed)
    else:self.other+=len(observed)
   if len(incoming)!=len(evidence):self.unexpected+=len(incoming)-len(evidence);raise ValueError('unexpected additional PTCP incoming')
  elif incoming:self.unexpected+=len(incoming);raise ValueError('Sync/Announce must not have invented wire ACK')
  return {'name':f'{method}-{r+1}','passed':True,'request':{'frames':[summary(p)for p in requests],'sequence':seq},'response':{'frames':evidence,'accepted_event_ids':{role:[e['event_id']for e in acceptance[role]]for role in acceptance},'wire_ack':False if not delay else None}}
 def optional_write(self,method):
  self.restore=False;body_deadline=min(self.deadline-30,time.monotonic()+60);baseline=self.status(body_deadline);native=baseline['components']['dcp'];field='station_name'if method=='DCP_WRITE_STATION_TEMP'else'ip_suite';cur=copy.deepcopy(native['current']);nv=copy.deepcopy(native['nonvolatile']);target=cur[field];nvtarget=nv[field];empty=''if field=='station_name'else{'ip':'0.0.0.0','netmask':'0.0.0.0','gateway':'0.0.0.0'};result={'name':method,'passed':False,'restoration_complete':False,'request':{},'response':{},'limitations':['DCP has no CAS; observed foreign mutation prevents restoration, but check-to-SET race cannot be eliminated']};written=False;own=None
  def manageable(v):
   n=v['components']['dcp'];st=v.get('storage');ap=v.get('network_apply')
   if not n.get('snapshot_stable')or n.get('active_ar')!=0 or not st or st['validation']!='valid'or st.get('native_nonvolatile_matches_saved')is not True or not ap or not ap['confirmed']:raise ValueError('unavailable: native stable/current/NV/saved/OS/manageable AR-free baseline required')
  manageable(baseline)
  if nvtarget!=empty and nvtarget!=target:raise ValueError('unavailable: mixed target current/nonvolatile baseline cannot be restored')
  qualifier=0 if nvtarget==empty else 1
  new='plab-'+secrets.token_hex(6)if field=='station_name'else dict(cur['ip_suite'])
  if field=='ip_suite':
   if target['ip']=='0.0.0.0':raise ValueError('unavailable: unconfigured IP cannot safely choose alternate suite')
   network=ipaddress.IPv4Network((target['ip'],target['netmask']),strict=False);alternates=[]
   for a in network.hosts():
    if str(a)not in(target['ip'],target['gateway']):alternates.append(str(a))
    if len(alternates)>=2:break
   if not alternates:raise ValueError('unavailable: no alternate native-valid host')
   new['ip']=alternates[0];suite(new)
  pair=(2,2)if field=='station_name'else(1,2)
  def payload(value,q):return block(*pair,q.to_bytes(2,'big')+(value.encode()if field=='station_name'else b''.join(socket.inet_aton(value[k])for k in('ip','netmask','gateway'))))
  try:
   verify=self.status(body_deadline);manageable(verify)
   if verify['components']['dcp']['current']!=cur or verify['components']['dcp']['nonvolatile']!=nv:raise ValueError('foreign mutation before write')
   # Mark possibly sent before exchange, so ACK-loss still triggers qualified recovery checks.
   written=True;own=copy.deepcopy(cur);own[field]=new;expectnv=copy.deepcopy(nv);expectnv[field]=empty
   ack,_=self.dcp_exchange('temporary SET',4,payload(new,0),expect_pair=pair,deadline=body_deadline);result['request']=ack['request'];result['response']['set_ack']=ack['response']
   while time.monotonic()<body_deadline:
    observed=self.status(body_deadline);n=observed['components']['dcp']
    if n['current']==own and n['nonvolatile']==expectnv and observed.get('storage',{}).get('native_nonvolatile_matches_saved')is True and observed.get('network_apply',{}).get('confirmed'):break
    time.sleep(.05)
   else:raise TimeoutError('temporary native current/NV/OS/save confirmation')
   kind='GetStationName'if field=='station_name'else'GetIPv4';read,_=self.dcp_exchange('wire verify temporary',3,bytes(pair),read_kind=kind,deadline=body_deadline);result['response']['wire_verification']=read['response'];result['passed']=True
  except Exception as e:result['error']=str(e)[:512]
  finally:
   if written:
    try:
     observed=self.status(self.deadline);n=observed['components']['dcp']
     if n['active_ar']!=0 or n['current']!=own or n['nonvolatile']!=expectnv:raise ValueError('foreign or unconfirmed mutation; refusing to overwrite during restore')
     restored,_=self.dcp_exchange('restore qualified SET',4,payload(target,qualifier),expect_pair=pair,deadline=self.deadline);result['response']['restore_ack']=restored['response']
     while time.monotonic()<self.deadline:
      after=self.status(self.deadline);n=after['components']['dcp']
      if n['current']==cur and n['nonvolatile']==nv and after.get('storage',{}).get('native_nonvolatile_matches_saved')is True and after.get('network_apply',{}).get('confirmed')and after['interfaces']==baseline['interfaces']:self.restore=True;break
      time.sleep(.05)
     if not self.restore:raise TimeoutError('native current/NV/OS restoration incomplete')
     kind='GetStationName'if field=='station_name'else'GetIPv4';self.dcp_exchange('wire verify restored',3,bytes(pair),read_kind=kind,deadline=self.deadline)
    except Exception as e:result['passed']=False;result['restore_error']=str(e)[:512]
   result['restoration_complete']=self.restore
  return result
 def signal_check(self,r):
  self.failure_evidence=None
  before=self.status();sig=before['signal'];history=sig.get('history',[])
  if before['components']['dcp'].get('signal_active')is True or sig.get('state')is True or len(history)>1 and before['uptime_ms']-history[-1]['uptime_ms']<3500 and self.known_signal_end!=sig['transitions']:raise ValueError('unavailable: preexisting/recent native signal activity')
  count=sig['transitions'];cursor=before['next_event_id']-1;deadline=min(self.deadline,time.monotonic()+5);result,_=self.dcp_exchange('DCP_SIGNAL-'+str(r+1),4,block(5,3,b'\0\0\x01\0'),expect_pair=(5,3),deadline=deadline)
  while time.monotonic()<deadline:
   after=self.status(deadline);new=[h for h in after['signal']['history']if h['sequence']>count]
   for e in self.events(cursor,deadline):
    if e['node']=='dcp'and e['kind']=='native_tap_in'and e.get('metadata',{}).get('service')==4 and e['metadata'].get('xid')!=result['request']['xid']:raise ValueError('concurrent native SET/Signal activity makes software LED causality ambiguous')
   if len(new)>=6:
    if len(new)!=6 or[h['state']for h in new]!=[True,False,True,False,True,False]or not 2400<=new[-1]['uptime_ms']-new[0]['uptime_ms']<=3600 or any(not 300<=b['uptime_ms']-a['uptime_ms']<=800 for a,b in zip(new,new[1:])):raise ValueError('native 3x1Hz software signal transition proof')
    result['response']['software_signal_transitions']=new;self.known_signal_end=new[-1]['sequence'];return result
   time.sleep(.05)
  raise TimeoutError('native software signal transitions incomplete')
 def run(self):
  try:
   self.open();method=self.a.method
   if method in('DCP_READ','ALL'):self.reads()
   for selected in('PTCP_N_DELAY','PTCP_F_DELAY','PTCP_SYNC','PTCP_SYNC_FOLLOW_UP','PTCP_ANNOUNCE'):
    if method in(selected,'ALL'):
     for r in range(2):
      try:self.checks.append(self.ptcp_check(selected,r))
      except Exception as e:self.unexpected=max(self.unexpected,self.responses-self.matched-self.other);self.checks.append({'name':f'{selected}-{r+1}','passed':False,'error':str(e)[:512],'response':self.failure_evidence})
   if method.startswith('DCP_WRITE_'):self.checks.append(self.optional_write(method))
   if method=='DCP_SIGNAL':
    for r in range(2):
     if r:time.sleep(.7)
     try:self.checks.append(self.signal_check(r))
     except Exception as e:self.unexpected=max(self.unexpected,self.responses-self.matched-self.other);self.checks.append({'name':f'DCP_SIGNAL-{r+1}','passed':False,'error':str(e)[:512],'response':self.failure_evidence})
   self.status();passed=bool(self.checks)and all(c['passed']for c in self.checks)
   report={'schema_version':1,'protocol':'profinet','wire_profile':PROFILE,'passed':passed,'method':method,'selected_target':'all'if method=='ALL'else'ptcp_n'if method=='PTCP_N_DELAY'else'ptcp_f'if method=='PTCP_F_DELAY'else'dcp'if method.startswith('DCP_')else'both_ptcp','path':'suite','applied_config':self.c,'source':{'boot_id':self.a.expected_boot_id,'runtime_id':self.a.expected_runtime_id},'checks':self.checks,'summary':{'total':len(self.checks),'passed':sum(c['passed']for c in self.checks),'failed':sum(not c['passed']for c in self.checks),'planned_requests':26 if method=='ALL'else 14 if method=='DCP_READ'else 4 if method=='PTCP_SYNC_FOLLOW_UP'else None if method.startswith('DCP_WRITE_')else 2,'actual_requests':self.requests,'actual_responses':self.responses,'matched_responses':self.matched,'other_node_responses':self.other,'unexpected_responses':self.unexpected},'seconds':round(time.monotonic()-self.born,6)}
   if self.restore is not None:report['restoration_complete']=self.restore
   return report
  finally:
   if self.s:self.s.close()
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--config-json',required=True);p.add_argument('--interface',default='auto');p.add_argument('--peer-mac');p.add_argument('--observer-host',required=True);p.add_argument('--observer-port',type=int,default=18092);p.add_argument('--expected-boot-id',required=True);p.add_argument('--expected-runtime-id',required=True);p.add_argument('--method',choices=METHODS,default='ALL');p.add_argument('--path',choices=['suite'],default='suite');a=p.parse_args();client=None
 def timeout(*_):raise TimeoutError('absolute 90-second client deadline')
 signal.signal(signal.SIGALRM,timeout);signal.alarm(90)
 try:client=Client(a);report=client.run()
 except Exception as e:
  checks=client.checks if client else[];report={'schema_version':1,'protocol':'profinet','wire_profile':PROFILE,'method':a.method,'path':a.path,'applied_config':client.c if client else None,'source':{'boot_id':a.expected_boot_id,'runtime_id':a.expected_runtime_id},'passed':False,'checks':checks,'failure_evidence':client.failure_evidence if client else None,'summary':{'total':len(checks),'passed':sum(c['passed']for c in checks),'failed':sum(not c['passed']for c in checks),'actual_requests':client.requests if client else 0,'actual_responses':client.responses if client else 0,'matched_responses':client.matched if client else 0,'other_node_responses':client.other if client else 0,'unexpected_responses':client.unexpected if client else 0},'error':str(e)[:512]}
  if client and client.restore is not None:report['restoration_complete']=client.restore
 signal.alarm(0);text=canonical(report)
 if len(text.encode())>524288:
  report.update(passed=False,error='bounded report exceeded; detailed evidence truncated',report_truncated=True,checks=[{k:v for k,v in c.items()if k in('name','passed','error')}for c in report['checks']],failure_evidence=None);text=canonical(report)
 print(text);return 0 if report['passed']else 1
if __name__=='__main__':raise SystemExit(main())
