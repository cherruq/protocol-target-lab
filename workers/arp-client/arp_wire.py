"""MIT. Finite active Ethernet/IPv4 ARP roles and Linux kernel socket proof."""
import copy
import ctypes
import hashlib
import ipaddress
import json
import os
import re
import socket
import struct

MODES=('whois','response-fuzz','rarp','inarp')
SCENARIOS=('normal','wrong-target-ip','wrong-target-mac','unknown-tha','short-arp','nonzero-rarp-proto','nonzero-whois-tha')
METHODS=('OBSERVE_REQUEST','MAPPING','REJECT_REPLY','TIMEOUT')
DEFAULT_CONFIG={'wire_profile':'ethernet-ipv4-active-arp','link':{'mode':'docker-bridge'},'source_mac':'02:00:00:00:01:10','source_ip':'198.18.1.10','server_mac':'02:00:00:00:01:20','server_ip':'198.18.1.20','assigned_ip':'198.18.1.10','mode':'whois','request_scenario':{'mode':'normal'},'interval_ms':500,'timeout_ms':1000,'retries':0}
FILTER=[[40,0,0,12],[21,2,0,2054],[21,1,0,32821],[6,0,0,0],[6,0,0,4294967295]]
BROADCAST=b'\xff'*6

def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode('ascii')
def filter_hash(v):return hashlib.sha256(json.dumps(v,separators=(',',':'),ensure_ascii=True).encode('ascii')).hexdigest()
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
def validate_config(value):
    exact(value,DEFAULT_CONFIG);c=copy.deepcopy(value)
    if c['wire_profile']!='ethernet-ipv4-active-arp':raise ValueError('wire_profile mismatch')
    if type(c['link']) is not dict:raise ValueError('link must be tagged object')
    if c['link'].get('mode')=='docker-bridge':exact(c['link'],('mode',))
    elif c['link'].get('mode')=='host-interface':exact(c['link'],('mode','interface'));iface(c['link']['interface'])
    else:raise ValueError('unsupported link mode')
    for k in ('source_mac','server_mac'):c[k]=mac_text(mac(c[k]))
    for k in ('source_ip','server_ip','assigned_ip'):c[k]=ipv4(c[k])
    if c['source_mac']==c['server_mac'] or c['source_ip']==c['server_ip']:raise ValueError('source/server roles must differ')
    if type(c['mode']) is not str or c['mode'] not in MODES:raise ValueError('unsupported mode')
    exact(c['request_scenario'],('mode',));s=c['request_scenario']['mode']
    if type(s) is not str or s not in SCENARIOS:raise ValueError('unsupported request scenario')
    if s in ('wrong-target-ip','nonzero-whois-tha') and c['mode'] not in ('whois','response-fuzz'):raise ValueError('scenario requires whois role')
    if s in ('unknown-tha','nonzero-rarp-proto') and c['mode']!='rarp':raise ValueError('scenario requires rarp')
    if s=='wrong-target-mac' and c['mode']!='inarp':raise ValueError('scenario requires inarp')
    for k in ('interval_ms','timeout_ms'):integer(c[k],10,60000)
    integer(c['retries'],0,10);return c

def load_config(text):return validate_config(json.loads(text))
def canonical_hash(c):return hashlib.sha256(canonical(validate_config(c))).hexdigest()
def summary(raw):return {'wire_length':len(raw),'raw_sha256':hashlib.sha256(raw).hexdigest(),'preview_hex':raw[:128].hex(),'truncated':len(raw)>128}
def positive(c):return c['request_scenario']['mode'] not in ('wrong-target-ip','wrong-target-mac','unknown-tha','short-arp')
def encode(dst,src,et,op,sha,spa,tha,tpa,padding=b''):
    raw=dst+src+struct.pack('!HHHBBH',et,1,0x0800,6,4,op)+sha+spa+tha+tpa+padding
    return raw+bytes(max(0,60-len(raw)))
def request(c):
    sm=mac(c['source_mac']);dm=mac(c['server_mac']);sip=socket.inet_aton(c['source_ip']);dip=socket.inet_aton(c['server_ip']);mode=c['mode']
    if mode=='rarp':dst,et,op,spa,tha,tpa=BROADCAST,0x8035,3,bytes(4),sm,bytes(4)
    elif mode=='inarp':dst,et,op,spa,tha,tpa=dm,0x0806,8,sip,dm,bytes(4)
    else:dst,et,op,spa,tha,tpa=BROADCAST,0x0806,1,sip,bytes(6),dip
    intent=encode(dst,sm,et,op,sm,spa,tha,tpa);s=c['request_scenario']['mode']
    if s=='wrong-target-ip':tpa=tpa[:3]+bytes([tpa[3]^1])
    if s in ('wrong-target-mac','unknown-tha'):tha=tha[:5]+bytes([tha[5]^1])
    if s=='nonzero-rarp-proto':spa=bytes.fromhex('01020304');tpa=bytes.fromhex('05060708')
    if s=='nonzero-whois-tha':tha=BROADCAST
    raw=encode(dst,sm,et,op,sm,spa,tha,tpa)
    return intent,raw[:37] if s=='short-arp' else raw

class PacketError(ValueError):pass

