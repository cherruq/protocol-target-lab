"""MIT. Wire, fault and source safety regression tests with independent assertions."""
import copy,errno,io,json,queue,socket,struct,threading,time,unittest
from collections import deque
from unittest import mock
import mpls_wire as w
import server

class ConfigTests(unittest.TestCase):
    def test_required_types_and_profile(self):
        for k in w.DEFAULT_CONFIG:
            v=copy.deepcopy(w.DEFAULT_CONFIG);del v[k]
            with self.subTest(k=k),self.assertRaises(ValueError):w.validate_config(v)
        for patch in ({'unknown':1},{'label':True},{'label':15},{'label':1048576},{'reply_ttl':0},{'reply_ttl':256},{'source_ip':'0.1.2.3'},{'source_mac':'01:00:00:00:00:01'},{'scenario':{'mode':'normal','duration':1}},{'link':{'mode':'docker-bridge','interface':'eth0'}}):
            with self.subTest(patch=patch),self.assertRaises((ValueError,TypeError)):w.validate_config({**copy.deepcopy(w.DEFAULT_CONFIG),**patch})
    def test_upper_bounds_and_mac_canonicalization(self):
        c=w.validate_config({**copy.deepcopy(w.DEFAULT_CONFIG),'label':1048575,'reply_ttl':255,'source_mac':'02:AB:00:00:58:20'});self.assertEqual(c['source_mac'],'02:ab:00:00:58:20')
    def test_filter_hash_contract(self):self.assertEqual(w.filter_hash(w.FILTER),'2664965342338e0a1e0ef77583475f3467f8d5047cbe258cf3c8e0b5e5c157c2')
    def test_current_mutated_role_collision_guard(self):
        c=copy.deepcopy(w.DEFAULT_CONFIG);c['scenario']['mode']='wrong-ip-dst';changed='198.18.58.11'
        with mock.patch.object(w,'ipv4_addresses',return_value=[{'ip':changed}]),mock.patch('builtins.open',return_value=io.StringIO('Iface Destination Gateway Flags\n')),self.assertRaisesRegex(ValueError,'collides'):w.role_preflight(c)
    def test_gateway_and_source_proof_collision_guard(self):
        for s in ({'actual_ipv4':[{'ip':'198.18.58.20'}]},{'actual_gateways':['198.18.58.10']}):
            with self.subTest(s=s),mock.patch.object(w,'ipv4_addresses',return_value=[]),mock.patch('builtins.open',return_value=io.StringIO('Iface Destination Gateway Flags\n')),self.assertRaisesRegex(ValueError,'collides'):w.role_preflight(w.DEFAULT_CONFIG,s)

