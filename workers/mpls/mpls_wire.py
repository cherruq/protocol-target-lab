"""MIT. Finite MPLS single-label IPv4 Echo wire codec and actual Linux socket proof."""
import copy,ctypes,fcntl,hashlib,ipaddress,json,os,re,socket,struct,time
from pathlib import Path
SCENARIOS=('normal','silent','wrong-eth-src','wrong-eth-dst','wrong-ip-src','wrong-ip-dst','wrong-id','wrong-seq','wrong-payload','bad-ip-checksum','bad-icmp-checksum','short-ethernet','short-ipv4','short-icmp')
METHODS=('ECHO','TC_TTL','PADDING','INVALID_REQUEST')
FILTER=[[40,0,0,12],[21,0,1,0x8847],[6,0,0,4294967295],[6,0,0,0]]
DEFAULT_CONFIG={'wire_profile':'mpls-single-label-ipv4-icmp-echo','link':{'mode':'docker-bridge'},'source_mac':'02:00:00:00:58:20','source_ip':'198.18.58.20','client_mac':'02:00:00:00:58:10','client_ip':'198.18.58.10','label':58,'reply_ttl':64,'scenario':{'mode':'normal'}}
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode('utf8')
def canonical_hash(v):return hashlib.sha256(canonical(validate_config(v))).hexdigest()
def filter_hash(v):return hashlib.sha256(json.dumps(v,separators=(',',':')).encode('ascii')).hexdigest()
def summary(raw):return {'wire_length':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'preview_hex':raw[:128].hex(),'truncated':len(raw)>128}
def inode(sock):return int(os.readlink('/proc/self/fd/'+str(sock.fileno())).split('[')[1][:-1])
class PacketError(ValueError):pass
def exact(v,keys):
    if type(v) is not dict or set(v)!=set(keys):raise ValueError('exact required fields: '+','.join(keys))
def integer(v,lo,hi):
    if type(v) is not int or not lo<=v<=hi:raise ValueError(f'integer required {lo}..{hi}')
def mac(v):
    if type(v) is not str or not re.fullmatch(r'(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}',v):raise ValueError('six MAC octets required')
    raw=bytes.fromhex(v.replace(':',''))
    if raw==bytes(6) or raw[0]&1:raise ValueError('nonzero unicast MAC required')
    return raw
def mac_text(raw):return ':'.join(f'{x:02x}' for x in raw)
def ipv4(v):
    if type(v) is not str:raise ValueError('IPv4 text required')
    ip=ipaddress.IPv4Address(v)
    if ip.packed[0]==0 or ip.is_multicast or int(ip)==0xffffffff:raise ValueError('nonzero unicast IPv4 required')
    return str(ip)
def iface(v):
    if type(v) is not str or not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,14}',v):raise ValueError('kernel interface name required')
    return v
def validate_config(v):
    exact(v,DEFAULT_CONFIG);c=copy.deepcopy(v)
    if c['wire_profile']!=DEFAULT_CONFIG['wire_profile']:raise ValueError('wire_profile mismatch')
    if type(c['link']) is not dict:raise ValueError('link object required')
    if c['link'].get('mode')=='docker-bridge':exact(c['link'],('mode',))
    elif c['link'].get('mode')=='host-interface':exact(c['link'],('mode','interface'));iface(c['link']['interface'])
    else:raise ValueError('link mode')
    for k in ('source_mac','client_mac'):c[k]=mac_text(mac(c[k]))
    for k in ('source_ip','client_ip'):c[k]=ipv4(c[k])
    if c['source_mac']==c['client_mac'] or c['source_ip']==c['client_ip']:raise ValueError('distinct source/client roles required')
    integer(c['label'],16,1048575);integer(c['reply_ttl'],1,255);exact(c['scenario'],('mode',))
    if type(c['scenario']['mode']) is not str or c['scenario']['mode'] not in SCENARIOS:raise ValueError('unsupported scenario')
    return c
def load_config(s):return validate_config(json.loads(s))
def role_addresses(c):
    result={c['source_ip'],c['client_ip']};m=c['scenario']['mode']
    if m in ('wrong-ip-src','wrong-ip-dst'):
        b=bytearray(socket.inet_aton(c['source_ip' if m=='wrong-ip-src' else 'client_ip']));b[3]^=1;result.add(socket.inet_ntoa(b))
    return result

def role_preflight(c,source_status=None):
    real={x['ip'] for x in ipv4_addresses()}
    with open('/proc/net/route') as f:
        for n,line in enumerate(f):
            if n>100000:raise ValueError('route row budget')
            a=line.split()
            if n and len(a)>=4:
                gateway=int(a[2],16)
                if gateway:real.add(socket.inet_ntoa(struct.pack('<I',gateway)))
    if source_status:
        real.update(x['ip'] for x in source_status.get('actual_ipv4',[]))
        real.update(source_status.get('actual_gateways',[]))
    conflicts=real.intersection(role_addresses(c))
    if conflicts:raise ValueError('environment_unavailable: protocol role/current mutated IP collides with actual OS address/gateway: '+','.join(sorted(conflicts)))
    return sorted(real)

