#!/usr/bin/env python3
import copy
import json
import socket
import threading
import time
import unittest
import struct
from unittest.mock import patch
from types import SimpleNamespace
from vxlan_wire import DEFAULT_CONFIG,MODES,PacketError,canonical_hash,validate_config,decode,make_request,make_reply,fault_bytes,validate_request,check_local_address
from server import Worker
from client import Observer,request_bytes

class ConfigTests(unittest.TestCase):
    def cfg(self):return copy.deepcopy(DEFAULT_CONFIG)
    def test_required_and_unknown(self):
        for key in DEFAULT_CONFIG:
            c=self.cfg();del c[key]
            with self.assertRaises(ValueError):validate_config(c)
        c=self.cfg();c['extra']=1
        with self.assertRaises(ValueError):validate_config(c)
    def test_strict_numbers(self):
        for key in ['port','peer_port','source_port','vni','reply_padding']:
            for value in [True,None,-1]:
                c=self.cfg();c[key]=value
                with self.assertRaises(ValueError):validate_config(c)
    def test_same_ip_endpoints(self):
        c=self.cfg();c['peer_ip']=c['bind_ip'];c['peer_port']=4790;validate_config(c)
        for p in [c['port'],c['source_port']]:
            c['peer_port']=p
            with self.assertRaises(ValueError):validate_config(c)
    def test_mac_canonical_without_input_mutation(self):
        c=self.cfg();c['inner_mac']='02:AA:BB:CC:DD:EE'
        out=validate_config(c);self.assertEqual(out['inner_mac'],'02:aa:bb:cc:dd:ee');self.assertEqual(c['inner_mac'],'02:AA:BB:CC:DD:EE')
        self.assertEqual(canonical_hash(c),canonical_hash(out))
    def test_mac_strictness(self):
        for value in ['00:00:00:00:00:00','01:00:00:00:00:01','02:0:00:00:00:01','02:00:00:00:00:GG',None]:
            c=self.cfg();c['inner_mac']=value
            with self.assertRaises(ValueError):validate_config(c)
    def test_zero_slash8_and_probe(self):
        for key in ['bind_ip','peer_ip','inner_ip','requester_ip']:
            c=self.cfg();c[key]='0.1.2.3'
            with self.assertRaises(ValueError):validate_config(c)
        c=self.cfg();c['requester_ip']='0.0.0.0';validate_config(c)
    def test_vni_boundaries_and_padding(self):
        for n in [0,0xffffff]:
            c=self.cfg();c['vni']=n;validate_config(c)
        for n in [1,17,19]:
            c=self.cfg();c['reply_padding']=n
            with self.assertRaises(ValueError):validate_config(c)
    def test_scenario_exact_shapes(self):
        for mode in MODES:
            c=self.cfg();c['scenario']={'mode':mode};validate_config(c)
            c['scenario']['duration']=1
            with self.assertRaises(ValueError):validate_config(c)
    def test_local_address_netlink_loopback(self):
        check_local_address('127.0.0.2')
        with self.assertRaises(ValueError):check_local_address('192.0.2.254')

class NetlinkBudgetTests(unittest.TestCase):
    class Fake:
        def __init__(self,raw):self.raw=raw;self.reads=0
        def __enter__(self):return self
        def __exit__(self,*args):return None
        def bind(self,*args):pass
        def settimeout(self,*args):pass
        def sendto(self,*args):pass
        def recv(self,*args):self.reads+=1;return self.raw
    def test_abnormal_dump_cannot_slide_absolute_deadline(self):
        fake=self.Fake(struct.pack('=IHHII',16,999,0,7,0));clock=[0.]
        def now():clock[0]+=.1;return clock[0]
        with patch('vxlan_wire.socket.socket',return_value=fake),patch('vxlan_wire.secrets.randbits',return_value=7),patch('vxlan_wire.time.monotonic',side_effect=now):
            with self.assertRaisesRegex(TimeoutError,'absolute deadline'):check_local_address('192.0.2.254')
        self.assertLess(fake.reads,10)
    def test_abnormal_dump_has_total_byte_budget(self):
        fake=self.Fake(struct.pack('=IHHII',16,999,0,7,0)*4096)
        with patch('vxlan_wire.socket.socket',return_value=fake),patch('vxlan_wire.secrets.randbits',return_value=7),patch('vxlan_wire.time.monotonic',return_value=0):
            with self.assertRaisesRegex(OSError,'byte budget'):check_local_address('192.0.2.254')
        self.assertEqual(fake.reads,17)

