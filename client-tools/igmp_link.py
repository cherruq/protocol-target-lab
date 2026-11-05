#!/usr/bin/env python3
"""MIT. Typed, journaled, project-owned IGMP VXLAN link helper. No protocol sender."""
import argparse
import contextlib
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import socket
import struct
import stat
import subprocess
import sys
import time
import uuid

DEFAULT_ROOT=Path('/var/lib/protocol-target-lab/igmp-links')
LIMIT=1048576
class HelperError(Exception):pass
class UsageError(HelperError):pass
class Parser(argparse.ArgumentParser):
    def error(self,message):raise UsageError(message)
def exact(v,keys):
    if type(v) is not dict or set(v)!=set(keys):raise UsageError('exact fields required: '+','.join(keys))
def integer(v,lo,hi):
    if type(v) is not int or not lo<=v<=hi:raise UsageError(f'integer {lo}..{hi} required')
def ipv4(s):
    if type(s) is not str:raise UsageError('IPv4 literal required')
    ip=ipaddress.IPv4Address(s)
    if str(ip)!=s or ip.packed[0]==0 or ip.packed[0]>=224:raise UsageError('canonical nonzero unicast IPv4 required')
    return ip
def interface(s):
    if type(s) is not str or not re.fullmatch('[A-Za-z0-9_][A-Za-z0-9_.-]{0,14}',s):raise UsageError('kernel interface name required')
    return s
def validate_spec(value):
    exact(value,('schema_version','deployment_id','instance_id','role','link'))
    if type(value['schema_version']) is not int or value['schema_version']!=1:raise UsageError('schema_version1 required')
    if type(value['deployment_id']) is not str or str(uuid.UUID(value['deployment_id']))!=value['deployment_id']:raise UsageError('canonical deployment UUID required')
    if type(value['instance_id']) is not str or not re.fullmatch('[a-z0-9][a-z0-9-]{0,47}',value['instance_id']):raise UsageError('valid instance ID required')
    if value['role'] not in ('target','peer'):raise UsageError('target or peer role required')
    l=value['link'];exact(l,('outer_interface','local_outer_ip','peer_outer_ip','vni','udp_port','mtu','inner_cidr','inner_mac'));interface(l['outer_interface']);a=ipv4(l['local_outer_ip']);b=ipv4(l['peer_outer_ip'])
    if a==b:raise UsageError('outer peers must differ')
    integer(l['vni'],1,16777215);integer(l['udp_port'],1024,65535);integer(l['mtu'],576,9000)
    if type(l['inner_cidr']) is not str:raise UsageError('inner CIDR required')
    i=ipaddress.IPv4Interface(l['inner_cidr']);ipv4(str(i.ip))
    if not 16<=i.network.prefixlen<=30 or i.ip in (i.network.network_address,i.network.broadcast_address,a,b):raise UsageError('usable inner host/prefix16..30 distinct from outer required')
    if str(i)!=l['inner_cidr']:raise UsageError('canonical inner CIDR required')
    m=l['inner_mac']
    if type(m) is not str or not re.fullmatch('(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}',m):raise UsageError('six MAC octets required')
    raw=bytes.fromhex(m.replace(':',''))
    if raw==bytes(6) or raw[0]&1:raise UsageError('nonzero unicast inner MAC required')
    result=json.loads(json.dumps(value));result['link']['inner_mac']=m.lower();return result

def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def digest(v):return hashlib.sha256(canonical(v)).hexdigest()
def atomic_group(owner):return (int.from_bytes(hashlib.sha256(owner.encode('utf8')).digest()[:4],'big')&0x7fffffff) or 1
def namespace():
    s=os.stat('/proc/self/ns/net');return {'device':s.st_dev,'inode':s.st_ino}
def boot_id():return Path('/proc/sys/kernel/random/boot_id').read_text().strip()
def require_admin():
    effective=int(next(x.split()[1] for x in Path('/proc/self/status').read_text().splitlines() if x.startswith('CapEff:')),16)
    if not effective&(1<<12):raise HelperError('native owned VXLAN operations require CAP_NET_ADMIN')

