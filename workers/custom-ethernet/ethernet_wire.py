"""MIT. Fixed Ethernet response configuration, live libpcap and Linux socket proof."""
import copy
import ctypes
import fcntl
import hashlib
import json
import os
import re
import socket
import struct

SNAPLEN=262144
MAX_FRAME=65535
LIBRARY='/usr/local/lib/libpcap.so.1.10.5'
DEFAULT_CONFIG={'wire_profile':'ethernet-fixed-response','link':{'mode':'docker-bridge'},'local_mac':'02:00:00:00:02:20','peer_mac':'02:00:00:00:02:10','packet_filter':'ether proto 0x88b5 and ether src 02:00:00:00:02:10','request_marker_hex':b'PLAB-REQUEST'.hex(),'response':{'mode':'payload','payload':{'destination_mac':'02:00:00:00:02:10','source_mac':{'mode':'interface','value':'02:00:00:00:02:20'},'ether_type':0x88b5,'payload_hex':(b'PLAB-RESPONSE'+bytes(51)).hex(),'vlan':{'enabled':False,'vid':7,'pcp':0,'dei':False}},'frame_hex':(bytes.fromhex('02000000021002000000022088b5')+b'PLAB-RESPONSE'+bytes(51)).hex()},'promiscuous':False,'multicast_macs':[],'test_request':{'frame_hex':(bytes.fromhex('02000000022002000000021088b5')+b'PLAB-REQUEST'+bytes(52)).hex()}}

def exact(v,keys):
    if type(v) is not dict or set(v)!=set(keys):raise ValueError('exact required fields: '+','.join(keys))
def integer(v,lo,hi):
    if type(v) is not int or not lo<=v<=hi:raise ValueError(f'integer {lo}..{hi} required')
def boolean(v):
    if type(v) is not bool:raise ValueError('boolean required')
def mac(v,kind='unicast'):
    if type(v) is not str or not re.fullmatch(r'(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}',v):raise ValueError('six MAC octets required')
    b=bytes.fromhex(v.replace(':',''))
    if b==bytes(6) or (kind=='unicast' and b[0]&1) or (kind=='multicast' and (not b[0]&1 or b==b'\xff'*6)):raise ValueError('invalid '+kind+' MAC')
    return b
def mac_text(b):return ':'.join(f'{v:02x}' for v in b)
def hexbytes(v,lo,hi):
    if type(v) is not str or len(v)%2 or not re.fullmatch('[0-9a-fA-F]*',v):raise ValueError('plain even ASCII hex required')
    if not lo<=len(v)//2<=hi:raise ValueError('hex byte length outside bounds')
    return bytes.fromhex(v)
def iface(v):
    if type(v) is not str or not re.fullmatch('[A-Za-z0-9_][A-Za-z0-9_.-]{0,14}',v):raise ValueError('kernel interface name required')
    return v
