"""Bounded MQTT 3.1.1/5 wire primitives for a read-only interoperability probe."""
import hashlib
import ipaddress
import socket
import struct

MAX_PACKET = 1048576
PACKET_NAMES = {1:'CONNECT',2:'CONNACK',3:'PUBLISH',4:'PUBACK',5:'PUBREC',6:'PUBREL',7:'PUBCOMP',8:'SUBSCRIBE',9:'SUBACK',14:'DISCONNECT'}

def validate_config(value):
    if not isinstance(value, dict) or set(value) != {'bind_ip','port','max_connections','max_packet_size'}:
        raise ValueError('config: expected bind_ip, port, max_connections, max_packet_size only')
    if not isinstance(value['bind_ip'],str):
        raise ValueError('bind_ip: expected IPv4 string')
    ip=ipaddress.IPv4Address(value['bind_ip'])
    if ip.is_multicast or int(ip)==0xffffffff:
        raise ValueError('bind_ip: expected unicast/wildcard IPv4')
    for key,low,high in (('port',1,65535),('max_connections',1,128),('max_packet_size',128,MAX_PACKET)):
        if type(value[key]) is not int or not low<=value[key]<=high:
            raise ValueError(f'{key}: expected integer {low}..{high}')
    return dict(value,bind_ip=str(ip))

def varint(value):
    if type(value) is not int or not 0<=value<=268435455:
        raise ValueError('invalid variable byte integer')
    out=bytearray()
    while True:
        digit=value%128;value//=128
        out.append(digit | (128 if value else 0))
        if not value:return bytes(out)

def read_varint(data,at=0):
    value=0
    for i in range(4):
        if at+i>=len(data):raise ValueError('truncated variable byte integer')
        digit=data[at+i];value+=(digit&127)*(128**i)
        if not digit&128:
            if varint(value)!=data[at:at+i+1]:raise ValueError('noncanonical variable byte integer')
            return value,at+i+1
    raise ValueError('oversized variable byte integer')

def utf(value):
    raw=value.encode('utf-8')
    if len(raw)>65535 or '\0' in value:raise ValueError('invalid MQTT UTF-8 string')
    return struct.pack('!H',len(raw))+raw

def read_utf(data,at):
    if at+2>len(data):raise ValueError('truncated MQTT string')
    size=struct.unpack_from('!H',data,at)[0];at+=2
    if at+size>len(data):raise ValueError('truncated MQTT string')
    text=data[at:at+size].decode('utf-8')
    if '\0' in text:raise ValueError('MQTT string contains null')
    return text,at+size

# MQTT 5 property wire encodings, including values a real broker may advertise.
PROP_TYPES={1:'byte',2:'u32',3:'utf',8:'utf',9:'binary',11:'varint',17:'u32',18:'utf',19:'u16',21:'utf',22:'binary',23:'byte',24:'u32',25:'byte',26:'utf',28:'utf',31:'utf',33:'u16',34:'u16',35:'u16',36:'byte',37:'byte',38:'pair',39:'u32',40:'byte',41:'byte',42:'byte'}
def properties(data,at):
    length,at=read_varint(data,at);end=at+length
    if end>len(data):raise ValueError('truncated MQTT properties')
    result=[]
    while at<end:
        if len(result)>=128:raise ValueError('too many MQTT 5 properties')
        key,at=read_varint(data,at);kind=PROP_TYPES.get(key)
        if kind is None:raise ValueError('unknown MQTT 5 property')
        if kind in ('byte','u16','u32'):
            size={'byte':1,'u16':2,'u32':4}[kind]
            if at+size>end:raise ValueError('truncated numeric property')
            value=int.from_bytes(data[at:at+size],'big');at+=size
        elif kind=='varint':value,at=read_varint(data,at)
        elif kind=='utf':value,at=read_utf(data,at)
        elif kind=='pair':
            a,at=read_utf(data,at);b,at=read_utf(data,at);value=[a,b]
        else:
            if at+2>end:raise ValueError('truncated binary property')
            size=int.from_bytes(data[at:at+2],'big');at+=2
            if at+size>end:raise ValueError('truncated binary property')
            value=data[at:at+size][:128].hex();at+=size
        if at>end:raise ValueError('property exceeds declared boundary')
        result.append({'id':key,'value':value})
    return result,end

