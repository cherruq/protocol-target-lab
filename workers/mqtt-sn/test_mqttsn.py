"""Bounded independent MQTT-SN framing/config contract tests."""
import unittest
from unittest.mock import patch,MagicMock,call
import mqttsn_wire
from mqttsn_wire import *
CONFIG=dict(bind_ip='0.0.0.0',port=1884,discovery_group='239.192.0.2',discovery_port=1885,gateway_id=1,broker_host='127.0.0.1',broker_port=28897,predefined_topics=[dict(topic_id=1,topic='plab/predefined')])
class ContractTests(unittest.TestCase):
    def test_config_endpoint_types_and_ranges(self):
        self.assertEqual(validate_config(CONFIG),CONFIG)
        for key,value in [('port',True),('port',0),('bind_ip','127.0.0.1'),('broker_host','0.0.0.0'),('discovery_group','192.0.2.1'),('discovery_port',1884),('gateway_id',256)]:
            with self.assertRaises(ValueError):validate_config(dict(CONFIG,**{key:value}))
        with self.assertRaises(ValueError):validate_config(dict(CONFIG,extra=True))
    def test_topic_ascii_namespace_uniqueness_and_boundary(self):
        self.assertEqual(validate_config(dict(CONFIG,predefined_topics=[dict(topic_id=65534,topic='x'*128)]))['predefined_topics'][0]['topic_id'],65534)
        for name in ['x'*129,'','a b','a,b','a+b','a#b','界','a\x7f','plab/test','plab/test/other','$SYS/review','$share/group/topic','$CONTROL/test','$arbitrary']:
            with self.assertRaises(ValueError):validate_config(dict(CONFIG,predefined_topics=[dict(topic_id=1,topic=name)]))
        for topics in [[dict(topic_id=65535,topic='a')],[dict(topic_id=True,topic='a')],[dict(topic_id=1,topic='a'),dict(topic_id=1,topic='b')],[dict(topic_id=1,topic='a'),dict(topic_id=2,topic='a')]]:
            with self.assertRaises(ValueError):validate_config(dict(CONFIG,predefined_topics=topics))
    def test_short_and_extended_datagram_framing(self):
        for length in (0,1,253,254,1020):
            body=b'x'*length;raw=packet(12,body);self.assertEqual(decode(raw),(12,body))
            for malformed in [raw+b'x',raw[:-1]]:
                with self.assertRaises(ValueError):decode(malformed)
        with self.assertRaises(ValueError):packet(12,b'x'*1021)
    def test_client_ids_equal_length_without_prefix(self):
        self.assertEqual(len(NORMAL_ID),len(PREDEFINED_ID));self.assertFalse(NORMAL_ID.startswith(PREDEFINED_ID));self.assertFalse(PREDEFINED_ID.startswith(NORMAL_ID))
    def test_remote_membership_uses_target_route_not_multicast_vpn_route(self):
        local_ips={'127.0.0.1','192.0.2.10','198.51.100.10'}
        def route(host,port):
            return '198.51.100.10' if host==CONFIG['discovery_group'] else '192.0.2.10'
        with patch.object(mqttsn_wire,'route_source_ipv4',side_effect=route) as lookup:
            interface,allowed=discovery_membership('192.0.2.20',CONFIG,local_ips)
            self.assertEqual(interface,'192.0.2.10');self.assertEqual(allowed,{'192.0.2.20'})
            lookup.assert_called_once_with('192.0.2.20',CONFIG['port'])
    def test_local_and_loopback_membership_keep_native_group_route(self):
        local_ips={'127.0.0.1','192.0.2.10','198.51.100.10'}
        for target in ('192.0.2.10','127.0.0.1','127.0.0.2'):
            with patch.object(mqttsn_wire,'route_source_ipv4',return_value='198.51.100.10') as lookup:
                interface,allowed=discovery_membership(target,CONFIG,local_ips)
                self.assertEqual(interface,'198.51.100.10');self.assertEqual(allowed,local_ips)
                lookup.assert_called_once_with(CONFIG['discovery_group'],CONFIG['discovery_port'])
    def test_route_lookup_connects_without_sending_packets(self):
        route=MagicMock();route.__enter__.return_value=route;route.getsockname.return_value=('192.0.2.10',40000)
        with patch.object(mqttsn_wire.socket,'socket',return_value=route):
            self.assertEqual(route_source_ipv4('192.0.2.20',1884),'192.0.2.10')
        route.connect.assert_called_once_with(('192.0.2.20',1884))
        route.send.assert_not_called();route.sendto.assert_not_called();route.sendall.assert_not_called()
    def test_remote_discovery_installs_selected_membership_and_reports_it(self):
        receiver=MagicMock();receiver.__enter__.return_value=receiver
        sender=MagicMock();sender.__enter__.return_value=sender
        ancillary=[(socket.IPPROTO_IP,8,struct.pack('=I4s4s',7,b'\0'*4,socket.inet_aton(CONFIG['discovery_group'])))]
        receiver.recvmsg.side_effect=[BlockingIOError(),(packet(2,bytes([CONFIG['gateway_id']])),ancillary,0,('192.0.2.20',CONFIG['port']))]
        with patch.object(mqttsn_wire.socket,'socket',side_effect=[receiver,sender]),patch.object(mqttsn_wire.socket,'gethostbyname',return_value='192.0.2.20'),patch.object(mqttsn_wire,'local_addresses',return_value={'127.0.0.1','192.0.2.10','198.51.100.10'}),patch.object(mqttsn_wire,'route_source_ipv4',return_value='192.0.2.10'):
            actual=discovery('192.0.2.20',CONFIG,time.monotonic()+3,Trace())
        self.assertIn(call(socket.IPPROTO_IP,socket.IP_ADD_MEMBERSHIP,socket.inet_aton(CONFIG['discovery_group'])+socket.inet_aton('192.0.2.10')),receiver.setsockopt.call_args_list)
        self.assertEqual(actual['membership_interface_ipv4'],'192.0.2.10');self.assertEqual(actual['allowed_source_ips'],['192.0.2.20'])
    def simulated_discovery(self,mode):
        clock=[0.0];receiver=MagicMock();receiver.__enter__.return_value=receiver
        sender=MagicMock();sender.__enter__.return_value=sender;send_times=[]
        sender.sendto.side_effect=lambda *_:send_times.append(clock[0]) or 3
        calls=[0]
        ancillary=[(socket.IPPROTO_IP,8,struct.pack('=I4s4s',7,b'\0'*4,socket.inet_aton(CONFIG['discovery_group'])))]
        def receive(*_):
            calls[0]+=1
            if calls[0]==1:raise BlockingIOError()
            if mode=='drop-first' and len(send_times)>=2:
                clock[0]+=0.01
                return packet(2,bytes([CONFIG['gateway_id']])),ancillary,0,('192.0.2.20',CONFIG['port'])
            if mode=='flood':
                clock[0]+=0.1
                return packet(2,bytes([CONFIG['gateway_id']])),ancillary,0,('192.0.2.99',CONFIG['port'])
            clock[0]+=receiver.settimeout.call_args.args[0]
            raise socket.timeout()
        receiver.recvmsg.side_effect=receive;trace=Trace();result=None;error=None
        with patch.object(mqttsn_wire.time,'monotonic',side_effect=lambda:clock[0]),patch.object(mqttsn_wire.socket,'socket',side_effect=[receiver,sender]),patch.object(mqttsn_wire.socket,'gethostbyname',return_value='192.0.2.20'),patch.object(mqttsn_wire,'local_addresses',return_value={'127.0.0.1','192.0.2.10'}),patch.object(mqttsn_wire,'route_source_ipv4',return_value='192.0.2.10'):
            try:result=discovery('192.0.2.20',CONFIG,30,trace)
            except ValueError as exc:error=str(exc)
        return result,error,send_times,clock[0],trace,calls[0]-1
    def test_discovery_retries_lost_first_query_within_same_deadline(self):
        result,error,sent,elapsed,trace,_=self.simulated_discovery('drop-first')
        self.assertIsNone(error);self.assertEqual(sent,[0.0,0.5]);self.assertEqual(result['queries_sent'],2);self.assertLess(elapsed,3)
        self.assertEqual([e['query_number'] for e in trace if e['direction']=='send'],[1,2])
    def test_discovery_no_reply_fails_at_three_seconds_without_reset(self):
        result,error,sent,elapsed,trace,_=self.simulated_discovery('silent')
        self.assertIsNone(result);self.assertIn('absolute discovery deadline',error)
        self.assertEqual(sent,[0,0.5,1,1.5,2,2.5]);self.assertEqual(elapsed,3);self.assertEqual(len(trace),6)
    def test_discovery_discard_flood_cannot_extend_absolute_deadline(self):
        result,error,sent,elapsed,_,received=self.simulated_discovery('flood')
        self.assertIsNone(result);self.assertIn('absolute discovery deadline',error)
        self.assertLessEqual(len(sent),6);self.assertLessEqual(received,64);self.assertLess(elapsed,3.11)
    def test_trace_and_preview_bounds(self):
        p=preview(b'x'*1024);self.assertEqual(p['length'],1024);self.assertEqual(len(p['preview_hex']),256);self.assertTrue(p['truncated'])
        t=Trace()
        for _ in range(512):t.append(dict(direction='receive'))
        with self.assertRaises(ValueError):t.append(dict(direction='receive'))
if __name__=='__main__':unittest.main()
