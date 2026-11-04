#!/usr/bin/env python3
"""MIT. Finite VXLAN/Ethernet/IPv4 ARP codec; no kernel network changes."""
from dataclasses import dataclass
import copy
import hashlib
import fcntl
import ipaddress
import json
import re
import secrets
import socket
import struct
import time

MODES=('normal','silent','wrong-vni','clear-i','wrong-eth-dst','wrong-sha','wrong-spa','wrong-tha','wrong-tpa','short-header','short-arp')
DEFAULT_CONFIG={'wire_profile':'vxlan-ipv4-arp','bind_ip':'127.0.0.1','port':4789,'peer_ip':'127.0.0.2','peer_port':4789,'source_port':55029,'vni':1000,'inner_ip':'198.18.0.20','inner_mac':'02:00:00:00:00:20','requester_ip':'198.18.0.10','requester_mac':'02:00:00:00:00:10','reply_padding':0,'scenario':{'mode':'normal'}}
BROADCAST=b'\xff'*6

def integer(v,lo,hi):
    if type(v) is not int or not lo<=v<=hi:raise ValueError(f'integer must be {lo}..{hi}')
def exact(obj,keys):
    if type(obj) is not dict or set(obj)!=set(keys):raise ValueError('required fields: '+','.join(keys))
def ipv4(text,zero=False):
    if type(text) is not str:raise ValueError('IPv4 must be text')
    ip=ipaddress.IPv4Address(text)
    if (ip.packed[0]==0 and not (zero and int(ip)==0)) or ip.is_multicast or int(ip)==0xffffffff:raise ValueError('unicast IPv4 required')
    return str(ip)
def mac(text):
    if type(text) is not str or not re.fullmatch(r'(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}',text):raise ValueError('six two-hex MAC octets required')
    data=bytes.fromhex(text.replace(':',''))
    if data==bytes(6) or data[0]&1:raise ValueError('nonzero unicast MAC required')
    return data
def mac_text(raw):return ':'.join(f'{v:02x}' for v in raw)
def validate_config(config):
    exact(config,DEFAULT_CONFIG);c=copy.deepcopy(config)
    if c['wire_profile']!='vxlan-ipv4-arp':raise ValueError('invalid wire_profile')
    for k in ('bind_ip','peer_ip','inner_ip'):c[k]=ipv4(c[k])
    c['requester_ip']=ipv4(c['requester_ip'],True)
    for k in ('port','peer_port'):integer(c[k],1,65535)
    integer(c['source_port'],49152,65535)
    if c['port']==c['source_port']:raise ValueError('listen/source ports must differ')
    if c['bind_ip']==c['peer_ip'] and c['peer_port'] in (c['port'],c['source_port']):raise ValueError('same-IP peer endpoint overlaps target')
    integer(c['vni'],0,0xffffff)
    for k in ('inner_mac','requester_mac'):c[k]=mac_text(mac(c[k]))
    if c['inner_mac']==c['requester_mac'] or c['inner_ip']==c['requester_ip']:raise ValueError('inner roles must differ')
    integer(c['reply_padding'],0,18)
    if c['reply_padding'] not in (0,18):raise ValueError('reply_padding must be0 or18')
    exact(c['scenario'],('mode',))
    if type(c['scenario']['mode']) is not str or c['scenario']['mode'] not in MODES:raise ValueError('invalid scenario mode')
    return c
