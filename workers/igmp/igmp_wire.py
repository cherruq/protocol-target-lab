"""MIT. Linux membership observation and bounded independent IGMP query wire tools."""
import copy
import ctypes
import fcntl
import hashlib
import ipaddress
import json
import os
import re
import socket
import struct
import time

DEFAULT_CONFIG={'wire_profile':'linux-kernel-igmp-v2','link':{'mode':'docker-bridge'},'groups':['239.192.19.1'],'query_profile':{'version':2,'max_response_code':100}}
METHODS=('GENERAL_QUERY','GROUP_QUERY','ALL')
PORT=18088

def exact(v,keys):
    if type(v) is not dict or set(v)!=set(keys):raise ValueError('exact required fields: '+','.join(keys))
def integer(v,lo,hi):
    if type(v) is not int or not lo<=v<=hi:raise ValueError(f'integer {lo}..{hi} required')
def ipv4(v):
    if type(v) is not str:raise ValueError('IPv4 literal required')
    ip=ipaddress.IPv4Address(v)
    if ip.packed[0]==0 or ip.packed[0]>=224 or ip.is_multicast or int(ip)==0xffffffff:raise ValueError('nonzero unicast IPv4 required')
    return str(ip)
def iface(v):
    if type(v) is not str or not re.fullmatch('[A-Za-z0-9_][A-Za-z0-9_.-]{0,14}',v):raise ValueError('kernel interface name required')
    return v
def mac(v):
    if type(v) is not str or not re.fullmatch('(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}',v):raise ValueError('six MAC octets required')
    b=bytes.fromhex(v.replace(':',''))
    if b==bytes(6) or b[0]&1:raise ValueError('nonzero unicast MAC required')
    return b
def mac_text(b):return ':'.join(f'{v:02x}' for v in b)
def validate_config(value):
    exact(value,DEFAULT_CONFIG);c=copy.deepcopy(value)
    if c['wire_profile']!='linux-kernel-igmp-v2':raise ValueError('wire profile mismatch')
    if type(c['groups']) is not list or not 1<=len(c['groups'])<=16:raise ValueError('1..16 groups required')
    for i,g in enumerate(c['groups']):
        if type(g) is not str or ipaddress.IPv4Address(g).packed[0]!=239:raise ValueError('239/8 group literal required')
        c['groups'][i]=str(ipaddress.IPv4Address(g))
    if len(set(c['groups']))!=len(c['groups']):raise ValueError('duplicate groups')
    exact(c['query_profile'],('version','max_response_code'));integer(c['query_profile']['version'],2,2);integer(c['query_profile']['max_response_code'],100,100)
    l=c['link']
    if type(l) is not dict:raise ValueError('tagged link required')
    if l.get('mode')=='docker-bridge':exact(l,('mode',))
    elif l.get('mode')=='host-interface':
        exact(l,('mode','interface','interface_ip','peer_interface'));iface(l['interface']);l['interface_ip']=ipv4(l['interface_ip'])
        if l['peer_interface'] is not None:
            iface(l['peer_interface'])
            if l['peer_interface']==l['interface']:raise ValueError('peer interface must differ')
    elif l.get('mode')=='owned-vxlan':
        exact(l,('mode','outer_interface','local_outer_ip','peer_outer_ip','vni','udp_port','mtu','local_inner_cidr','local_inner_mac','peer_inner_ip','peer_inner_mac'));iface(l['outer_interface'])
        for k in ('local_outer_ip','peer_outer_ip','peer_inner_ip'):l[k]=ipv4(l[k])
        integer(l['vni'],1,16777215);integer(l['udp_port'],1024,65535);integer(l['mtu'],576,9000)
        if type(l['local_inner_cidr']) is not str:raise ValueError('inner CIDR required')
        inner=ipaddress.IPv4Interface(l['local_inner_cidr']);ipv4(str(inner.ip))
        if not 16<=inner.network.prefixlen<=30:raise ValueError('inner prefix16..30 required')
        peer=ipaddress.IPv4Address(l['peer_inner_ip'])
        if inner.ip in (inner.network.network_address,inner.network.broadcast_address) or peer not in inner.network or peer in (inner.ip,inner.network.network_address,inner.network.broadcast_address):raise ValueError('different usable inner hosts required')
        if l['local_outer_ip']==l['peer_outer_ip'] or {str(inner.ip),str(peer)}&{l['local_outer_ip'],l['peer_outer_ip']}:raise ValueError('inner/outer roles must differ')
        l['local_inner_cidr']=str(inner)
        for k in ('local_inner_mac','peer_inner_mac'):l[k]=mac_text(mac(l[k]))
        if l['local_inner_mac']==l['peer_inner_mac']:raise ValueError('inner MAC roles must differ')
    else:raise ValueError('unsupported link mode')
    return c