class Store:
    def __init__(self,root):self.root=root
    def secure(self,create):
        if not self.root.is_absolute():raise UsageError('absolute state directory required')
        if not self.root.exists():
            ancestor=self.root.parent
            while not ancestor.exists():ancestor=ancestor.parent
            for p in (ancestor,*ancestor.parents):
                info=p.lstat()
                if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or (info.st_mode&0o022 and not (info.st_mode&stat.S_ISVTX and info.st_uid==0)):raise HelperError('unsafe state ancestry: '+str(p))
            if create:self.root.mkdir(mode=0o700,parents=True,exist_ok=True)
            else:return False
        # Root-owned receipt directory and nonreplaceable ancestry; /tmp sticky root is allowed.
        for p in (self.root,*self.root.parents):
            info=p.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or (info.st_mode&0o022 and not (info.st_mode&stat.S_ISVTX and info.st_uid==0)):raise HelperError('unsafe state path ownership/type/permissions: '+str(p))
        if self.root.stat().st_mode&0o077:raise HelperError('state directory must be root0700')
        return True
    @contextlib.contextmanager
    def lock(self,deadline):
        global_store=Store(Path('/run/protocol-target-lab-igmp'))
        global_store.secure(True);ns=namespace();global_path=global_store.root/(str(ns['device'])+'-'+str(ns['inode'])+'.lock')
        descriptors=[]
        try:
            for path in (global_path,self.root/'control.lock'):
                if path.parent==self.root:self.secure(True)
                fd=os.open(path,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW|os.O_CLOEXEC,0o600);descriptors.append(fd);info=os.fstat(fd)
                if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode&0o077:raise HelperError('unsafe helper lock')
                while True:
                    try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);break
                    except BlockingIOError:
                        if time.monotonic()>=deadline:raise HelperError('link helper lock deadline')
                        time.sleep(.02)
            yield
        finally:
            for fd in reversed(descriptors):os.close(fd)
    def key(self,spec):return digest({k:spec[k] for k in ('deployment_id','instance_id','role')})
    def path(self,spec):return self.root/(self.key(spec)+'.json')
    def read_path(self,path):
        try:fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
        except FileNotFoundError:return None
        try:
            st=os.fstat(fd)
            if not stat.S_ISREG(st.st_mode) or st.st_uid!=0 or st.st_mode&0o077:raise HelperError('unsafe receipt')
            raw=os.read(fd,65537)
            if len(raw)>65536:raise HelperError('receipt size bound')
            r=json.loads(raw);self.check_receipt(r)
            if self.path(r['spec'])!=path:raise HelperError('receipt identity/path mismatch')
            return r
        finally:os.close(fd)
    def read(self,spec):return self.read_path(self.path(spec))
    def check_receipt(self,r):
        if type(r) is not dict or type(r.get('schema_version')) is not int or r.get('schema_version')!=1 or r.get('protocol')!='igmp-link':raise HelperError('invalid receipt schema')
        spec=validate_spec(r['spec']);owner=r['owner_id']
        if str(uuid.UUID(owner))!=owner or r['name']!='plig'+owner.replace('-','')[:10] or r['alias']!=alias(spec,owner) or r.get('atomic_group_id')!=atomic_group(owner) or r['link_sha256']!=digest(spec['link']) or r['phase'] not in ('intent','created','configured','ready'):raise HelperError('invalid ownership receipt')
        if r.get('ifindex') is not None and (type(r['ifindex']) is not int or r['ifindex']<=0):raise HelperError('invalid receipt ifindex')
        if set(r.get('network_namespace',{}))!={'device','inode'} or any(type(v) is not int or v<=0 for v in r['network_namespace'].values()):raise HelperError('invalid receipt namespace')
        if str(uuid.UUID(r['boot_id']))!=r['boot_id']:raise HelperError('invalid receipt boot ID')
        fingerprint=r.get('vxlan_attributes_sha256')
        if fingerprint is not None and (type(fingerprint) is not str or not re.fullmatch('[0-9a-f]{64}',fingerprint)):raise HelperError('invalid native VXLAN attribute fingerprint')
        if 'quiescing' in r:
            q=r['quiescing']
            if type(q) is not dict or set(q)!={'original_up'} or type(q['original_up']) is not bool:raise HelperError('invalid quiescing journal')
    def write(self,r):
        self.check_receipt(r);path=self.path(r['spec']);temp=self.root/('.tmp-'+uuid.uuid4().hex);fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600)
        try:
            raw=canonical(r);at=0
            while at<len(raw):at+=os.write(fd,raw[at:])
            os.fsync(fd);os.close(fd);fd=None;os.replace(temp,path);self.sync()
        finally:
            if fd is not None:os.close(fd)
            with contextlib.suppress(FileNotFoundError):temp.unlink()
    def remove(self,r):
        current=self.read(r['spec'])
        if current!=r:raise HelperError('receipt changed during cleanup')
        self.path(r['spec']).unlink();self.sync()
    def sync(self):
        fd=os.open(self.root,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(fd)
        finally:os.close(fd)
    def all(self):
        if not self.secure(False):return []
        return [self.read_path(p) for p in sorted(self.root.glob('*.json'))]

def alias(spec,owner):return 'protocol-target-lab:igmp:'+spec['deployment_id']+':'+spec['instance_id']+':'+spec['role']+':'+owner

def command(args,deadline,check=True):
    left=deadline-time.monotonic()
    if left<=0:raise HelperError('helper absolute deadline')
    p=subprocess.run(args,capture_output=True,text=True,timeout=min(2,left))
    if len(p.stdout.encode())>LIMIT or len(p.stderr.encode())>65536:raise HelperError('native command output bound')
    if check and p.returncode:raise HelperError('native '+str(args[0])+': '+p.stderr.strip()[:1000])
    return p

def ip(args,deadline,check=True):return command(['/usr/sbin/ip',*args],deadline,check)
def ip_json(args,deadline):return json.loads(ip(['-j',*args],deadline).stdout)
def attributes(raw):
    result={};at=0
    while at+4<=len(raw):
        size,kind=struct.unpack_from('HH',raw,at)
        if size<4 or at+size>len(raw):raise HelperError('malformed native link attribute')
        result[kind&0x3fff]=raw[at+4:at+size];at+=(size+3)&~3
    if at!=len(raw):raise HelperError('native attribute alignment')
    return result

def native_links(deadline):
    end=min(deadline,time.monotonic()+1);seq=int(time.monotonic_ns()&0xffffffff);result=[];total=0
    with socket.socket(socket.AF_NETLINK,socket.SOCK_RAW,0) as sock:
        sock.bind((0,0));sock.send(struct.pack('IHHII',32,18,0x301,seq,0)+struct.pack('BBHiII',0,0,0,0,0,0))
        while True:
            left=end-time.monotonic()
            if left<=0:raise HelperError('native link dump absolute deadline')
            sock.settimeout(left);data,anc,flags,addr=sock.recvmsg(65536)
            if flags&socket.MSG_TRUNC:raise HelperError('truncated native link dump')
            total+=len(data)
            if total>1048576:raise HelperError('native link byte budget')
            at=0
            while at+16<=len(data):
                size,kind,flg,nseq,pid=struct.unpack_from('IHHII',data,at)
                if size<16 or at+size>len(data):raise HelperError('malformed native link message')
                raw=data[at+16:at+size];at+=(size+3)&~3
                if nseq!=seq:continue
                if flg&0x10:raise HelperError('interrupted native link dump')
                if kind==3:
                    if len(raw) not in (0,4) or (raw and struct.unpack('i',raw)[0]!=0):raise HelperError('native link DONE error')
                    if at!=len(data):raise HelperError('trailing native DONE bytes')
                    return result
                if kind==2:
                    if len(raw)<4 or struct.unpack_from('i',raw)[0]!=0:raise HelperError('native link netlink error')
                    continue
                if kind!=16 or len(raw)<16:continue
                if len(result)>=100000:raise HelperError('native link row budget')
                family,pad,hw,index,iflags,change=struct.unpack_from('BBHiII',raw);a=attributes(raw[16:])
                def text(t):return a.get(t,b'').rstrip(b'\0').decode('utf8')
                def number(t,default=0):
                    b=a.get(t)
                    if b is None:return default
                    if len(b)!=4:raise HelperError('native integer attribute width')
                    return struct.unpack('I',b)[0]
                row={'ifindex':index,'ifname':text(3),'address':':'.join(f'{v:02x}' for v in a.get(1,b'')),'mtu':number(4),'group':number(27),'ifalias':text(20),'link_type':'ether' if hw==1 else 'other','flags':['UP'] if iflags&1 else [],'master_ifindex':number(10),'link_index':number(5)}
                if 18 in a:
                    info=attributes(a[18]);kind=info.get(1,b'').rstrip(b'\0').decode();row['linkinfo']={'info_kind':kind}
                    if kind=='vxlan':
                        d=attributes(info.get(2,b''));vx={}
                        def dn(k,native=False):
                            b=d.get(k,b'')
                            return int.from_bytes(b,sys.byteorder if native else 'big') if b else 0
                        vx.update(id=dn(1,True),remote=str(ipaddress.IPv4Address(d[2])) if 2 in d and len(d[2])==4 else None,local=str(ipaddress.IPv4Address(d[4])) if 4 in d and len(d[4])==4 else None,port=dn(15),learning=bool(dn(7)),link_ifindex=dn(3,True))
                        try:vx['link']=socket.if_indextoname(vx['link_ifindex'])
                        except OSError:vx['link']=None
                        vx['fixed_defaults_ok']=all(dn(k)==0 for k in (5,6,9,11,12,13,14,19,20,21,22,25,28,29,30)) and dn(8,True) in (0,300) and (10 not in d or d[10]==bytes(4)) and (18 not in d or dn(18)==1) and not any(k in d for k in (23,24,27)) and (31 not in d or dn(31)==1)
                        row['linkinfo']['info_data']=vx;row['vxlan_attributes_sha256']=digest({str(k):v.hex() for k,v in d.items()})
                result.append(row)
            if at!=len(data):raise HelperError('trailing native link message bytes')

def link(name,deadline):
    interface(name)
    # Typed RTM_GETLINK avoids older iproute2 malformed JSON on newer kernel attrs.
    rows=[r for r in native_links(deadline) if r['ifname']==name]
    if len(rows)>1:raise HelperError('unique native interface required')
    return rows[0] if rows else None

def addresses(name,deadline):
    rows=ip_json(['-4','address','show','dev',name],deadline)
    return rows[0].get('addr_info',[]) if len(rows)==1 else []
def check_context(r):
    if r['network_namespace']!=namespace():raise HelperError('receipt belongs to another network namespace')
    if r['boot_id']!=boot_id():raise HelperError('receipt belongs to previous boot; existing device cannot be assumed owned')
def core_matches(r,v,allow_empty_alias=False):
    l=r['spec']['link'];d=v.get('linkinfo',{}).get('info_data',{})
    return (v.get('ifname')==r['name'] and (v.get('ifalias')==r['alias'] or (allow_empty_alias and not v.get('ifalias'))) and v.get('linkinfo',{}).get('info_kind')=='vxlan' and d.get('id')==l['vni'] and d.get('local')==l['local_outer_ip'] and d.get('remote')==l['peer_outer_ip'] and d.get('port')==l['udp_port'] and d.get('link')==l['outer_interface'] and d.get('learning') is False and v.get('address')==l['inner_mac'] and v.get('mtu')==l['mtu'] and v.get('group')==r['atomic_group_id'] and d.get('fixed_defaults_ok') is True and not v.get('master_ifindex') and (r.get('vxlan_attributes_sha256') is None or r['vxlan_attributes_sha256']==v.get('vxlan_attributes_sha256')))
def automatic_route4(row,inner,name):
    if set(row)-{'type','dst','dev','table','protocol','scope','prefsrc','flags'}:return False
    if row.get('dev')!=name or row.get('protocol')!='kernel' or row.get('prefsrc')!=str(inner.ip) or set(row.get('flags',[]))-{'linkdown'}:return False
    table=row.get('table','main');kind=row.get('type','unicast');scope=row.get('scope')
    if table in ('main',254) and kind=='unicast':return row.get('dst')==str(inner.network) and scope=='link'
    if table in ('local',255) and kind=='local':return row.get('dst')==str(inner.ip) and scope=='host'
    if table in ('local',255) and kind=='broadcast':return row.get('dst') in (str(inner.network.network_address),str(inner.network.broadcast_address)) and scope=='link'
    return False

def automatic_route6(row,name):
    # Native IPv6-enabled kernels add this one multicast route even with addrgen none.
    allowed={'type','dst','dev','table','protocol','metric','flags','pref'}
    return not set(row)-allowed and row.get('dev')==name and row.get('type')=='multicast' and row.get('dst')=='ff00::/8' and row.get('table') in ('local',255) and row.get('protocol')=='kernel' and row.get('metric')==256 and not row.get('flags') and row.get('pref')=='medium'

def complete_alias(r,store,deadline):
    v=verify(r,deadline,allow_partial=True)
    if v is None:return None
    if v.get('ifalias')!=r['alias']:
        if 'UP' in v.get('flags',[]) or addresses(r['name'],deadline):raise HelperError('partial ownership completion requires DOWN empty-address device')
        ip(['link','set','dev',r['name'],'alias',r['alias']],deadline)
    return verify(r,deadline)

def set_ipv6_profile(name,deadline):
    p=ip(['link','set','dev',name,'addrgenmode','none'],deadline,False)
    if p.returncode:
        unsupported=False
        try:
            sock=socket.socket(socket.AF_INET6,socket.SOCK_DGRAM);sock.close()
        except OSError as error:unsupported=error.errno in (97,93)
        if not unsupported or Path('/proc/net/if_inet6').exists() or any(x.get('addr_info') for x in ip_json(['-6','address','show','dev',name],deadline)) or any(x.get('dev')==name for x in ip_json(['-6','route','show','table','all'],deadline)):raise HelperError('cannot enforce IPv4-only new-device address generation: '+p.stderr[:256])
        return 'native AF_INET6 unavailable; no IPv6 addresses/routes'
    mode=Path('/proc/sys/net/ipv6/conf')/name/'addr_gen_mode'
    if not mode.exists() or mode.read_text().strip()!='1':raise HelperError('actual addrgenmode none readback mismatch')
    return 'addrgenmode none verified'

def verify(r,deadline,ready=False,allow_partial=False):
    if r['boot_id']==boot_id() and r['network_namespace']!=namespace():raise HelperError('receipt belongs to another network namespace in same boot')
    v=link(r['name'],deadline)
    if v is None:return None
    check_context(r)
    if not core_matches(r,v,allow_partial and r['phase'] in ('intent','created')) or (r['ifindex'] is not None and v['ifindex']!=r['ifindex']):raise HelperError('native owned-link identity/core drift; refusing mutation')
    if any(x['ifindex']!=v['ifindex'] and x.get('group')==r['atomic_group_id'] for x in native_links(deadline)):raise HelperError('atomic ownership group collision')
    a=addresses(r['name'],deadline);want=ipaddress.IPv4Interface(r['spec']['link']['inner_cidr'])
    if (r['phase']=='intent' or v.get('ifalias')!=r['alias']) and ('UP' in v.get('flags',[]) or a):raise HelperError('unaliased/intent partial must be new DOWN empty-address device')
    if any(x.get('addr_info') for x in ip_json(['-6','address','show','dev',r['name']],deadline)):raise HelperError('unexpected IPv6 address on owned IPv4-only device')
    if any(x.get('local')!=str(want.ip) or x.get('prefixlen')!=want.network.prefixlen or x.get('secondary',False) for x in a) or len(a)>1:raise HelperError('extra or changed owned IPv4 addresses; refusing mutation')
    # Reject foreign upper devices and non-kernel IPv4 route dependencies.
    rows=native_links(deadline)
    if any(x.get('link_index')==v['ifindex'] or x.get('master_ifindex')==v['ifindex'] for x in rows):raise HelperError('foreign upper/master dependency on owned link')
    routes=ip_json(['-4','route','show','table','all'],deadline)
    if any(x.get('dev')==r['name'] and not automatic_route4(x,want,r['name']) for x in routes):raise HelperError('unexpected IPv4 route dependency on owned link')
    if any(x.get('dev')==r['name'] and not automatic_route6(x,r['name']) for x in ip_json(['-6','route','show','table','all'],deadline)):raise HelperError('unexpected IPv6 route dependency on owned IPv4-only link')
    if ready:
        if len(a)!=1 or 'UP' not in v.get('flags',[]) or Path('/proc/sys/net/ipv4/conf',r['name'],'force_igmp_version').read_text().strip()!='2':raise HelperError('owned link is not ready with exact IPv4/force2')
    return v

def related(a,b):
    if (a['deployment_id'],a['instance_id'])!=(b['deployment_id'],b['instance_id']) or a['role']==b['role']:return False
    x,y=a['link'],b['link']
    return x['local_outer_ip']==y['peer_outer_ip'] and x['peer_outer_ip']==y['local_outer_ip'] and x['vni']==y['vni'] and x['udp_port']==y['udp_port'] and ipaddress.IPv4Interface(x['inner_cidr']).network==ipaddress.IPv4Interface(y['inner_cidr']).network and x['inner_cidr']!=y['inner_cidr'] and x['inner_mac']!=y['inner_mac']
def preflight(spec,store,deadline):
    require_admin();l=spec['link'];v=link(l['outer_interface'],deadline)
    if not v or v.get('link_type')!='ether' or 'UP' not in v.get('flags',[]):raise HelperError('existing UP Ethernet underlay required')
    if l['mtu']>v['mtu']-50:raise HelperError('inner MTU exceeds actual underlay budget')
    if not any(x.get('local')==l['local_outer_ip'] for x in addresses(l['outer_interface'],deadline)):raise HelperError('local outer IP is not actually assigned to underlay')
    route=ip_json(['-4','route','get',l['peer_outer_ip'],'from',l['local_outer_ip'],'oif',l['outer_interface']],deadline)
    if len(route)!=1 or route[0].get('dev')!=l['outer_interface'] or route[0].get('type') in ('unreachable','blackhole','prohibit','local'):raise HelperError('bound underlay route unavailable; not a peer liveness claim')
    allowed={};records=store.all()
    for r in records:
        if (r['spec']['deployment_id'],r['spec']['instance_id'],r['spec']['role'])==(spec['deployment_id'],spec['instance_id'],spec['role']) or related(r['spec'],spec):
            current=verify(r,deadline,ready=r['phase']=='ready' and 'quiescing' not in r,allow_partial=r['phase']!='ready')
            if current:allowed[r['name']]=r
    inner=ipaddress.IPv4Interface(l['inner_cidr']);all_addresses=ip_json(['-4','address','show'],deadline)
    for row in all_addresses:
        if row['ifname'] in allowed:continue
        for a in row.get('addr_info',[]):
            network=ipaddress.IPv4Network(str(a['local'])+'/'+str(a['prefixlen']),strict=False)
            if inner.network.overlaps(network):raise HelperError('inner prefix overlaps an unrelated assigned IPv4 network')
    for row in ip_json(['-4','route','show','table','all'],deadline):
        if row.get('dev') in allowed or row.get('dst') in (None,'default','0.0.0.0/0'):continue
        try:network=ipaddress.IPv4Network(row['dst'],strict=False)
        except ValueError:continue
        if inner.network.overlaps(network):raise HelperError('inner prefix overlaps an unrelated actual route')
    # Kernel UDP sockets may have no owning userspace PID. Inspect all local rows.
    portrows=0
    for name in ('udp','udp6'):
        path=Path('/proc/net')/name
        if not path.exists():continue
        for count,line in enumerate(path.read_text().splitlines()[1:]):
            if count>100000:raise HelperError('UDP table budget')
            row=line.split()
            if len(row)>1 and int(row[1].rsplit(':',1)[1],16)==l['udp_port']:portrows+=1
    for current in native_links(deadline):
        if current.get('linkinfo',{}).get('info_kind')=='vxlan' and current['linkinfo'].get('info_data',{}).get('port')==l['udp_port'] and current['ifname'] not in allowed:raise HelperError('VXLAN UDP port shared by an unrelated native VTEP')
    allowedports=sum(r['spec']['link']['udp_port']==l['udp_port'] for r in allowed.values())
    if portrows>allowedports:raise HelperError('VXLAN UDP port conflicts with existing socket')
    docker=command(['/usr/bin/docker','--host','unix:///var/run/docker.sock','ps','--format','{{json .Ports}}'],deadline,False) if Path('/usr/bin/docker').exists() else None
    if docker and docker.returncode==0:
        if re.search(r'(?<![0-9])'+str(l['udp_port'])+r'->[^, ]*/udp',docker.stdout):raise HelperError('VXLAN UDP port conflicts with Docker publication')
    elif docker and Path('/var/run/docker.sock').exists():raise HelperError('cannot inspect Docker publications for UDP conflict')
    return {'underlay_ifindex':v['ifindex'],'underlay_mac':v['address'],'actual_underlay_mtu':v['mtu'],'known_owned_replacement_names':list(allowed)}

def output(spec,record,v,action):
    ready=record is not None and v is not None and record['phase']=='ready' and 'quiescing' not in record and 'UP' in v.get('flags',[]);info=None
    if v is not None:
        i=ipaddress.IPv4Interface(record['spec']['link']['inner_cidr']);info={'name':v['ifname'],'ifindex':v['ifindex'],'hardware_type':1,'mac':v['address'],'primary_ipv4':str(i.ip),'prefixlen':i.network.prefixlen,'mtu':v['mtu']}
    return {'schema_version':1,'protocol':'igmp-link','passed':True,'action':action,'exists':v is not None,'ready':ready,'matches_requested':record is not None and record['spec']==spec,'interface':info,'receipt':record}
def active_memberships(name):
    selected=False;found=[]
    with open('/proc/net/igmp') as f:
        for count,line in enumerate(f):
            if count>100000:raise HelperError('IGMP membership row budget')
            row=line.split();header=re.match(r'^\s*[0-9]+\s+([^\s:]+)\s*:',line)
            if header:selected=header.group(1)==name
            elif selected and row:
                if len(row)!=4 or not re.fullmatch('[0-9A-Fa-f]{8}',row[0]) or not re.fullmatch('[0-9]+',row[1]):raise HelperError('malformed native membership record')
                try:group=ipaddress.IPv4Address(bytes.fromhex(row[0])[::-1]);users=int(row[1])
                except (ValueError,TypeError):raise HelperError('malformed native membership record')
                if not group.is_multicast or not 1<=users<=0xffffffff:raise HelperError('unknown group or invalid native membership reference count')
                if str(group)!='224.0.0.1' or users>1:found.append({'group':str(group),'users':users})
    return found

def mdns_only(refs):return bool(refs) and all(x['group']=='224.0.0.251' for x in refs)

def delete(record,store,deadline):
    v=complete_alias(record,store,deadline)
    if v is None:store.remove(record);return
    refs=active_memberships(record['name'])
    # In particular, never DOWN a live source holding 239/8: that would restart
    # kernel timers without restarting the source's recorded membership age.
    if refs and not mdns_only(refs):raise HelperError('owned interface still has active IP multicast references; stop member/source first')
    try:
        if refs:
            end=min(time.monotonic()+1,deadline-1.5)
            if end<=time.monotonic():raise HelperError('insufficient absolute budget for cooperative stop and restore')
            if 'quiescing' not in record:
                record['quiescing']={'original_up':'UP' in v.get('flags',[])};store.write(record)
            require_admin();ip(['link','set','dev',record['name'],'down'],end)
            while True:
                verify(record,end);refs=active_memberships(record['name'])
                if not refs:break
                if not mdns_only(refs):raise HelperError('non-mDNS membership appeared during cooperative stop')
                left=end-time.monotonic()
                if left<=0:raise HelperError('cooperative stop timed out with actual multicast references')
                time.sleep(min(.05,left))
        # Recheck the complete native identity and actual references immediately
        # before deletion. DOWN is an invitation to drop refs, never a whitelist.
        verify(record,deadline);refs=active_memberships(record['name'])
        if refs:raise HelperError('actual multicast references remain before deletion')
        require_admin();ip(['link','delete','dev',record['name']],deadline)
        if link(record['name'],deadline) is not None:raise HelperError('owned native link did not disappear')
        store.remove(record)
    except Exception as primary:
        restore='not requested';remaining=refs
        if 'quiescing' in record:
            try:
                current=verify(record,deadline)
                if current is None:raise HelperError('owned device is absent during restoration')
                if record['quiescing']['original_up']:
                    ip(['link','set','dev',record['name'],'up'],deadline)
                    verify(record,deadline,ready=True)
                    record.pop('quiescing');store.write(record);restore='original UP verified'
                else:restore='original DOWN retained; journal preserved'
                remaining=active_memberships(record['name'])
            except Exception as error:restore='restore incomplete: '+str(error)[:256]
        raise HelperError(str(primary)+'; '+restore+'; remaining_refs='+json.dumps(remaining,separators=(',',':'))) from primary

def resume_quiescing(record,store,deadline):
    v=verify(record,deadline)
    if v is None:return None
    refs=active_memberships(record['name'])
    if refs and not mdns_only(refs):raise HelperError('pending cooperative stop has live data/foreign refs; explicit start cannot reset member timers')
    require_admin()
    if 'UP' not in v.get('flags',[]):ip(['link','set','dev',record['name'],'up'],deadline)
    v=verify(record,deadline,ready=True)
    record.pop('quiescing');store.write(record);return v

def cleanup_package(store,deadline):
    # Only the explicitly supplied package state directory is consulted. Load
    # and validate all receipts before mutating anything; never scan other roots.
    records=store.all();checks=[];removed=0;failed=0;processed=0
    for record in records:
        if time.monotonic()>=deadline:break
        item={'owner_id':record['owner_id'],'role':record['spec']['role'],'passed':False}
        try:
            delete(record,store,min(deadline,time.monotonic()+5));removed+=1;item['passed']=True
        except Exception as error:
            failed+=1;item['error']=type(error).__name__+': '+str(error)[:500]
        processed+=1
        if len(checks)<32:checks.append(item)
    pending=len(records)-processed
    result={'schema_version':1,'protocol':'igmp-link','passed':failed==0 and pending==0,'action':'_cleanup_package','summary':{'total':len(records),'removed':removed,'failed':failed,'unprocessed':pending,'details_truncated':processed>len(checks)},'checks':checks}
    if not result['passed']:result['error']=f'package link cleanup incomplete: removed={removed}, refused={failed}, unprocessed={pending}; unsafe receipts retained'
    return result
def start(spec,store,deadline):
    preflight(spec,store,deadline-2);r=store.read(spec)
    if r:
        if r['spec']!=spec:raise HelperError('owned link spec differs; stop exact old spec before commit replacement')
        v=verify(r,deadline-2,ready=r['phase']=='ready' and 'quiescing' not in r,allow_partial=r['phase']!='ready')
        if v is not None and 'quiescing' in r:v=resume_quiescing(r,store,deadline-2)
        if v is not None and r['phase']=='ready':return output(spec,r,v,'start')
        if v is None:
            if r['boot_id']==boot_id() and r['phase']=='ready':raise HelperError('owned ready link disappeared in same boot; explicit stop/restart required')
            r['ifindex']=None;r['phase']='intent';r['boot_id']=boot_id();r['network_namespace']=namespace();r['vxlan_attributes_sha256']=None;r.pop('quiescing',None);store.write(r)
    else:
        owner=str(uuid.uuid4());r={'schema_version':1,'protocol':'igmp-link','owner_id':owner,'spec':spec,'link_sha256':digest(spec['link']),'name':'plig'+owner.replace('-','')[:10],'alias':alias(spec,owner),'network_namespace':namespace(),'boot_id':boot_id(),'ifindex':None,'phase':'intent','atomic_group_id':atomic_group(owner),'vxlan_attributes_sha256':None};store.write(r)
    created=False
    try:
        v=link(r['name'],deadline-2)
        if v is None:
            l=spec['link']
            if any(x['ifname']==r['name'] or x.get('group')==r['atomic_group_id'] for x in native_links(deadline-2)):raise HelperError('new ownership name/group collides with existing device')
            ip(['link','add','name',r['name'],'group',str(r['atomic_group_id']),'alias',r['alias'],'address',l['inner_mac'],'mtu',str(l['mtu']),'type','vxlan','id',str(l['vni']),'local',l['local_outer_ip'],'remote',l['peer_outer_ip'],'dev',l['outer_interface'],'dstport',str(l['udp_port']),'nolearning'],deadline-2);created=True
        v=complete_alias(r,store,deadline-2);r['ifindex']=v['ifindex'];r['vxlan_attributes_sha256']=v['vxlan_attributes_sha256'];r['phase']='created';store.write(r)
        r['ipv6_profile']=set_ipv6_profile(r['name'],deadline-2)
        if not addresses(r['name'],deadline-2):ip(['address','add',spec['link']['inner_cidr'],'dev',r['name']],deadline-2)
        path=Path('/proc/sys/net/ipv4/conf')/r['name']/'force_igmp_version';path.write_text('2\n');r['phase']='configured';store.write(r);ip(['link','set','dev',r['name'],'up'],deadline-2);v=verify(r,deadline-2,ready=True);r['phase']='ready';store.write(r);return output(spec,r,v,'start')
    except Exception as primary:
        if created:
            try:delete(r,store,deadline)
            except Exception as cleanup:raise HelperError(str(primary)+'; exact-owned cleanup incomplete: '+str(cleanup)) from primary
        raise

def main():
    entry=time.monotonic()
    def expired(*_):raise HelperError('helper absolute entry deadline')
    signal.signal(signal.SIGALRM,expired);signal.setitimer(signal.ITIMER_REAL,10)
    p=Parser(description=__doc__);p.add_argument('action',choices=('start','status','stop','_preflight','_cleanup_deployment','_cleanup_package','_peer_status'));g=p.add_mutually_exclusive_group(required=True);g.add_argument('--spec-json');g.add_argument('--spec-file');p.add_argument('--state-dir',default=str(DEFAULT_ROOT));args=None
    try:
        args=p.parse_args()
        if os.geteuid()!=0:raise UsageError('native helper requires root')
        deadline=entry+({'start':10,'_preflight':10,'stop':5,'_cleanup_package':30}.get(args.action,3));signal.setitimer(signal.ITIMER_REAL,max(.001,deadline-time.monotonic()))
        if args.spec_json is not None:text=args.spec_json
        elif args.spec_file=='-':text=sys.stdin.buffer.read(65537).decode('utf8')
        else:
            fd=os.open(args.spec_file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC)
            try:
                if not stat.S_ISREG(os.fstat(fd).st_mode):raise UsageError('regular spec file required')
                text=os.read(fd,65537).decode('utf8')
            finally:os.close(fd)
        if len(text.encode())>65536:raise UsageError('spec byte bound64KiB')
        value=json.loads(text);store=Store(Path(args.state_dir))
        if args.action=='_cleanup_package':
            exact(value,('schema_version',));integer(value['schema_version'],1,1)
            if store.secure(False):
                with store.lock(deadline):result=cleanup_package(store,deadline)
            else:result={'schema_version':1,'protocol':'igmp-link','passed':True,'action':args.action,'summary':{'total':0,'removed':0,'failed':0,'unprocessed':0,'details_truncated':False},'checks':[]}
        elif args.action=='_cleanup_deployment':
            exact(value,('schema_version','deployment_id'));integer(value['schema_version'],1,1)
            if type(value['deployment_id']) is not str or str(uuid.UUID(value['deployment_id']))!=value['deployment_id']:raise UsageError('canonical deployment UUID required')
            if store.secure(False):
                with store.lock(deadline):
                    for r in store.all():
                        if r['spec']['deployment_id']==value['deployment_id']:delete(r,store,deadline)
            result={'schema_version':1,'protocol':'igmp-link','passed':True,'action':args.action}
        else:
            spec=validate_spec(value)
            if args.action in ('status','stop','_peer_status') and not store.secure(False):result=output(spec,None,None,args.action)
            else:
                with store.lock(deadline):
                    if args.action=='start':result=start(spec,store,deadline)
                    elif args.action=='_preflight':result={'schema_version':1,'protocol':'igmp-link','passed':True,'action':args.action,'preflight':preflight(spec,store,deadline-2)}
                    elif args.action=='_peer_status':
                        matches=[r for r in store.all() if related(r['spec'],spec)]
                        if len(matches)>1:raise HelperError('ambiguous peer receipts')
                        r=matches[0] if matches else None;v=verify(r,deadline,ready='quiescing' not in r) if r else None;result=output(r['spec'] if r else spec,r,v,args.action)
                    else:
                        r=store.read(spec)
                        if r is not None and r['spec']!=spec:raise HelperError('receipt does not match requested exact spec')
                        v=(complete_alias(r,store,deadline) if args.action=='stop' else verify(r,deadline,ready=r['phase']=='ready' and 'quiescing' not in r)) if r else None
                        if args.action=='stop' and r:delete(r,store,deadline);v=None;r=None
                        result=output(spec,r,v,args.action)
        signal.setitimer(signal.ITIMER_REAL,0);print(json.dumps(result,separators=(',',':')));return 0 if result['passed'] else 1
    except (UsageError,ValueError,TypeError,KeyError) as e:code=2;error=e
    except Exception as e:code=1;error=e
    signal.setitimer(signal.ITIMER_REAL,0)
    print(json.dumps({'schema_version':1,'protocol':'igmp-link','passed':False,'error':type(error).__name__+': '+str(error)[:1600]},separators=(',',':')));return code
if __name__=='__main__':raise SystemExit(main())
