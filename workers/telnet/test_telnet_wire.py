"""Independent parser segmentation, byte escaping, config and SB budget boundaries."""
import unittest
from telnet_wire import *

class WireTests(unittest.TestCase):
    def test_every_split_of_escaped_iac_and_subnegotiation(self):
        wire=b'abc'+escape(b'\xff')+negotiation(DO,TTYPE)+subnegotiation(NAWS,b'\0\xff\0\x25')+b'end'
        for split in range(len(wire)+1):
            decoder=Decoder();a,x=decoder.feed(wire[:split]);b,y=decoder.feed(wire[split:])
            self.assertEqual(a+b,b'abc\xffend')
            self.assertEqual(x+y,[('negotiation',DO,TTYPE),('subnegotiation',NAWS,b'\0\xff\0\x25')])
    def test_subnegotiation_budget_fragmented_and_reset(self):
        guard=SubnegotiationBudget(limit=64)
        for _ in range(10):
            for byte in subnegotiation(TTYPE,b'\0'+b'x'*59):guard.feed(bytes([byte]))
        guard.feed(bytes([IAC,SB,TTYPE])+b'x'*63)
        with self.assertRaisesRegex(ValueError,'budget'):guard.feed(b'x')
    def test_empty_subnegotiation_rejected_before_native(self):
        guard=SubnegotiationBudget()
        guard.feed(bytes([IAC,SB,IAC]))
        with self.assertRaisesRegex(ValueError,'empty'):guard.feed(bytes([SE]))
    def test_budget_does_not_limit_normal_lifetime_data(self):
        guard=SubnegotiationBudget(limit=16)
        for _ in range(100):guard.feed(b'normal application text'+escape(b'\xff')+negotiation(DO,255))
        self.assertEqual(guard.state,'data')
    def test_config_utf8_bytes_controls_and_types(self):
        cfg=dict(bind_ip='0.0.0.0',port=2323,banner='Telnet',max_connections=16,max_line_bytes=4096)
        self.assertEqual(validate_config(dict(cfg,banner='界'*85))['banner'],'界'*85)
        for key,value in [('banner','界'*86),('banner',''),('banner','a\n'),('banner','a\x7f'),('port',True),('max_line_bytes',63),('max_connections',129),('bind_ip',None),('bind_ip','224.0.0.1')]:
            with self.assertRaises((ValueError,TypeError)):validate_config(dict(cfg,**{key:value}))
        with self.assertRaises(ValueError):validate_config(dict(cfg,unknown=True))
        self.assertEqual(validate_config(dict(cfg,max_line_bytes=64,max_connections=1))['max_connections'],1)

if __name__=='__main__':unittest.main()
