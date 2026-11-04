"""RTCP whole-compound parsing, bounded evidence and private observer invariants."""
import asyncio
import copy
import hashlib
import json
import struct
import time
import unittest
from client import build_compound,case_packets,validate_observations
from rtcp_wire import PacketError,bytes_info,decode_compound,validate_config
from server import ReceiverState,RtcpProtocol,observe

CONFIG=dict(bind_ip='0.0.0.0',port=5005,max_packet_size=2048,packet_profile='sr-sdes')
FIELDS=(0x10203040,0xffffffff,0xfedcba98,0x12345678,0xffffffff,0xfffffffe)
def packet(kind,body,count=0,padding=0):
    return struct.pack('!BBH',128|count|(32 if padding else 0),kind,(len(body)+padding)//4)+body+(b'\xa5'*(padding-1)+bytes([padding]) if padding else b'')
def chunk(ssrc,items):
    body=struct.pack('!I',ssrc)+b''.join(bytes([kind,len(value)])+value for kind,value in items)+b'\0'
    return body+b'\0'*((-len(body))%4)
def sr(fields=FIELDS,blocks=b'',extra=b''):return packet(200,struct.pack('!6I',*fields)+blocks+extra,len(blocks)//24)

def sdes(ssrc=FIELDS[0],name=b'x'):return packet(202,chunk(ssrc,[(1,name)]),1)

class WireTests(unittest.TestCase):
    def test_discriminator_and_types_are_required_without_rtp_shape_change(self):
        self.assertEqual(validate_config(CONFIG),CONFIG)
        old=dict(CONFIG);old.pop('packet_profile')
        for value in (old,dict(CONFIG,packet_profile=None),dict(CONFIG,packet_profile='other'),dict(CONFIG,extra=1),dict(CONFIG,port=True),dict(CONFIG,max_packet_size=63)):
            with self.assertRaises(ValueError):validate_config(value)
    def test_all_public_cases_fit64_and_independently_constructed_fields_match(self):
        for method in ('SR_SDES','REPORT_BLOCKS','SDES_ITEMS','PADDING'):
            for n in (1,2):
                raw,expected=case_packets(method,n)[0];self.assertLessEqual(len(raw),64);self.assertEqual(decode_compound(raw),expected)
    def test_report_count31_and_exact_ntp_are_preserved(self):
        raw=sr(blocks=b'x'*(31*24),extra=b'ext!')+sdes();p=decode_compound(raw)['primary_sr'];self.assertEqual(p['ntp64_hex'],'fffffffffedcba98');self.assertEqual(p['report_count'],31);self.assertEqual(p['report_blocks']['length'],744);self.assertEqual(p['profile_extension'],bytes_info(b'ext!'))
    def test_cname_in_last_of31_chunks_is_not_lost(self):
        chunks=[chunk(n,[(1,b'other')]) for n in range(30)]+[chunk(FIELDS[0],[(1,'名字'.encode())])]
        value=decode_compound(sr()+packet(202,b''.join(chunks),31));self.assertEqual(value['sdes_chunk_count'],31);self.assertEqual(value['cname'],'名字')
    def test_summary_cap_does_not_skip_late_cname_or_late_validation(self):
        raw=sr()+b''.join(sdes(n,b'other') for n in range(7))+sdes()
        value=decode_compound(raw);self.assertEqual(value['subpacket_count'],9);self.assertEqual(len(value['subpackets']),8);self.assertTrue(value['subpackets_truncated']);self.assertEqual(value['cname'],'x')
        with self.assertRaisesRegex(PacketError,'wrong_version'):decode_compound(raw+b'\x40\xca\0\0')
        with self.assertRaisesRegex(PacketError,'conflicting_cname'):decode_compound(sr()+sdes(name=b'x')+b''.join(sdes(n,b'other') for n in range(7))+sdes(name=b'y'))
    def test_ninth_item_cname_remains_mandatory_and_complete(self):
        raw=sr()+packet(202,chunk(FIELDS[0],[(n,b'opaque') for n in range(2,10)]+[(1,b'last-cname')]),1)
        value=decode_compound(raw);self.assertEqual(value['cname'],'last-cname');self.assertEqual(value['matching_item_count'],9);self.assertEqual(len(value['matching_items']),8);self.assertTrue(value['matching_items_truncated'])
    def test_cname_profile_rejections(self):
        for items,code in [([(1,b'')],'empty_cname'),([(1,b'\xff')],'invalid_cname_utf8'),([(1,b'a'),(1,b'a')],'duplicate_cname'),([(2,b'name')],'compound_missing_cname')]:
            with self.assertRaisesRegex(PacketError,code):decode_compound(sr()+packet(202,chunk(FIELDS[0],items),1))
    def test_whole_compound_structure_rejections(self):
        valid=sr()+sdes();aligned_bad=bytearray(chunk(FIELDS[0],[(1,b'ab')]));aligned_bad[-1]=1
        vectors=[(b'x','short_header'),(valid+b'x','compound_unaligned'),(b'\x40'+valid[1:],'wrong_version'),(b'\x80\xc8\xff\xff','packet_length_overrun'),(packet(201,b''),'compound_first_not_sr'),(valid+packet(203,b''),'unsupported_packet_type'),(packet(200,struct.pack('!6I',*FIELDS),1)+sdes(),'sr_count_length'),(sr()+packet(202,b'',1),'truncated_sdes_chunk'),(sr()+packet(202,struct.pack('!I',FIELDS[0]),1),'missing_sdes_end'),(sr()+packet(202,bytes(aligned_bad),1),'invalid_sdes_alignment'),(packet(200,struct.pack('!6I',*FIELDS),padding=4)+sdes(),'padding_not_last'),(sr()+sdes()+b'\xa0\xca\0\1\0\0\0\0','invalid_padding')]
        for raw,code in vectors:
            with self.assertRaisesRegex(PacketError,code):decode_compound(raw)
    def test_max_aligned65504_and_trailing_bad_never_commits_partial_success(self):
        raw=sr(extra=b'x'*65464)+sdes();self.assertEqual(len(raw),65504);self.assertEqual(decode_compound(raw)['primary_sr']['profile_extension']['length'],65464)
        state=ReceiverState(CONFIG);state.receive(sr()+sdes()+b'\x40\xca\0\0',('192.0.2.1',40000));self.assertEqual(state.stats['accepted'],0);self.assertEqual(len(state.sources),0);self.assertNotIn('rtcp',state.events[0])
    def test_same_hash_large_metadata_query_is_byte_bounded_without_field_deletion(self):
        raw=sr()+b''.join(packet(202,chunk(FIELDS[0],[(1,b'\x01'*255),(99,b'v'*255)]),1) for _ in range(8));state=ReceiverState(dict(CONFIG,max_packet_size=65507))
        for _ in range(300):state.receive(raw,('192.0.2.1',65535))
        query=state.observations(0,bytes_info(raw)['sha256']);self.assertEqual(query['matched_count'],256);self.assertLess(query['returned_count'],16);self.assertGreater(query['returned_count'],0);self.assertTrue(query['truncated']);self.assertLessEqual(len(json.dumps(query,separators=(',',':')).encode()),65536)
        for event in query['events']:self.assertEqual(event['rtcp']['cname'],'\x01'*255);self.assertEqual(event['rtcp']['primary_sr']['ntp64_hex'],'fffffffffedcba98')
        self.assertEqual(state.stats['event_evictions'],44);self.assertEqual(state.log_queue.qsize(),256)
        for n in range(140):state.receive(sr((n,*FIELDS[1:]))+sdes(n),('192.0.2.1',40000+n))
        self.assertEqual(len(state.sources),128);self.assertLessEqual(len(json.dumps(state.status(),separators=(',',':')).encode()),65536)
    def test_stale_wrong_hash_cname_ntp_and_type_fail_proof(self):
        raw,expected=build_compound(FIELDS,b'nonce');state=ReceiverState(CONFIG);state.receive(raw,('192.0.2.1',40000));query=state.observations(0,bytes_info(raw)['sha256']);baseline=dict(boot_id=state.boot_id,counter=0);self.assertEqual(len(validate_observations(query,baseline,raw,expected)),1)
        for field in ('boot','stale','raw','cname','ntp','type'):
            bad=copy.deepcopy(query)
            if field=='boot':bad['boot_id']='0'*32
            elif field=='stale':bad['events'][0]['event_id']=0
            elif field=='raw':bad['events'][0]['raw']['sha256']='0'*64
            elif field=='cname':bad['events'][0]['rtcp']['cname']='wrong'
            elif field=='ntp':bad['events'][0]['rtcp']['primary_sr']['ntp64_hex']='0'*16
            else:bad['events'][0]['rtcp']['primary_sr']['sender_packet_count']=float(0xffffffff)
            with self.assertRaises(ValueError):validate_observations(bad,baseline,raw,expected)

class ObserverTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.state=ReceiverState(CONFIG);self.state.udp_bound=['0.0.0.0',5005];self.state.fatal=asyncio.get_running_loop().create_future()
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
        RtcpProtocol(self.state).connection_lost(None)
        with self.assertRaisesRegex(RuntimeError,'listener closed'):await self.state.fatal