def load_config(text):return validate_config(json.loads(text))
def canonical_hash(config):return hashlib.sha256(json.dumps(validate_config(config),sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()).hexdigest()
def summary(raw):return {'wire_length':len(raw),'raw_sha256':hashlib.sha256(raw).hexdigest(),'preview_hex':raw[:128].hex(),'truncated':len(raw)>128}

class PacketError(ValueError):pass
@dataclass(frozen=True)
class Packet:
    flags:int
    reserved:bytes
    vni:int
    ethernet_destination:bytes
    ethernet_source:bytes
    opcode:int
    sender_mac:bytes
    sender_ip:bytes
    target_mac:bytes
    target_ip:bytes
    padding:bytes=b''
    def encode(self):
        if len(self.reserved)!=4:raise ValueError('four reserved bytes required')
        return bytes([self.flags])+self.reserved[:3]+self.vni.to_bytes(3,'big')+self.reserved[3:]+self.ethernet_destination+self.ethernet_source+b'\x08\x06'+struct.pack('!HHBBH',1,0x0800,6,4,self.opcode)+self.sender_mac+self.sender_ip+self.target_mac+self.target_ip+self.padding
    def fields(self):
        return {'flags':self.flags,'ignored_flag_bits':self.flags&0xf7,'reserved_hex':self.reserved.hex(),'vni':self.vni,'ethernet_destination':mac_text(self.ethernet_destination),'ethernet_source':mac_text(self.ethernet_source),'ether_type':0x0806,'hardware_type':1,'protocol_type':0x0800,'hardware_size':6,'protocol_size':4,'opcode':self.opcode,'sender_mac':mac_text(self.sender_mac),'sender_ip':socket.inet_ntoa(self.sender_ip),'target_mac':mac_text(self.target_mac),'target_ip':socket.inet_ntoa(self.target_ip),'inner_size':42+len(self.padding),'padding':summary(self.padding)}

def decode(raw):
    if len(raw)<8:raise PacketError('short_vxlan')
    if not raw[0]&8:raise PacketError('missing_i')
    if len(raw)<22:raise PacketError('short_ethernet')
    et=int.from_bytes(raw[20:22],'big')
    if et in (0x8100,0x88a8):raise PacketError('unsupported_vlan')
    if et!=0x0806:raise PacketError('wrong_ethertype')
    if len(raw)<30:raise PacketError('short_arp_header')
    hw,proto,hs,ps,op=struct.unpack('!HHBBH',raw[22:30])
    if hw!=1:raise PacketError('wrong_hardware_type')
    if proto!=0x0800:raise PacketError('wrong_protocol_type')
    if hs!=6 or ps!=4:raise PacketError('wrong_address_sizes')
    if len(raw)<50:raise PacketError('short_arp_addresses')
    return Packet(raw[0],raw[1:4]+raw[7:8],int.from_bytes(raw[4:7],'big'),raw[8:14],raw[14:20],op,raw[30:36],raw[36:40],raw[40:46],raw[46:50],raw[50:])

def validate_request(p,source,c):
    if source[0]!=c['peer_ip']:raise PacketError('wrong_source')
    if p.vni!=c['vni']:raise PacketError('wrong_vni')
    if p.ethernet_destination not in (BROADCAST,mac(c['inner_mac'])):raise PacketError('wrong_ethernet_destination')
    if p.ethernet_source!=mac(c['requester_mac']):raise PacketError('wrong_ethernet_source')
    if p.opcode!=1:raise PacketError('not_arp_request')
    if p.sender_mac!=mac(c['requester_mac']):raise PacketError('wrong_sender_mac')
    if p.sender_ip!=socket.inet_aton(c['requester_ip']):raise PacketError('wrong_sender_ip')
    if p.target_ip!=socket.inet_aton(c['inner_ip']):raise PacketError('wrong_target_ip')

def make_reply(p,c):
    return Packet(8,bytes(4),c['vni'],p.sender_mac,mac(c['inner_mac']),2,mac(c['inner_mac']),socket.inet_aton(c['inner_ip']),p.sender_mac,p.sender_ip,bytes(c['reply_padding']))

def fault_bytes(raw,c):
    mode=c['scenario']['mode']
    if mode=='silent':return None
    if mode=='short-header':return raw[:7]
    if mode=='short-arp':return raw[:49]
    data=bytearray(raw)
    if mode=='wrong-vni':data[4:7]=((c['vni']+1)&0xffffff).to_bytes(3,'big')
    elif mode=='clear-i':data[0]&=0xf7
    else:
        offsets={'wrong-eth-dst':13,'wrong-sha':35,'wrong-spa':39,'wrong-tha':45,'wrong-tpa':49}
        if mode in offsets:data[offsets[mode]]^=1
    return bytes(data)

def make_request(c,nonce,unicast=False,reserved=False,tha=None):
    if len(nonce)!=16:raise ValueError('sixteen nonce bytes required')
    return Packet(0x18 if reserved else 8,b'\x01\x02\x03\x04' if reserved else bytes(4),c['vni'],mac(c['inner_mac']) if unicast else BROADCAST,mac(c['requester_mac']),1,mac(c['requester_mac']),socket.inet_aton(c['requester_ip']),bytes(6) if tha is None else tha,socket.inet_aton(c['inner_ip']),nonce+b'\0\0')

def check_local_address(address):
    """Read all IPv4 addresses via netlink, permitting existing loopback127/8."""
    ip=ipaddress.IPv4Address(address);seq=secrets.randbits(31);deadline=time.monotonic()+1;total_bytes=0;rows=0
    request=struct.pack('=IHHII',24,22,0x301,seq,0)+struct.pack('=BBBBI',socket.AF_INET,0,0,0,0)
    with socket.socket(socket.AF_NETLINK,socket.SOCK_RAW,0) as nl:
        nl.bind((0,0));nl.settimeout(max(.001,deadline-time.monotonic()));nl.sendto(request,(0,0))
        while True:
            left=deadline-time.monotonic()
            if left<=0:raise TimeoutError('netlink address dump absolute deadline')
            nl.settimeout(left);raw=nl.recv(65536);total_bytes+=len(raw);pos=0
            if total_bytes>1048576:raise OSError('netlink address dump byte budget')
            while pos+16<=len(raw):
                rows+=1
                if rows>100000:raise OSError('netlink address dump row budget')
                if time.monotonic()>=deadline:raise TimeoutError('netlink address dump absolute deadline')
                n,kind,flags,number,pid=struct.unpack_from('=IHHII',raw,pos)
                if n<16 or pos+n>len(raw):raise OSError('invalid netlink reply')
                data=raw[pos+16:pos+n];pos+=(n+3)&~3
                if number!=seq:continue
                if kind==3:raise ValueError('address is not local to this execution node')
                if kind==2:raise OSError('netlink address query failed')
                if kind!=20 or len(data)<8:continue
                family,prefix,aflags,scope,index=struct.unpack_from('=BBBBI',data)
                if family!=socket.AF_INET:continue
                attrs={};offset=8
                while offset+4<=len(data):
                    length,k=struct.unpack_from('=HH',data,offset)
                    if length<4 or offset+length>len(data):raise OSError('invalid address attribute')
                    attrs[k]=data[offset+4:offset+length];offset+=(length+3)&~3
                value=attrs.get(2,attrs.get(1))
                if value is not None and len(value)==4:
                    local=ipaddress.IPv4Address(value)
                    if ip==local:return
                    if ip.is_loopback and local.is_loopback and ip in ipaddress.IPv4Network((local,prefix),strict=False):
                        name=socket.if_indextoname(index).encode()
                        with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as control:
                            flags=struct.unpack_from('=H',fcntl.ioctl(control.fileno(),0x8913,struct.pack('256s',name)),16)[0]
                        if flags&8:return

class Transport:
    def __init__(self,address,port,source_port=None,excluded=()):
        self.receiver=None;self.sender=None;check_local_address(address)
        try:
            self.receiver=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);self.receiver.setsockopt(socket.IPPROTO_IP,8,1)
            self.receiver.bind((address,port));self.receiver.setblocking(False)
            self.sender=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
            if source_port is None:
                for _ in range(128):
                    p=49152+secrets.randbelow(16384)
                    if p==port or p in excluded:continue
                    try:self.sender.bind((address,p));break
                    except OSError as error:
                        if error.errno!=98:raise
                else:raise OSError('no free high source port')
            else:self.sender.bind((address,source_port))
            self.source_port=self.sender.getsockname()[1];self.sender.setblocking(False)
        except BaseException:self.close();raise
    def receive(self,sender=False):
        sock=self.sender if sender else self.receiver
        raw,anc,flags,source=sock.recvmsg(65535,socket.CMSG_SPACE(12))
        infos=[]
        for level,kind,data in anc:
            if level==socket.IPPROTO_IP and kind==8 and len(data)>=12:
                idx,spec,dst=struct.unpack('=I4s4s',data[:12]);infos.append((idx,socket.inet_ntoa(dst)))
        return raw,{'source':[source[0],source[1]],'destination':list(sock.getsockname()),'local_destination':infos[0][1] if len(infos)==1 else sock.getsockname()[0],'ifindex':infos[0][0] if len(infos)==1 else None,'truncated_datagram':bool(flags&(socket.MSG_CTRUNC|socket.MSG_TRUNC))}
    def send(self,raw,ip,port):
        if self.sender.sendto(raw,(ip,port))!=len(raw):raise OSError('incomplete UDP submission')
    def close(self):
        for s in (self.receiver,self.sender):
            if s is not None:s.close()
