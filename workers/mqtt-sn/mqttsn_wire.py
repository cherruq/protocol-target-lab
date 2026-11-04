"""Finite MQTT-SN config and independent UDP wire/client helpers."""
import fcntl
import hashlib
import ipaddress
import socket
import struct
import time

NORMAL_ID='plab-sn-normal';PREDEFINED_ID='plab-sn-predef'
class Deadline(Exception):pass

def validate_config(value):
    keys={'bind_ip','port','discovery_group','discovery_port','gateway_id','broker_host','broker_port','predefined_topics'}
    if not isinstance(value,dict) or set(value)!=keys:raise ValueError('config: unexpected or missing fields')
    if value['bind_ip']!='0.0.0.0' or value['broker_host']!='127.0.0.1':raise ValueError('bind_ip must be 0.0.0.0; private broker_host must be 127.0.0.1')
    for key,lo,hi in [('port',1,65535),('discovery_port',1,65535),('gateway_id',1,255),('broker_port',1,65535)]:
        if type(value[key]) is not int or not lo<=value[key]<=hi:raise ValueError(f'{key}: expected integer {lo}..{hi}')
    if value['port']==value['discovery_port']:raise ValueError('UDP and discovery ports must differ')
    if not isinstance(value['discovery_group'],str) or not ipaddress.IPv4Address(value['discovery_group']).is_multicast:raise ValueError('discovery_group: expected IPv4 multicast')
    topics=value['predefined_topics']
    if not isinstance(topics,list) or not 1<=len(topics)<=16:raise ValueError('predefined_topics: expected 1..16 mappings')
    ids=set();names=set()
    for entry in topics:
        if not isinstance(entry,dict) or set(entry)!={'topic_id','topic'}:raise ValueError('predefined topic: expected topic_id and topic')
        ident=entry['topic_id'];name=entry['topic']
        if type(ident) is not int or not 1<=ident<=65534:raise ValueError('topic_id: expected integer 1..65534')
        if not isinstance(name,str) or not 1<=len(name)<=128 or any(not 33<=ord(c)<=126 or c in ',+#' for c in name):raise ValueError('topic: expected visible ASCII 1..128 without comma,+,#')
        if name.startswith('$'):raise ValueError('topic: leading $ is outside this laboratory configuration subset')
        if name=='plab/test' or name.startswith('plab/test/'):raise ValueError('topic: plab/test namespace is reserved for normal registration tests')
        if ident in ids or name in names:raise ValueError('predefined topics: duplicate id/name')
        ids.add(ident);names.add(name)
    return value

def preview(data):return dict(length=len(data),preview_hex=data[:128].hex(),truncated=len(data)>128,sha256=hashlib.sha256(data).hexdigest())
def packet(kind,body=b''):
    size=len(body)+2
    result=bytes([size,kind])+body if size<=255 else b'\1'+(len(body)+4).to_bytes(2,'big')+bytes([kind])+body
    if len(result)>1024:raise ValueError('MQTT-SN packet exceeds native 1024-byte limit')
    return result

def decode(data):
    if len(data)<2 or len(data)>1024:raise ValueError('invalid MQTT-SN packet size')
    if data[0]==1:
        if len(data)<4 or int.from_bytes(data[1:3],'big')!=len(data):raise ValueError('invalid extended MQTT-SN length')
        return data[3],data[4:]
    if data[0]!=len(data):raise ValueError('MQTT-SN datagram length mismatch')
    return data[1],data[2:]

def timeout(deadline):
    remaining=deadline-time.monotonic()
    if remaining<=0:raise Deadline('MQTT-SN overall deadline exceeded')
    return min(3,remaining)

class Trace(list):
    def append(self,entry):
        if len(self)>=512:raise ValueError('MQTT-SN trace event budget exceeded')
        super().append(dict(index=len(self),protocol=entry.pop('protocol','MQTT3.1.1'),**entry))

class Session:
    def __init__(self,host,port,client_id,deadline,trace,used_ports):
        self.deadline=deadline;self.trace=trace;self.client_id=client_id;self.closed=False
        for _ in range(16):
            self.sock=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);self.sock.bind(('0.0.0.0',0))
            self.source_port=self.sock.getsockname()[1]
            if self.source_port not in used_ports:break
            self.sock.close()
        else:raise ValueError('could not allocate a fresh UDP source port')
        used_ports.add(self.source_port);self.sock.connect((host,port))
        try:self.send(4,b'\4\1\0\x14'+client_id.encode('ascii'));self.expect(5,b'\0')
        except BaseException:self.sock.close();raise
    def send(self,kind,body=b''):
        data=packet(kind,body);self.trace.append(dict(protocol='MQTT-SN',transport='UDP',direction='send',type_id=kind,source_port=self.source_port,**preview(data)))
        self.sock.settimeout(timeout(self.deadline));self.sock.send(data)
    def expect(self,kind,expected=None):
        self.sock.settimeout(timeout(self.deadline));data,_,flags,peer=self.sock.recvmsg(2048)
        if flags&socket.MSG_TRUNC:raise ValueError('truncated MQTT-SN datagram')
        actual,body=decode(data);self.trace.append(dict(protocol='MQTT-SN',transport='UDP',direction='receive',type_id=actual,source=list(peer),**preview(data)))
        if actual!=kind or expected is not None and body!=expected:raise ValueError('MQTT-SN reply type/fields mismatch')
        return body
    def register(self,topic,msg_id):
        self.send(10,b'\0\0'+msg_id.to_bytes(2,'big')+topic.encode('ascii'));body=self.expect(11)
        if len(body)!=5 or body[2:4]!=msg_id.to_bytes(2,'big') or body[4]!=0:raise ValueError('REGACK MsgId/return_code mismatch')
        ident=int.from_bytes(body[:2],'big')
        if not 1<=ident<=65534:raise ValueError('REGACK assigned invalid/reserved topic id')
        return ident
    def publish(self,ident,payload,msg_id,predefined=False):
        self.send(12,bytes([0x21 if predefined else 0x20])+ident.to_bytes(2,'big')+msg_id.to_bytes(2,'big')+payload)
        expected=ident.to_bytes(2,'big')+msg_id.to_bytes(2,'big')+b'\0';self.expect(13,expected)
    def disconnect(self):self.send(24);self.expect(24,b'');self.closed=True
    def close(self):self.sock.close()

