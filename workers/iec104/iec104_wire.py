"""Independent finite IEC104 APCI/ASDU client. No server protocol implementation."""
import math
import socket
import struct
import time
from iec104_config import preview

class Deadline(Exception):pass

def asdu(kind,cot,ca,ioa,payload=b''):
    return bytes([kind,1,cot,0])+ca.to_bytes(2,'little')+ioa.to_bytes(3,'little')+payload

def decode_asdu(data):
    if len(data)<6:raise ValueError('truncated ASDU header')
    kind,vsq,cause,oa=data[:4];count=vsq&127;ca=int.from_bytes(data[4:6],'little');at=6;objects=[];base=None
    sizes={1:1,13:5,45:1,100:1,102:0,70:1}
    if kind not in sizes:raise ValueError('unexpected ASDU type '+str(kind))
    if not count or (kind not in (1,13) and (vsq&128 or count!=1)):raise ValueError('invalid ASDU SQ/object-count shape')
    for index in range(count):
        if not(vsq&128) or index==0:
            if at+3>len(data):raise ValueError('truncated ASDU IOA')
            base=int.from_bytes(data[at:at+3],'little');at+=3
        ioa=base+index if vsq&128 else base
        if ioa>16777215:raise ValueError('ASDU sequence exceeds IOA range')
        size=sizes[kind]
        if at+size>len(data):raise ValueError('truncated ASDU object')
        raw=data[at:at+size];at+=size;obj=dict(ioa=ioa)
        if kind==1:
            if raw[0]&0x0e:raise ValueError('SIQ reserved bits set')
            obj.update(value=bool(raw[0]&1),quality=raw[0]&0xf0)
        elif kind==13:
            value=struct.unpack('<f',raw[:4])[0]
            if not math.isfinite(value):raise ValueError('nonfinite measured value')
            obj.update(value=value,quality=raw[4])
        elif kind==45:
            if raw[0]&2:raise ValueError('SCO reserved bit set')
            obj.update(value=bool(raw[0]&1),select=bool(raw[0]&128),qualifier=(raw[0]>>2)&31)
        elif kind==100:obj['qoi']=raw[0]
        elif kind==70:obj['coi']=raw[0]
        objects.append(obj)
    if at!=len(data):raise ValueError('ASDU length/object count mismatch')
    return dict(type_id=kind,cot=cause&63,negative=bool(cause&64),test=bool(cause&128),oa=oa,ca=ca,sequence=bool(vsq&128),objects=objects)