def interface_info(name,role_mac):
    iface(name)
    with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as s:
        req=struct.pack('256s',name.encode());hw=fcntl.ioctl(s,0x8927,req);flags=struct.unpack('H',fcntl.ioctl(s,0x8913,req)[16:18])[0];mtu=struct.unpack('i',fcntl.ioctl(s,0x8921,req)[16:20])[0]
    if struct.unpack('H',hw[16:18])[0]!=1 or not flags&1 or hw[18:24]!=mac(role_mac):raise ValueError('actual UP Ethernet interface/MAC does not match configured role')
    return {'name':name,'ifindex':socket.if_nametoindex(name),'hardware_type':1,'mac':mac_text(hw[18:24]),'mtu':mtu}
def aux_metadata(anc):
    result={'vlan_valid':False,'vlan_tpid_known':False,'vlan_tci':None,'vlan_tpid':None}
    for level,kind,data in anc:
        if level==263 and kind==8:
            if len(data)<20:raise PacketError('short_auxdata')
            status,n,snap,moff,noff,tci,tpid=struct.unpack('IIIHHHH',data[:20])
            if status&(1<<4):result={'vlan_valid':True,'vlan_tpid_known':bool(status&(1<<6)),'vlan_tci':tci,'vlan_tpid':tpid if status&(1<<6) else None}
    return result

