"""Meaningful configuration, capture boundary and fixed-frame tests; no host packets."""
import copy
import argparse
import json
import socket
import struct
import unittest
import threading
import time
from ethernet_wire import *
from client import matching_frame, Observer, restore_response

class ConfigTests(unittest.TestCase):
    def setUp(self):self.c=copy.deepcopy(DEFAULT_CONFIG)
    def test_default78(self):
        c=validate_config(self.c);self.assertEqual(len(response_frame(c)),78);self.assertEqual(len(bytes.fromhex(c['test_request']['frame_hex'])),78)
    def test_unknown(self):
        self.c['extra']=0
        with self.assertRaises(ValueError):validate_config(self.c)
    def test_null(self):
        self.c['response']=None
        with self.assertRaises(ValueError):validate_config(self.c)
    def test_bool_integer(self):
        self.c['response']['payload']['ether_type']=True
        with self.assertRaises(ValueError):validate_config(self.c)
    def test_mac_canonical(self):
        self.c['local_mac']='02:AA:BB:CC:DD:EE';self.assertEqual(validate_config(self.c)['local_mac'],'02:aa:bb:cc:dd:ee')
    def test_invalid_local(self):
        self.c['local_mac']='ff:ff:ff:ff:ff:ff'
        with self.assertRaises(ValueError):validate_config(self.c)
    def test_banks_independent(self):
        self.c['response']['frame_hex']='00'*14;c=validate_config(self.c);self.assertEqual(len(response_frame(c)),78);c['response']['mode']='frame';self.assertEqual(response_frame(c),bytes(14))
    def test_inactive_bank_invalid(self):
        self.c['response']['frame_hex']='00'
        with self.assertRaises(ValueError):validate_config(self.c)
    def test_source_interface_ignores_saved_override(self):
        self.c['response']['payload']['source_mac']['value']='02:11:22:33:44:55';self.assertEqual(response_frame(validate_config(self.c))[6:12],mac(self.c['local_mac']))
    def test_source_override(self):
        self.c['response']['payload']['source_mac']={'mode':'override','value':'02:11:22:33:44:55'};self.assertEqual(response_frame(validate_config(self.c))[6:12],bytes.fromhex('021122334455'))
    def test_vlan_priority(self):
        self.c['response']['payload']['vlan']={'enabled':True,'vid':0,'pcp':7,'dei':True};r=response_frame(validate_config(self.c));self.assertEqual(r[12:18],bytes.fromhex('8100f00088b5'))
    def test_tagged_static_limit(self):
        p=self.c['response']['payload'];p['vlan']['enabled']=True;p['payload_hex']='00'*65518
        with self.assertRaises(ValueError):validate_config(self.c)
    def test_untagged_static_limit(self):
        self.c['response']['payload']['payload_hex']='00'*65521;self.assertEqual(len(response_frame(validate_config(self.c))),65535)
    def test_multicast_duplicate(self):
        self.c['multicast_macs']=['01:00:5e:00:00:01']*2
        with self.assertRaises(ValueError):validate_config(self.c)
    def test_filter_whitespace(self):
        self.c['packet_filter']=' \n'
        with self.assertRaises(ValueError):validate_config(self.c)
    def test_marker_empty(self):
        self.c['request_marker_hex']=''
        with self.assertRaises(ValueError):validate_config(self.c)
    def test_marker_disabled(self):self.c['request_marker_hex']=None;self.assertIsNone(validate_config(self.c)['request_marker_hex'])
    def test_hex_strict(self):
        self.c['test_request']['frame_hex']='0x'+self.c['test_request']['frame_hex']
        with self.assertRaises(ValueError):validate_config(self.c)
    def test_mtu_only_selected(self):
        self.c['response']['frame_hex']='00'*2000;c=validate_config(self.c);mtu_check(response_frame(c),1500);c['response']['mode']='frame'
        with self.assertRaises(ValueError):mtu_check(response_frame(c),1500)

class ArgumentTests(unittest.TestCase):
    def test_ordered_parts(self):
        text=json.dumps(DEFAULT_CONFIG);p=argparse.ArgumentParser();config_arguments(p)
        args=p.parse_args(['--config-json-part',text[:70],'--config-json-part',text[70:]])
        self.assertEqual(config_from_arguments(args),validate_config(DEFAULT_CONFIG))
    def test_unicode_boundary(self):
        c=copy.deepcopy(DEFAULT_CONFIG);c['packet_filter']='ether proto 0x88b5 #文';text=json.dumps(c,ensure_ascii=False);parts=[text[:text.index('文')],text[text.index('文'):]]
        args=argparse.Namespace(config_json=None,config_json_part=parts)
        self.assertEqual(config_from_arguments(args)['packet_filter'],c['packet_filter'])
    def test_byte_bound(self):
        with self.assertRaises(ValueError):config_from_arguments(argparse.Namespace(config_json=None,config_json_part=['文'*20001]))
    def test_single_parts_exclusive(self):
        p=argparse.ArgumentParser();config_arguments(p)
        with self.assertRaises(SystemExit):p.parse_args(['--config-json','{}','--config-json-part','{}'])

    def test_canonical_unicode_utf8(self):
        c=copy.deepcopy(DEFAULT_CONFIG);c['packet_filter']='ether proto 0x88b5 #文'
        raw=canonical(validate_config(c));self.assertIn('文'.encode(),raw);self.assertNotIn(b'\\u6587',raw)

