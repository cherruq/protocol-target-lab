"""Meaningful strict-config/wire/state boundary tests; real native tests are separate."""
import copy,json,struct,unittest
from config import validate,suite,station,digest
import ptcp
from client import block,parse_dcp,dcp_frame
DEFAULT={'wire_profile':'pnet-dcp-ptcp-lab-v1','link':{'mode':'owned-data-l2'},'test_peer_mac':'02:00:00:00:86:10','dcp':{'mac':'02:00:00:00:86:20','initial_station_name':'protocol-target-lab-profinet','initial_ip_suite':{'ip':'198.18.86.20','netmask':'255.255.255.0','gateway':'0.0.0.0'}},'ptcp_n':{'mac':'02:00:00:00:86:21','scenario':{'mode':'good'}},'ptcp_f':{'mac':'02:00:00:00:86:22','scenario':{'mode':'good'},'truncated_follow_up_size':37}}
class ConfigTests(unittest.TestCase):
 def test_default_and_mac_canonical(self):
  c=copy.deepcopy(DEFAULT);c['dcp']['mac']='02:AA:00:00:86:20';self.assertEqual(validate(c)['dcp']['mac'],'02:aa:00:00:86:20')
 def test_missing_required_and_unknown(self):
  for k in DEFAULT:
   c=copy.deepcopy(DEFAULT);del c[k]
   with self.assertRaises(ValueError):validate(c)
  c=copy.deepcopy(DEFAULT);c['duration']=1
  with self.assertRaises(ValueError):validate(c)
 def test_duplicate_and_multicast_mac(self):
  for m in('00:00:00:00:00:00','01:00:00:00:00:01',DEFAULT['ptcp_f']['mac']):
   c=copy.deepcopy(DEFAULT);c['test_peer_mac']=m
   with self.assertRaises(ValueError):validate(c)
 def test_n_rejects_fu_fault(self):
  c=copy.deepcopy(DEFAULT);c['ptcp_n']['scenario']['mode']='missing-follow-up'
  with self.assertRaises(ValueError):validate(c)
 def test_hidden_truncated_size_always_validated(self):
  for x in(None,True,15,46):
   c=copy.deepcopy(DEFAULT);c['ptcp_f']['truncated_follow_up_size']=x
   with self.assertRaises(ValueError):validate(c)
 def test_station_policy_and_runtime_separation(self):
  for s in('','A','a..b','-a','a-','1.2.3.4','port-001.x','port-001-00001','a.' ):
   with self.assertRaises(ValueError):station(s)
  station('a.port-001');station('a'*63+'.b')
 def test_ip_no_host_31_32_loopback(self):
  for i,m in [('198.18.1.2','255.255.255.254'),('198.18.1.2','255.255.255.255'),('127.1.2.3','255.255.255.0'),('198.18.1.0','255.255.255.0'),('224.1.2.3','255.255.255.0')]:
   with self.assertRaises(ValueError):suite({'ip':i,'netmask':m,'gateway':'0.0.0.0'})
 def test_unconfigured_and_bad_gateway(self):
  suite({'ip':'0.0.0.0','netmask':'0.0.0.0','gateway':'0.0.0.0'})
  for gw in('198.18.2.1','198.18.86.0','198.18.86.255'):
   with self.assertRaises(ValueError):suite({**DEFAULT['dcp']['initial_ip_suite'],'gateway':gw})
 def test_canonical_hash_key_order(self):self.assertEqual(digest(DEFAULT),digest(dict(reversed(list(DEFAULT.items())))))