def local_addresses(group,port):
    ips={'127.0.0.1'}
    with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as s:
        for _,name in socket.if_nameindex():
            try:ips.add(socket.inet_ntoa(fcntl.ioctl(s.fileno(),0x8915,struct.pack('256s',name.encode()[:15]))[20:24]))
            except OSError:pass
        try:s.connect((group,port));ips.add(s.getsockname()[0])
        except OSError:pass
    return ips

def route_source_ipv4(target,port):
    # UDP connect performs route selection without transmitting a datagram.
    with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as route:
        route.connect((target,port))
        return route.getsockname()[0]

def discovery_membership(target,config,local_ips):
    local_target=target in local_ips or ipaddress.IPv4Address(target).is_loopback
    # Paho sends local multicast using its default group route. A remote
    # gateway's multicast arrives on the interface used to reach that gateway,
    # which may differ from this client's multicast default route (e.g. VPN).
    destination=(config['discovery_group'],config['discovery_port']) if local_target else (target,config['port'])
    interface=route_source_ipv4(*destination)
    return interface,local_ips if local_target else {target}

def discovery(host,config,deadline,trace):
    target=socket.gethostbyname(host);locals=local_addresses(config['discovery_group'],config['discovery_port'])
    membership_interface,allowed=discovery_membership(target,config,locals)
    phase_deadline=min(deadline,time.monotonic()+3)
    with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as receiver,socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as sender:
        receiver.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
        receiver.setsockopt(socket.IPPROTO_IP,49,0)  # Linux IP_MULTICAST_ALL: only our membership.
        receiver.setsockopt(socket.IPPROTO_IP,8,1)  # Linux IP_PKTINFO: verify actual multicast destination.
        receiver.bind(('0.0.0.0',config['discovery_port']))
        receiver.setsockopt(socket.IPPROTO_IP,socket.IP_ADD_MEMBERSHIP,socket.inet_aton(config['discovery_group'])+socket.inet_aton(membership_interface))
        receiver.setblocking(False)
        for _ in range(64):
            try:receiver.recvmsg(2048,128)
            except BlockingIOError:break
        query=packet(1,b'\1');queries_sent=0;received=0;next_query_at=0
        while received<64:
            now=time.monotonic()
            if now>=phase_deadline:raise ValueError('no matching GWINFO before absolute discovery deadline')
            if queries_sent<6 and now>=next_query_at:
                sender.settimeout(timeout(phase_deadline));sender.sendto(query,(target,config['port']));queries_sent+=1
                trace.append(dict(protocol='MQTT-SN',transport='UDP',direction='send',type_id=1,target=[target,config['port']],membership_interface_ipv4=membership_interface,query_number=queries_sent,**preview(query)))
                next_query_at=time.monotonic()+0.5
            wake_at=min(phase_deadline,next_query_at) if queries_sent<6 else phase_deadline
            wait=wake_at-time.monotonic()
            if wait<=0:continue
            receiver.settimeout(wait)
            try:data,ancillary,flags,source=receiver.recvmsg(2048,128)
            except socket.timeout:continue
            received+=1
            if time.monotonic()>=phase_deadline:raise ValueError('no matching GWINFO before absolute discovery deadline')
            if source[0] not in allowed or source[1]!=config['port']:continue
            destination=None;interface=None
            for level,kind,control in ancillary:
                if level==socket.IPPROTO_IP and kind==8 and len(control)>=12:
                    interface,_,address=struct.unpack('=I4s4s',control[:12]);destination=socket.inet_ntoa(address)
            if destination!=config['discovery_group']:continue
            kind,body=decode(data)
            if kind!=2:continue
            trace.append(dict(protocol='MQTT-SN',transport='UDP',direction='receive',type_id=kind,source=list(source),destination=destination,interface_index=interface,**preview(data)))
            if flags&socket.MSG_TRUNC or body!=bytes([config['gateway_id']]):raise ValueError('GWINFO length/id mismatch')
            return dict(gateway_id=body[0],source=list(source),destination=destination,interface_index=interface,membership_interface_ipv4=membership_interface,queries_sent=queries_sent,allowed_source_ips=sorted(allowed))
        raise ValueError('no matching GWINFO within packet budget')
