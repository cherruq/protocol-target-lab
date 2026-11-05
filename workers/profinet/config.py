"""Strict public configuration; runtime native values deliberately use a different policy."""
import hashlib,ipaddress,json,re
PROFILE='pnet-dcp-ptcp-lab-v1'
N_MODES=('good','wrong-seq','bad-tlv','wrong-port','old-seq-first')
F_MODES=('good','wrong-seq','missing-follow-up','bad-tlv','wrong-port','old-seq-first','truncated-follow-up','follow-up-reserved','follow-up-padding','follow-up-duplicate-port','follow-up-bad-end')
METHODS=('DCP_READ','PTCP_N_DELAY','PTCP_F_DELAY','PTCP_SYNC','PTCP_SYNC_FOLLOW_UP','PTCP_ANNOUNCE','ALL','DCP_WRITE_STATION_TEMP','DCP_WRITE_IP_TEMP','DCP_SIGNAL')
STORE='/var/lib/protocol-target-lab/profinet-native';ABI='pnet-v0.2.0-linux-x86_64-v1';CONTEXT='/run/protocol-target-lab/profinet-context.json'
def exact(v,keys):
 if not isinstance(v,dict)or set(v)!=set(keys):raise ValueError('exact required object fields: '+','.join(keys))
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def digest(v):return hashlib.sha256(canonical(v).encode()).hexdigest()
def mac(v):
 if not isinstance(v,str)or not re.fullmatch(r'(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}',v):raise ValueError('six colon hex octets required')
 b=bytes.fromhex(v.replace(':',''))
 if b==bytes(6)or b[0]&1:raise ValueError('nonzero unicast MAC required')
 return v.lower()
def suite(v):
 exact(v,('ip','netmask','gateway'));i,m,g=(ipaddress.IPv4Address(v[k])for k in ('ip','netmask','gateway'))
 if any(str(a)!=v[k]for a,k in zip((i,m,g),('ip','netmask','gateway'))):raise ValueError('canonical dotted IPv4 required')
 if int(i)==int(m)==int(g)==0:return v
 mask=int(m);host=int(i)&(~mask&0xffffffff)
 valid=lambda x:0<int(x)>>24<224 and int(x)>>24!=127
 if not valid(i)or not mask or ((~mask&0xffffffff)+1)&(~mask&0xffffffff)or host in (0,~mask&0xffffffff):raise ValueError('native-valid unicast IP/contiguous host mask required')
 if int(g)and(not valid(g)or int(g)&mask!=int(i)&mask or int(g)&(~mask&0xffffffff)in (0,~mask&0xffffffff)):raise ValueError('gateway must be zero or same-subnet unicast host')
 return v
def station(s):
 if not isinstance(s,str)or not 1<=len(s)<=240:raise ValueError('station initializer length1..240')
 labels=s.split('.')
 if any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?',v)for v in labels)or len(labels)==4 and all(v.isdigit()for v in labels)or re.fullmatch(r'port-\d{3}(?:-\d{5})?',labels[0]):raise ValueError('canonical lowercase station labels, no reserved port/IP form')
 return s
def validate(c):
 exact(c,('wire_profile','link','test_peer_mac','dcp','ptcp_n','ptcp_f'));exact(c['link'],('mode',))
 if c['wire_profile']!=PROFILE or c['link']['mode']!='owned-data-l2':raise ValueError('fixed wire/link profile required')
 exact(c['dcp'],('mac','initial_station_name','initial_ip_suite'));station(c['dcp']['initial_station_name']);suite(c['dcp']['initial_ip_suite'])
 macs=[mac(c['test_peer_mac'])];c['test_peer_mac']=macs[0]
 for name,modes in [('dcp',None),('ptcp_n',N_MODES),('ptcp_f',F_MODES)]:
  n=c[name];n['mac']=mac(n['mac']);macs.append(n['mac'])
  if modes:
   exact(n,('mac','scenario')if name=='ptcp_n'else('mac','scenario','truncated_follow_up_size'));exact(n['scenario'],('mode',))
   if n['scenario']['mode']not in modes:raise ValueError('unsupported PTCP scenario')
 if len(set(macs))!=4:raise ValueError('four distinct MAC roles required')
 size=c['ptcp_f']['truncated_follow_up_size']
 if type(size)is not int or not 16<=size<=45:raise ValueError('truncated follow-up length16..45')
 return c
