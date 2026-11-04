#!/usr/bin/env python3
"""MIT. Finite IPv4 single-hop Control codec and exact-interface UDP transport."""
import hashlib
import ipaddress
import json
import re
import secrets
import socket
import struct
from dataclasses import dataclass

PORT=3784
IP_RECVTTL=12
IP_PKTINFO=8
STATES=('AdminDown','Down','Init','Up')
MODES=('normal','poll','quiet','wrong-your','ttl254','short')
DEFAULT_CONFIG={'wire_profile':'bfd-ipv4-single-hop','bind_ip':'127.0.0.1','peer_ip':'127.0.0.2','interface':'lo','source_port':55028,'local_discriminator':1111901224,'min_tx_us':1000000,'min_rx_us':1000000,'detect_mult':3,'scenario':{'mode':'normal'}}

def canonical_hash(c):
    return hashlib.sha256(json.dumps(c,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()).hexdigest()

def exact(d,keys):
    if type(d) is not dict or set(d)!=set(keys):raise ValueError('required fields: '+','.join(keys))

def integer(v,lo,hi):
    if type(v) is not int or not lo<=v<=hi:raise ValueError(f'integer must be {lo}..{hi}')

def ipv4(v):
    if type(v) is not str:raise ValueError('IPv4 must be text')
    ip=ipaddress.IPv4Address(v)
    if ip.is_unspecified or ip.is_multicast or int(ip)==0xffffffff:raise ValueError('explicit unicast IPv4 required')
    return str(ip)

def validate_config(c):
    exact(c,DEFAULT_CONFIG)
    if c['wire_profile']!='bfd-ipv4-single-hop':raise ValueError('wrong wire_profile')
    for name in ('bind_ip','peer_ip'):ipv4(c[name])
    if c['bind_ip']==c['peer_ip']:raise ValueError('local/peer addresses must differ')
    if type(c['interface']) is not str or not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,14}',c['interface']):raise ValueError('invalid interface name')
    integer(c['source_port'],49152,65535);integer(c['local_discriminator'],1,0xffffffff)
    for key in ('min_tx_us','min_rx_us'):integer(c[key],1000000,0xffffffff)
    integer(c['detect_mult'],1,255)
    s=c['scenario']
    if type(s) is not dict or s.get('mode') not in MODES:raise ValueError('invalid scenario')
    mode=s['mode'];keys=['mode']+(['after_up_ms'] if mode!='normal' else [])+(['duration_ms'] if mode not in ('normal','poll') else [])
    exact(s,keys)
    if mode!='normal':integer(s['after_up_ms'],0,3600000)
    if mode not in ('normal','poll'):integer(s['duration_ms'],1,3600000)
    return c

def load_config(s):return validate_config(json.loads(s))

def interface_addresses(interface):
    """Read Linux RTM_GETADDR; do not add addresses or change routes."""
    index=socket.if_nametoindex(interface);seq=secrets.randbits(31)
    request=struct.pack('=IHHII',24,22,0x301,seq,0)+struct.pack('=BBBBI',socket.AF_INET,0,0,0,0)
    addresses=[]
    with socket.socket(socket.AF_NETLINK,socket.SOCK_RAW,0) as nl:
        nl.settimeout(1);nl.bind((0,0));nl.sendto(request,(0,0))
        while True:
            packet=nl.recv(65536);offset=0
            while offset+16<=len(packet):
                size,kind,flags,number,pid=struct.unpack_from('=IHHII',packet,offset)
                if size<16 or offset+size>len(packet):raise OSError('invalid netlink address reply')
                data=packet[offset+16:offset+size];offset+=(size+3)&~3
                if number!=seq:continue
                if kind==3:return index,addresses
                if kind==2:raise OSError('netlink address query failed')
                if kind!=20 or len(data)<8:continue
                family,prefix,aflags,scope,idx=struct.unpack_from('=BBBBI',data)
                if family!=socket.AF_INET or idx!=index:continue
                attrs={};pos=8
                while pos+4<=len(data):
                    n,k=struct.unpack_from('=HH',data,pos)
                    if n<4 or pos+n>len(data):raise OSError('invalid address attribute')
                    attrs[k]=data[pos+4:pos+n];pos+=(n+3)&~3
                raw=attrs.get(2,attrs.get(1))
                if raw is not None and len(raw)==4:addresses.append((socket.inet_ntoa(raw),prefix))

def check_local(address,interface):
    ipv4(address);index,addresses=interface_addresses(interface)
    ip=ipaddress.IPv4Address(address)
    for local,prefix in addresses:
        if local==address:return index
        if ip.is_loopback and ipaddress.IPv4Address(local).is_loopback and ip in ipaddress.IPv4Network((local,prefix),strict=False):return index
    raise ValueError('address is not present on the selected local interface')

