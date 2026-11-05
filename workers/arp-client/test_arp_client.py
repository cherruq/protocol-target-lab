"""MIT. Fixed parser, role, state and resource-bound regressions without networking."""
from collections import deque
import copy
import contextlib
import io
import json
import queue
import socket
import threading
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import arp_wire as a
from server import Worker
from client import matched_request,response_bytes,expected_request,run_check,peer_role_ips,main as client_main

class FakeTransport:
    interface={'name':'eth0','ifindex':7,'hardware_type':1,'mac':a.DEFAULT_CONFIG['source_mac']}
    def __init__(self):self.sent=[]
    def send(self,raw):self.sent.append(raw)
    def proof(self):return {'name':'arp-rarp-ethertype-v1','instructions':a.FILTER,'sha256':a.filter_hash(a.FILTER),'attached':True,'packet_socket_inode':123}

def worker(config=None):
    w=Worker.__new__(Worker);w.cfg=copy.deepcopy(config or a.DEFAULT_CONFIG);w.runtime='a'*32;w.boot='boot';w.born=10.;w.heartbeat=10.;w.lock=threading.RLock();w.ready=True;w.events=deque(maxlen=256);w.next_id=1;w.next_query=1;w.evictions=0;w.pending=None;w.retry=0;w.next_send=10.;w.last_mapping=None;w.transport=FakeTransport();w.logs=queue.Queue(256);w.counters={k:0 for k in ('queries_sent','resolved','timeouts','negative_silent','unexpected_responses','observed_frames','incoming_frames','rejected_frames','ignored_control','ignored_outgoing','log_dropped')};return w

def meta(raw,**changes):
    m={'interface':'eth0','ifindex':7,'packet_type':0,'hardware_type':1,'hardware_address':a.mac_text(raw[6:12]),'protocol':0x0806,'truncated':False};m.update(changes);return m

def tick(w,t):
    with patch('server.time.monotonic',return_value=t):w.tick(t)

def process(w,raw,t=10.1,**changes):
    with patch('server.time.monotonic',return_value=t):w.process(raw,meta(raw,**changes),t)

