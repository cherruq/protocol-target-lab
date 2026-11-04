#!/usr/bin/env python3
import copy
import json
import random
import unittest
import socket
import threading
import time
from types import SimpleNamespace
from bfd_wire import DEFAULT_CONFIG,Control,PacketError,decode,load_config,validate_config,canonical_hash,Transport
from state import Session
from client import budgets,idle,Observer,Peer

class ConfigTests(unittest.TestCase):
    def config(self):return copy.deepcopy(DEFAULT_CONFIG)
    def test_all_required_and_unknown(self):
        for key in DEFAULT_CONFIG:
            c=self.config();del c[key]
            with self.assertRaises(ValueError):validate_config(c)
        c=self.config();c['extra']=1
        with self.assertRaises(ValueError):validate_config(c)
    def test_strict_integer_nulls(self):
        for key in ['source_port','local_discriminator','min_tx_us','min_rx_us','detect_mult']:
            for value in [True,None,-1]:
                c=self.config();c[key]=value
                with self.assertRaises(ValueError):validate_config(c)
    def test_all_scenario_shapes(self):
        for mode in ['normal','poll','quiet','wrong-your','ttl254','short']:
            c=self.config();c['scenario']={'mode':mode}
            if mode!='normal':c['scenario']['after_up_ms']=0
            if mode not in ['normal','poll']:c['scenario']['duration_ms']=4000
            validate_config(c)
            c['scenario']['extra']=0
            with self.assertRaises(ValueError):validate_config(c)
    def test_ifname_and_addresses(self):
        for interface in ['a:b','../lo','bad space','-bad','a'*16]:
            c=self.config();c['interface']=interface
            with self.assertRaises(ValueError):validate_config(c)
        for addr in ['0.0.0.0','239.1.2.3','255.255.255.255',None]:
            c=self.config();c['peer_ip']=addr
            with self.assertRaises(ValueError):validate_config(c)
    def test_canonical_sorted(self):
        c=self.config();self.assertEqual(canonical_hash(c),canonical_hash(dict(reversed(list(c.items())))))
        self.assertEqual(load_config(json.dumps(c)),c)
    def test_budget_default_six_modes(self):
        for mode in ['normal','poll','quiet','wrong-your','ttl254','short']:
            c=self.config();c['scenario']={'mode':mode}
            if mode!='normal':c['scenario']['after_up_ms']=1000
            if mode not in ['normal','poll']:c['scenario']['duration_ms']=4000
            self.assertTrue(all(x<=15 for x in budgets(c).values()))
    def test_budget_refuses_large_or_unobservable(self):
        for scenario in [{'mode':'short','after_up_ms':1000,'duration_ms':1},{'mode':'poll','after_up_ms':3600000}]:
            c=self.config();c['scenario']=scenario
            with self.assertRaises(ValueError):budgets(c)
    def test_idle_guard(self):
        status={'local_state':'Up','last_valid_age_ms':None,'remote_state':'Down','receive_detection_us':3000000}
        with self.assertRaises(ValueError):idle(status)
        status.update(local_state='Down',last_valid_age_ms=100)
        with self.assertRaises(ValueError):idle(status)
        status['remote_state']='AdminDown';idle(status)

class WireTests(unittest.TestCase):
    def test_exact_codec_and_trailing(self):
        p=Control(my_discriminator=123);self.assertEqual(len(p.encode()),24)
        self.assertEqual(decode(p.encode()+b'tail'),p)
    def test_invalid_basics(self):
        good=bytearray(Control().encode())
        for pos,value in [(0,0),(2,0),(3,23),(3,25),(1,0x41),(1,0x44),(1,0x42),(1,0x70)]:
            raw=bytearray(good);raw[pos]=value
            with self.assertRaises(PacketError):decode(raw)
        with self.assertRaises(PacketError):decode(b'1234567')
    def test_strict_actual_metadata(self):
        t=object.__new__(Transport);t.address='127.0.0.1';t.ifindex=1
        meta={'ancillary_truncated':False,'source':['127.0.0.2',55029],'ttl':255,'ifindex':1,'local_destination':'127.0.0.1'}
        t.validate(meta,'127.0.0.2')
        for key,value in [('ttl',254),('ttl',None),('ifindex',2),('local_destination','127.0.0.3'),('ancillary_truncated',True)]:
            bad={**meta,key:value}
            with self.assertRaises(PacketError):t.validate(bad,'127.0.0.2')