def checksum(raw):
    if len(raw)%2:raw+=b'\0'
    total=sum(struct.unpack('!'+str(len(raw)//2)+'H',raw))
    while total>>16:total=(total&65535)+(total>>16)
    return (~total)&65535

def decode_request(raw):
    if len(raw)>65553:raise PacketError('oversized_frame')
    if len(raw)<14:raise PacketError('short_ethernet')
    if raw[12:14]!=b'\x88\x47':raise PacketError('wrong_ethertype')
    if len(raw)<18:raise PacketError('short_mpls')
    shim=int.from_bytes(raw[14:18],'big')
    if not shim&256:raise PacketError('unsupported_label_stack')
    if len(raw)<38:raise PacketError('short_ipv4')
    ip=raw[18:38];total=int.from_bytes(ip[2:4],'big');flags=int.from_bytes(ip[6:8],'big')
    if ip[0]>>4!=4:raise PacketError('wrong_ip_version')
    if ip[0]&15!=5:raise PacketError('unsupported_ihl')
    if total<28:raise PacketError('invalid_ip_length')
    if total>len(raw)-18:raise PacketError('truncated_ip_datagram')
    if checksum(ip):raise PacketError('bad_ip_checksum')
    if flags&0x8000:raise PacketError('reserved_ip_flag')
    if flags&0x3fff:raise PacketError('unsupported_fragmentation')
    if not ip[8]:raise PacketError('zero_ip_ttl')
    if ip[9]!=1:raise PacketError('wrong_ip_protocol')
    icmp=raw[38:18+total]
    if checksum(icmp):raise PacketError('bad_icmp_checksum')
    if icmp[:2]!=b'\x08\x00':raise PacketError('not_echo_request')
    return {'ethernet_source':mac_text(raw[6:12]),'ethernet_destination':mac_text(raw[:6]),'label':shim>>12,'traffic_class':shim>>9&7,'bottom_of_stack':True,'label_ttl':shim&255,'ip_tos':ip[1],'ip_total_length':total,'ip_identifier':int.from_bytes(ip[4:6],'big'),'ip_flags':flags,'ip_ttl':ip[8],'source_ip':socket.inet_ntoa(ip[12:16]),'destination_ip':socket.inet_ntoa(ip[16:20]),'identifier':int.from_bytes(icmp[4:6],'big'),'sequence':int.from_bytes(icmp[6:8],'big'),'payload':icmp[8:],'padding':raw[18+total:]}
def decoded(p):return {**{k:v for k,v in p.items() if k not in ('payload','padding')},'payload':summary(p['payload']),'ethernet_padding':summary(p['padding'])}
def validate_request(p,c):
    for k,v,reason in [('ethernet_destination',c['source_mac'],'wrong_destination_mac'),('ethernet_source',c['client_mac'],'wrong_source_mac'),('label',c['label'],'wrong_label'),('source_ip',c['client_ip'],'wrong_source_ip'),('destination_ip',c['source_ip'],'wrong_destination_ip')]:
        if p[k]!=v:raise PacketError(reason)
    if p['label_ttl']<2:raise PacketError('mpls_ttl_expired')
def ipv4_icmp(src,dst,payload,identifier,sequence,*,echo_type=0,tos=0,ip_id=0,flags=0,ttl=64):
    icmp=struct.pack('!BBHHH',echo_type,0,0,identifier,sequence)+payload;icmp=icmp[:2]+struct.pack('!H',checksum(icmp))+icmp[4:]
    ip=struct.pack('!BBHHHBBH4s4s',0x45,tos,20+len(icmp),ip_id,flags,ttl,1,0,socket.inet_aton(src),socket.inet_aton(dst));ip=ip[:10]+struct.pack('!H',checksum(ip))+ip[12:]
    return ip+icmp

def reply_frame(p,c,ip_id):
    scenario=c['scenario']['mode']
    if scenario=='silent':return None
    src,dst=c['source_mac'],p['ethernet_source'];sip,dip=p['destination_ip'],p['source_ip'];ident,seq,payload=p['identifier'],p['sequence'],p['payload']
    def changed_mac(s):b=bytearray(mac(s));b[5]^=1;return mac_text(b)
    def changed_ip(s):b=bytearray(socket.inet_aton(s));b[3]^=1;return socket.inet_ntoa(b)
    if scenario=='wrong-eth-src':src=changed_mac(src)
    if scenario=='wrong-eth-dst':dst=changed_mac(dst)
    if scenario=='wrong-ip-src':sip=changed_ip(sip)
    if scenario=='wrong-ip-dst':dip=changed_ip(dip)
    if scenario=='wrong-id':ident=(ident+1)&65535
    if scenario=='wrong-seq':seq=(seq+1)&65535
    if scenario=='wrong-payload':payload=bytes([payload[0]^1])+payload[1:] if payload else b'\1'
    raw=mac(dst)+mac(src)+b'\x08\x00'+ipv4_icmp(sip,dip,payload,ident,seq,tos=p['ip_tos'],ip_id=ip_id,flags=p['ip_flags']&0x4000,ttl=c['reply_ttl']);raw+=bytes(max(0,60-len(raw)))
    if scenario in ('bad-ip-checksum','bad-icmp-checksum'):
        offset=24 if scenario=='bad-ip-checksum' else 36;raw=raw[:offset]+bytes([raw[offset]^1])+raw[offset+1:]
    return raw[:{'short-ethernet':13,'short-ipv4':33,'short-icmp':41}.get(scenario,len(raw))]
def request_frame(c,identifier,sequence,payload,*,tc=0,label_ttl=64,padding=b'',label=None):
    header=((c['label'] if label is None else label)<<12)|(tc<<9)|256|label_ttl
    raw=mac(c['source_mac'])+mac(c['client_mac'])+b'\x88\x47'+struct.pack('!I',header)+ipv4_icmp(c['client_ip'],c['source_ip'],payload,identifier,sequence,echo_type=8,tos=0x2e,ip_id=identifier,flags=0x4000,ttl=64)
    return raw+padding+bytes(max(0,60-len(raw)-len(padding)))
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

class SockFilter(ctypes.Structure):_fields_=[('code',ctypes.c_ushort),('jt',ctypes.c_ubyte),('jf',ctypes.c_ubyte),('k',ctypes.c_uint32)]
class SockFprog(ctypes.Structure):_fields_=[('len',ctypes.c_ushort),('filter',ctypes.POINTER(SockFilter))]
_libc=ctypes.CDLL(None,use_errno=True)

def attach_filter(sock):
    arr=(SockFilter*len(FILTER))(*(SockFilter(*v) for v in FILTER));p=SockFprog(len(FILTER),arr)
    if _libc.setsockopt(sock.fileno(),socket.SOL_SOCKET,26,ctypes.byref(p),ctypes.sizeof(p))!=0:raise OSError(ctypes.get_errno(),'SO_ATTACH_FILTER failed')
    if read_filter(sock)!=FILTER:raise OSError('actual kernel filter readback mismatch')
def read_filter(sock):
    buf=(SockFilter*512)();n=ctypes.c_uint(512)
    if _libc.getsockopt(sock.fileno(),socket.SOL_SOCKET,26,ctypes.byref(buf),ctypes.byref(n))!=0:raise OSError(ctypes.get_errno(),'SO_GET_FILTER failed')
    if n.value>512:raise OSError('filter readback overflow')
    return [[v.code,v.jt,v.jf,v.k] for v in buf[:n.value]]

class Transport:
    def __init__(self,name,role_mac,filtered=False):
        self.socket=None
        try:
            self.interface=interface_info(name,role_mac);self.socket=socket.socket(socket.AF_PACKET,socket.SOCK_RAW,socket.htons(3));self.socket.setsockopt(263,8,1);self.socket.bind((name,0))
            if filtered:attach_filter(self.socket)
            self.socket.setblocking(False)
        except BaseException:self.close();raise
    def proof(self):
        v=read_filter(self.socket);return {'name':'mpls-unicast-ethertype-v1','attached':v==FILTER,'instructions':v,'sha256':filter_hash(v),'packet_socket_inode':inode(self.socket)}
    def receive(self):
        raw,anc,flags,addr=self.socket.recvmsg(262144,1024)
        return raw,{'interface':addr[0],'ifindex':socket.if_nametoindex(addr[0]),'protocol':addr[1],'packet_type':addr[2],'hardware_type':addr[3],'hardware_address':mac_text(addr[4]),'truncated':bool(flags&(socket.MSG_TRUNC|socket.MSG_CTRUNC)),**aux_metadata(anc)}
    def send(self,raw):
        if len(raw)-14>self.interface['mtu']:raise OSError(90,'frame exceeds actual interface MTU')
        if self.socket.send(raw)!=len(raw):raise OSError('incomplete raw frame submission')
    def close(self):
        if self.socket:self.socket.close();self.socket=None
