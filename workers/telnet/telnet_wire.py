"""Strict configuration, bounded byte previews and incremental independent Telnet wire decoding."""
import hashlib
import ipaddress

IAC=255;DONT=254;DO=253;WONT=252;WILL=251;SB=250;SE=240
BINARY=0;SGA=3;TTYPE=24;NAWS=31;TSPEED=32;XDISPLOC=35;NEW_ENVIRON=39
OPTION_NAMES={0:'BINARY',1:'ECHO',3:'SGA',24:'TTYPE',31:'NAWS',32:'TSPEED',35:'XDISPLOC',39:'NEW_ENVIRON'}

def validate_config(value):
    if not isinstance(value,dict) or set(value)!={'bind_ip','port','banner','max_connections','max_line_bytes'}:
        raise ValueError('config: expected bind_ip, port, banner, max_connections, max_line_bytes only')
    if not isinstance(value['bind_ip'],str):raise ValueError('bind_ip: expected IPv4 string')
    ip=ipaddress.IPv4Address(value['bind_ip'])
    if ip.is_multicast or int(ip)==0xffffffff:raise ValueError('bind_ip: expected unicast/wildcard IPv4')
    banner=value['banner']
    if not isinstance(banner,str) or not banner or len(banner.encode('utf-8'))>256 or any(ord(c)<32 or ord(c)==127 for c in banner):
        raise ValueError('banner: expected nonempty UTF-8 <=256 bytes without ASCII controls')
    for key,lo,hi in (('port',1,65535),('max_connections',1,128),('max_line_bytes',64,65536)):
        if type(value[key]) is not int or not lo<=value[key]<=hi:raise ValueError(f'{key}: expected integer {lo}..{hi}')
    return dict(value,bind_ip=str(ip))

def preview(data):
    return dict(length=len(data),preview_hex=data[:128].hex(),truncated=len(data)>128,sha256=hashlib.sha256(data).hexdigest())

def escape(data):return data.replace(b'\xff',b'\xff\xff')
def negotiation(command,option):return bytes([IAC,command,option])
def subnegotiation(option,data):return bytes([IAC,SB,option])+escape(data)+bytes([IAC,SE])

class Decoder:
    """No assumptions about TCP segmentation; SB and decoded data are bounded."""
    def __init__(self):self.state='data';self.command=None;self.option=None;self.sb=bytearray()
    def feed(self,data):
        events=[];plain=bytearray()
        for b in data:
            if self.state=='data':
                if b==IAC:self.state='iac'
                else:plain.append(b)
            elif self.state=='iac':
                if b==IAC:plain.append(IAC);self.state='data'
                elif b in (WILL,WONT,DO,DONT):self.command=b;self.state='option'
                elif b==SB:self.state='sb-option'
                else:events.append(('command',b,None));self.state='data'
            elif self.state=='option':events.append(('negotiation',self.command,b));self.state='data'
            elif self.state=='sb-option':self.option=b;self.sb.clear();self.state='sb'
            elif self.state=='sb':
                if b==IAC:self.state='sb-iac'
                else:self.sb.append(b)
            elif self.state=='sb-iac':
                if b==SE:events.append(('subnegotiation',self.option,bytes(self.sb)));self.sb.clear();self.state='data'
                elif b==IAC:self.sb.append(IAC);self.state='sb'
                else:raise ValueError('malformed IAC inside subnegotiation')
            if len(self.sb)>8192:raise ValueError('Telnet subnegotiation exceeds client bound')
        return bytes(plain),events

class SubnegotiationBudget:
    """A resource guard only: leave interpretation and all replies to telnetlib3."""
    def __init__(self,limit=65536):self.limit=limit;self.state='data';self.count=0
    def feed(self,data):
        for byte in data:
            if self.state=='data':
                if byte==IAC:self.state='iac'
            elif self.state=='iac':
                if byte==SB:self.state='sb';self.count=0
                elif byte in (DO,DONT,WILL,WONT):self.state='option'
                else:self.state='data'
            elif self.state=='option':self.state='data'
            elif self.state=='sb':
                self.count+=1
                if byte==IAC:self.state='sb-iac'
            elif self.state=='sb-iac':
                if byte==SE:
                    if self.count==1:raise ValueError('empty Telnet subnegotiation')
                    self.state='data';self.count=0
                else:
                    self.count+=1;self.state='sb'
            if self.count>self.limit:raise ValueError('unfinished Telnet subnegotiation exceeds 65536-byte budget')