class WireTests(unittest.TestCase):
    def setUp(self):self.c=copy.deepcopy(w.DEFAULT_CONFIG);self.raw=w.request_frame(self.c,0xabcd,0x1234,b'odd-bytes',tc=7,label_ttl=2,padding=b'\xa5'*9);self.p=w.decode_request(self.raw)
    def test_single_label_current_values_and_separate_padding(self):
        w.validate_request(self.p,self.c);self.assertEqual(self.p['label'],58);self.assertEqual(self.p['traffic_class'],7);self.assertEqual(self.p['label_ttl'],2);self.assertEqual(self.p['payload'],b'odd-bytes');self.assertEqual(self.p['padding'],b'\xa5'*9)
    def test_normal_reply_plain_and_checksummed_exact_echo(self):
        r=w.reply_frame(self.p,self.c,0xbeef);self.assertEqual(r[12:14],b'\x08\0');self.assertEqual(r[:6],w.mac(self.c['client_mac']));self.assertEqual(r[34:36],b'\0\0');self.assertEqual(r[38:42],bytes.fromhex('abcd1234'));self.assertEqual(r[42:51],b'odd-bytes');self.assertEqual(w.checksum(r[14:34]),0);self.assertEqual(w.checksum(r[34:51]),0);self.assertEqual(len(r),60);self.assertEqual(r[51:],bytes(9));self.assertEqual(int.from_bytes(r[18:20],'big'),0xbeef);self.assertEqual(r[15],0x2e);self.assertEqual(r[22],64)
    def test_label_and_ttl_limits_not_echo_success(self):
        for label,ttl,reason in ((59,64,'wrong_label'),(58,0,'mpls_ttl_expired'),(58,1,'mpls_ttl_expired')):
            p=w.decode_request(w.request_frame(self.c,1,2,b'',label=label,label_ttl=ttl))
            with self.subTest(label=label,ttl=ttl),self.assertRaisesRegex(w.PacketError,reason):w.validate_request(p,self.c)
    def test_malformed_header_and_checksums(self):
        variants=[(self.raw[:13],'short_ethernet'),(self.raw[:17],'short_mpls'),(self.raw[:37],'short_ipv4')]
        for offset,bit,reason in ((16,1,'unsupported_label_stack'),(18,1,'unsupported_ihl'),(28,1,'bad_ip_checksum'),(40,1,'bad_icmp_checksum')):
            r=bytearray(self.raw);r[offset]^=bit;variants.append((bytes(r),reason))
        for raw,reason in variants:
            with self.subTest(reason=reason),self.assertRaisesRegex(w.PacketError,reason):w.decode_request(raw)
    def test_current_request_payload_never_reuses_previous(self):
        for p in (b'',b'\0',bytes(range(255)),b'new'):
            q=w.decode_request(w.request_frame(self.c,65535,0,p));r=w.reply_frame(q,self.c,1);total=int.from_bytes(r[16:18],'big');self.assertEqual(r[42:14+total],p)
    def test_all_fault_lengths_and_corruption(self):
        normal=w.reply_frame(self.p,self.c,1)
        for mode in w.SCENARIOS:
            c=copy.deepcopy(self.c);c['scenario']['mode']=mode;r=w.reply_frame(self.p,c,1)
            with self.subTest(mode=mode):
                if mode=='silent':self.assertIsNone(r);continue
                self.assertEqual(len(r),{'short-ethernet':13,'short-ipv4':33,'short-icmp':41}.get(mode,60))
                if mode=='normal':self.assertEqual(r,normal)
                elif mode.startswith('short-'):self.assertEqual(r,normal[:len(r)])
                else:self.assertNotEqual(r,normal)
                if mode=='bad-ip-checksum':self.assertNotEqual(w.checksum(r[14:34]),0)
                if mode=='bad-icmp-checksum':self.assertNotEqual(w.checksum(r[34:51]),0)
    def test_checksums_recomputed_for_semantic_mutations(self):
        for mode in ('wrong-ip-src','wrong-ip-dst','wrong-id','wrong-seq','wrong-payload'):
            c=copy.deepcopy(self.c);c['scenario']['mode']=mode;r=w.reply_frame(self.p,c,1);total=int.from_bytes(r[16:18],'big');self.assertEqual(w.checksum(r[14:34]),0);self.assertEqual(w.checksum(r[34:14+total]),0)
    def test_auxdata_valid_unknown_tpid_not_guessed(self):
        data=struct.pack('IIIHHHH',1<<4,60,60,0,14,7,0);a=w.aux_metadata([(263,8,data)]);self.assertTrue(a['vlan_valid']);self.assertIsNone(a['vlan_tpid']);self.assertFalse(a['vlan_tpid_known'])