def packet(header,body=b''):
    result=bytes([header])+varint(len(body))+body
    if len(result)>MAX_PACKET:raise ValueError('outbound packet exceeds hard size limit')
    return result

def preview(data):
    return dict(length=len(data),preview_hex=data[:128].hex(),truncated=len(data)>128,sha256=hashlib.sha256(data).hexdigest())

def recv_exact(sock,size):
    out=bytearray()
    while len(out)<size:
        part=sock.recv(size-len(out))
        if not part:raise ValueError('connection closed before complete MQTT packet')
        out.extend(part)
    return bytes(out)

def receive(sock,limit):
    first=recv_exact(sock,1);encoded=bytearray()
    for _ in range(4):
        encoded.extend(recv_exact(sock,1))
        if not encoded[-1]&128:break
    else:raise ValueError('invalid MQTT Remaining Length')
    length,_=read_varint(encoded)
    if 1+len(encoded)+length>min(limit,MAX_PACKET):raise ValueError('incoming MQTT packet exceeds configured size limit')
    body=recv_exact(sock,length)
    return first[0],body,first+encoded+body

class Session:
    def __init__(self,host,port,version,client_id,limit,role,trace):
        self.sock=socket.create_connection((host,port),timeout=3);self.sock.settimeout(3)
        self.version=version;self.limit=limit;self.role=role;self.trace=trace
        try:
            body=utf('MQTT')+bytes([version,2])+struct.pack('!H',20)+(b'\0' if version==5 else b'')+utf(client_id)
            self.send(0x10,body)
            data=self.expect(2)
            if len(data)<2 or data[:2]!=b'\0\0':raise ValueError('CONNACK did not accept clean anonymous connection')
            if version==5:
                self.connack_properties,end=properties(data,2)
                if end!=len(data):raise ValueError('trailing CONNACK bytes')
            elif len(data)!=2:raise ValueError('invalid MQTT 3.1.1 CONNACK size')
        except BaseException:
            self.sock.close();raise
    def send(self,header,body=b''):
        data=packet(header,body)
        if len(data)>self.limit:raise ValueError('outbound MQTT packet exceeds configured size limit')
        self.sock.sendall(data)
        self.trace.append(dict(role=self.role,direction='send',packet=PACKET_NAMES.get(header>>4,str(header>>4)),flags=header&15,**preview(data)))
    def recv(self):
        header,body,data=receive(self.sock,self.limit)
        self.trace.append(dict(role=self.role,direction='receive',packet=PACKET_NAMES.get(header>>4,str(header>>4)),flags=header&15,**preview(data)))
        return header,body
    def expect(self,kind,flags=0):
        header,body=self.recv()
        if header!=kind*16+flags:raise ValueError(f'expected {PACKET_NAMES.get(kind,kind)} flags {flags}, received type {header>>4} flags {header&15}')
        return body
    def ack(self,kind,ident):
        data=self.expect(kind,2 if kind==6 else 0)
        if len(data)<2 or int.from_bytes(data[:2],'big')!=ident:raise ValueError('acknowledgement packet ID mismatch')
        if self.version==4:
            if len(data)!=2:raise ValueError('invalid MQTT 3.1.1 acknowledgement length')
        elif len(data)>2:
            if data[2]!=0:raise ValueError(f'MQTT 5 negative acknowledgement reason {data[2]}')
            if len(data)>3:
                _,end=properties(data,3)
                if end!=len(data):raise ValueError('trailing acknowledgement bytes')
    def close(self):
        try:self.send(0xe0)
        except OSError:pass
        finally:self.sock.close()
