"""Bounded typed Linux rtnetlink operations on this container's new data devices only."""
import errno,ipaddress,json,os,pathlib,socket,struct,time
AF=socket.AF_INET

def attr(k,v):return struct.pack('HH',len(v)+4,k)+v+b'\0'*((-len(v)-4)%4)
def attrs(b):
 out={};off=0
 while off<len(b):
  if len(b)-off<4:raise ValueError('partial netlink attribute')
  n,k=struct.unpack_from('HH',b,off)
  if n<4 or off+n>len(b):raise ValueError('invalid netlink attribute')
  out[k&0x3fff]=b[off+4:off+n];off+=(n+3)&~3
 return out

def request(kind,payload,flags=0x301):
 seq=time.monotonic_ns()&0xffffffff;deadline=time.monotonic()+1;out=[];budget=0
 with socket.socket(socket.AF_NETLINK,socket.SOCK_RAW,socket.NETLINK_ROUTE)as s:
  s.bind((0,0));s.send(struct.pack('IHHII',16+len(payload),kind,flags,seq,0)+payload)
  while time.monotonic()<deadline:
   s.settimeout(max(.001,deadline-time.monotonic()));data=s.recv(262144);budget+=len(data)
   if budget>2097152:raise ValueError('netlink dump budget')
   off=0
   while off<len(data):
    if len(data)-off<16:raise ValueError('partial netlink header')
    n,k,f,q,p=struct.unpack_from('IHHII',data,off)
    if n<16 or off+n>len(data)or f&0x10:raise ValueError('invalid/interrupted netlink dump')
    b=data[off+16:off+n];off+=(n+3)&~3
    if q!=seq:raise ValueError('unexpected netlink sequence')
    if k==2:
     e=struct.unpack_from('i',b)[0]
     if e:raise OSError(-e,os.strerror(-e))
     return out
    if k==3:
     if b and(len(b)<4 or struct.unpack_from('i',b)[0]):raise ValueError('failed netlink DONE')
     return out
    out.append((k,b))
    if len(out)>16384:raise ValueError('netlink row budget')
 raise TimeoutError('netlink absolute deadline')

def addresses():
 rows=[]
 for _,b in request(22,struct.pack('BBBBI',AF,0,0,0,0)):
  family,prefix,flags,scope,index=struct.unpack_from('BBBBI',b);a=attrs(b[8:]);raw=a.get(2,a.get(1))
  if family==AF and raw and len(raw)==4:rows.append({'ifindex':index,'address':socket.inet_ntoa(raw),'prefixlen':prefix,'scope':scope})
 return rows

def interfaces():
 ips=addresses();rows=[];namespace=os.readlink('/proc/self/ns/net')
 for index,name in socket.if_nameindex():
  p=pathlib.Path('/sys/class/net')/name
  rows.append({'name':name,'ifindex':index,'mac':(p/'address').read_text().strip(),'hardware_type':int((p/'type').read_text()),'mtu':int((p/'mtu').read_text()),'ipv4':[{k:v for k,v in a.items()if k in ('address','prefixlen')}for a in ips if a['ifindex']==index],'iflink':int((p/'iflink').read_text()),'namespace':namespace})
 return rows

def routes():
 rows=[]
 for _,b in request(26,struct.pack('BBBBBBBBI',AF,0,0,0,0,0,0,0,0)):
  fam,dstlen,srclen,tos,table,proto,scope,typ,flags=struct.unpack_from('BBBBBBBBI',b);a=attrs(b[12:])
  if fam!=AF:continue
  rows.append({'dst':socket.inet_ntoa(a.get(1,b'\0'*4)),'prefixlen':dstlen,'gateway':socket.inet_ntoa(a[5])if 5 in a else None,'ifindex':struct.unpack('I',a[4])[0]if 4 in a else None,'table':struct.unpack('I',a[15])[0]if 15 in a else table,'protocol':proto,'scope':scope,'type':typ,'flags':flags})
 return sorted(rows,key=lambda x:json.dumps(x,sort_keys=True))

def set_up(index):request(16,struct.pack('BBHiII',0,0,0,index,1,1),5)
def rename(index,name):request(16,struct.pack('BBHiII',0,0,0,index,0,0)+attr(3,name.encode()+b'\0'),5)
def macvlan(parent,name,mac):
 info=attr(1,b'macvlan\0')+attr(2,attr(1,struct.pack('I',4)))
 request(16,struct.pack('BBHiII',0,0,0,0,0,0)+attr(3,name.encode()+b'\0')+attr(5,struct.pack('I',parent))+attr(1,bytes.fromhex(mac.replace(':','')))+attr(18,info),0x605)
 set_up(socket.if_nametoindex(name))

def address_change(index,address,prefix,add):
 request(20 if add else 21,struct.pack('BBBBI',AF,prefix,0,0,index)+attr(1,socket.inet_aton(address))+attr(2,socket.inet_aton(address)),0x605 if add else 5)
def default_change(index,gateway,add):
 request(24 if add else 25,struct.pack('BBBBBBBBI',AF,0,0,0,254,3,0,1,0)+attr(4,struct.pack('I',index))+attr(5,socket.inet_aton(gateway)),0x605 if add else 5)

def assert_no_management_overlap(ip_suite,management):
 if ip_suite['ip']=='0.0.0.0':return
 n=ipaddress.IPv4Network((ip_suite['ip'],ip_suite['netmask']),strict=False)
 for a in management['ipv4']:
  if n.overlaps(ipaddress.IPv4Network((a['address'],a['prefixlen']),strict=False)):raise ValueError('native data suite overlaps actual management network')