def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode('utf8')
def canonical_hash(v):return hashlib.sha256(canonical(validate_config(v))).hexdigest()
def load_config(s):return validate_config(json.loads(s))
def inode(sock):return int(os.readlink('/proc/self/fd/'+str(sock.fileno())).split('[')[1][:-1])
def summary(raw):return {'wire_length':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'preview_hex':raw[:128].hex(),'truncated':len(raw)>128}
def namespace():
    s=os.stat('/proc/self/ns/net');return {'device':s.st_dev,'inode':s.st_ino}

def ipv4_addresses():
    """Read-only actual assigned IPv4s, including secondary flags; absolute bounded dump."""
    deadline=time.monotonic()+1;seq=int(time.monotonic_ns()&0xffffffff);result=[];total=0;rows=0
    with socket.socket(socket.AF_NETLINK,socket.SOCK_RAW,0) as s:
        s.bind((0,0));s.send(struct.pack('IHHII',24,22,0x301,seq,0)+struct.pack('BBBBI',socket.AF_INET,0,0,0,0))
        while True:
            left=deadline-time.monotonic()
            if left<=0:raise TimeoutError('address dump deadline')
            s.settimeout(left);data,anc,flags,addr=s.recvmsg(65536)
            if flags&socket.MSG_TRUNC:raise ValueError('truncated address dump')
            total+=len(data)
            if total>1048576:raise ValueError('address dump budget')
            offset=0
            while offset+16<=len(data):
                length,kind,nflags,nseq,pid=struct.unpack_from('IHHII',data,offset)
                if length<16 or offset+length>len(data):raise ValueError('malformed address dump')
                body=data[offset+16:offset+length];offset+=(length+3)&~3
                if nseq!=seq:continue
                if nflags&0x10:raise ValueError('interrupted address dump')
                if kind==3:
                    if len(body) not in (0,4) or (body and struct.unpack('i',body)[0]!=0):raise ValueError('address DONE error')
                    if offset!=len(data):raise ValueError('trailing address DONE bytes')
                    return result
                if kind==2:
                    if len(body)<4 or struct.unpack_from('i',body)[0]!=0:raise OSError('address netlink error')
                    continue
                rows+=1
                if rows>100000:raise ValueError('address row budget')
                if kind!=20 or len(body)<8:continue
                family,prefix,aflags,scope,index=struct.unpack_from('BBBBI',body);attrs={};pos=8
                while pos+4<=len(body):
                    n,t=struct.unpack_from('HH',body,pos)
                    if n<4 or pos+n>len(body):raise ValueError('malformed address attribute')
                    attrs[t]=body[pos+4:pos+n];pos+=(n+3)&~3
                raw=attrs.get(2,attrs.get(1))
                if family==socket.AF_INET and raw is not None and len(raw)==4:
                    ext=struct.unpack('I',attrs[8])[0] if len(attrs.get(8,b''))==4 else aflags
                    result.append({'ifindex':index,'ip':socket.inet_ntoa(raw),'prefixlen':prefix,'secondary':bool(ext&1),'scope':scope})
            if offset!=len(data):raise ValueError('trailing address message bytes')

def interface_info(name,expected_ip=None):
    iface(name)
    with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as s:
        req=struct.pack('256s',name.encode());hw=fcntl.ioctl(s,0x8927,req);flags=struct.unpack('H',fcntl.ioctl(s,0x8913,req)[16:18])[0];mtu=struct.unpack('i',fcntl.ioctl(s,0x8921,req)[16:20])[0]
    if struct.unpack('H',hw[16:18])[0]!=1 or not flags&1:raise ValueError('UP Ethernet interface required')
    index=socket.if_nametoindex(name);addresses=[v for v in ipv4_addresses() if v['ifindex']==index]
    if len(addresses)!=1 or addresses[0]['secondary']:raise ValueError('exactly one primary IPv4 required')
    ip=ipv4(addresses[0]['ip'])
    if expected_ip is not None and ip!=expected_ip:raise ValueError('actual primary IPv4 mismatch')
    return {'name':name,'ifindex':index,'hardware_type':1,'mac':mac_text(hw[18:24]),'primary_ipv4':ip,'prefixlen':addresses[0]['prefixlen'],'mtu':mtu}