def validate_config(value):
    exact(value,DEFAULT_CONFIG);c=copy.deepcopy(value)
    if c['wire_profile']!='ethernet-fixed-response':raise ValueError('wire_profile mismatch')
    if type(c['link']) is not dict:raise ValueError('tagged link required')
    if c['link'].get('mode')=='docker-bridge':exact(c['link'],('mode',))
    elif c['link'].get('mode')=='host-interface':exact(c['link'],('mode','interface'));iface(c['link']['interface'])
    else:raise ValueError('unsupported link mode')
    for k in ('local_mac','peer_mac'):c[k]=mac_text(mac(c[k]))
    if c['local_mac']==c['peer_mac']:raise ValueError('local and peer MAC must differ')
    f=c['packet_filter']
    if type(f) is not str or not f.strip() or '\0' in f or len(f.encode('utf8'))>2048:raise ValueError('nonempty BPF text <=2048 bytes required')
    if c['request_marker_hex'] is not None:c['request_marker_hex']=hexbytes(c['request_marker_hex'],1,64).hex()
    exact(c['response'],('mode','payload','frame_hex'));r=c['response']
    if r['mode'] not in ('payload','frame'):raise ValueError('response mode required')
    p=r['payload'];exact(p,('destination_mac','source_mac','ether_type','payload_hex','vlan'))
    p['destination_mac']=mac_text(mac(p['destination_mac'],'any'));exact(p['source_mac'],('mode','value'))
    if p['source_mac']['mode'] not in ('interface','override'):raise ValueError('source mode required')
    p['source_mac']['value']=mac_text(mac(p['source_mac']['value']))
    integer(p['ether_type'],1536,65535)
    if p['ether_type'] in (0x8100,0x88a8,0x9100):raise ValueError('use explicit VLAN selector')
    p['payload_hex']=hexbytes(p['payload_hex'],0,65521).hex();v=p['vlan'];exact(v,('enabled','vid','pcp','dei'));boolean(v['enabled']);boolean(v['dei']);integer(v['vid'],0,4094);integer(v['pcp'],0,7)
    if len(constructed_frame(c))>MAX_FRAME:raise ValueError('constructed stored bank exceeds 65535')
    r['frame_hex']=hexbytes(r['frame_hex'],14,MAX_FRAME).hex();exact(c['test_request'],('frame_hex',));c['test_request']['frame_hex']=hexbytes(c['test_request']['frame_hex'],14,MAX_FRAME).hex()
    boolean(c['promiscuous'])
    if type(c['multicast_macs']) is not list or len(c['multicast_macs'])>16:raise ValueError('at most16 multicast MACs')
    c['multicast_macs']=[mac_text(mac(m,'multicast')) for m in c['multicast_macs']]
    if len(set(c['multicast_macs']))!=len(c['multicast_macs']):raise ValueError('duplicate multicast MAC')
    return c

def config_arguments(parser):
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--config-json')
    group.add_argument('--config-json-part',action='append')
def config_from_arguments(args):
    if args.config_json is not None:return load_config(args.config_json)
    parts=args.config_json_part
    if not parts or len(parts)>16 or any(not v or len(v.encode('utf8'))>60000 for v in parts):raise ValueError('1..16 ordered config parts, each1..60000 UTF8 bytes required')
    return load_config(''.join(parts))

def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode('utf8')
def canonical_hash(v):return hashlib.sha256(canonical(validate_config(v))).hexdigest()
def filter_hash(v):return hashlib.sha256(json.dumps(v,separators=(',',':')).encode('ascii')).hexdigest()
def load_config(text):return validate_config(json.loads(text))
def summary(raw):return {'wire_length':len(raw),'raw_sha256':hashlib.sha256(raw).hexdigest(),'preview_hex':raw[:128].hex(),'truncated':len(raw)>128}
def constructed_frame(c):
    p=c['response']['payload'];v=p['vlan'];src=c['local_mac'] if p['source_mac']['mode']=='interface' else p['source_mac']['value']
    header=mac(p['destination_mac'],'any')+mac(src)
    if v['enabled']:header+=struct.pack('!HH',0x8100,(v['pcp']<<13)|(int(v['dei'])<<12)|v['vid'])
    return header+struct.pack('!H',p['ether_type'])+bytes.fromhex(p['payload_hex'])
def response_frame(c):return constructed_frame(c) if c['response']['mode']=='payload' else bytes.fromhex(c['response']['frame_hex'])
def mtu_check(raw,mtu):
    tagged=len(raw)>=14 and int.from_bytes(raw[12:14],'big') in (0x8100,0x88a8)
    if len(raw)>mtu+(18 if tagged else 14):raise ValueError('active frame exceeds actual interface MTU')

def interface_info(name):
    iface(name)
    with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as s:
        req=struct.pack('256s',name.encode())
        hw=fcntl.ioctl(s,0x8927,req);mtu=struct.unpack('i',fcntl.ioctl(s,0x8921,req)[16:20])[0]
    if struct.unpack('H',hw[16:18])[0]!=1:raise ValueError('Ethernet interface required')
    return {'name':name,'ifindex':socket.if_nametoindex(name),'mac':mac_text(hw[18:24]),'mtu':mtu}

