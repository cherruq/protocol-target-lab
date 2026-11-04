#!/usr/bin/env python3
"""MIT. Single peer state and once-per-epoch target-side scenarios."""
import random
from bfd_wire import Control,PacketError,STATES

class Session:
    def __init__(self,cfg,emit=None,rng=None):
        self.cfg=cfg;self.emit=emit or (lambda *a,**k:None);self.rng=rng or random.SystemRandom()
        self.state=1;self.diagnostic=0;self.remote_state=1;self.remote_discriminator=0
        self.remote_rx=1;self.remote_tx=1000000;self.remote_mult=3
        self.last_valid=None;self.detection_deadline=None;self.next_send=0.;self.last_periodic=None
        self.epoch_id=0;self.epoch_peer_discriminator=0
        self.armed=None;self.trigger=None;self.end=None;self.normal_up_sent=False
        self.poll_pending=False;self.poll_started=False;self.poll_actual_sent=False;self.poll_completed=False
        self.phase='normal' if cfg['scenario']['mode']=='normal' else 'waiting_up'
        self.windows_started=0
    def tx_interval(self):
        if self.remote_rx==0:return None
        return max(self.cfg['min_tx_us'],self.remote_rx)/1000000
    def detection_time(self):return self.remote_mult*max(self.cfg['min_rx_us'],self.remote_tx)/1000000
    def jitter(self):
        interval=self.tx_interval()
        return None if interval is None else interval*self.rng.uniform(.75,.9 if self.cfg['detect_mult']==1 else 1.)
    def change(self,new,reason):
        old=self.state;self.state=new
        if new==1:
            if self.poll_pending and self.phase=='poll_pending':
                self.phase='poll_aborted';self.emit('scenario_transition',phase='poll_aborted',reason=reason)
            self.poll_pending=False;self.normal_up_sent=False
        if new==3 and old!=3:self.diagnostic=0
        if old!=new:self.emit('state_transition',previous_state=STATES[old],state=STATES[new],reason=reason)
    def new_epoch(self,my,now):
        self.epoch_id+=1;self.epoch_peer_discriminator=my
        self.change(1,'new_peer_epoch');self.diagnostic=0
        self.remote_discriminator=0;self.remote_state=1;self.remote_rx=1;self.remote_tx=1000000;self.remote_mult=3
        self.last_valid=None;self.detection_deadline=None;self.normal_up_sent=False
        self.armed=None;self.trigger=None;self.end=None
        self.poll_pending=False;self.poll_started=False;self.poll_actual_sent=False;self.poll_completed=False
        self.windows_started=0;self.phase='normal' if self.cfg['scenario']['mode']=='normal' else 'waiting_up'
        self.next_send=now
        self.emit('scenario_transition',phase=self.phase,reason='new_peer_epoch',epoch_peer_discriminator=my)
    def receive(self,p,now):
        if p.your_discriminator not in (0,self.cfg['local_discriminator']):raise PacketError('wrong_your_discriminator')
        if not self.epoch_id or (p.state in (0,1) and p.my_discriminator!=self.epoch_peer_discriminator):self.new_epoch(p.my_discriminator,now)
        old_rx=self.remote_rx
        self.remote_discriminator=p.my_discriminator;self.remote_state=p.state
        self.remote_rx=p.required_min_rx_us;self.remote_tx=p.desired_min_tx_us;self.remote_mult=p.detect_mult
        if self.poll_pending and self.poll_actual_sent and p.final:
            self.poll_pending=False;self.poll_completed=True;self.phase='poll_complete'
            self.emit('poll_completed',peer_discriminator=p.my_discriminator)
        if p.state==0:self.diagnostic=3;self.change(1,'remote_admin_down')
        elif self.state==1 and p.state==1:self.change(2,'down_handshake')
        elif self.state==1 and p.state==2:self.change(3,'remote_init')
        elif self.state==2 and p.state in (2,3):self.change(3,'init_handshake')
        elif self.state==3 and p.state==1:self.diagnostic=3;self.change(1,'remote_down')
        self.last_valid=now;self.detection_deadline=now+self.detection_time()
        if old_rx!=self.remote_rx and self.remote_rx:
            delay=self.jitter();self.next_send=now if self.last_periodic is None else max(now,self.last_periodic+delay)
        self.maybe_arm(now)
        return p.poll
    def maybe_arm(self,now):
        mode=self.cfg['scenario']['mode']
        if mode=='normal' or self.armed is not None:return
        if self.state==3 and self.remote_state==3 and self.normal_up_sent:
            self.armed=now;self.trigger=now+self.cfg['scenario']['after_up_ms']/1000
            if mode!='poll':self.end=self.trigger+self.cfg['scenario']['duration_ms']/1000
            self.phase='armed';self.emit('scenario_transition',phase='armed',trigger_at=self.trigger,end_at=self.end)
    def tick(self,now):
        if self.detection_deadline is not None and now>=self.detection_deadline:
            self.remote_discriminator=0;self.detection_deadline=None
            if self.state in (2,3):self.diagnostic=1;self.change(1,'detection_timeout')
            else:self.poll_pending=False;self.normal_up_sent=False
        mode=self.cfg['scenario']['mode']
        if self.trigger is None:return
        if mode=='poll':
            if now>=self.trigger and not self.poll_started:
                self.poll_started=True
                self.poll_pending=self.state==3
                self.phase='poll_pending' if self.poll_pending else 'poll_aborted'
                self.emit('scenario_transition',phase=self.phase,reason='target_poll_trigger')
        elif mode!='normal':
            phase='armed' if now<self.trigger else 'active' if now<self.end else 'complete'
            if phase!=self.phase:
                self.phase=phase
                if phase in ('active','complete') and not self.windows_started:self.windows_started=1
                self.emit('scenario_transition',phase=phase,reason='target_fault_window')
    def active_fault(self,now):
        return self.cfg['scenario']['mode'] if self.trigger is not None and self.end is not None and self.trigger<=now<self.end else None
    def control(self,final=False):
        return Control(state=self.state,diagnostic=self.diagnostic,poll=self.poll_pending and not final,final=final,detect_mult=self.cfg['detect_mult'],my_discriminator=self.cfg['local_discriminator'],your_discriminator=self.remote_discriminator,desired_min_tx_us=self.cfg['min_tx_us'],required_min_rx_us=self.cfg['min_rx_us'])
    def transform(self,p,now):
        mode=self.active_fault(now);raw=p.encode();ttl=255
        if mode=='quiet':return None,ttl
        if mode=='short':raw=raw[:7]
        elif mode=='ttl254':ttl=254
        elif mode=='wrong-your':
            excluded={0,self.epoch_peer_discriminator,self.remote_discriminator}
            wrong=(self.epoch_peer_discriminator+1)&0xffffffff
            while wrong in excluded:wrong=(wrong+1)&0xffffffff
            raw=raw[:8]+wrong.to_bytes(4,'big')+raw[12:]
        return raw,ttl
    def submitted(self,p,now,periodic,actual):
        if actual and p.poll and not p.final and self.poll_pending:self.poll_actual_sent=True
        if actual and p.state==3 and self.active_fault(now) is None:
            self.normal_up_sent=True;self.maybe_arm(now)
        if periodic:
            self.last_periodic=now;delay=self.jitter()
            if delay is not None:self.next_send=now+delay
