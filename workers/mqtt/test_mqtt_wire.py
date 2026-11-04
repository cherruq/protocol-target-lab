"""Focused parser/resource-boundary checks; interoperability uses a real broker."""
import socket
import unittest
from mqtt_wire import MAX_PACKET,packet,properties,read_varint,receive,validate_config,varint

class WireTests(unittest.TestCase):
    def test_variable_integer_boundaries_and_noncanonical(self):
        for n in (0,127,128,16383,16384,2097151,2097152,268435455):
            raw=varint(n);self.assertEqual(read_varint(raw),(n,len(raw)))
        for raw in (b'\x80\0',b'\x80',b'\xff\xff\xff\xff\0'):
            with self.assertRaises(ValueError):read_varint(raw)
    def test_oversized_frame_rejected_before_body(self):
        a,b=socket.socketpair()
        try:
            a.sendall(b'\x30'+varint(MAX_PACKET))
            with self.assertRaisesRegex(ValueError,'exceeds'):receive(b,MAX_PACKET)
        finally:a.close();b.close()
    def test_fragmented_frame_and_coalescing(self):
        a,b=socket.socketpair()
        try:
            a.sendall(packet(0xd0)+packet(0x40,b'\0\1'))
            self.assertEqual(receive(b,128)[:2],(0xd0,b''))
            self.assertEqual(receive(b,128)[:2],(0x40,b'\0\1'))
        finally:a.close();b.close()
    def test_properties_declared_boundary(self):
        self.assertEqual(properties(b'\x05\x27\0\x10\0\0',0),([{'id':39,'value':1048576}],6))
        for raw in (b'\x01\x27',b'\x02\xff\0',b'\x01\x26\0\0\0\0',varint(258)+b'\x01\0'*129):
            with self.assertRaises(ValueError):properties(raw,0)
    def test_config_strict_types_and_limits(self):
        cfg=dict(bind_ip='0.0.0.0',port=18883,max_connections=32,max_packet_size=1048576)
        self.assertEqual(validate_config(cfg),cfg)
        for key,value in (('port',True),('max_connections',0),('max_packet_size',127),('max_packet_size',1048577),('bind_ip',None),('bind_ip','224.0.0.1')):
            with self.assertRaises((ValueError,TypeError)):validate_config(dict(cfg,**{key:value}))
        with self.assertRaises(ValueError):validate_config(dict(cfg,unknown=1))
        self.assertEqual(validate_config(dict(cfg,max_connections=1,max_packet_size=128))['max_packet_size'],128)

if __name__=='__main__':unittest.main()
