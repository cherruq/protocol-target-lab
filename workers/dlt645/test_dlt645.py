"""Finite software-meter state, byte-stream, privacy and recovery contract tests."""
import copy
import hashlib
import json
import time
import unittest
from unittest.mock import patch
from common import validate_config,sanitize,safe_config
from meter import *
import client

CONFIG=dict(wire_profile='dlt645-2007-tcp',bind_ip='0.0.0.0',port=20645,meter_address='000000000001',energy_hundredths=12345678,period_minutes=30,programming_key_enabled=False,max_connections=16,security={'mode':'reject'})
class CoreTests(unittest.TestCase):
    def test_strict_shape_security_and_integer_bounds(self):
        self.assertEqual(validate_config(CONFIG),CONFIG)
        for key,value in [('wire_profile',None),('max_connections',True),('meter_address','999999999999'),('energy_hundredths',100000000),('period_minutes',0),('security',{'mode':'reject','extra':1})]:
            with self.assertRaises(ValueError):validate_config(dict(CONFIG,**{key:value}))
        missing=dict(CONFIG);missing.pop('wire_profile')
        with self.assertRaises(ValueError):validate_config(missing)
    def test_modulo_and_data16_never_delimit_frame(self):
        raw=encode_frame(address_bytes('000000160068'),0x11,bytes([0xe3,0x35,0xcb,0xff]));self.assertIn(0x16,raw[10:-2]);self.assertEqual(decode_frame(raw).data,bytes([0xe3,0x35,0xcb,0xff]))
        stream=DltStream(max_buffer=4096);found=[]
        for n,b in enumerate(b'\xfe'*4+raw+raw):found.extend(stream.feed(bytes([b]),n*.001).frames)
        self.assertEqual([f.raw for f in found],[raw,raw])
    def test_partial_timeout_and_new_request_are_independent(self):
        raw=encode_frame(POINT_ADDRESS,0x13);stream=DltStream();stream.feed(raw[:9],0);self.assertTrue(stream.expire(.6));self.assertEqual(stream.feed(raw,.61).frames[0].raw,raw)
    def test_invalid_crc_address_or_control_cannot_mutate(self):
        cfg=MeterConfig(CONFIG['meter_address'],30,12345678,True);state=MeterState.create(cfg,0);before=state.snapshot(0)
        bad=bytearray(encode_frame(state.address,0x14,di_bytes(PERIOD_DI)+b'\2\0\0\0'+bytes(4)+b'\x31'));bad[-2]^=1
        with self.assertRaises(DltError):decode_frame(bytes(bad))
        for addr,ctrl in [(address_bytes('000000000002'),0x14),(state.address,0x94)]:self.assertIsNone(handle_request(decode_frame(encode_frame(addr,ctrl,b'')),state,cfg,0).reply)
        self.assertEqual(state.snapshot(0),before)
    def test_full_validation_before_invalid_write_or_auth_commit(self):
        cfg=MeterConfig(CONFIG['meter_address'],30,12345678,True);state=MeterState.create(cfg,0)
        for body in [di_bytes(PERIOD_DI)+b'\2\0\0\0'+bytes(4)+b'\0',di_bytes(PERIOD_DI)+b'\2\1\2\3'+bytes(4)+b'\x31']:
            before=state.snapshot(0);r=handle_request(decode_frame(encode_frame(state.address,0x14,body)),state,cfg,0);self.assertEqual(r.reply.control,0xd4);self.assertEqual(before,state.snapshot(0))
    def test_permissions_are_per_function_not_global_readonly(self):
        cfg=MeterConfig(CONFIG['meter_address'],30,12345678,False);state=MeterState.create(cfg,0)
        self.assertEqual(handle_request(decode_frame(encode_frame(state.address,0x1d,b'\2')),state,cfg,0).reply.control,0x9d)
        self.assertEqual(state.output,2)
        body=b'\2\0\0\0'+bytes(4)+b'\x1a\0'+clock_bytes(datetime(2026,1,1,0,1))
        self.assertEqual(handle_request(decode_frame(encode_frame(state.address,0x1c,body)),state,cfg,0).reply.control,0x9c);self.assertEqual(state.relay,'open')
    def test_true_five_minute_timer_units_without_sleep_or_fake_wire(self):
        cfg=MeterConfig(CONFIG['meter_address'],30,12345678,False);state=MeterState.create(cfg,0)
        body=b'\2\0\0\0'+bytes(4)+b'\x1d\1'+clock_bytes(datetime(2026,1,1,0,1))
        handle_request(decode_frame(encode_frame(state.address,0x1c,body)),state,cfg,0)
        self.assertEqual(state.restore_at,300);self.assertEqual(state.relay,'open');self.assertEqual(state.tick(299),());self.assertTrue(state.tick(300));self.assertEqual(state.relay,'closed')
    def test_log_redaction_removes_raw_auth_and_standalone_password_hashes(self):
        secret=b'\x9a\x7b\x6c';value={'credential_sha256':[hashlib.sha256(secret).hexdigest()],'raw_hex':secret.hex(),'before':{'credential_sha256':['x']}}
        result=sanitize(value);raw=json.dumps(result);self.assertNotIn(secret.hex(),raw);self.assertNotIn(hashlib.sha256(secret).hexdigest(),raw);self.assertNotIn('credential_sha256',raw)
    def test_fixture_is_exact_and_never_crypto(self):
        f=SecurityFixture(0x07000001,0x070000ff,b'abcd',b'12345678',b'abcdefghijkl');cfg=MeterConfig(CONFIG['meter_address'],30,12345678,False,f);state=MeterState.create(cfg,0);body=di_bytes(f.request_di)+f.operator+f.request
        r=handle_request(decode_frame(encode_frame(state.address,3,body)),state,cfg,0);self.assertEqual(r.reply.control,0x83);self.assertEqual(r.reply.data,di_bytes(f.response_di)+f.response);self.assertTrue(any(e.get('crypto_verified') is False for e in r.events))

class RecoveryTests(unittest.TestCase):
    def simulate(self,fail_write=False,fail_restore=False):
        store={'period':30,'writes':[]};trace=[]
        class FakeSession:
            def __init__(self,*args):self.deadline=args[2];self.sock=self
            def current_address(self):return b'\1'+bytes(5)
            def period(self,addr):return store['period']
            def write_period(self,addr,value):
                store['writes'].append(value)
                if len(store['writes'])>1 and fail_restore:raise OSError('injected restore failure')
                store['period']=value
                if len(store['writes'])==1 and fail_write:raise TimeoutError('injected lost write acknowledgement')
            def close(self):pass
        with patch.object(client,'Session',FakeSession):r=client.check('127.0.0.1',1,dict(CONFIG,programming_key_enabled=True),'WRITE_PERIOD',1,time.monotonic()+30)
        return store,r
    def test_lost_write_ack_is_failure_but_actual_mutation_is_restored(self):
        state,r=self.simulate(fail_write=True);self.assertFalse(r['passed']);self.assertTrue(r['response']['restored']);self.assertEqual(state['period'],30);self.assertEqual(state['writes'],[31,30])
    def test_restore_failure_can_never_be_reported_as_success(self):
        state,r=self.simulate(fail_restore=True);self.assertFalse(r['passed']);self.assertFalse(r['response']['restored']);self.assertIn('restore_error',r)