class StateTests(unittest.TestCase):
    def session(self,mode='normal'):
        c=copy.deepcopy(DEFAULT_CONFIG)
        c['scenario']={'mode':mode}
        if mode!='normal':c['scenario']['after_up_ms']=1000
        if mode not in ('normal','poll'):c['scenario']['duration_ms']=4000
        return Session(c,rng=random.Random(4))
    def up(self,s,my=10):
        s.receive(Control(my_discriminator=my),0)
        s.receive(Control(state=3,my_discriminator=my,your_discriminator=s.cfg['local_discriminator']),.1)
        self.assertEqual(s.state,3)
        s.submitted(s.control(),.2,True,True)
        return s
    def test_handshake_and_real_send_arming(self):
        s=self.session('quiet');s.receive(Control(my_discriminator=10),0);s.receive(Control(state=3,my_discriminator=10,your_discriminator=s.cfg['local_discriminator']),.1)
        self.assertIsNone(s.armed);s.submitted(s.control(),.2,True,False);self.assertIsNone(s.armed)
        s.submitted(s.control(),.3,True,True);self.assertAlmostEqual(s.trigger,1.3)
    def test_epoch_retained_across_timeout_and_recovery(self):
        s=self.up(self.session('short'));epoch=s.epoch_id;s.tick(3.2)
        self.assertEqual(s.state,1);self.assertEqual(s.epoch_peer_discriminator,10)
        s.receive(Control(my_discriminator=10),3.3);s.receive(Control(state=3,my_discriminator=10,your_discriminator=s.cfg['local_discriminator']),3.4)
        self.assertEqual(s.epoch_id,epoch);self.assertAlmostEqual(s.trigger,1.2)
        s.receive(Control(my_discriminator=20),3.5);self.assertEqual(s.epoch_id,epoch+1);self.assertIsNone(s.trigger)
    def test_up_my_change_wrong_your_double_exclusion(self):
        s=self.up(self.session('wrong-your'));epoch=s.epoch_id
        s.receive(Control(state=3,my_discriminator=11,your_discriminator=s.cfg['local_discriminator']),.4)
        self.assertEqual(s.epoch_id,epoch);self.assertEqual(s.epoch_peer_discriminator,10)
        raw,ttl=s.transform(s.control(),2)
        self.assertNotIn(decode(raw).your_discriminator,(0,10,11));self.assertEqual(ttl,255)
    def test_early_final_does_not_complete_target_poll(self):
        s=self.up(self.session('poll'));s.tick(1.3)
        self.assertTrue(s.poll_pending)
        final=Control(state=3,final=True,my_discriminator=10,your_discriminator=s.cfg['local_discriminator'])
        s.receive(final,1.4);self.assertFalse(s.poll_completed)
        s.submitted(s.control(),1.5,True,True);s.receive(final,1.6);self.assertTrue(s.poll_completed)
    def test_fault_transforms_final_too(self):
        for mode in ['quiet','short','ttl254','wrong-your']:
            s=self.up(self.session(mode));s.tick(2);raw,ttl=s.transform(s.control(True),2)
            if mode=='quiet':self.assertIsNone(raw)
            elif mode=='short':self.assertEqual(len(raw),7)
            elif mode=='ttl254':self.assertEqual(ttl,254)
            else:self.assertNotEqual(decode(raw).your_discriminator,10)
    def test_window_continues_down_and_not_rearmed(self):
        s=self.up(self.session('quiet'));s.tick(2);s.receive(Control(state=0,my_discriminator=10,your_discriminator=s.cfg['local_discriminator']),2.1)
        self.assertEqual(s.active_fault(3),'quiet');s.tick(5.3);self.assertEqual(s.phase,'complete');self.assertEqual(s.windows_started,1)
        s.receive(Control(my_discriminator=10),6);s.receive(Control(state=3,my_discriminator=10,your_discriminator=s.cfg['local_discriminator']),6.1);s.submitted(s.control(),6.2,True,True)
        self.assertAlmostEqual(s.trigger,1.2)
    def test_timer_direction_and_jitter(self):
        s=self.session();s.receive(Control(my_discriminator=10,detect_mult=4,desired_min_tx_us=2000000,required_min_rx_us=3000000),0)
        self.assertEqual(s.detection_time(),8);self.assertEqual(s.tx_interval(),3)
        self.assertTrue(all(2.25<=s.jitter()<=3 for _ in range(50)))
    def test_rx_zero_stops_periodic_not_final(self):
        s=self.session();s.receive(Control(my_discriminator=10,required_min_rx_us=0,poll=True),0)
        self.assertIsNone(s.tx_interval());self.assertTrue(s.control(True).final)

class CleanupIdentityTests(unittest.TestCase):
    def test_source_identity_failure_precedes_cleanup_send(self):
        peer=object.__new__(Peer);peer.deadline=time.monotonic()+3;peer.epoch=1;peer.my=10;sent=[]
        peer.send=lambda *args,**kwargs:sent.append(args)
        def changed(_deadline):raise ValueError('observer boot changed')
        peer.observer=SimpleNamespace(status=changed)
        with self.assertRaisesRegex(ValueError,'boot changed'):peer.release()
        self.assertEqual(sent,[])
    def test_replaced_epoch_precedes_cleanup_send(self):
        peer=object.__new__(Peer);peer.deadline=time.monotonic()+3;peer.epoch=1;peer.my=10;sent=[]
        peer.send=lambda *args,**kwargs:sent.append(args)
        peer.observer=SimpleNamespace(status=lambda _deadline:{'epoch_id':2,'epoch_peer_discriminator':11})
        with self.assertRaisesRegex(ValueError,'refusing AdminDown'):peer.release()
        self.assertEqual(sent,[])

class ObserverDeadlineTests(unittest.TestCase):
    def test_slow_body_cannot_reset_absolute_deadline(self):
        listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(1)
        listener.settimeout(2);stop=threading.Event()
        def slow():
            try:
                conn,_=listener.accept()
                with conn:
                    conn.settimeout(2);conn.recv(4096)
                    conn.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\n')
                    while not stop.wait(.1):conn.sendall(b' ')
            except OSError:pass
        thread=threading.Thread(target=slow,daemon=True);thread.start()
        args=SimpleNamespace(observer_host='127.0.0.1',observer_port=listener.getsockname()[1],expected_boot_id='test',expected_runtime_id='test')
        started=time.monotonic()
        try:
            with self.assertRaises(TimeoutError):Observer(args,DEFAULT_CONFIG).status(started+3)
            self.assertLess(time.monotonic()-started,1.5)
        finally:stop.set();listener.close();thread.join(timeout=2)

if __name__=='__main__':unittest.main()