def parameters(name):
    def number(path):
        v=int(open(path).read().strip())
        if not 0<=v<=2147483647:raise ValueError('kernel parameter range')
        return v
    root='/proc/sys/net/ipv4/'
    return {'sysctl_qrv':number(root+'igmp_qrv'),'interface_force':number(root+'conf/'+name+'/force_igmp_version'),'all_force':number(root+'conf/all/force_igmp_version'),'v2_unsolicited_interval_ms':number(root+'conf/'+name+'/igmpv2_unsolicited_report_interval'),'v3_unsolicited_interval_ms':number(root+'conf/'+name+'/igmpv3_unsolicited_report_interval')}

def warmup_bound(p):
    simple=p['interface_force']==2 and p['all_force'] in (0,2);upper=max(p['sysctl_qrv'],1 if simple else 7)
    return {'sysctl_qrv_at_join':p['sysctl_qrv'],'qrv_upper_bound_at_join':upper,'qrv_upper_bound_reason':'forced-v2-compatible sysctl count' if simple else 'conservative max(sysctl,7), learned mr_qrv is not exported','startup_upper_ms':(upper-1)*(max(p['v2_unsolicited_interval_ms'],p['v3_unsolicited_interval_ms'])+1000)+2000}

def proc_groups(name):
    selected=False;rows={}
    with open('/proc/net/igmp') as f:
        for count,line in enumerate(f):
            if count>100000:raise ValueError('IGMP proc row budget')
            values=line.split();header=re.match(r'^\s*[0-9]+\s+([^\s:]+)\s*:',line)
            if header:
                selected=header.group(1)==name
            elif selected and len(values)>=4 and re.fullmatch('[0-9A-Fa-f]{8}',values[0]):
                rows[socket.inet_ntoa(bytes.fromhex(values[0])[::-1])]={'users':int(values[1]),'timer':values[2],'reporter':values[3]}
    return rows