class Tests(unittest.TestCase):
    def test_01_required_literal_and_fields(self):
        for key in a.DEFAULT_CONFIG:
            c=copy.deepcopy(a.DEFAULT_CONFIG);c.pop(key)
            with self.assertRaises(ValueError):a.validate_config(c)
        c=copy.deepcopy(a.DEFAULT_CONFIG);c['wire_profile']='other'
        with self.assertRaises(ValueError):a.validate_config(c)
    def test_02_unknown_null_types_ranges(self):
        for key,value in [('extra',1),('source_ip',None),('interval_ms',True),('timeout_ms',60001),('retries',11)]:
            c=copy.deepcopy(a.DEFAULT_CONFIG);c[key]=value
            with self.assertRaises((ValueError,TypeError)):a.validate_config(c)
    def test_03_mac_canonical_and_roles(self):
        c=copy.deepcopy(a.DEFAULT_CONFIG);c['source_mac']='02:AB:CD:EF:01:10';self.assertEqual(a.validate_config(c)['source_mac'],'02:ab:cd:ef:01:10')
        for v in ['00:00:00:00:00:00','ff:ff:ff:ff:ff:ff','02:0:00:00:00:10']:
            with self.assertRaises(ValueError):a.mac(v)
    def test_04_ip_and_assignment_roles(self):
        for v in ['0.1.2.3','224.1.1.1','255.255.255.255']:
            with self.assertRaises(ValueError):a.ipv4(v)
        c=copy.deepcopy(a.DEFAULT_CONFIG);c['assigned_ip']='198.18.2.30';self.assertEqual(a.validate_config(c)['assigned_ip'],'198.18.2.30')
    def test_05_link_tags_iface(self):
        for link in [{'mode':'docker-bridge','interface':'eth0'},{'mode':'host-interface'},{'mode':'host-interface','interface':'eth0:1'}]:
            c=copy.deepcopy(a.DEFAULT_CONFIG);c['link']=link
            with self.assertRaises(ValueError):a.validate_config(c)
        c=copy.deepcopy(a.DEFAULT_CONFIG);c['link']={'mode':'host-interface','interface':'eth0'};a.validate_config(c)
    def test_06_known_normal_vector(self):
        raw=a.request(a.DEFAULT_CONFIG)[1]
        self.assertEqual(raw.hex(),'ffffffffffff02000000011008060001080006040001020000000110c612010a000000000000c6120114000000000000000000000000000000000000')
        self.assertEqual(a.decode(raw)['opcode'],1)
    def test_07_all_fifteen_combinations(self):
        count=0
        for mode in a.MODES:
            for scenario in a.SCENARIOS:
                c=copy.deepcopy(a.DEFAULT_CONFIG);c['mode']=mode;c['request_scenario']={'mode':scenario}
                try:c=a.validate_config(c)
                except ValueError:continue
                raw=a.request(c)[1];self.assertEqual(len(raw),37 if scenario=='short-arp' else 60);count+=1
        self.assertEqual(count,15)
    def test_08_invalid_pair_matrix(self):
        invalid=0
        for mode in a.MODES:
            for scenario in a.SCENARIOS:
                c=copy.deepcopy(a.DEFAULT_CONFIG);c['mode']=mode;c['request_scenario']={'mode':scenario}
                try:a.validate_config(c)
                except ValueError:invalid+=1
        self.assertEqual(invalid,13)
    def test_09_full_decode_declared_width(self):
        raw=response_bytes(a.DEFAULT_CONFIG)
        for n in range(42):
            with self.assertRaises(a.PacketError):a.decode(raw[:n])
        for offset in [14,16,18,19]:
            bad=bytearray(raw);bad[offset]^=1
            with self.assertRaises(a.PacketError):a.decode(bad)
    def test_10_short_padding_evidence(self):
        c=copy.deepcopy(a.DEFAULT_CONFIG);c['request_scenario']={'mode':'short-arp'};raw=a.request(c)[1]
        self.assertEqual(matched_request(raw,raw),'exact');self.assertEqual(matched_request(raw+bytes(23),raw),'driver_zero_padded60');self.assertIsNone(matched_request(raw+bytes(22)+b'X',raw))
    def test_11_nonzero_whois_tha_positive(self):
        c=copy.deepcopy(a.DEFAULT_CONFIG);c['request_scenario']={'mode':'nonzero-whois-tha'};self.assertTrue(a.positive(c));self.assertEqual(a.request(c)[1][32:38],a.BROADCAST);a.validate_reply(a.decode(response_bytes(c)),c)
    def test_12_nonzero_rarp_protocol_positive(self):
        c=copy.deepcopy(a.DEFAULT_CONFIG);c['mode']='rarp';c['request_scenario']={'mode':'nonzero-rarp-proto'};raw=a.request(c)[1];self.assertEqual(raw[28:32],bytes.fromhex('01020304'));self.assertTrue(a.positive(c));a.validate_reply(a.decode(response_bytes(c)),c)
    def test_13_rarp_assigned_distinct(self):
        c=copy.deepcopy(a.DEFAULT_CONFIG);c['mode']='rarp';c['assigned_ip']='198.18.3.99';raw=response_bytes(c);self.assertEqual(a.decode(raw)['target_ip'],c['assigned_ip']);self.assertEqual(a.mapping(c)['mapping_ip'],c['assigned_ip']);self.assertEqual(a.classify(raw,meta(raw),c,FakeTransport.interface),'candidate')
    def test_14_bad_reply_does_not_reset_pending(self):
        w=worker();tick(w,10.);before=dict(w.pending);process(w,response_bytes(w.cfg,'spa'));self.assertEqual(w.pending,before);self.assertEqual(w.counters['resolved'],0);self.assertEqual(w.counters['rejected_frames'],1)
    def test_15_retry_new_attempt_and_gap(self):
        c=copy.deepcopy(a.DEFAULT_CONFIG);c['retries']=1;w=worker(c);tick(w,10.);tick(w,11.);self.assertEqual((w.pending['query_id'],w.pending['attempt_id'],w.pending['retry_index']),(2,2,1));tick(w,12.);self.assertIsNone(w.pending);self.assertEqual(w.next_send,12.5);tick(w,12.5);self.assertEqual((w.pending['query_id'],w.pending['retry_index']),(3,0))
    def test_16_mapping_cancels_retry_and_interval(self):
        w=worker();w.retry=4;tick(w,10.);raw=response_bytes(w.cfg);process(w,raw);self.assertIsNone(w.pending);self.assertEqual(w.retry,0);self.assertEqual(w.next_send,10.6);self.assertEqual(w.last_mapping['response_sha256'],a.summary(raw)['raw_sha256']);self.assertEqual(w.counters['resolved'],1)
    def test_17_late_reply_cannot_resolve(self):
        w=worker();tick(w,10.);process(w,response_bytes(w.cfg),11.1);self.assertIsNone(w.pending);self.assertEqual(w.counters['timeouts'],1);self.assertEqual(w.counters['resolved'],0)
    def test_18_outgoing_metadata_ignored(self):
        w=worker();tick(w,10.);process(w,response_bytes(w.cfg),packet_type=4);self.assertEqual(w.counters['ignored_outgoing'],1);self.assertEqual(w.counters['incoming_frames'],0);process(w,response_bytes(w.cfg),ifindex=8);self.assertEqual(w.counters['rejected_frames'],1);self.assertEqual(w.counters['resolved'],0)
    def test_19_control_arp_does_not_pollute(self):
        c=copy.deepcopy(a.DEFAULT_CONFIG);c['request_scenario']={'mode':'wrong-target-ip'};w=worker(c);tick(w,10.);raw=bytearray(response_bytes(c));raw[28:32]=socket.inet_aton('172.20.0.3');raw[38:42]=socket.inet_aton('172.20.0.2');process(w,bytes(raw));raw[20:22]=b'\0\1';process(w,bytes(raw));w.expire(11.1);self.assertEqual(w.counters['ignored_control'],2);self.assertEqual(w.counters['negative_silent'],1);self.assertEqual(w.counters['unexpected_responses'],0)
    def test_20_wrong_one_address_attributable(self):
        c=copy.deepcopy(a.DEFAULT_CONFIG);c['request_scenario']={'mode':'wrong-target-ip'};w=worker(c);tick(w,10.)
        for wrong in ('spa','tpa'):process(w,response_bytes(c,wrong))
        self.assertEqual(w.pending['unexpected_responses'],2)
    def test_21_short_spa_boundary_no_guess(self):
        c=copy.deepcopy(a.DEFAULT_CONFIG);c['request_scenario']={'mode':'short-arp'};w=worker(c);tick(w,10.);raw=response_bytes(c)
        for n in (31,32,37,42):process(w,raw[:n])
        self.assertEqual(w.pending['unexpected_responses'],3);bad=bytearray(raw);bad[18]=5;process(w,bytes(bad));self.assertEqual(w.pending['unexpected_responses'],3)
    def test_22_negative_complete_reply_no_mapping(self):
        c=copy.deepcopy(a.DEFAULT_CONFIG);c['request_scenario']={'mode':'short-arp'};w=worker(c);tick(w,10.);process(w,response_bytes(c));w.expire(11.1);self.assertEqual(w.counters['unexpected_responses'],1);self.assertEqual(w.counters['timeouts'],1);self.assertEqual(w.counters['negative_silent'],0);self.assertEqual(w.counters['resolved'],0)
    def test_23_pure_negative_expiry(self):
        c=copy.deepcopy(a.DEFAULT_CONFIG);c['request_scenario']={'mode':'short-arp'};w=worker(c);tick(w,10.);w.expire(11.1);self.assertEqual(w.counters['negative_silent'],1);self.assertEqual(w.counters['timeouts'],1);self.assertEqual(w.counters['unexpected_responses'],0)
    def test_24_bounded_events_filter_budget(self):
        w=worker()
        for _ in range(400):w.event('test',None,wire=a.summary(bytes(65507)))
        page=w.query_events(0,16);self.assertEqual(len(w.events),256);self.assertEqual(w.evictions,144);self.assertLessEqual(len(json.dumps(page).encode()),65536);self.assertTrue(page['truncated']);self.assertGreater(w.counters['log_dropped'],0)
        self.assertEqual(a.filter_hash(a.FILTER),'4c5aa70c5e4491d80464cc65f5a5bbc5a041c913542e6e541f54b4c5b08be132');self.assertEqual(a.case_budgets(a.DEFAULT_CONFIG,'ALL')[1],26200)
        c=copy.deepcopy(a.DEFAULT_CONFIG);c['request_scenario']={'mode':'short-arp'};self.assertEqual(a.case_budgets(c,'ALL')[1],30000)
        c['timeout_ms']=10
        with self.assertRaises(ValueError):a.case_budgets(c,'ALL')
        c['timeout_ms']=60000
        with self.assertRaises(ValueError):a.case_budgets(c,'TIMEOUT')
    def test_25_observe_uses_live_new_anchor_not_old_timeout(self):
        c=copy.deepcopy(a.DEFAULT_CONFIG);raw=expected_request(c)
        class Peer:
            socket=object();interface={'ifindex':7}
            def __init__(self):self.calls=0
            def receive(self):
                self.calls+=1
                if self.calls==1:raise BlockingIOError()
                return raw,meta(raw,hardware_address=c['source_mac'],packet_type=1)
        class Observer:
            def __init__(self):self.calls=0
            def status(self,deadline):
                self.calls+=1
                if self.calls==1:return {'next_event_id':11,'uptime_ms':5000,'counters':{'queries_sent':5}}
                return {'uptime_ms':5002,'pending':{'query_id':6,'sent_ms':5001,'deadline_ms':6001,'unexpected_responses':0},'last_mapping':None}
            def get(self,path,deadline):
                return {'truncated':False,'next_event_id':14,'events':[{'event_id':11,'query_id':5,'attempt_id':5,'kind':'query_sent','wire':a.summary(raw)},{'event_id':12,'query_id':5,'kind':'query_timeout','negative_silent':False,'unexpected_responses':0},{'event_id':13,'query_id':6,'attempt_id':6,'kind':'query_sent','wire':a.summary(raw)}]}
        with patch('client.select.select',return_value=([Peer.socket],[],[])):
            result,_=run_check(SimpleNamespace(expected_boot_id='boot'),c,Observer(),Peer(),'OBSERVE_REQUEST',1,0,time.monotonic()+30,2500)
        self.assertTrue(result['passed'],result);self.assertEqual(result['response']['query_id'],6);self.assertEqual(result['request']['live_source_anchor']['query_id'],6)
    def test_26_foreign_resolved_capture_cannot_borrow_timeout(self):
        c=copy.deepcopy(a.DEFAULT_CONFIG);raw=expected_request(c)
        class Peer:
            socket=object();interface={'ifindex':7}
            def __init__(self):self.calls=0
            def receive(self):
                self.calls+=1
                if self.calls==1:raise BlockingIOError()
                return raw,meta(raw,hardware_address=c['source_mac'],packet_type=1)
        class Observer:
            def __init__(self):self.calls=0
            def status(self,deadline):
                self.calls+=1
                if self.calls==1:return {'next_event_id':11,'uptime_ms':5000,'counters':{'queries_sent':5}}
                return {'uptime_ms':5002,'pending':None,'last_mapping':{'query_id':6}}
            def get(self,path,deadline):raise AssertionError('Must not borrow an expired timeout proof')
        with patch('client.select.select',return_value=([Peer.socket],[],[])):
            result,_=run_check(SimpleNamespace(expected_boot_id='boot'),c,Observer(),Peer(),'TIMEOUT',1,0,time.monotonic()+30,3500)
        self.assertFalse(result['passed']);self.assertIn('external response resolved',result['error'])
    def test_27_actual_mutated_tpa_in_peer_collision_set(self):
        c=copy.deepcopy(a.DEFAULT_CONFIG);c['server_ip']='172.25.0.5';c['request_scenario']={'mode':'wrong-target-ip'}
        self.assertIn('172.25.0.4',peer_role_ips(c));self.assertIn('172.25.0.5',peer_role_ips(c));self.assertEqual(c['server_ip'],'172.25.0.5')
    def test_28_rarp_nonzero_tpa_and_no_short_guess(self):
        c=copy.deepcopy(a.DEFAULT_CONFIG);c['mode']='rarp';c['request_scenario']={'mode':'nonzero-rarp-proto'}
        self.assertIn('5.6.7.8',peer_role_ips(c));self.assertEqual(expected_request(c)[38:42],socket.inet_aton('5.6.7.8'))
        c['request_scenario']={'mode':'short-arp'}
        self.assertEqual(len(expected_request(c)),37);self.assertEqual(peer_role_ips(c),{c[k] for k in ('source_ip','server_ip','assigned_ip')})
    def test_29_mutated_collision_rejected_before_packet_or_observer(self):
        c=copy.deepcopy(a.DEFAULT_CONFIG);c['server_ip']='172.25.0.5';c['request_scenario']={'mode':'wrong-target-ip'}
        argv=['client.py','--config-json',json.dumps(c),'--interface','eth0','--method','TIMEOUT','--observer-host','172.25.0.2','--expected-runtime-id','a'*32,'--expected-boot-id','boot']
        output=io.StringIO()
        with patch('client.sys.argv',argv),patch('client.signal.signal'),patch('client.signal.alarm'),patch('client.socket.socket'),patch('client.fcntl.ioctl',return_value=bytes(20)+socket.inet_aton('172.25.0.4')+bytes(232)),patch('client.Transport') as transport,patch('client.Observer') as observer,contextlib.redirect_stdout(output):
            code=client_main()
        result=json.loads(output.getvalue());self.assertEqual(code,1);self.assertFalse(result['passed']);self.assertEqual(result['checks'],[]);self.assertIn('test unavailable',result['error']);transport.assert_not_called();observer.assert_not_called()
if __name__=='__main__':unittest.main()
