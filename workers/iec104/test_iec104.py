"""Configuration, finite ASDU parser and APCI sequence boundary tests."""
import copy
import socket
import struct
import time
import unittest
from iec104_config import float32,validate_config
from iec104_wire import Session,asdu,decode_asdu

CONFIG=dict(bind_ip='0.0.0.0',port=2404,max_connections=16,points=dict(single=dict(ca=1,ioa=1,value=False),measured=dict(ca=1,ioa=100,value=12.5),command=dict(ca=2,ioa=1)))
class ProtocolTests(unittest.TestCase):
    def test_config_types_ranges_unique_and_float32(self):
        cfg=copy.deepcopy(CONFIG);cfg['points']['measured']['value']=.1
        self.assertEqual(validate_config(cfg)['points']['measured']['value'],float32(.1))
        for key,value in [('port',True),('port',0),('max_connections',65),('bind_ip','224.0.0.1')]:
            with self.assertRaises(ValueError):validate_config(dict(CONFIG,**{key:value}))
        for value in (True,float('inf'),float('nan'),10**1000):
            cfg=copy.deepcopy(CONFIG);cfg['points']['measured']['value']=value
            with self.assertRaises(ValueError):validate_config(cfg)
        cfg=copy.deepcopy(CONFIG);cfg['points']['command']=dict(ca=1,ioa=1)
        with self.assertRaises(ValueError):validate_config(cfg)
        cfg=copy.deepcopy(CONFIG);cfg['points']['single'].update(ca=65534,ioa=16777215)
        self.assertEqual(validate_config(cfg)['points']['single']['ioa'],16777215)
    def test_data_and_control_shapes(self):
        self.assertTrue(decode_asdu(asdu(1,5,1,16777215,b'\1'))['objects'][0]['value'])
        for kind,body in [(1,b'\2'),(45,b'\2')]:
            with self.assertRaisesRegex(ValueError,'reserved'):decode_asdu(asdu(kind,7,1,1,body))
        for kind,payload in [(45,b'\0'),(100,b'\x14'),(102,b'')]:
            raw=bytearray(asdu(kind,7,1,1,payload));raw[1]=129
            with self.assertRaisesRegex(ValueError,'shape'):decode_asdu(raw)
    def test_truncation_and_sequence_ioa_overflow(self):
        raw=asdu(13,20,1,100,struct.pack('<f',.1)+b'\0')
        for size in range(len(raw)):
            with self.assertRaises((ValueError,IndexError)):decode_asdu(raw[:size])
        raw=bytes([1,130,20,0,1,0])+b'\xff\xff\xff\0\1'
        with self.assertRaisesRegex(ValueError,'IOA range'):decode_asdu(raw)
    def test_coalesced_i_and_s_frames_and_ack_sequences(self):
        a,b=socket.socketpair();session=Session.__new__(Session);session.sock=b;session.deadline=time.monotonic()+2;session.trace=[];session.tx=1;session.rx=0;session.acked=0;session.frames=0
        try:
            payload=asdu(1,5,1,1,b'\1');a.sendall(bytes([0x68,4+len(payload),0,0,2,0])+payload+b'\x68\4\1\0\2\0')
            self.assertEqual(session.frame()[0],'I');self.assertEqual(a.recv(6),b'\x68\4\1\0\2\0')
            self.assertEqual(session.frame(),('S',1))
            a.sendall(b'\x68\4\1\0\4\0')
            with self.assertRaisesRegex(ValueError,'unsent'):session.frame()
        finally:a.close();b.close()
    def test_read_requires_native_confirmation_and_real_data_in_either_order(self):
        point=dict(ca=1,ioa=1)
        confirmation=decode_asdu(asdu(102,7,1,1))
        data=decode_asdu(asdu(1,5,1,1,b'\1'))
        for messages in ([confirmation,data],[data,confirmation]):
            session=Session.__new__(Session);session.send_i=lambda payload:None
            incoming=iter(messages);session.application=lambda:next(incoming)
            self.assertTrue(session.read(point,1))
        session=Session.__new__(Session);session.send_i=lambda payload:None
        incoming=iter([confirmation,confirmation]);session.application=lambda:next(incoming)
        with self.assertRaisesRegex(ValueError,'duplicate'):session.read(point,1)
    def test_u_frame_not_interchangeable(self):
        a,b=socket.socketpair();session=Session.__new__(Session);session.sock=b;session.deadline=time.monotonic()+2;session.trace=[];session.tx=0;session.rx=0;session.acked=0;session.frames=0
        try:
            a.sendall(b'\x68\4\x23\0\0\0')
            with self.assertRaisesRegex(ValueError,'unexpected U'):session.u(7,11)
        finally:a.close();b.close()
if __name__=='__main__':unittest.main()
