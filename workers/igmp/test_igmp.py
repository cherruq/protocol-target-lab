"""MIT. Protocol boundaries, exact memberships and conservative timer fixtures."""
import copy
import io
import json
import socket
import struct
import time
import unittest
from unittest import mock
import igmp_wire as w

class ConfigTests(unittest.TestCase):
    def setUp(self):self.c=copy.deepcopy(w.DEFAULT_CONFIG)
    def test_default(self):self.assertEqual(w.validate_config(self.c),self.c)
    def test_required_unknown(self):
        for key in self.c:
            c=copy.deepcopy(self.c);del c[key]
            with self.subTest(key=key),self.assertRaises(ValueError):w.validate_config(c)
        self.c['port']=0
        with self.assertRaises(ValueError):w.validate_config(self.c)
    def test_group_bounds_duplicates(self):
        for groups in ([],['224.0.0.1'],['239.1.2.3']*2,['239.1.2.3']*17,[None]):
            self.c['groups']=groups
            with self.subTest(groups=groups),self.assertRaises((ValueError,TypeError)):w.validate_config(self.c)
    def test_constant_query_not_bool(self):
        for profile in ({'version':True,'max_response_code':100},{'version':2,'max_response_code':99}):
            self.c['query_profile']=profile
            with self.assertRaises(ValueError):w.validate_config(self.c)
    def test_host_required_nullable_peer(self):
        self.c['link']={'mode':'host-interface','interface':'eth0','interface_ip':'192.0.2.20','peer_interface':None};w.validate_config(self.c);del self.c['link']['peer_interface']
        with self.assertRaises(ValueError):w.validate_config(self.c)
    def test_same_host_iface_rejected(self):
        self.c['link']={'mode':'host-interface','interface':'eth0','interface_ip':'192.0.2.20','peer_interface':'eth0'}
        with self.assertRaises(ValueError):w.validate_config(self.c)
    def test_group_order_preserved_and_mac_aliases_dedupable(self):
        self.c['groups']=['239.129.2.3','239.1.2.3'];self.assertEqual(w.validate_config(self.c)['groups'],self.c['groups']);self.assertEqual(w.group_mac(self.c['groups'][0]),w.group_mac(self.c['groups'][1]))

class WarmupTests(unittest.TestCase):
    def p(self,qrv=2,force=2,allforce=0):return {'sysctl_qrv':qrv,'interface_force':force,'all_force':allforce,'v2_unsolicited_interval_ms':10000,'v3_unsolicited_interval_ms':1000}
    def test_default_includes_rounding_margin(self):self.assertEqual(w.warmup_bound(self.p())['startup_upper_ms'],13000)
    def test_qrv3_two_repeat_intervals(self):self.assertEqual(w.warmup_bound(self.p(3))['startup_upper_ms'],24000)
    def test_auto_uses_upper_not_unknown_effective_qrv(self):
        b=w.warmup_bound(self.p(force=0));self.assertEqual(b['sysctl_qrv_at_join'],2);self.assertEqual(b['qrv_upper_bound_at_join'],7);self.assertEqual(b['startup_upper_ms'],68000)
    def test_allforce_complex_uses_conservative7(self):self.assertEqual(w.warmup_bound(self.p(allforce=1))['qrv_upper_bound_at_join'],7)
    def test_qrv1_has_initial_margin(self):self.assertEqual(w.warmup_bound(self.p(1))['startup_upper_ms'],2000)
    def test_large_qrv_stays_runtime_valid_but_test_budget_too_large(self):self.assertGreater(w.warmup_bound(self.p(10))['startup_upper_ms']+48000+10000,90000)

class ProcTests(unittest.TestCase):
    def test_long_and_short_names_real_ref(self):
        for name,header in [('plig1234567890','24 plig1234567890: 2 V2'),('eth0','24 eth0       : 2 V2')]:
            raw='Idx Device : Count Querier\n'+header+'\n 010000E0 1 0:00000000 0\n 0113C0EF 1 0:00000000 1\n'
            with self.subTest(name=name),mock.patch('builtins.open',return_value=io.StringIO(raw)):self.assertEqual(w.proc_groups(name)['239.192.19.1']['users'],1)

