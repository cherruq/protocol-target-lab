"""RTP structure, proof integrity and real bounded observer tests."""
import asyncio
import copy
import json
import struct
import time
import unittest
from client import build_packet,validate_observations
from rtp_wire import PacketError,bytes_info,decode_rtp,validate_config
from server import ReceiverState,RtpProtocol,observe

CONFIG=dict(bind_ip='0.0.0.0',port=5004,max_packet_size=2048)
class WireTests(unittest.TestCase):
    def test_config_strict_integer_and_ipv4_bounds(self):
        self.assertEqual(validate_config(CONFIG),CONFIG)
        for key,value in [('port',True),('port',0),('max_packet_size',63),('max_packet_size',65508),('bind_ip','239.1.1.1'),('bind_ip','255.255.255.255'),('bind_ip',None)]:
            with self.assertRaises(ValueError):validate_config(dict(CONFIG,**{key:value}))
        with self.assertRaises(ValueError):validate_config(dict(CONFIG,extra=1))
    def test_all_options_strip_exact_padding_and_keep_full_header_ranges(self):
        raw,expected=build_packet(b'opaque\0\xff',65535,0xffffffff,0xffffffff,True,list(range(15)),(0x1234,b'12345678'),7,127)
        self.assertEqual(decode_rtp(raw),expected)
        empty,_=build_packet(b'',0,0,0,extension=(0x1234,b''),padding=1)
        self.assertEqual(decode_rtp(empty)['payload']['length'],0)
    def test_structural_rejections(self):
        base=struct.pack('!BBHII',128,96,1,2,3)
        bad=[(b'123','short_header'),(bytes([64])+base[1:],'wrong_version'),(bytes([143])+base[1:],'truncated_csrc'),(bytes([144])+base[1:],'truncated_extension_header'),(bytes([144])+base[1:]+b'\x12\x34\xff\xff','truncated_extension_data'),(bytes([160])+base[1:],'invalid_padding'),(bytes([160])+base[1:]+b'\0','invalid_padding'),(bytes([160])+base[1:]+b'\2','invalid_padding')]
        for raw,code in bad:
            with self.assertRaisesRegex(PacketError,code):decode_rtp(raw)
    def test_sequence_wrap_duplicates_are_accepted_not_loss_estimates(self):
        state=ReceiverState(CONFIG)
        for seq in (65534,65535,0,1,65535):state.receive(build_packet(b'x',seq,seq,123)[0],('192.0.2.1',40000))
        self.assertEqual(state.stats['accepted'],5);self.assertEqual(list(state.sources.values())[0]['last_sequence'],65535)
    def test_bounds_and_same_hash_query_preserve_full_evidence(self):
        state=ReceiverState(dict(CONFIG,max_packet_size=65507));raw,_=build_packet(b'x'*65495,65535,0xffffffff,0xffffffff)
        for _ in range(300):state.receive(raw,('192.0.2.1',65535))
        query=state.observations(0,bytes_info(raw)['sha256'])
        self.assertEqual((len(state.events),state.stats['event_evictions'],query['matched_count'],query['returned_count']),(256,44,256,16));self.assertTrue(query['truncated']);self.assertLess(len(json.dumps(query).encode()),65536)
        self.assertEqual(query['events'][0]['rtp']['payload']['length'],65495);self.assertEqual(len(query['events'][0]['rtp']['payload']['preview_hex']),256)
        for n in range(140):state.receive(build_packet(b'x',1,2,n)[0],('192.0.2.1',40000+n))
        self.assertEqual(len(state.sources),128);self.assertEqual(state.log_queue.qsize(),256);self.assertGreater(state.stats['log_dropped'],0);self.assertLess(len(json.dumps(state.status()).encode()),65536)
    def test_oversize_is_rejected_and_next_packet_still_accepted(self):
        state=ReceiverState(dict(CONFIG,max_packet_size=64));state.receive(b'x'*65,('192.0.2.1',40000));state.receive(build_packet(b'ok',1,2,3)[0],('192.0.2.1',40000))
        self.assertEqual(state.events[0]['error_code'],'packet_too_large');self.assertTrue(state.events[1]['accepted'])
    def test_proof_rejects_stale_wrong_boot_hash_payload_and_types(self):
        raw,expected=build_packet(b'nonce',1,2,3);state=ReceiverState(CONFIG);state.receive(raw,('192.0.2.1',40000));baseline=dict(boot_id=state.boot_id,counter=0);query=state.observations(0,bytes_info(raw)['sha256']);self.assertEqual(len(validate_observations(query,baseline,raw,expected)),1)
        for field in ('boot','stale','raw','payload','type','counter'):
            bad=copy.deepcopy(query)
            if field=='boot':bad['boot_id']='0'*32
            elif field=='stale':bad['events'][0]['event_id']=0
            elif field=='raw':bad['events'][0]['raw']['sha256']='0'*64
            elif field=='payload':bad['events'][0]['rtp']['payload']['sha256']='0'*64
            elif field=='type':bad['events'][0]['rtp']['sequence']=1.0
            else:bad['counter']=-1
            with self.assertRaises(ValueError):validate_observations(bad,baseline,raw,expected)

class ObserverTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.state=ReceiverState(CONFIG);self.state.udp_bound=['0.0.0.0',5004];self.state.fatal=asyncio.get_running_loop().create_future()
        self.listener=await asyncio.start_server(lambda r,w:observe(r,w,self.state),'127.0.0.1',0,limit=4096)
        self.port=self.listener.sockets[0].getsockname()[1]
    async def asyncTearDown(self):
        self.state.stopping=True;self.listener.close();await self.listener.wait_closed()
        for w in tuple(self.state.writers):w.close()
        for t in tuple(self.state.tasks):t.cancel()
        if self.state.tasks:await asyncio.gather(*tuple(self.state.tasks),return_exceptions=True)
    async def request(self,raw):
        reader,writer=await asyncio.open_connection('127.0.0.1',self.port);writer.write(raw);await writer.drain();data=await asyncio.wait_for(reader.read(),2);writer.close();return data
    async def test_query_is_read_only_and_wrong_method_is_rejected(self):
        result=await self.request(b'POST /v1/status HTTP/1.1\r\nHost: test\r\n\r\n');self.assertIn(b'405',result);self.assertEqual(self.state.counter,0)
        result=await self.request(b'GET /v1/observations?after=0&raw_sha256='+b'0'*64+b' HTTP/1.1\r\nHost: test\r\n\r\n');self.assertIn(b'200',result);self.assertEqual(self.state.counter,0)
    async def test_slow_drip_headers_have_absolute_one_second_deadline(self):
        reader,writer=await asyncio.open_connection('127.0.0.1',self.port);started=time.monotonic()
        async def drip():
            try:
                for _ in range(8):writer.write(b'G');await writer.drain();await asyncio.sleep(.2)
            except ConnectionError:pass
        task=asyncio.create_task(drip());data=await asyncio.wait_for(reader.read(),1.5);elapsed=time.monotonic()-started;task.cancel();await asyncio.gather(task,return_exceptions=True);writer.close()
        self.assertIn(b'408',data);self.assertLess(elapsed,1.3)
    async def test_eight_connection_slots_are_bounded_before_waiting(self):
        held=[await asyncio.open_connection('127.0.0.1',self.port) for _ in range(8)];await asyncio.sleep(.02);self.assertEqual(len(self.state.writers),8)
        reader,writer=await asyncio.open_connection('127.0.0.1',self.port);self.assertEqual(await asyncio.wait_for(reader.read(),.3),b'');writer.close()
        for _,writer in held:writer.close()
    async def test_unexpected_udp_listener_loss_is_critical(self):
        RtpProtocol(self.state).connection_lost(None)
        with self.assertRaisesRegex(RuntimeError,'listener closed'):await self.state.fatal
