#!/usr/bin/env python3
"""Contract/parser tests, independent of lib60870 execution."""
import copy
import json
import unittest
import queue
from server import Supervisor
from common import DEFAULT_CONFIG,decode_frame,fixed,gi_request,load_config,validate_config,variable

class ContractTests(unittest.TestCase):
    def config(self): return copy.deepcopy(DEFAULT_CONFIG)
    def test_default_and_null_unknown(self):
        self.assertEqual(load_config(json.dumps(self.config())),self.config())
        for key,value in [('extra',1),('single',None)]:
            c=self.config();c[key]=value
            with self.assertRaises(ValueError):validate_config(c)
    def test_duplicate_key_rejected(self):
        with self.assertRaises(ValueError):load_config('{"single":1,"single":2}')
    def test_two_channels_required(self):
        c=self.config();del c['double']
        with self.assertRaises(ValueError):validate_config(c)
    def test_ports_distinct_bool_not_integer(self):
        for value in (True,0,65536,24741):
            c=self.config();c['double']['port']=value
            with self.assertRaises(ValueError):validate_config(c)
    def test_literal_serial_and_profile(self):
        for value in (9601,True,None):
            c=self.config();c['serial']['baud_rate']=value
            with self.assertRaises(ValueError):validate_config(c)
        c=self.config();c['wire_profile']='rtp'
        with self.assertRaises(ValueError):validate_config(c)
    def test_width_boundaries(self):
        c=self.config();c['single'].update(link_address=254,common_address=254)
        c['single']['point']={'ioa':255,'value':False};c['double'].update(link_address=65534,common_address=65534,originator_address=255)
        c['double']['point']={'ioa':16777215,'value':False}; validate_config(c)
        c['single']['originator_address']=1
        with self.assertRaises(ValueError):validate_config(c)
    def test_point_requires_boolean(self):
        c=self.config();c['double']['point']['value']=1
        with self.assertRaises(ValueError):validate_config(c)
    def test_reset_status_vectors(self):
        self.assertEqual(fixed(0x40,1,1).hex(),'1040014116')
        self.assertEqual(fixed(0x7b,4660,2).hex(),'107b3412c116')
    def test_e5_is_not_asdu(self):
        self.assertEqual(decode_frame(b'\xe5',2),{'kind':'e5','asdu':None})
    def test_gi_asdu_widths_oa(self):
        for name,width in [('single',1),('double',2)]:
            p=self.config()[name];a=bytearray(gi_request(p,width));a[2]=7
            r=decode_frame(variable(8,p['link_address'],width,a),width)['asdu']
            self.assertEqual(r['originator_address'],None if width==1 else 7)
            self.assertEqual(r['common_address'],p['common_address'])
    def test_strict_framing(self):
        raw=variable(8,1,1,b'\x01\x01\x03\x01\x01\x01')
        for index in [1,2,3,len(raw)-1,len(raw)-2]:
            bad=bytearray(raw);bad[index]^=1
            with self.assertRaises(ValueError):decode_frame(bad,1)
    def test_siq_reserved_and_gi_shape(self):
        for a in (b'\x01\x01\x03\x01\x01\x03', b'\x64\x81\x07\x01\x00\x14'):
            with self.assertRaises(ValueError):decode_frame(variable(8,1,1,a),1)

class ResourceTests(unittest.TestCase):
    def test_pending_limit_closes_without_appending_excess(self):
        sup=object.__new__(Supervisor); closed=[]
        sup.close_session=lambda state,reason:closed.append(reason)
        state={'tcp_out':bytearray(b'x'*65535),'tcp_since':None}
        sup.append(state,'tcp_out',b'y')
        self.assertEqual(len(state['tcp_out']),65536)
        sup.append(state,'tcp_out',b'z')
        self.assertEqual(len(state['tcp_out']),65536)
        self.assertEqual(closed,['pending byte limit'])
    def test_logger_overflow_is_observable_failure(self):
        sup=object.__new__(Supervisor);sup.logs=queue.Queue(256)
        for _ in range(256):sup.log('test')
        with self.assertRaisesRegex(RuntimeError,'log queue overflow'):sup.log('excess')
        self.assertEqual(sup.logs.qsize(),256)

if __name__=='__main__':unittest.main()