def decode(raw):
    if len(raw)<14:raise PacketError('short_ethernet')
    et=int.from_bytes(raw[12:14],'big')
    if et not in (0x0806,0x8035):raise PacketError('unsupported_ethertype')
    if len(raw)<22:raise PacketError('short_arp_header')
    hw,pr,hl,pl,op=struct.unpack('!HHBBH',raw[14:22])
    if (hw,pr,hl,pl)!=(1,0x0800,6,4):raise PacketError('unsupported_address_declaration')
    if len(raw)<42:raise PacketError('short_arp_addresses')
    return {'ethernet_destination':mac_text(raw[:6]),'ethernet_source':mac_text(raw[6:12]),'ether_type':et,'hardware_type':hw,'protocol_type':pr,'hardware_size':hl,'protocol_size':pl,'opcode':op,'sender_mac':mac_text(raw[22:28]),'sender_ip':socket.inet_ntoa(raw[28:32]),'target_mac':mac_text(raw[32:38]),'target_ip':socket.inet_ntoa(raw[38:42]),'padding':summary(raw[42:])}
def mapping(c):
    mode=c['mode'];return {'mapping_kind':'assigned_ip_for_target_mac' if mode=='rarp' else 'server_ip_for_known_mac' if mode=='inarp' else 'server_mac_for_target_ip','mapping_mac':c['source_mac'] if mode=='rarp' else c['server_mac'],'mapping_ip':c['assigned_ip'] if mode=='rarp' else c['server_ip']}
def validate_reply(p,c):
    et,op=(0x8035,4) if c['mode']=='rarp' else (0x0806,9 if c['mode']=='inarp' else 2)
    for k,v in [('ether_type',et),('opcode',op),('ethernet_source',c['server_mac']),('ethernet_destination',c['source_mac']),('sender_mac',c['server_mac']),('sender_ip',c['server_ip']),('target_mac',c['source_mac']),('target_ip',c['assigned_ip'] if c['mode']=='rarp' else c['source_ip'])]:
        if p[k]!=v:raise PacketError('wrong_'+k)

def classify(raw,meta,c,interface):
    """Candidate ownership is narrower than peer MAC: control ARP is unrelated."""
    if meta['packet_type']==4:return 'outgoing'
    if meta['truncated']:return 'malformed'
    if meta['interface']!=interface['name'] or meta['ifindex']!=interface['ifindex'] or meta['hardware_type']!=1:return 'malformed'
    if len(raw)<14:return 'malformed'
    if meta['hardware_address']!=mac_text(raw[6:12]):return 'malformed'
    if raw[6:12]!=mac(c['server_mac']) or raw[:6] not in (mac(c['source_mac']),BROADCAST):return 'unrelated'
    if len(raw)<22:return 'malformed'
    et=int.from_bytes(raw[12:14],'big');hw,pr,hl,pl,op=struct.unpack('!HHBBH',raw[14:22])
    if et not in (0x0806,0x8035) or op not in (2,4,9):return 'unrelated'
    if (hw,pr,hl,pl)!=(1,0x0800,6,4) or len(raw)<32:return 'malformed'
    target=c['assigned_ip'] if c['mode']=='rarp' else c['source_ip']
    if raw[28:32]!=socket.inet_aton(c['server_ip']) and not (len(raw)>=42 and raw[38:42]==socket.inet_aton(target)):return 'unrelated'
    return 'candidate'

def case_budgets(c,method):
    if method not in METHODS+('ALL',):raise ValueError('unsupported test method')
    I,T=c['interval_ms'],c['timeout_ms'];W=I+T
    b={'OBSERVE_REQUEST':W+1000,'MAPPING':W+1000+(0 if positive(c) else T),'REJECT_REPLY':W+1000+(100 if positive(c) else T),'TIMEOUT':W+T+1000}
    selected=METHODS if method=='ALL' else (method,);total=4000+2*sum(b[m] for m in selected)
    if T<250 or any(b[m]>4000 for m in selected) or total>30000:raise ValueError('test unavailable: applied timers exceed bounded test budget')
    return b,total

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
    def __init__(self,name,role_mac):
        iface(name);self.socket=None
        try:
            self.socket=socket.socket(socket.AF_PACKET,socket.SOCK_RAW,socket.htons(3));self.socket.bind((name,0));actual=self.socket.getsockname()
            if actual[0]!=name or actual[3]!=1 or actual[4]!=mac(role_mac):raise ValueError('actual Ethernet interface/MAC does not match configured role')
            self.interface={'name':name,'ifindex':socket.if_nametoindex(name),'hardware_type':actual[3],'mac':mac_text(actual[4])}
            attach_filter(self.socket);self.socket.setblocking(False)
        except BaseException:self.close();raise
    def proof(self):
        values=read_filter(self.socket)
        return {'name':'arp-rarp-ethertype-v1','instructions':values,'sha256':filter_hash(values),'attached':values==FILTER,'packet_socket_inode':int(os.readlink('/proc/self/fd/'+str(self.socket.fileno())).split('[')[1][:-1])}
    def receive(self):
        raw,_,flags,addr=self.socket.recvmsg(65535)
        return raw,{'interface':addr[0],'ifindex':socket.if_nametoindex(addr[0]),'protocol':addr[1],'packet_type':addr[2],'hardware_type':addr[3],'hardware_address':mac_text(addr[4]),'truncated':bool(flags&(socket.MSG_TRUNC|socket.MSG_CTRUNC))}
    def send(self,raw):
        if self.socket.send(raw)!=len(raw):raise OSError('incomplete AF_PACKET submission')
    def close(self):
        if self.socket is not None:self.socket.close()