class Session:
    def __init__(self,host,port,deadline,trace):
        self.deadline=deadline;self.trace=trace;self.tx=0;self.rx=0;self.acked=0;self.frames=0
        self.sock=socket.create_connection((host,port),timeout=self.timeout());self.sock.settimeout(self.timeout())
        try:self.u(7,11)
        except BaseException:self.sock.close();raise
    def timeout(self):
        remaining=self.deadline-time.monotonic()
        if remaining<=0:raise Deadline('IEC104 operation deadline exceeded')
        return min(3,remaining)
    def recv_exact(self,size):
        out=bytearray()
        while len(out)<size:
            self.sock.settimeout(self.timeout());part=self.sock.recv(size-len(out))
            if not part:raise EOFError('IEC104 connection closed mid-frame')
            out.extend(part)
        return bytes(out)
    def send(self,data,fragment=False):
        if len(self.trace)>=256:raise ValueError('IEC104 trace event limit exceeded')
        self.trace.append(dict(direction='send',**preview(data)))
        self.sock.settimeout(self.timeout())
        if fragment:
            for part in (data[:1],data[1:3],data[3:]):
                if part:self.sock.sendall(part)
        else:self.sock.sendall(data)
    def acknowledge(self,nr):
        if ((nr-self.acked)&32767)>((self.tx-self.acked)&32767):raise ValueError('APCI N(R) acknowledges unsent/out-of-order data')
        self.acked=nr
    def frame(self):
        head=self.recv_exact(2)
        if head[0]!=0x68 or not 4<=head[1]<=253:raise ValueError('invalid IEC104 start/length')
        data=head+self.recv_exact(head[1]);self.frames+=1
        if self.frames>128 or len(self.trace)>=256:raise ValueError('IEC104 frame/event budget exceeded')
        control=data[2:6];event=dict(direction='receive',**preview(data))
        if control[0]&1==0:
            ns=int.from_bytes(control[:2],'little')>>1;nr=int.from_bytes(control[2:],'little')>>1
            if ns!=self.rx or control[2]&1:raise ValueError('APCI I-frame sequence mismatch')
            self.acknowledge(nr);self.rx=(self.rx+1)&32767
            message=decode_asdu(data[6:]);event.update(format='I',ns=ns,nr=nr,asdu=message);self.trace.append(event)
            self.send(b'\x68\4\1\0'+(self.rx<<1).to_bytes(2,'little'))
            if message['negative'] or message['test'] or message['oa']!=0:raise ValueError('ASDU PN/TEST/OA mismatch')
            return 'I',message
        if control[0]==1:
            if len(data)!=6 or control[1]!=0 or control[2]&1:raise ValueError('invalid S-frame')
            nr=int.from_bytes(control[2:],'little')>>1;self.acknowledge(nr);event.update(format='S',nr=nr);self.trace.append(event);return 'S',nr
        if len(data)!=6 or control[1:]!=b'\0\0\0' or control[0] not in (7,11,19,35,67,131):raise ValueError('invalid U-frame')
        event.update(format='U',control=control[0]);self.trace.append(event)
        if control[0]==67:self.send(b'\x68\4\x83\0\0\0')
        return 'U',control[0]
    def u(self,request,response):
        self.send(bytes([0x68,4,request,0,0,0]),True)
        while True:
            kind,value=self.frame()
            if kind=='U' and value==response:return
            if kind=='U' and value!=67:raise ValueError('unexpected U confirmation')
            if kind=='I' and not(value['type_id']==70 and value['cot']==4):raise ValueError('unexpected application data during U transaction')
    def send_i(self,payload):
        if ((self.tx-self.acked)&32767)>=12:raise ValueError('client send window exhausted')
        control=(self.tx<<1).to_bytes(2,'little')+(self.rx<<1).to_bytes(2,'little');self.send(bytes([0x68,4+len(payload)])+control+payload,True);self.tx=(self.tx+1)&32767
    def application(self):
        while True:
            kind,message=self.frame()
            if kind=='I' and not(message['type_id']==70 and message['cot']==4):return message
    def read(self,point,kind):
        self.send_i(asdu(102,5,point['ca'],point['ioa']))
        value=None;got_value=False;got_confirmation=False
        while not (got_value and got_confirmation):
            message=self.application()
            if message['ca']!=point['ca'] or len(message['objects'])!=1:raise ValueError('READ CA/count mismatch')
            obj=message['objects'][0]
            if obj['ioa']!=point['ioa']:raise ValueError('READ IOA mismatch')
            # c104 2.2.1 natively queues monitoring COT5 and separately emits a
            # C_RD_NA_1 ACT_CON7. Require both without assuming scheduling order.
            if message['type_id']==102 and message['cot']==7 and not got_confirmation:
                got_confirmation=True
            elif message['type_id']==kind and message['cot']==5 and not got_value and obj.get('quality')==0:
                value=obj['value'];got_value=True
            else:raise ValueError('READ type/COT/quality or duplicate response mismatch')
        return value
    def gi(self,config):
        snapshots=[]
        for ca in sorted({p['ca'] for p in config['points'].values()}):
            self.send_i(asdu(100,6,ca,0,b'\x14'));first=self.application()
            expected_qoi=[dict(ioa=0,qoi=20)]
            if (first['type_id'],first['cot'],first['ca'],first['objects'])!=(100,7,ca,expected_qoi):raise ValueError('GI ACT_CON mismatch')
            expected={(kind,p['ioa']):p for role,kind in [('single',1),('measured',13)] if (p:=config['points'][role])['ca']==ca};found={}
            while True:
                message=self.application()
                if message['type_id']==100:
                    if (message['cot'],message['ca'],message['objects'])!=(10,ca,expected_qoi):raise ValueError('GI ACT_TERM mismatch')
                    break
                if message['cot']!=20 or message['ca']!=ca:raise ValueError('GI data COT/CA mismatch')
                for obj in message['objects']:
                    key=(message['type_id'],obj['ioa'])
                    if key not in expected or key in found or obj.get('quality')!=0:raise ValueError('GI unexpected/duplicate point or quality')
                    if key[0]==13 and obj['value']!=expected[key]['value']:raise ValueError('GI float32 measured value mismatch')
                    found[key]=obj['value']
            if set(found)!=set(expected):raise ValueError('GI missing configured monitoring points')
            snapshots.append(dict(ca=ca,confirmation=7,termination=10,points=[dict(type_id=k[0],ioa=k[1],value=v) for k,v in sorted(found.items())]))
        return snapshots
    def command(self,point,value):
        self.send_i(asdu(45,6,point['ca'],point['ioa'],bytes([int(value)])))
        message=self.application()
        if (message['type_id'],message['cot'],message['ca'],message['objects'])!=(45,7,point['ca'],[dict(ioa=point['ioa'],value=value,select=False,qualifier=0)]):raise ValueError('single command ACT_CON fields mismatch')
        return message
    def close(self):self.sock.close()