class WireTests(unittest.TestCase):
 def test_dcp_declared_size_and_padding(self):
  raw=dcp_frame(DEFAULT['test_peer_mac'],DEFAULT['dcp']['mac'],0xfefd,3,42,block(2,2,b'\0\0name'));p=parse_dcp(raw);self.assertEqual(p['blocks'][2,2],b'\0\0name')
  with self.assertRaises(ValueError):parse_dcp(raw[:29])
  with self.assertRaises(ValueError):parse_dcp(raw[:-1]+b'\1')
 def test_dcp_duplicate_block_rejected(self):
  b=block(2,2,b'\0\0x')
  with self.assertRaises(ValueError):parse_dcp(dcp_frame(DEFAULT['test_peer_mac'],DEFAULT['dcp']['mac'],0xfefd,3,42,b+b))
 def req(self):return struct.pack('!6s6sHH12xH2xI',ptcp.mac_bytes(ptcp.GROUPS[0]),ptcp.mac_bytes(DEFAULT['test_peer_mac']),0x8892,0xff40,7,0)+ptcp.encode_tlv(6,ptcp.mac_bytes(DEFAULT['test_peer_mac']))+b'\0\0'
 def test_all_sixteen_mode_combinations_have_actual_outputs(self):
  from config import N_MODES,F_MODES
  for mode in N_MODES:
   r=ptcp.process_frame(self.req(),ptcp.mac_bytes(DEFAULT['ptcp_n']['mac']),ptcp.PeerState(),scenario=mode);self.assertEqual(len(r.frames),2 if mode=='old-seq-first'else 1)
  for mode in F_MODES:
   r=ptcp.process_frame(self.req(),ptcp.mac_bytes(DEFAULT['ptcp_f']['mac']),ptcp.PeerState(),scenario=mode,delay_mode='with-follow-up');self.assertEqual(len(r.frames),1 if mode=='missing-follow-up'else 4 if mode=='old-seq-first'else 2)
 def test_real_requestor_echo_and_software_timestamp(self):
  r=ptcp.process_frame(self.req(),ptcp.mac_bytes(DEFAULT['ptcp_n']['mac']),ptcp.PeerState(),timestamp_ns=0x123456789);f=ptcp.decode_frame(r.frames[0]);self.assertEqual(ptcp.one_block(f,6,6),ptcp.mac_bytes(DEFAULT['test_peer_mac']));self.assertEqual(ptcp.one_block(f,7,6)[2:],bytes.fromhex('23456789'))
 def test_bad_and_duplicate_tlv_not_accepted(self):
  req=self.req()
  for bad in(req[:36]+b'\x0d\xff'+req[38:],req[:44]+req[36:44]+b'\0\0'):
   with self.assertRaises(ValueError):ptcp.process_frame(bad,ptcp.mac_bytes(DEFAULT['ptcp_n']['mac']),ptcp.PeerState())
 def native(self):return {'components':{'dcp':{'current':{'station_name':'live-name','ip_suite':{'ip':'198.18.86.20','netmask':'255.255.255.0','gateway':'0.0.0.0'}},'factory':{'vendor_id':1171,'device_id':2,'device_role':1,'device_options_hex':'01020202','product_name':'Lab'}}}}
 def test_native_get_block_info_is_verified(self):
  from client import Client
  q=Client.__new__(Client);before=self.native();q.check_read({'blocks':{(2,2):b'\0\0live-name'}},'GetStationName',before)
  with self.assertRaises(ValueError):q.check_read({'blocks':{(2,2):b'\0\1live-name'}},'GetStationName',before)
 def test_identify_requires_all_native_property_values(self):
  from client import Client
  q=Client.__new__(Client);before=self.native();good={(2,2):b'\0\0live-name',(1,2):b'\0\1'+bytes.fromhex('c6125614ffffff0000000000'),(2,3):bytes.fromhex('000004930002'),(2,4):b'\0\0\1\0',(2,5):bytes.fromhex('000001020202'),(2,1):b'\0\0Lab'};q.check_read({'blocks':good},'IdentifyAll',before)
  for pair in good:
   bad=dict(good);bad[pair]=bad[pair][:-1]+bytes((bad[pair][-1]^1,))
   with self.assertRaises(ValueError):q.check_read({'blocks':bad},'IdentifyCurrentName',before)
 def test_own_source_ignored(self):self.assertEqual(ptcp.process_frame(self.req(),ptcp.mac_bytes(DEFAULT['test_peer_mac']),ptcp.PeerState()).status,'ignored-own-source')
if __name__=='__main__':unittest.main()