class OpaqueResponseTests(unittest.TestCase):
    def setUp(self):self.raw=bytes.fromhex(DEFAULT_CONFIG['response']['frame_hex'])
    def test_opaque_tags_preserved(self):
        for tag in (bytes.fromhex('88a80007'),bytes.fromhex('91000007'),bytes.fromhex('8100000781000008')):
            raw=self.raw[:12]+tag+self.raw[12:];actual,meta=restore_response(raw,0,[])
            self.assertEqual(actual,raw);self.assertTrue(meta['opaque'])
            with self.assertRaises(PacketError):normalize(raw,0,[])
    def test_actual_aux_tpid(self):
        data=struct.pack('IIIHHHH',(1<<4)|(1<<6),len(self.raw),len(self.raw),0,14,7,0x88a8)
        restored,meta=restore_response(self.raw,0,[(263,8,data)])
        self.assertEqual(restored,self.raw[:12]+bytes.fromhex('88a80007')+self.raw[12:]);self.assertTrue(meta['vlan']['auxdata']['tpid_from_auxdata'])
    def test_unknown_aux_tpid_not_expected_invention(self):
        data=struct.pack('IIIHHHH',1<<4,len(self.raw),len(self.raw),0,14,7,0x88a8)
        restored,meta=restore_response(self.raw,0,[(263,8,data)])
        self.assertEqual(restored[12:16],bytes.fromhex('81000007'));self.assertFalse(meta['vlan']['auxdata']['tpid_from_auxdata'])
        self.assertIsNone(matching_frame(restored,self.raw[:12]+bytes.fromhex('88a80007')+self.raw[12:]))
    def test_capture_flags_and_bounds_still_rejected(self):
        with self.assertRaises(PacketError):restore_response(self.raw,socket.MSG_TRUNC,[])
        with self.assertRaises(PacketError):restore_response(self.raw+bytes(65536-len(self.raw)),0,[])

class ObserverBudgetTests(unittest.TestCase):
    def fixture(self,handler):
        listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(1);listener.settimeout(.5)
        def run():
            try:
                conn,_=listener.accept()
                with conn:handler(conn)
            except OSError:pass
            finally:listener.close()
        thread=threading.Thread(target=run,daemon=True);thread.start();self.addCleanup(lambda:thread.join(.7))
        o=Observer('127.0.0.1',listener.getsockname()[1],'boot','runtime',DEFAULT_CONFIG);return o
    def test_absolute_slow_drip_headers(self):
        def handle(conn):
            conn.recv(8192)
            for byte in b'HTTP/1.1 200 OK\r\n':conn.sendall(bytes([byte]));time.sleep(.03)
        o=self.fixture(handle);o.phase=time.monotonic()+.12;start=time.monotonic()
        with self.assertRaises((TimeoutError,OSError)):o.get('/v1/status')
        self.assertLess(time.monotonic()-start,.3)
    def test_stale_identity_rejected(self):
        def handle(conn):
            conn.recv(8192);raw=json.dumps({'schema_version':1,'protocol':'custom-ethernet','boot_id':'wrong','runtime_id':'runtime'}).encode();conn.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: '+str(len(raw)).encode()+b'\r\n\r\n'+raw)
        o=self.fixture(handle);o.phase=time.monotonic()+1
        with self.assertRaisesRegex(ValueError,'identity changed'):o.get('/v1/status')

class CaptureTests(unittest.TestCase):
    def setUp(self):self.raw=bytes.fromhex(DEFAULT_CONFIG['test_request']['frame_hex'])
    def aux(self,status,tci=0,tpid=0):return [(263,8,struct.pack('IIIHHHH',status,len(self.raw),len(self.raw),0,14,tci,tpid))]
    def test_ordinary(self):r,d=normalize(self.raw,0,[]);self.assertEqual(r,self.raw);self.assertEqual(d['payload_offset'],14)
    def test_aux_zero(self):r,d=normalize(self.raw,0,self.aux(1<<4));self.assertEqual(r[12:18],bytes.fromhex('8100000088b5'));self.assertFalse(d['vlan']['auxdata']['tpid_from_auxdata'])
    def test_aux_known_tpid(self):r,d=normalize(self.raw,0,self.aux((1<<4)|(1<<6),0xa007,0x8100));self.assertEqual(d['vlan']['vid'],7);self.assertEqual(d['vlan']['pcp'],5)
    def test_aux_nested_reject(self):
        raw=self.raw[:12]+bytes.fromhex('81000007')+self.raw[12:]
        with self.assertRaises(PacketError):normalize(raw,0,self.aux(1<<4))
    def test_other_outer_reject(self):
        raw=self.raw[:12]+bytes.fromhex('88a80007')+self.raw[12:]
        with self.assertRaises(PacketError):normalize(raw,0,[])
    def test_truncated(self):
        for flag in (socket.MSG_TRUNC,socket.MSG_CTRUNC):
            with self.assertRaises(PacketError):normalize(self.raw,flag,[])
    def test_original_oversize(self):
        with self.assertRaises(PacketError):normalize(self.raw+bytes(65536-len(self.raw)),0,[])
    def test_reconstruct_oversize(self):
        with self.assertRaises(PacketError):normalize(self.raw+bytes(65532-len(self.raw)),0,self.aux(1<<4))
    def test_malformed_aux(self):
        with self.assertRaises(PacketError):normalize(self.raw,0,[(263,8,b'')])
    def test_short_tag(self):
        with self.assertRaises(PacketError):normalize(self.raw[:12]+b'\x81\x00',0,[])
    def test_padding_exact_bound(self):
        raw=self.raw[:42];self.assertEqual(matching_frame(raw+bytes(18),raw),'driver_zero_padding_to60');self.assertIsNone(matching_frame(raw+bytes(19),raw))
    def test_long_frame_never_padding(self):self.assertIsNone(matching_frame(self.raw+b'\0',self.raw))

if __name__=='__main__':unittest.main()