class PacketError(ValueError):pass

def normalize(raw,flags,ancillary):
    if flags&(socket.MSG_TRUNC|socket.MSG_CTRUNC):raise PacketError('truncated_capture')
    if len(raw)>MAX_FRAME or len(raw)>=SNAPLEN:raise PacketError('original_frame_oversize')
    if len(raw)<14:raise PacketError('short_ethernet')
    vlan_meta=None
    for level,kind,data in ancillary:
        if level==263 and kind==8:
            if vlan_meta is not None or len(data)<20:raise PacketError('invalid_auxdata')
            status,length,snap,net,macoff,tci,tpid=struct.unpack('IIIHHHH',data[:20])
            if status&(1<<4):
                actual_tpid=tpid if status&(1<<6) else 0x8100
                vlan_meta={'tci':tci,'tpid':actual_tpid,'tpid_from_auxdata':bool(status&(1<<6))}
    result=raw if vlan_meta is None else raw[:12]+struct.pack('!HH',vlan_meta['tpid'],vlan_meta['tci'])+raw[12:]
    if len(result)>MAX_FRAME:raise PacketError('normalized_frame_oversize')
    et=int.from_bytes(result[12:14],'big');offset=14;vlan=None
    if et==0x8100:
        if len(result)<18:raise PacketError('short_vlan')
        tci,et=struct.unpack('!HH',result[14:18]);offset=18
        vlan={'vid':tci&4095,'pcp':tci>>13,'dei':bool(tci&4096),'auxdata':vlan_meta}
    if et in (0x8100,0x88a8,0x9100):raise PacketError('unsupported_vlan_stack')
    if et<1536:raise PacketError('not_ethernet_ii')
    return result,{'destination_mac':mac_text(result[:6]),'source_mac':mac_text(result[6:12]),'ether_type':et,'vlan':vlan,'payload_offset':offset,'payload_length':len(result)-offset}

class SockFilter(ctypes.Structure):_fields_=[('code',ctypes.c_ushort),('jt',ctypes.c_ubyte),('jf',ctypes.c_ubyte),('k',ctypes.c_uint32)]
class SockFprog(ctypes.Structure):_fields_=[('len',ctypes.c_ushort),('filter',ctypes.POINTER(SockFilter))]
class BpfProgram(ctypes.Structure):_fields_=[('bf_len',ctypes.c_uint),('bf_insns',ctypes.POINTER(SockFilter))]
_libc=ctypes.CDLL(None,use_errno=True)

def read_filter(sock):
    values=(SockFilter*512)();n=ctypes.c_uint(512)
    if _libc.getsockopt(sock.fileno(),socket.SOL_SOCKET,26,ctypes.byref(values),ctypes.byref(n))!=0:raise OSError(ctypes.get_errno(),'SO_GET_FILTER')
    if not 1<=n.value<=512:raise ValueError('kernel filter length outside bound')
    return [[v.code,v.jt,v.jf,v.k] for v in values[:n.value]]
def attach_filter(sock,values):
    arr=(SockFilter*len(values))(*(SockFilter(*v) for v in values));program=SockFprog(len(values),arr)
    if _libc.setsockopt(sock.fileno(),socket.SOL_SOCKET,26,ctypes.byref(program),ctypes.sizeof(program))!=0:raise OSError(ctypes.get_errno(),'SO_ATTACH_FILTER')
    if read_filter(sock)!=values:raise ValueError('actual filter readback mismatch')