class WireTests(unittest.TestCase):
    def setUp(self):self.interface={'mac':'02:00:00:00:19:10','primary_ipv4':'192.0.2.10'};self.frame=w.query_frame(self.interface,None,0x1234)
    def test_general_canonical_packet(self):
        p=w.decode(self.frame,[],0);self.assertEqual(p['group'],'0.0.0.0');self.assertEqual(p['destination_ip'],'224.0.0.1');self.assertEqual(p['ttl'],1);self.assertTrue(p['router_alert']);self.assertEqual(p['ipv4_id'],0x1234);self.assertEqual(p['igmp_type'],0x11);self.assertEqual(p['max_response_code'],100)
    def test_group_specific(self):self.assertEqual(w.decode(w.query_frame(self.interface,'239.192.19.1',1),[],0)['destination_ip'],'239.192.19.1')
    def test_ethernet_padding_does_not_change_canonical_ip(self):self.assertEqual(w.decode(self.frame,[],0)['ipv4']['sha256'],w.decode(self.frame+bytes(18),[],0)['ipv4']['sha256'])
    def test_bad_ipv4_checksum(self):
        raw=bytearray(self.frame);raw[24]^=1
        with self.assertRaises(w.PacketError):w.decode(bytes(raw),[],0)
    def test_bad_igmp_checksum(self):
        raw=bytearray(self.frame);raw[-1]^=1
        with self.assertRaises(w.PacketError):w.decode(bytes(raw),[],0)
    def test_bad_length(self):
        for raw in (self.frame[:13],self.frame[:-1]):
            with self.assertRaises(w.PacketError):w.decode(raw,[],0)
    def test_fragment_before_checksum(self):
        raw=bytearray(self.frame);raw[20]|=0x20
        with self.assertRaises(w.PacketError):w.decode(bytes(raw),[],0)
    def test_truncated_capture(self):
        for flag in (socket.MSG_TRUNC,socket.MSG_CTRUNC):
            with self.assertRaises(w.PacketError):w.decode(self.frame,[],flag)
    def test_router_alert_invalid_value(self):
        raw=bytearray(self.frame);raw[37]=1;raw[24:26]=b'\0\0';raw[24:26]=struct.pack('!H',w.checksum(bytes(raw[14:38])))
        with self.assertRaises(w.PacketError):w.decode(bytes(raw),[],0)

class FakeNetlink:
    def __init__(self,flag=0,error=0,trailing=b''):self.flag=flag;self.error=error;self.trailing=trailing
    def __enter__(self):return self
    def __exit__(self,*a):pass
    def bind(self,*a):pass
    def send(self,data):self.seq=struct.unpack_from('IHHII',data)[3]
    def settimeout(self,*a):pass
    def recvmsg(self,*a):return (struct.pack('IHHIIi',20,3,self.flag,self.seq,0,self.error)+self.trailing,[],0,(0,0))
class AddressDumpTests(unittest.TestCase):
    def call(self,**kw):
        with mock.patch.object(w.socket,'socket',return_value=FakeNetlink(**kw)):return w.ipv4_addresses()
    def test_complete_empty(self):self.assertEqual(self.call(),[])
    def test_interrupted_not_a_complete_address_set(self):
        with self.assertRaises(ValueError):self.call(flag=0x10)
    def test_error_done(self):
        with self.assertRaises(ValueError):self.call(error=-4)
    def test_misaligned_trailer(self):
        with self.assertRaises(ValueError):self.call(trailing=b'x')

if __name__=='__main__':unittest.main()

class NativeReportVersionTests(unittest.TestCase):
    def report(self,kind,group='239.192.19.1'):
        destination='224.0.0.22' if kind==0x22 else group
        if kind==0x22:payload=bytes.fromhex('2200000000000001')+struct.pack('!BBH4s',4,0,0,socket.inet_aton(group))
        else:payload=struct.pack('!BBH4s',kind,0,0,socket.inet_aton(group))
        payload=payload[:2]+struct.pack('!H',w.checksum(payload))+payload[4:]
        header=struct.pack('!BBHHHBBH4s4s4s',0x46,192,24+len(payload),0,0x4000,1,2,0,socket.inet_aton('192.0.2.20'),socket.inet_aton(destination),bytes.fromhex('94040000'));header=header[:10]+struct.pack('!H',w.checksum(header))+header[12:]
        return w.group_mac(destination)+w.mac('02:00:00:00:19:20')+b'\x08\x00'+header+payload
    def receive(self,kind,group='239.192.19.1'):
        from client import Client
        import argparse
        args=argparse.Namespace(target_ip='192.0.2.20',target_mac='02:00:00:00:19:20',test_run_id=None)
        c=Client(args,w.DEFAULT_CONFIG);c.cap=mock.Mock();c.cap.receive.return_value=(self.report(kind,group),[],0,{'packet_type':0});return c.receive()
    def test_v1_v2_v3_are_observable_prequery(self):
        for kind,version in ((0x12,1),(0x16,2),(0x22,3)):
            with self.subTest(kind=kind):self.assertEqual(self.receive(kind)['decoded']['igmp_version'],version)
    def test_v3_requires_configured_intersection(self):self.assertIsNone(self.receive(0x22,'239.192.19.2'))
    def test_v3_wrong_destination_not_accepted(self):
        raw=self.report(0x22);self.assertEqual(w.decode(raw,[],0,['239.192.19.1'])['matching_configured_groups'],['239.192.19.1'])
    def test_deep_v3_intersection_not_lost_to_summary(self):
        records=b''.join(struct.pack('!BBH4s',4,0,0,socket.inet_aton('239.192.20.'+str(i))) for i in range(1,18))+struct.pack('!BBH4s',4,0,0,socket.inet_aton('239.192.19.1'));payload=struct.pack('!BBHHH',0x22,0,0,0,18)+records;payload=payload[:2]+struct.pack('!H',w.checksum(payload))+payload[4:];base=self.report(0x22);header=bytearray(base[14:38]);header[2:4]=struct.pack('!H',24+len(payload));header[10:12]=b'\0\0';header[10:12]=struct.pack('!H',w.checksum(bytes(header)));p=w.decode(base[:14]+bytes(header)+payload,[],0,['239.192.19.1']);self.assertTrue(p['groups_truncated']);self.assertEqual(p['matching_configured_groups'],['239.192.19.1'])