class SourceTests(unittest.TestCase):
    def worker(self,mode='normal'):
        c=copy.deepcopy(w.DEFAULT_CONFIG);c['scenario']['mode']=mode;x=server.Worker.__new__(server.Worker);x.cfg=c;x.lock=threading.RLock();x.born=time.monotonic();x.events=deque(maxlen=256);x.next_id=1;x.next_request=1;x.evictions=0;x.last_request=None;x.last_output=None;x.logs=queue.Queue(256);x.counters={k:0 for k in ('rx_frames','accepted','rejected','expired','tx_submitted','suppressed','tx_error','ignored','log_dropped')};x.transport=mock.Mock();x.transport.interface={'name':'eth0','ifindex':2,'hardware_type':1,'mac':c['source_mac'],'mtu':1500};return x
    def meta(self):return {'interface':'eth0','ifindex':2,'hardware_type':1,'hardware_address':w.DEFAULT_CONFIG['client_mac'],'packet_type':0,'truncated':False,'vlan_valid':False}
    def test_short13_tx_error_is_not_suppression_or_process_failure(self):
        x=self.worker('short-ethernet');x.transport.send.side_effect=OSError(errno.EINVAL,'invalid argument');x.process(w.request_frame(x.cfg,1,2,b'nonce'),self.meta());self.assertEqual(x.counters['accepted'],1);self.assertEqual(x.counters['tx_error'],1);self.assertEqual(x.counters['suppressed'],0);self.assertEqual(x.last_output['kind'],'tx_error');self.assertEqual(x.last_output['frame']['wire_length'],13);self.assertEqual(x.last_output['errno'],22)
    def test_invalid_current_frame_never_uses_previous_good_request(self):
        x=self.worker();good=w.request_frame(x.cfg,1,2,b'nonce');x.process(good,self.meta());x.process(good[:37],self.meta());self.assertEqual(x.transport.send.call_count,1);self.assertEqual(x.counters['rejected'],1);self.assertEqual(x.last_request['reason'],'short_ipv4')
    def test_vlan_truncation_metadata_and_outgoing_no_reply(self):
        for patch in ({'vlan_valid':True},{'truncated':True},{'hardware_type':772},{'hardware_address':'02:00:00:00:00:00'},{'packet_type':4}):
            x=self.worker();x.process(w.request_frame(x.cfg,1,2,b'nonce'),{**self.meta(),**patch});x.transport.send.assert_not_called()
    def test_silent_is_current_accepted_and_suppressed(self):
        x=self.worker('silent');x.process(w.request_frame(x.cfg,1,2,b'nonce'),self.meta());self.assertEqual([e['kind'] for e in x.events],['accepted','suppressed']);self.assertEqual(x.events[0]['request_id'],x.events[1]['request_id']);x.transport.send.assert_not_called()
    def test_event_ring_preview_and_ordered_page_bounds(self):
        x=self.worker();x.boot='00000000-0000-4000-8000-000000000001';x.runtime='0'*32
        for n in range(300):x.event('rejected',n,'0'*64,b'x'*65553,reason='length')
        page=x.query_events(0,16);self.assertEqual(x.evictions,44);self.assertEqual(page['returned'],16);self.assertTrue(page['truncated']);self.assertLess(len(json.dumps(page).encode()),65536);self.assertEqual(page['events'][0]['event_id'],45);self.assertEqual(len(page['events'][0]['frame']['preview_hex']),256)


class QuietAssociationTests(unittest.TestCase):
    def setUp(self):
        import client
        self.associate=client.quiet_association;self.c=copy.deepcopy(w.DEFAULT_CONFIG);self.c['scenario']['mode']='silent';self.p=w.decode_request(w.request_frame(self.c,0x1234,0xabcd,b'unique-current-nonce'));normal=copy.deepcopy(self.c);normal['scenario']['mode']='normal';self.reply=w.reply_frame(self.p,normal,4)
    def test_all_payload_changed_still_current_idseq_reply(self):
        raw=self.reply[:42]+b'Z'*len(self.p['payload']);self.assertEqual(self.associate(raw,self.c,self.p),'current_icmp_id_sequence_and_roles')
    def test_bad_checksum_and_wrong_mac_or_ip_not_quiet_success(self):
        bad=bytearray(self.reply);bad[24]^=1;self.assertIsNotNone(self.associate(bytes(bad),self.c,self.p));bad=bytearray(self.reply);bad[11]^=7;self.assertIsNotNone(self.associate(bytes(bad),self.c,self.p));bad=bytearray(self.reply);bad[29]^=7;self.assertIsNotNone(self.associate(bytes(bad),self.c,self.p))
    def test_partial_response_id_and_role_prefix_association(self):
        self.assertEqual(self.associate(self.reply[:41],self.c,self.p),'partial_current_icmp_id_sequence_and_roles');self.assertEqual(self.associate(self.reply[:33],self.c,self.p),'partial_ipv4_role_prefix_without_wire_id')
    def test_unrelated_arp_tcp_and_other_identifier_not_attributed(self):
        self.assertIsNone(self.associate(self.reply[:12]+b'\x08\x06'+self.reply[14:],self.c,self.p));raw=bytearray(self.reply);raw[23]=6;self.assertIsNone(self.associate(bytes(raw),self.c,self.p));raw=bytearray(self.reply);raw[38:42]=b'\0\0\0\0';raw[42:]=b'Z'*(len(raw)-42);self.assertIsNone(self.associate(bytes(raw),self.c,self.p))

if __name__=='__main__':unittest.main()