def compile_filter(name,expression):
    lib=ctypes.CDLL(LIBRARY)
    lib.pcap_create.argtypes=[ctypes.c_char_p,ctypes.c_char_p];lib.pcap_create.restype=ctypes.c_void_p
    for n in ('pcap_set_snaplen','pcap_set_promisc'):getattr(lib,n).argtypes=[ctypes.c_void_p,ctypes.c_int]
    lib.pcap_activate.argtypes=[ctypes.c_void_p];lib.pcap_datalink.argtypes=[ctypes.c_void_p]
    lib.pcap_compile.argtypes=[ctypes.c_void_p,ctypes.POINTER(BpfProgram),ctypes.c_char_p,ctypes.c_int,ctypes.c_uint32]
    lib.pcap_freecode.argtypes=[ctypes.POINTER(BpfProgram)];lib.pcap_close.argtypes=[ctypes.c_void_p]
    lib.pcap_geterr.argtypes=[ctypes.c_void_p];lib.pcap_geterr.restype=ctypes.c_char_p
    lib.pcap_lib_version.restype=ctypes.c_char_p
    err=ctypes.create_string_buffer(256);handle=lib.pcap_create(name.encode(),err)
    if not handle:raise ValueError('pcap_create: '+err.value.decode(errors='replace'))
    program=BpfProgram();allocated=False
    try:
        if lib.pcap_set_snaplen(handle,SNAPLEN)!=0 or lib.pcap_set_promisc(handle,0)!=0 or lib.pcap_activate(handle)<0:raise ValueError('live pcap activation failed')
        if lib.pcap_datalink(handle)!=1:raise ValueError('live EN10MB context required')
        if lib.pcap_compile(handle,ctypes.byref(program),expression.encode(),1,0xffffffff)!=0:raise ValueError('BPF compile: '+lib.pcap_geterr(handle).decode(errors='replace')[:256])
        allocated=True
        if not 1<=program.bf_len<=512:raise ValueError('compiled BPF exceeds512 instructions')
        values=[[v.code,v.jt,v.jf,v.k] for v in program.bf_insns[:program.bf_len]]
        for code,jt,jf,k in values:
            if code&7==6 and (code!=6 or k not in (0,SNAPLEN)):raise ValueError('BPF return would clip capture')
        library={'version':lib.pcap_lib_version().decode(),'sha256':hashlib.sha256(open(LIBRARY,'rb').read()).hexdigest()}
        return values,library
    finally:
        if allocated:lib.pcap_freecode(ctypes.byref(program))
        lib.pcap_close(handle)

class Transport:
    def __init__(self,name,program=None,memberships=(),promiscuous=False):
        self.socket=None;self.members=[];self.interface=interface_info(name)
        try:
            self.socket=socket.socket(socket.AF_PACKET,socket.SOCK_RAW,0)
            self.socket.setsockopt(263,8,1)
            if program is not None:attach_filter(self.socket,program)
            for value in memberships:self.join(mac(value,'multicast'),0)
            if promiscuous:self.join(b'',1)
            self.socket.bind((name,3));self.socket.setblocking(False)
        except BaseException:self.close();raise
    def join(self,addr,kind):
        request=struct.pack('IHH8s',self.interface['ifindex'],kind,len(addr),addr)
        self.socket.setsockopt(263,1,request);self.members.append(request)
    def proof(self):
        v=read_filter(self.socket)
        return {'instructions':v,'sha256':filter_hash(v),'installed':True,'readback_instructions':v,'packet_socket_inode':int(os.readlink('/proc/self/fd/'+str(self.socket.fileno())).split('[')[1][:-1])}
    def receive(self):
        raw,anc,flags,addr=self.socket.recvmsg(SNAPLEN,1024)
        return raw,anc,flags,{'interface':addr[0],'ifindex':socket.if_nametoindex(addr[0]),'protocol':addr[1],'packet_type':addr[2],'hardware_type':addr[3],'hardware_address':mac_text(addr[4])}
    def send(self,raw):
        if self.socket.send(raw)!=len(raw):raise OSError('incomplete AF_PACKET submission')
    def close(self):
        if self.socket is not None:
            for item in self.members:
                try:self.socket.setsockopt(263,2,item)
                except OSError:pass
            self.socket.close();self.socket=None