def checksum(raw):
    if len(raw)%2:raw+=b'\0'
    total=sum(struct.unpack('!'+str(len(raw)//2)+'H',raw))
    while total>>16:total=(total&65535)+(total>>16)
    return (~total)&65535

def group_mac(group):
    b=socket.inet_aton(group);return b'\x01\x00\x5e'+bytes([b[1]&127])+b[2:]

class PacketError(ValueError):pass

def decode(raw,anc,flags,configured_groups=()):
    if flags&(socket.MSG_TRUNC|socket.MSG_CTRUNC) or len(raw)>65535:raise PacketError('truncated_or_oversized')
    if len(raw)<14:raise PacketError('short_ethernet')
    frame=raw
    for level,kind,data in anc:
        if level==263 and kind==8 and len(data)>=20:
            status,n,snap,moff,noff,tci,tpid=struct.unpack('IIIHHHH',data[:20])
            if status&(1<<4):frame=raw[:12]+struct.pack('!HH',tpid if status&(1<<6) else 0x8100,tci)+raw[12:]
    et=int.from_bytes(frame[12:14],'big');start=14
    if et in (0x8100,0x88a8):
        if len(frame)<18:raise PacketError('short_vlan')
        et=int.from_bytes(frame[16:18],'big');start=18
    if et!=0x0800 or len(frame)<start+20:raise PacketError('not_complete_ipv4')
    ip=frame[start:];ihl=(ip[0]&15)*4;total=int.from_bytes(ip[2:4],'big')
    if ip[0]>>4!=4 or not 20<=ihl<=60 or len(ip)<ihl or total<ihl+8 or total>len(ip) or ip[9]!=2:raise PacketError('invalid_ipv4_igmp_lengths')
    if int.from_bytes(ip[6:8],'big')&0xbfff:raise PacketError('fragmented_or_reserved_ipv4')
    if checksum(ip[:ihl]) or checksum(ip[ihl:total]):raise PacketError('invalid_checksum')
    pos=20;router_alert=False
    while pos<ihl:
        kind=ip[pos]
        if kind==0:
            if any(ip[pos+1:ihl]):raise PacketError('nonzero_option_padding')
            break
        if kind==1:pos+=1;continue
        if pos+2>ihl or ip[pos+1]<2 or pos+ip[pos+1]>ihl:raise PacketError('invalid_ipv4_options')
        length=ip[pos+1]
        if kind==148:
            if length!=4 or ip[pos+2:pos+4]!=b'\0\0' or router_alert:raise PacketError('invalid_router_alert')
            router_alert=True
        pos+=length
    payload=ip[ihl:total];kind=payload[0];group=socket.inet_ntoa(payload[4:8]);groups=[];version=None
    if kind in (0x11,0x12,0x16,0x17):
        if kind!=0x11 and len(payload)!=8:raise PacketError('invalid_v1v2_length')
        if kind==0x11 and len(payload) not in (8,) and len(payload)<12:raise PacketError('invalid_query_length')
        if kind in (0x12,0x16):groups=[group];version=1 if kind==0x12 else 2
    elif kind==0x22:
        version=3;count=int.from_bytes(payload[6:8],'big');at=8
        for _ in range(count):
            if at+8>len(payload):raise PacketError('short_v3_record')
            rtype,aux,sources=struct.unpack('!BBH',payload[at:at+4]);end=at+8+sources*4+aux*4
            if rtype not in range(1,7) or end>len(payload):raise PacketError('invalid_v3_record')
            groups.append(socket.inet_ntoa(payload[at+4:at+8]));at=end
        if at!=len(payload):raise PacketError('extra_v3_bytes')
    else:raise PacketError('unknown_igmp_type')
    return {'source_mac':mac_text(frame[6:12]),'destination_mac':mac_text(frame[:6]),'source_ip':socket.inet_ntoa(ip[12:16]),'destination_ip':socket.inet_ntoa(ip[16:20]),'ttl':ip[8],'ipv4_id':int.from_bytes(ip[4:6],'big'),'router_alert':router_alert,'igmp_type':kind,'igmp_version':version,'max_response_code':payload[1],'group':group,'groups':groups[:16],'matching_configured_groups':list(dict.fromkeys(g for g in groups if g in configured_groups)),'total_groups':len(groups),'groups_truncated':len(groups)>16,'ipv4':summary(ip[:total]),'igmp':summary(payload)}

def query_frame(interface,group,identifier):
    destination='224.0.0.1' if group is None else group;g=bytes(4) if group is None else socket.inet_aton(group)
    igmp=struct.pack('!BBH4s',0x11,100,0,g);igmp=igmp[:2]+struct.pack('!H',checksum(igmp))+igmp[4:]
    header=struct.pack('!BBHHHBBH4s4s4s',0x46,0,32,identifier,0,1,2,0,socket.inet_aton(interface['primary_ipv4']),socket.inet_aton(destination),bytes.fromhex('94040000'));header=header[:10]+struct.pack('!H',checksum(header))+header[12:]
    return group_mac(destination)+mac(interface['mac'])+b'\x08\x00'+header+igmp

class SockFilter(ctypes.Structure):_fields_=[('code',ctypes.c_ushort),('jt',ctypes.c_ubyte),('jf',ctypes.c_ubyte),('k',ctypes.c_uint32)]
class SockFprog(ctypes.Structure):_fields_=[('len',ctypes.c_ushort),('filter',ctypes.POINTER(SockFilter))]
FILTER=[[40,0,0,12],[21,2,0,0x0800],[21,4,0,0x8100],[21,3,8,0x88a8],[48,0,0,23],[21,5,6,2],[6,0,0,0],[40,0,0,16],[21,0,3,0x0800],[48,0,0,27],[21,0,1,2],[6,0,0,262144],[6,0,0,0]]

def attach(sock):
    lib=ctypes.CDLL(None,use_errno=True);arr=(SockFilter*len(FILTER))(*(SockFilter(*v) for v in FILTER));p=SockFprog(len(FILTER),arr)
    if lib.setsockopt(sock.fileno(),socket.SOL_SOCKET,26,ctypes.byref(p),ctypes.sizeof(p)):raise OSError(ctypes.get_errno(),'filter attach')

class Capture:
    def __init__(self,interface,groups):
        self.socket=None;self.members=[];self.interface=interface
        try:
            self.socket=socket.socket(socket.AF_PACKET,socket.SOCK_RAW,0);self.socket.setsockopt(263,8,1);attach(self.socket)
            for m in sorted({group_mac(g) for g in groups}):
                req=struct.pack('IHH8s',interface['ifindex'],0,6,m);self.socket.setsockopt(263,1,req);self.members.append(req)
            self.socket.bind((interface['name'],3));self.socket.setblocking(False)
        except BaseException:self.close();raise
    def receive(self):
        raw,anc,flags,addr=self.socket.recvmsg(262144,1024)
        return raw,anc,flags,{'interface':addr[0],'ifindex':socket.if_nametoindex(addr[0]),'packet_type':addr[2],'hardware_type':addr[3],'hardware_address':mac_text(addr[4])}
    def send(self,raw):
        if self.socket.send(raw)!=len(raw):raise OSError('short actual query submission')
    def close(self):
        if self.socket:
            for req in self.members:
                try:self.socket.setsockopt(263,2,req)
                except OSError:pass
            self.socket.close();self.socket=None