@dataclass(frozen=True)
class Control:
    state:int=1
    diagnostic:int=0
    poll:bool=False
    final:bool=False
    control_independent:bool=False
    detect_mult:int=3
    my_discriminator:int=1
    your_discriminator:int=0
    desired_min_tx_us:int=1000000
    required_min_rx_us:int=1000000
    required_min_echo_rx_us:int=0
    def encode(self):
        flags=self.state<<6|int(self.poll)<<5|int(self.final)<<4|int(self.control_independent)<<3
        return struct.pack('!BBBBIIIII',0x20|self.diagnostic,flags,self.detect_mult,24,self.my_discriminator,self.your_discriminator,self.desired_min_tx_us,self.required_min_rx_us,self.required_min_echo_rx_us)
    def fields(self):
        return {**self.__dict__,'state':STATES[self.state]}

class PacketError(ValueError):pass

def decode(raw):
    if len(raw)<24:raise PacketError('short_control')
    version,flags,mult,length,my,your,tx,rx,echo=struct.unpack('!BBBBIIIII',raw[:24])
    if version>>5!=1:raise PacketError('wrong_version')
    if length<24 or length>len(raw) or length!=24:raise PacketError('invalid_length')
    if mult==0:raise PacketError('zero_detect_mult')
    if flags&1:raise PacketError('multipoint')
    if flags&4:raise PacketError('authentication')
    if flags&2:raise PacketError('unsupported_demand')
    if flags&0x30==0x30:raise PacketError('poll_and_final')
    if my==0:raise PacketError('zero_my_discriminator')
    state=flags>>6
    if your==0 and state not in (0,1):raise PacketError('zero_your_discriminator')
    return Control(state,version&31,bool(flags&32),bool(flags&16),bool(flags&8),mult,my,your,tx,rx,echo)

def wire_summary(raw):
    tail=raw[24:]
    return {'wire_length':len(raw),'raw_sha256':hashlib.sha256(raw).hexdigest(),'raw_hex':raw[:24].hex(),'trailing_length':len(tail),'trailing_sha256':hashlib.sha256(tail).hexdigest(),'trailing_preview_hex':tail[:128].hex(),'trailing_truncated':len(tail)>128}

class Transport:
    def __init__(self,address,interface,source_port=None):
        self.address=address;self.interface=interface;self.ifindex=check_local(address,interface)
        self.receiver=None;self.sender=None
        try:
            self.receiver=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
            self.sender=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
            for sock in (self.receiver,self.sender):sock.setsockopt(socket.SOL_SOCKET,socket.SO_BINDTODEVICE,interface.encode()+b'\0')
            self.receiver.setsockopt(socket.IPPROTO_IP,IP_RECVTTL,1);self.receiver.setsockopt(socket.IPPROTO_IP,IP_PKTINFO,1)
            self.receiver.bind((address,PORT));self.receiver.setblocking(False)
            self.sender.setsockopt(socket.IPPROTO_IP,socket.IP_TTL,255)
            if source_port is None:
                for _ in range(128):
                    p=49152+secrets.randbelow(16384)
                    try:self.sender.bind((address,p));break
                    except OSError as error:
                        if error.errno!=98:raise
                else:raise OSError('no free high source port')
            else:self.sender.bind((address,source_port))
            self.source_port=self.sender.getsockname()[1]
        except BaseException:self.close();raise
    def receive(self):
        raw,anc,flags,source=self.receiver.recvmsg(65535,socket.CMSG_SPACE(4)+socket.CMSG_SPACE(12))
        ttls=[];infos=[]
        for level,kind,data in anc:
            if level==socket.IPPROTO_IP and kind==socket.IP_TTL and len(data)>=4:ttls.append(struct.unpack('=i',data[:4])[0])
            if level==socket.IPPROTO_IP and kind==IP_PKTINFO and len(data)>=12:
                idx,spec,dst=struct.unpack('=I4s4s',data[:12]);infos.append((idx,socket.inet_ntoa(dst)))
        metadata={'source':[source[0],source[1]],'destination':[self.address,PORT],'ttl':ttls[0] if len(ttls)==1 else None,'ifindex':infos[0][0] if len(infos)==1 else None,'local_destination':infos[0][1] if len(infos)==1 else None,'ancillary_truncated':bool(flags&(socket.MSG_CTRUNC|socket.MSG_TRUNC))}
        return raw,metadata
    def validate(self,meta,peer):
        if meta['ancillary_truncated']:raise PacketError('truncated_datagram_or_ancillary')
        if meta['source'][0]!=peer:raise PacketError('wrong_source_ip')
        if not 49152<=meta['source'][1]<=65535:raise PacketError('wrong_source_port')
        if meta['ttl']!=255:raise PacketError('wrong_ttl')
        if meta['ifindex']!=self.ifindex or meta['local_destination']!=self.address:raise PacketError('wrong_interface_or_destination')
    def send(self,raw,peer,ttl=255):
        self.sender.setsockopt(socket.IPPROTO_IP,socket.IP_TTL,ttl)
        n=self.sender.sendto(raw,(peer,PORT))
        if n!=len(raw):raise OSError('incomplete UDP submission')
    def close(self):
        for sock in (self.receiver,self.sender):
            if sock is not None:sock.close()
