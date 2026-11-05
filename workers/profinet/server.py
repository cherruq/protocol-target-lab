#!/usr/local/bin/python3
"""Persistent three-node PROFINET software workspace; native p-net owns all DCP responses."""
import argparse,collections,fcntl,hashlib,json,os,pathlib,queue,re,select,signal,socket,stat,struct,subprocess,threading,time,urllib.parse,uuid
from config import ABI,CONTEXT,STORE,canonical,digest,validate
import net,ptcp
NATIVE='/opt/protocol-target-lab/native/pn_native'
RUN=pathlib.Path('/run/protocol-target-lab')
def atomic(path,value):
 path=pathlib.Path(path);tmp=path.with_suffix('.tmp');fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'w')as f:f.write(canonical(value));f.flush();os.fsync(f.fileno())
 os.replace(tmp,path)
def readjson(path,limit=32768):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 with os.fdopen(fd,'rb')as f:
  if not stat.S_ISREG(os.fstat(f.fileno()).st_mode):raise ValueError('regular JSON file required')
  b=f.read(limit+1)
 if len(b)>limit:raise ValueError('bounded JSON file exceeded')
 return json.loads(b)
def summary(raw):return {'length':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'preview_hex':raw[:128].hex(),'truncated':len(raw)>128}
def metadata(raw,addr):
 v={'interface':addr[0],'ifindex':socket.if_nametoindex(addr[0]),'packet_type':addr[2],'source_mac':':'.join(f'{b:02x}'for b in raw[6:12]),'destination_mac':':'.join(f'{b:02x}'for b in raw[:6]),'frame_id':int.from_bytes(raw[14:16],'big')if len(raw)>=16 else None,'sequence':None,'xid':None}
 if len(raw)>=30 and v['frame_id']in ptcp.FRAME_IDS:v['sequence']=int.from_bytes(raw[28:30],'big')
 if len(raw)>=26 and v['frame_id']in (0xfefd,0xfefe,0xfeff):v['xid']=int.from_bytes(raw[18:22],'big');v['service']=raw[16];v['service_type']=raw[17];end=26+int.from_bytes(raw[24:26],'big');v['dcp_pdu_sha256']=hashlib.sha256(raw[14:end]).hexdigest()if end<=len(raw)else None;v['dcp_pdu_length']=end-14
 return v

def packet_socket(name,groups):
 s=socket.socket(socket.AF_PACKET,socket.SOCK_RAW,socket.htons(0x8892));s.bind((name,0));s.setblocking(False)
 for g in groups:s.setsockopt(263,1,struct.pack('IHH8s',socket.if_nametoindex(name),0,6,ptcp.mac_bytes(g)))
 return s