class WireTests(unittest.TestCase):
    def request(self,**kw):return make_request(DEFAULT_CONFIG,b'\x16\x68\xfe'+bytes(13),**kw)
    def test_known_normal_reply_vector(self):
        wire=make_reply(self.request(),DEFAULT_CONFIG).encode()
        expected='080000000003e80002000000001002000000002008060001080006040002020000000020c6120014020000000010c612000a'
        self.assertEqual(wire.hex(),expected)
    def test_all_truncations(self):
        wire=self.request().encode()
        for n in range(50):
            with self.assertRaises(PacketError):decode(wire[:n])
    def test_reserved_and_request_tha_ignored(self):
        p=self.request(reserved=True,tha=b'\xff'*6);decoded=decode(p.encode())
        validate_request(decoded,('127.0.0.2',1),DEFAULT_CONFIG)
        reply=make_reply(decoded,DEFAULT_CONFIG);self.assertEqual(reply.flags,8);self.assertEqual(reply.reserved,bytes(4));self.assertEqual(reply.target_mac,p.sender_mac)
    def test_request_role_rejections(self):
        raw=bytearray(self.request().encode())
        for pos in [6,13,19,29,35,39,49]:
            bad=bytearray(raw);bad[pos]^=1
            with self.assertRaises(PacketError):validate_request(decode(bad),('127.0.0.2',55000),DEFAULT_CONFIG)
        with self.assertRaises(PacketError):validate_request(self.request(),('127.0.0.3',55000),DEFAULT_CONFIG)
    def test_no_vlan_or_wrong_arp_shape(self):
        wire=bytearray(self.request().encode())
        for pos,value in [(20,0x81),(23,2),(25,1),(26,8),(27,16)]:
            bad=bytearray(wire);bad[pos]=value
            with self.assertRaises(PacketError):decode(bad)
    def test_large_padding_bounded_fields(self):
        raw=self.request().encode()+b'X'*(65507-len(self.request().encode()))
        p=decode(raw);f=p.fields();self.assertEqual(len(raw),65507);self.assertTrue(f['padding']['truncated']);self.assertEqual(len(f['padding']['preview_hex']),256)
    def test_all_fault_bytes(self):
        normal=make_reply(self.request(),DEFAULT_CONFIG).encode()
        positions={'wrong-eth-dst':13,'wrong-sha':35,'wrong-spa':39,'wrong-tha':45,'wrong-tpa':49}
        for mode in MODES:
            c=copy.deepcopy(DEFAULT_CONFIG);c['scenario']['mode']=mode;wire=fault_bytes(normal,c)
            if mode=='silent':self.assertIsNone(wire)
            elif mode=='short-header':self.assertEqual(wire,normal[:7])
            elif mode=='short-arp':self.assertEqual(wire,normal[:49])
            elif mode in positions:self.assertEqual([i for i in range(len(normal)) if wire[i]!=normal[i]],[positions[mode]])
            elif mode=='clear-i':self.assertEqual(wire[0],0);self.assertEqual(wire[1:],normal[1:])
            elif mode=='normal':self.assertEqual(wire,normal)
    def test_vni_wrap_and_short_padding18(self):
        c=copy.deepcopy(DEFAULT_CONFIG);c.update(vni=0xffffff,reply_padding=18);r=make_reply(make_request(c,bytes(16)),c).encode();c['scenario']['mode']='wrong-vni';self.assertEqual(fault_bytes(r,c)[4:7],bytes(3))
        c['scenario']['mode']='short-arp';self.assertEqual(len(r),68);self.assertEqual(len(fault_bytes(r,c)),49)
    def test_independent_client_expected_transforms(self):
        for mode in MODES:
            c=copy.deepcopy(DEFAULT_CONFIG);c['scenario']['mode']=mode
            request,normal,expected,reason=request_bytes(c,'ARP',1)
            self.assertEqual(normal,make_reply(decode(request),c).encode());self.assertEqual(expected,fault_bytes(normal,c))

class BusinessGateTests(unittest.TestCase):
    def worker(self,mode):
        w=object.__new__(Worker);w.cfg=copy.deepcopy(DEFAULT_CONFIG);w.cfg['scenario']['mode']=mode
        w.lock=threading.RLock();w.counters={k:0 for k in ['received','accepted','rejected','tx_actual','normal_replies','suppressed']};w.next_request=1;w.last_valid=None
        self.events=[];self.sent=[];w.event=lambda kind,*args,**data:self.events.append((kind,args,data));w.transport=SimpleNamespace(send=lambda *args:self.sent.append(args));return w
    def meta(self):return {'source':['127.0.0.2',1234],'destination':['127.0.0.1',4789],'local_destination':'127.0.0.1','ifindex':1,'truncated_datagram':False}
    def test_reject_never_sends_or_suppresses(self):
        for mode in MODES:
            w=self.worker(mode);w.process(bytes(12),self.meta())
            self.assertEqual(self.sent,[]);self.assertEqual([r[0] for r in self.events],['rx_rejected']);self.assertEqual(w.counters['accepted'],0)
    def test_silent_has_causal_accepted_and_no_wire(self):
        w=self.worker('silent');raw=make_request(DEFAULT_CONFIG,bytes(16)).encode();w.process(raw,self.meta())
        self.assertEqual(self.sent,[]);self.assertEqual([r[0] for r in self.events],['rx_accepted','tx_suppressed']);self.assertEqual(self.events[0][1],self.events[1][1]);self.assertEqual(w.counters['suppressed'],1)
    def test_fixed_return_not_request_source(self):
        w=self.worker('normal');w.process(make_request(DEFAULT_CONFIG,bytes(16)).encode(),self.meta())
        self.assertEqual(self.sent[0][1:],('127.0.0.2',4789));self.assertEqual(w.counters['normal_replies'],1)

class DeadlineTests(unittest.TestCase):
    def test_client_slow_body_is_absolute(self):
        listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(1);listener.settimeout(2);stop=threading.Event()
        def slow():
            try:
                conn,_=listener.accept()
                with conn:
                    conn.recv(4096);conn.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\n')
                    while not stop.wait(.1):conn.sendall(b' ')
            except OSError:pass
        t=threading.Thread(target=slow,daemon=True);t.start();args=SimpleNamespace(observer_host='127.0.0.1',observer_port=listener.getsockname()[1],expected_boot_id='x',expected_runtime_id='x');start=time.monotonic()
        try:
            with self.assertRaises(TimeoutError):Observer(args,DEFAULT_CONFIG).status(start+3)
            self.assertLess(time.monotonic()-start,1.5)
        finally:stop.set();listener.close();t.join(timeout=2)

if __name__=='__main__':unittest.main()