class Worker:
 def __init__(self,c):
  self.c=c;self.runtime=os.environ['PLAB_RUNTIME_ID'];self.boot=str(uuid.uuid4());self.born=time.monotonic();self.heartbeat=self.born;self.lock=threading.RLock();self.stopping=threading.Event();self.fatal=None;self.ready=False;self.events=collections.deque(maxlen=256);self.next_id=1;self.evictions=0;self.logs=queue.Queue(256);self.slots=threading.BoundedSemaphore(8);self.sockets={};self.nodes={};self.child=None;self.observer=None;self.store_fd=None;self.native=None;self.native_at=0;self.apply=None;self.storage=None;self.signal={'software_only':True,'state':None,'transitions':0,'last_transition_ms':None,'history':[]};self.capture={'packet_socket_inode':None,'received':0,'outgoing':0,'errors':0,'native_packet_pid_attribution':False};self.ifaces={};self.logger=threading.Thread(target=self.log_loop,daemon=True);self.logger.start()
 def uptime(self):return int((time.monotonic()-self.born)*1000)
 def log(self,v):
  try:self.logs.put_nowait(v)
  except queue.Full:pass
 def log_loop(self):
  try:
   while not self.stopping.is_set()or not self.logs.empty():
    try:v=self.logs.get(timeout=.1)
    except queue.Empty:continue
    print(canonical(v),flush=True)
  except BaseException as e:self.fatal='stdout logger failed: '+type(e).__name__
 def event(self,node,kind,raw=None,query=None,status=None,meta=None,**extra):
  with self.lock:
   v={'event_id':self.next_id,'boot_id':self.boot,'runtime_id':self.runtime,'uptime_ms':self.uptime(),'node':node,'kind':kind,'query_sha256':query,'status':status,'frame':summary(raw)if raw is not None else None,'metadata':meta,**extra};self.next_id+=1
   if len(self.events)==256:self.evictions+=1
   self.events.append(v);self.log({'event':'profinet',**v});return v
 def prepare_store(self):
  p=pathlib.Path(STORE);st=p.lstat()
  if not stat.S_ISDIR(st.st_mode)or st.st_uid!=0:raise ValueError('native store must be owned root directory')
  os.chmod(p,0o700);self.store_fd=os.open(p/'.writer.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600);st=os.fstat(self.store_fd)
  if not stat.S_ISREG(st.st_mode)or st.st_uid or st.st_nlink!=1:raise ValueError('unsafe native writer lock')
  fcntl.flock(self.store_fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  marker={'schema_version':1,'deployment_id':os.environ['PLAB_DEPLOYMENT_ID'],'instance_id':os.environ['PLAB_INSTANCE_ID'],'owner_nonce':os.environ['PLAB_STORE_NONCE'],'abi':ABI};m=p/'.plab-store.json'
  if m.exists():
   st=m.lstat()
   if not stat.S_ISREG(st.st_mode)or st.st_uid or stat.S_IMODE(st.st_mode)!=0o600 or readjson(m)!=marker:raise ValueError('native store owner/ABI marker mismatch')
  else:
   if set(x.name for x in p.iterdir())!={'.writer.lock'}:raise ValueError('unmarked nonempty native store; preserved')
   atomic(m,marker)
  initialized=p/'.initialized.json'
  if initialized.exists()or initialized.is_symlink():
   st=initialized.lstat();v=readjson(initialized)
   if not stat.S_ISREG(st.st_mode)or st.st_uid or stat.S_IMODE(st.st_mode)!=0o600 or type(v.get('schema_version'))is not int or v.get('schema_version')!=1 or v.get('abi')!=ABI or set(v.get('files',[]))!={'pnet_data_ip.bin','pnet_data_im.bin','pnet_data_pdport_1.bin'}:raise ValueError('unsafe native initialized receipt')
  subprocess.run([NATIVE,'--validate-store',STORE],check=True,timeout=2,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  self.marker=marker
 def prepare_network(self):
  rows=net.interfaces();data=[x for x in rows if x['mac']==self.c['dcp']['mac']]
  if len(data)!=1 or data[0]['hardware_type']!=1:raise ValueError('unique actual DCP data MAC interface required')
  d=data[0];mgmt=[x for x in rows if x['hardware_type']==1 and x['ifindex']!=d['ifindex']and x['ipv4']]
  if len(mgmt)!=1 or len(mgmt[0]['ipv4'])!=1:raise ValueError('exactly one distinct management IPv4 interface required')
  net.assert_no_management_overlap(self.c['dcp']['initial_ip_suite'],mgmt[0])
  if d['name']!='pn0':
   if any(x['name']=='pn0'for x in rows):raise ValueError('unexpected existing pn0')
   net.rename(d['ifindex'],'pn0')
  for a in d['ipv4']:net.address_change(d['ifindex'],a['address'],a['prefixlen'],False)
  for role,name in [('ptcp_n','pnptcpn'),('ptcp_f','pnptcpf')]:
   if any(x['name']==name or x['mac']==self.c[role]['mac']for x in rows):raise ValueError('PTCP interface/MAC collision')
   net.macvlan(d['ifindex'],name,self.c[role]['mac'])
  current={x['name']:x for x in net.interfaces()};self.ifaces={'management':next(x for x in current.values()if x['ifindex']==mgmt[0]['ifindex']),'data':current['pn0'],'ptcp_n':current['pnptcpn'],'ptcp_f':current['pnptcpf']}
  self.management_initial=dict(self.ifaces['management']);context={'schema_version':1,'boot_id':self.boot,'runtime_id':self.runtime,'deployment_id':os.environ['PLAB_DEPLOYMENT_ID'],'instance_id':os.environ['PLAB_INSTANCE_ID'],'namespace':os.readlink('/proc/self/ns/net'),'data':self.ifaces['data'],'management':self.ifaces['management']};atomic(CONTEXT,context)
  for role in ('ptcp_n','ptcp_f'):
   s=packet_socket(self.ifaces[role]['name'],ptcp.GROUPS);self.sockets[role]=s;inode=int(os.readlink('/proc/self/fd/'+str(s.fileno()))[8:-1]);self.nodes[role]={'ready':True,'mode':'without-follow-up'if role=='ptcp_n'else'with-follow-up','scenario':self.c[role]['scenario']['mode'],'packet_socket_inode':inode,'packet_filter':{'ethertype':34962,'protocol':'ETH_P_PROFINET'},'counters':dict.fromkeys(('received','accepted','rejected','ignored','tx_submitted','tx_errors','pending_expired'),0),'pending':0,'last_request':None,'last_output':None};self.nodes[role]['_state']=ptcp.PeerState();self.nodes[role]['_pending_at']={}
  # ALL socket is required to passively observe actual native outgoing frames.
  tap=socket.socket(socket.AF_PACKET,socket.SOCK_RAW,socket.htons(3));tap.bind(('pn0',0));tap.setblocking(False);self.sockets['dcp']=tap;self.capture['packet_socket_inode']=int(os.readlink('/proc/self/fd/'+str(tap.fileno()))[8:-1])
 def read_native(self):
  try:
   n=readjson(RUN/'native.json');age=int(time.monotonic()*1000)-n['monotonic_ms']
   if n['pid']!=self.child.pid or not 0<=age<2000:raise ValueError('native current snapshot identity/heartbeat')
   n.update(start_ticks=int(pathlib.Path(f'/proc/{n["pid"]}/stat').read_text().split(') ',1)[1].split()[19]),native_binary_sha256=hashlib.sha256(pathlib.Path(NATIVE).read_bytes()).hexdigest(),version='0.2.0',commit='3e650720850e1f31f8a419c8aa135a2e81b44ddb',tick_age_ms=age);self.native=n
  except FileNotFoundError:
   if time.monotonic()-self.native_at>5:raise
  p=RUN/'network-apply.json'
  self.apply=readjson(p)if p.exists()else None
 def observe_apply(self):
  # Last native callback is historical. Only actual OS readback confirms current native data addressing.
  import ipaddress
  requested=self.native['current']['ip_suite'];data=self.ifaces['data'];routes=[r for r in net.routes()if r['ifindex']==data['ifindex']];defaults=[r for r in routes if r['prefixlen']==0]
  expected=[]if requested['ip']=='0.0.0.0'else[{'address':requested['ip'],'prefixlen':ipaddress.IPv4Network((requested['ip'],requested['netmask']),strict=False).prefixlen}]
  matches=data['ipv4']==expected and (not defaults if requested['gateway']=='0.0.0.0'else len(defaults)==1 and defaults[0]['gateway']==requested['gateway'])
  value=dict(self.apply)if self.apply else {'phase':'observed_no_callback','sequence':None,'requested':None,'confirmed':True,'error':None}
  value.update(actual_ipv4=data['ipv4'],actual_routes=routes,native_current=self.native['current'],native_current_matches_os=matches,native_callback_observed=self.apply is not None,management_unchanged=self.ifaces['management']==self.management_initial)
  value['confirmed']=bool(value.get('confirmed')and matches and value['management_unchanged'])
  if not matches and value.get('phase')!='error':value.update(phase='unconfirmed',error='native current IP suite differs from actual data OS; native may defer network callback')
  self.apply=value
 def inspect_storage(self):
  result=subprocess.run([NATIVE,'--validate-store',STORE],capture_output=True,text=True,timeout=2);files=[]
  for p in sorted(pathlib.Path(STORE).glob('pnet_*')):
   st=p.lstat()
   if stat.S_ISREG(st.st_mode)and st.st_size<=65536:files.append({'name':p.name,'bytes':st.st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
  valid=result.returncode==0 and len(files)==3
  if valid and not(pathlib.Path(STORE)/'.initialized.json').exists():atomic(pathlib.Path(STORE)/'.initialized.json',{'schema_version':1,'abi':ABI,'files':[x['name']for x in files]})
  # Saved semantic view is decoded by the same compiled C ABI, separately from current memory.
  saved=None
  if valid:
   r=subprocess.run([NATIVE,'--saved-view',STORE],capture_output=True,text=True,timeout=2)
   if r.returncode==0:saved=json.loads(r.stdout)
  self.storage={'path':STORE,'abi':ABI,'owner_nonce':self.marker['owner_nonce'],'writer_locked':True,'initialized':(pathlib.Path(STORE)/'.initialized.json').exists(),'validation':'valid'if valid else'pending','durability':'native-save-observed-not-fsync-certified','files':files,'native_nonvolatile_matches_saved':saved==self.native.get('nonvolatile')if saved is not None and self.native else None,'saved_nonvolatile':saved,'error':None if valid else'native asynchronous save pending or invalid; bytes preserved'}
 def child_output(self):
  try:
   while not self.stopping.is_set():
    line=self.child.stdout.readline(4097)
    if not line:return
    if len(line)>4096:raise ValueError('native stdout line budget')
    text=line.decode('utf8','replace').rstrip()
    if text.startswith('PLAB_NATIVE '):
     v=json.loads(text[12:])
     with self.lock:
      self.signal.update(state=v['state'],transitions=v['sequence'],last_transition_ms=v['monotonic_ms']-int(self.born*1000));self.signal['history']=(self.signal['history']+[{'state':v['state'],'uptime_ms':self.signal['last_transition_ms'],'sequence':v['sequence']}])[-32:];self.event('dcp','signal_transition',status='software LED callback',signal=dict(v))
    elif text:self.log({'event':'native_log','message':text[:512]})
  except BaseException as e:self.fatal='native output reader failed: '+str(e)[:128]
 def process(self,node,raw,addr):
  if node=='dcp':
   if len(raw)<16 or raw[12:14]!=b'\x88\x92' or int.from_bytes(raw[14:16],'big')not in(0xfefd,0xfefe,0xfeff):return
   meta=metadata(raw,addr);out=addr[2]==4;self.capture['outgoing'if out else'received']+=1;self.event('dcp','native_tap_out'if out else'native_tap_in',raw,status='passive capture; no packet PID attribution',meta=meta);return
  if addr[2]==4:return
  n=self.nodes[node];cnt=n['counters'];cnt['received']+=1;sha=summary(raw)['sha256'];meta=metadata(raw,addr);state=n['_state'];at=n['_pending_at'];now=time.monotonic()
  for key in list(at):
   if now-at[key]>=5:at.pop(key);state.pending_sync.pop(key,None);cnt['pending_expired']+=1
  try:
   result=ptcp.process_frame(raw,ptcp.mac_bytes(self.c[node]['mac']),state,delay_mode=n['mode'],scenario=n['scenario'],truncated_follow_up_size=self.c['ptcp_f']['truncated_follow_up_size'],timestamp_ns=time.monotonic_ns())
   if result.status.startswith('ignored'):cnt['ignored']+=1;return
   cnt['accepted']+=1;n['last_request']=self.event(node,'accepted',raw,sha,result.status,meta)
   if result.status=='sync-awaiting-follow-up':at[raw[6:12]]=now
   elif result.status=='sync-follow-up-complete':at.pop(raw[6:12],None)
   n['pending']=len(state.pending_sync)
   for output in result.frames:
    try:
     sent=self.sockets[node].send(output)
     if sent!=len(output):raise OSError('short AF_PACKET send')
     cnt['tx_submitted']+=1;n['last_output']=self.event(node,'tx_submitted',output,sha,result.status,{'interface':self.ifaces[node]['name'],'ifindex':self.ifaces[node]['ifindex'],'packet_type':4,'submitted':True})
    except OSError as e:cnt['tx_errors']+=1;n['last_output']=self.event(node,'tx_error',output,sha,str(e)[:128],None)
  except ValueError as e:cnt['rejected']+=1;n['last_request']=self.event(node,'rejected',raw,sha,str(e)[:256],meta)
 def status(self):
  with self.lock:
   native=dict(self.native)if self.native else {'ready':False};native['tick_age_ms']=int(time.monotonic()*1000)-native['monotonic_ms']if 'monotonic_ms'in native else None
   return {'schema_version':1,'protocol':'profinet','boot_id':self.boot,'runtime_id':self.runtime,'config_sha256':digest(self.c),'worker_ready_after_bind':self.ready,'event_loop_age_ms':int((time.monotonic()-self.heartbeat)*1000),'uptime_ms':self.uptime(),'interfaces':self.ifaces,'components':{'dcp':native,**{name:{k:v for k,v in n.items()if not k.startswith('_')}for name,n in self.nodes.items()}},'network_apply':self.apply,'storage':self.storage,'signal':self.signal,'capture':self.capture,'next_event_id':self.next_id,'cache_evictions':self.evictions}
 def query_events(self,after,limit,node=None,query=None):
  with self.lock:
   matches=[e for e in self.events if e['event_id']>after and(node is None or e['node']==node)and(query is None or e['query_sha256']==query)];v={'schema_version':1,'protocol':'profinet','boot_id':self.boot,'runtime_id':self.runtime,'events':[],'matched':len(matches),'returned':0,'truncated':False,'next_event_id':self.next_id,'cache_evictions':self.evictions}
   for e in matches[:limit]:
    v['events'].append(e)
    if len(canonical(v).encode())>64000:v['events'].pop();break
   v.update(returned=len(v['events']),truncated=len(matches)>len(v['events']));return v
 def connection(self,conn):
  deadline=time.monotonic()+1
  try:
   data=b''
   while b'\r\n\r\n'not in data:
    left=deadline-time.monotonic()
    if left<=0:raise TimeoutError()
    conn.settimeout(left);chunk=conn.recv(min(1024,8193-len(data)))
    if not chunk:return
    data+=chunk
    if len(data)>8192:raise ValueError('request budget')
   lines=data.split(b'\r\n\r\n',1)[0].decode('ascii').split('\r\n');method,target,version=lines[0].split(' ')
   if version not in('HTTP/1.0','HTTP/1.1'):raise ValueError('version')
   for line in lines[1:]:
    key,sep,value=line.partition(':')
    if not sep or key.lower()=='transfer-encoding'or key.lower()=='content-length'and value.strip()!='0':raise ValueError('body rejected')
   code=200;u=urllib.parse.urlsplit(target)
   if method!='GET':code=405;v={'error':'read-only GET'}
   elif u.scheme or u.netloc or u.fragment:raise ValueError('relative target required')
   elif u.path=='/v1/status'and not u.query:v=self.status()
   elif u.path=='/v1/events':
    q=urllib.parse.parse_qs(u.query,strict_parsing=True)
    if not {'after','limit'}<=set(q)or set(q)-{'after','limit','node','query_sha256'}or any(len(x)!=1 for x in q.values()):raise ValueError('query keys')
    if any(not re.fullmatch(r'[0-9]{1,20}',q[k][0])for k in('after','limit')):raise ValueError('query number')
    after,limit=int(q['after'][0]),int(q['limit'][0]);node=q.get('node',[None])[0];query=q.get('query_sha256',[None])[0]
    if not 0<=after<2**63 or not 1<=limit<=16 or node not in(None,'dcp','ptcp_n','ptcp_f')or query is not None and not re.fullmatch('[0-9a-f]{64}',query):raise ValueError('query range')
    v=self.query_events(after,limit,node,query)
   else:code=404;v={'error':'unknown read-only endpoint'}
   body=canonical(v).encode()
   if len(body)>65536:raise ValueError('response budget')
   conn.settimeout(max(.001,deadline-time.monotonic()));conn.sendall(f'HTTP/1.1 {code} Response\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\nConnection: close\r\nAllow: GET\r\n\r\n'.encode()+body)
  except(OSError,ValueError,UnicodeError):pass
  finally:conn.close();self.slots.release()
 def serve(self):
  try:
   while not self.stopping.is_set():
    try:c,_=self.observer.accept()
    except socket.timeout:continue
    except OSError:
     if self.stopping.is_set():return
     raise
    if not self.slots.acquire(False):c.close();continue
    try:threading.Thread(target=self.connection,args=(c,),daemon=True).start()
    except BaseException:c.close();self.slots.release();raise
  except BaseException as e:self.fatal='observer listener failed: '+type(e).__name__
 def run(self):
  try:
   RUN.mkdir(mode=0o700,parents=True,exist_ok=True);os.chmod(RUN,0o700);self.prepare_store();self.prepare_network();ip=self.c['dcp']['initial_ip_suite'];self.native_at=time.monotonic();self.child=subprocess.Popen([NATIVE,'pn0',self.c['dcp']['initial_station_name'],ip['ip'],ip['netmask'],ip['gateway'],STORE,str(RUN/'native.json'),str(RUN/'native-start-gate.json')],cwd='/opt/protocol-target-lab/native',stdout=subprocess.PIPE,stderr=subprocess.STDOUT);context=readjson(CONTEXT);context['native']={'pid':self.child.pid,'start_ticks':int(pathlib.Path(f'/proc/{self.child.pid}/stat').read_text().split(') ',1)[1].split()[19]),'binary_sha256':hashlib.sha256(pathlib.Path(NATIVE).read_bytes()).hexdigest()};atomic(CONTEXT,context);atomic(RUN/'native-start-gate.json',{'pid':self.child.pid});threading.Thread(target=self.child_output,daemon=True).start();self.observer=socket.socket();self.observer.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);self.observer.bind((self.ifaces['management']['ipv4'][0]['address'],18092));self.observer.listen(16);self.observer.settimeout(.2);threading.Thread(target=self.serve,daemon=True).start();last=0;storage_at=0
   while not self.stopping.is_set():
    if self.fatal:raise RuntimeError(self.fatal)
    if self.child.poll()is not None:raise RuntimeError('critical native child exited '+str(self.child.returncode))
    self.heartbeat=time.monotonic();now=self.heartbeat
    if now-last>=.1:
     self.read_native();last=now
     if self.native:
      rows=net.interfaces();self.ifaces={k:next(x for x in rows if x['ifindex']==v['ifindex'])for k,v in self.ifaces.items()};self.observe_apply()
      self.ready=bool(self.native.get('ready')and self.native.get('snapshot_stable')and all(n['ready']for n in self.nodes.values()))
    if now-storage_at>=.5 and self.native:self.inspect_storage();storage_at=now
    for n in self.nodes.values():
     for key in list(n['_pending_at']):
      if now-n['_pending_at'][key]>=5:n['_pending_at'].pop(key);n['_state'].pending_sync.pop(key,None);n['counters']['pending_expired']+=1
     n['pending']=len(n['_state'].pending_sync)
    readable,_,_=select.select(list(self.sockets.values()),[],[],.02)
    for s in readable:
     node=next(k for k,v in self.sockets.items()if v is s)
     for _ in range(32):
      try:raw,addr=s.recvfrom(65536)
      except BlockingIOError:break
      with self.lock:self.process(node,raw,addr)
   return 0
  except BaseException as e:self.fatal=type(e).__name__+': '+str(e)[:256];self.log({'event':'fatal','error':self.fatal});return 1
  finally:
   self.ready=False;self.stopping.set()
   if self.observer:self.observer.close()
   if self.child and self.child.poll()is None:
    self.child.terminate()
    try:self.child.wait(timeout=3)
    except subprocess.TimeoutExpired:self.child.kill();self.child.wait(timeout=1)
   for s in self.sockets.values():s.close()
   if self.store_fd is not None:os.close(self.store_fd)
   self.logger.join(.5)
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--config-json',required=True);a=p.parse_args()
 try:
  c=validate(json.loads(a.config_json))
  for key in('PLAB_RUNTIME_ID','PLAB_STORE_NONCE'):
   if not re.fullmatch('[0-9a-f]{32}',os.environ.get(key,'')):raise ValueError(key+'32lowerhex required')
  if str(uuid.UUID(os.environ['PLAB_DEPLOYMENT_ID']))!=os.environ['PLAB_DEPLOYMENT_ID']:raise ValueError('canonical deployment UUID required')
  if not re.fullmatch('[A-Za-z0-9_-]{1,64}',os.environ.get('PLAB_INSTANCE_ID','')):raise ValueError('instance ID required')
 except Exception as e:print(canonical({'event':'config_error','error':str(e)[:256]}));return 2
 w=Worker(c);signal.signal(signal.SIGTERM,lambda *_:w.stopping.set());signal.signal(signal.SIGINT,lambda *_:w.stopping.set());return w.run()
if __name__=='__main__':raise SystemExit(main())
