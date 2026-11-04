#!/usr/bin/env python3
"""MIT. Real peer for the CURRENT target-side scenario, two independent epochs."""
from collections import deque
import argparse
import socket
import ipaddress
import json
import secrets
import select
import signal
import sys
import time
import urllib.parse
from bfd_wire import Control,Transport,decode,PacketError,wire_summary,load_config,canonical_hash,STATES

METHODS={'normal':'NORMAL','poll':'POLL','quiet':'QUIET','wrong-your':'WRONG_YOUR','ttl254':'TTL254','short':'SHORT'}

def budgets(cfg):
    t=max(cfg['min_tx_us'],1000000)/1000000;c=max(cfg['min_rx_us'],1000000)/1000000
    mode=cfg['scenario']['mode'];s=cfg['scenario'];h=max(5,4*max(t,c)+2)
    phases={'handshake':h,'stable':3*t+1}
    if mode=='normal':phases['poll_final']=max(3,2*max(t,c)+1)
    else:phases['trigger']=s['after_up_ms']/1000+2*t+1
    if mode=='poll':phases['poll_final']=max(3,2*max(t,c)+1)
    elif mode!='normal':
        duration=s['duration_ms']/1000
        if duration<max(cfg['detect_mult']*t+.5,2*t+.25):raise ValueError('scenario window too short for full detection validation; legal runtime, unavailable bounded test')
        phases['fault_window']=duration+max(t,c)+1;phases['recovery']=h
    if any(value>15 for value in phases.values()) or 2*sum(phases.values())+5>120:raise ValueError('configured timers/scenario exceed 15s phases or120s total bounded test budget')
    return phases

def idle(status):
    if status['local_state'] in ('Up','Init'):raise ValueError('peer unavailable: refusing to supersede an active Up/Init session')
    age=status['last_valid_age_ms']
    if age is not None and status['remote_state']!='AdminDown' and age<status['receive_detection_us']/1000+100:raise ValueError('peer unavailable: recently valid active peer; wait for legitimate idle')

class Observer:
    def __init__(self,args,cfg):self.args=args;self.cfg=cfg
    def get(self,path,deadline):
        left=min(1,deadline-time.monotonic())
        if left<=0:raise TimeoutError('observer absolute deadline')
        end=time.monotonic()+left
        conn=socket.create_connection((self.args.observer_host,self.args.observer_port),timeout=left)
        def remaining():
            budget=end-time.monotonic()
            if budget<=0:raise TimeoutError('observer absolute1s deadline exceeded')
            conn.settimeout(budget)
        try:
            remaining();conn.sendall(('GET '+path+' HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n').encode('ascii'))
            data=bytearray()
            while b'\r\n\r\n' not in data:
                remaining();chunk=conn.recv(4096)
                if not chunk:raise ValueError('observer EOF before HTTP headers')
                data.extend(chunk)
                if len(data)>8192:raise ValueError('observer header budget exceeded')
            head,body=bytes(data).split(b'\r\n\r\n',1)
            lines=head.decode('ascii').split('\r\n')
            if len(lines[0].split(' '))<2 or lines[0].split(' ')[1]!='200':raise ValueError('observer HTTP status rejected')
            lengths=[line.split(':',1)[1].strip() for line in lines[1:] if line.lower().startswith('content-length:')]
            if len(lengths)!=1 or not lengths[0].isdigit() or len(lengths[0])>5:raise ValueError('observer Content-Length missing/invalid')
            length=int(lengths[0])
            if length>65536:raise ValueError('observer response too large')
            while len(body)<length:
                remaining();chunk=conn.recv(min(4096,length-len(body)))
                if not chunk:raise ValueError('observer truncated body')
                body+=chunk
            if len(body)!=length:raise ValueError('observer excess body')
            remaining();obj=json.loads(body)
        finally:conn.close()
        if obj.get('schema_version')!=1 or obj.get('protocol')!='bfd' or obj.get('boot_id')!=self.args.expected_boot_id or obj.get('runtime_id')!=self.args.expected_runtime_id:raise ValueError('observer source boot/runtime identity mismatch')
        if path=='/v1/status':
            if obj.get('config_sha256')!=canonical_hash(self.cfg) or not obj.get('worker_ready_after_bind') or not 0<=obj.get('event_loop_age_ms',999999)<=2000:raise ValueError('observer config/readiness/main-loop heartbeat mismatch')
        return obj
    def status(self,deadline):return self.get('/v1/status',deadline)

class Peer:
    def __init__(self,args,cfg,observer,transport,my,deadline,start_status):
        self.args=args;self.cfg=cfg;self.observer=observer;self.transport=transport;self.my=my;self.deadline=deadline
        self.state=1;self.diagnostic=0;self.remote_disc=0;self.remote_rx=1;self.remote_tx=1000000;self.remote_mult=3
        self.last_valid=None;self.detection_deadline=None;self.next_send=0;self.last_periodic=None
        self.trace=deque(maxlen=128);self.events=deque(maxlen=256);self.trace_total=0;self.event_total=0
        self.status=start_status;self.next_observe=0;self.epoch=None;self.cursor=start_status['next_event_id']-1
        self.poll_pending=False;self.poll_actual=False;self.poll_complete=False;self.target_poll=False;self.valid_up=0;self.fault_samples=0;self.timeouts=0
        self.window_seen=False;self.complete_seen=False;self.recovery_seen=False;self.phases=[];self.local_events=[]
    def add_trace(self,d):self.trace_total+=1;self.trace.append(d)
    def send(self,now,final=False,admin=False):
        p=Control(state=0 if admin else self.state,diagnostic=7 if admin else self.diagnostic,poll=self.poll_pending and not final and not admin,final=final,detect_mult=3,my_discriminator=self.my,your_discriminator=self.remote_disc or (self.cfg['local_discriminator'] if admin else 0),desired_min_tx_us=1000000,required_min_rx_us=1000000)
        raw=p.encode();self.transport.send(raw,self.cfg['bind_ip'],255)
        self.add_trace({'direction':'tx','seconds':round(now,6),'source':[self.cfg['peer_ip'],self.transport.source_port],'destination':[self.cfg['bind_ip'],3784],'ttl':255,'control':p.fields(),**wire_summary(raw)})
        if p.poll:self.poll_actual=True
        if not final and not admin:
            self.last_periodic=now;self.next_send=now+max(1,self.remote_rx/1000000)*(.75+secrets.randbelow(250001)/1000000)
    def tick(self,now):
        if self.detection_deadline is not None and now>=self.detection_deadline:
            old=self.state;self.state=1;self.diagnostic=1;self.remote_disc=0;self.detection_deadline=None
            if old in (2,3):self.timeouts+=1;self.local_events.append({'kind':'client_detection_timeout','seconds':now,'previous_state':STATES[old],'state':'Down','diagnostic':1})
            self.poll_pending=False
        if self.remote_rx!=0 and now>=self.next_send:self.send(now)
    def receive(self,raw,meta,now):
        record={'direction':'rx','seconds':round(now,6),**meta,**wire_summary(raw)}
        parsed=None
        try:parsed=decode(raw);record['control']=parsed.fields()
        except PacketError as error:record['parse_error']=str(error)
        try:
            self.transport.validate(meta,self.cfg['bind_ip'])
            if meta['source'][1]!=self.cfg['source_port']:raise PacketError('wrong_target_source_port')
            if parsed is None:raise PacketError(record['parse_error'])
            p=parsed
            if p.my_discriminator!=self.cfg['local_discriminator']:raise PacketError('wrong_target_discriminator')
            if p.your_discriminator not in (0,self.my):raise PacketError('wrong_your_discriminator')
            if p.desired_min_tx_us!=self.cfg['min_tx_us'] or p.required_min_rx_us!=self.cfg['min_rx_us'] or p.detect_mult!=self.cfg['detect_mult'] or p.required_min_echo_rx_us!=0:raise PacketError('unexpected_target_timers')
        except PacketError as error:
            record['accepted']=False;record['rejection']=str(error)
            # Count only exact faults emitted by the configured target, not arbitrary background UDP.
            exact_source=meta['source']==[self.cfg['bind_ip'],self.cfg['source_port']] and meta['ifindex']==self.transport.ifindex and meta['local_destination']==self.cfg['peer_ip'] and not meta['ancillary_truncated']
            mode=self.cfg['scenario']['mode']
            if exact_source and ((mode=='short' and len(raw)==7 and meta['ttl']==255) or (mode=='ttl254' and parsed is not None and meta['ttl']==254 and parsed.my_discriminator==self.cfg['local_discriminator'] and parsed.your_discriminator==self.my) or (mode=='wrong-your' and parsed is not None and meta['ttl']==255 and parsed.my_discriminator==self.cfg['local_discriminator'] and parsed.your_discriminator not in (0,self.my))):self.fault_samples+=1
            self.add_trace(record);return
        record['accepted']=True;self.add_trace(record)
        self.remote_disc=p.my_discriminator;self.remote_rx=p.required_min_rx_us;self.remote_tx=p.desired_min_tx_us;self.remote_mult=p.detect_mult
        old=self.state
        if p.state==0:self.state=1;self.diagnostic=3
        elif self.state==1 and p.state==1:self.state=2
        elif self.state==1 and p.state==2:self.state=3
        elif self.state==2 and p.state in (2,3):self.state=3
        elif self.state==3 and p.state==1:self.state=1;self.diagnostic=3
        if self.state==3 and old!=3:self.diagnostic=0
        if old!=self.state:self.local_events.append({'kind':'client_state','seconds':now,'state':STATES[self.state]})
        self.last_valid=now;self.detection_deadline=now+p.detect_mult*max(1000000,p.desired_min_tx_us)/1000000
        if self.state==3 and p.state==3:
            self.valid_up+=1
            if self.complete_seen:self.recovery_seen=True
        if p.final and self.poll_pending and self.poll_actual:self.poll_pending=False;self.poll_complete=True
        if p.poll:self.target_poll=True;self.send(now,final=True)
    def observe(self,deadline):
        st=self.observer.status(deadline);self.status=st
        if st['epoch_peer_discriminator']==self.my:
            if self.epoch is None:self.epoch=st['epoch_id']
            if st['epoch_id']!=self.epoch:raise ValueError('same peer identity unexpectedly rearmed new epoch')
            for _ in range(4):
                path='/v1/events?'+urllib.parse.urlencode({'epoch_id':self.epoch,'after_event_id':self.cursor,'limit':16})
                obj=self.observer.get(path,deadline)
                for event in obj['events']:
                    self.events.append(event);self.event_total+=1;self.cursor=max(self.cursor,event['event_id'])
                if not obj['truncated']:break
            if st['scenario']['phase']=='active':self.window_seen=True
            if st['scenario']['phase']=='complete':self.complete_seen=True
        elif self.epoch is not None:raise ValueError('worker peer epoch changed during test')
    def pump(self,deadline):
        now=time.monotonic()
        if now>=deadline or now>=self.deadline:raise TimeoutError('absolute BFD phase deadline exceeded')
        self.tick(now)
        select.select([self.transport.receiver],[],[],min(.04,deadline-now,self.deadline-now))
        for _ in range(32):
            if time.monotonic()>=deadline:raise TimeoutError('absolute BFD phase deadline exceeded under receive load')
            try:raw,meta=self.transport.receive()
            except BlockingIOError:break
            self.tick(time.monotonic());self.receive(raw,meta,time.monotonic())
        now=time.monotonic()
        if now>=self.next_observe:self.observe(min(deadline,self.deadline));self.next_observe=now+.15
    def until(self,name,seconds,predicate):
        start=time.monotonic();end=min(self.deadline,start+seconds)
        while not predicate():self.pump(end)
        self.phases.append({'name':name,'passed':True,'seconds':round(time.monotonic()-start,6)})
    def release(self):
        end=min(self.deadline,time.monotonic()+2)
        submitted=False;observed=False
        while time.monotonic()<end:
            # Revalidate source and own epoch BEFORE a cleanup packet can mutate it.
            st=self.observer.status(end)
            if self.epoch is None or st['epoch_id']!=self.epoch or st['epoch_peer_discriminator']!=self.my:
                raise ValueError('own peer epoch replaced/unconfirmed; refusing AdminDown cleanup')
            if st['remote_state']=='AdminDown' and st['local_state']=='Down':observed=True;break
            if not submitted:self.send(time.monotonic(),admin=True);submitted=True
            time.sleep(.04)
        if not observed:raise ValueError('AdminDown release was not observed for own epoch before cleanup deadline')
        return {'admin_down_submitted':submitted,'own_epoch_observed_down':True,'not_a_detection_timeout_claim':True}

def run_round(args,cfg,observer,phase_budgets,deadline,number,previous_my):
    started=time.monotonic();check={'name':METHODS[cfg['scenario']['mode']]+'/round-'+str(number),'passed':False,'request':{'method':args.method,'scenario':cfg['scenario'],'host':args.host,'port':3784,'peer_ip':cfg['peer_ip'],'interface':args.interface},'response':{},'phases':[]}
    transport=None;peer=None
    try:
        before=observer.status(deadline);idle(before)
        transport=Transport(cfg['peer_ip'],args.interface)
        # Close the preflight/bind race without evicting any active peer.
        before=observer.status(deadline);idle(before)
        my=secrets.randbelow(0xffffffff)+1
        while my in (cfg['local_discriminator'],previous_my):my=secrets.randbelow(0xffffffff)+1
        check['request'].update(my_discriminator=my,source_port=transport.source_port)
        peer=Peer(args,cfg,observer,transport,my,deadline,before)
        peer.until('real_bidirectional_up',phase_budgets['handshake'],lambda:peer.state==3 and peer.valid_up>=1 and peer.epoch is not None and peer.status['local_state']=='Up')
        mode=cfg['scenario']['mode']
        if mode=='normal':
            start_up=peer.valid_up;peer.until('normal_valid_up_periods',phase_budgets['stable'],lambda:peer.valid_up>=start_up+2)
            peer.poll_pending=True
            peer.until('client_initiated_poll_actual_target_final',phase_budgets['poll_final'],lambda:peer.poll_complete)
            if peer.status['scenario']['phase']!='normal':raise ValueError('normal target unexpectedly armed a scenario')
        elif mode=='poll':
            peer.until('actual_target_poll',phase_budgets['trigger'],lambda:peer.target_poll)
            peer.until('target_poll_completed_after_actual_final',phase_budgets['poll_final'],lambda:peer.status['scenario']['poll_completed'])
            start_up=peer.valid_up;peer.until('post_poll_valid_up_periods',phase_budgets['stable'],lambda:peer.valid_up>=start_up+2)
            if not peer.status['scenario']['poll_actual_sent']:raise ValueError('observer claims Poll completion without actual target P transmission')
        else:
            peer.until('target_fault_window_started',phase_budgets['trigger'],lambda:peer.window_seen)
            peer.until('target_fault_window_complete_and_client_detection',phase_budgets['fault_window'],lambda:peer.complete_seen and peer.timeouts>=1)
            peer.until('same_identity_normal_recovery',phase_budgets['recovery'],lambda:peer.recovery_seen and peer.state==3 and peer.status['local_state']=='Up')
            start_up=peer.valid_up;peer.until('no_same_epoch_rearm',phase_budgets['stable'],lambda:peer.valid_up>=start_up+2)
            if peer.status['scenario']['windows_started']!=1:raise ValueError('target scenario did not run exactly once in this epoch')
            if mode=='quiet':
                if not any(e['kind']=='tx_suppressed' and e.get('scenario_phase')=='active' and e.get('intended_control',{}).get('your_discriminator')==peer.my for e in peer.events):raise ValueError('quiet lacks fresh target suppression evidence')
            else:
                wire_hashes={r['raw_sha256'] for r in peer.trace if r.get('direction')=='rx' and not r.get('accepted')}
                source_hashes={e.get('raw_sha256') for e in peer.events if e['kind']=='tx_actual' and e.get('scenario_phase')=='active' and e.get('intended_control',{}).get('your_discriminator')==peer.my}
                if peer.fault_samples<1 or not wire_hashes.intersection(source_hashes):raise ValueError('no fresh target-epoch actual fault transmission matched received wire hash')
        check['passed']=True
    except Exception as error:check['error']=type(error).__name__+': '+str(error)[:300]
    finally:
        if peer is not None:
            try:check['response']['release']=peer.release()
            except Exception as error:
                check['passed']=False;check['cleanup_error']=type(error).__name__+': '+str(error)[:256]
            check['phases']=peer.phases;check['response'].update(epoch_id=peer.epoch,worker=peer.status,client_detection_timeouts=peer.timeouts,target_fault_datagrams=peer.fault_samples,wire_trace=list(peer.trace),wire_trace_total=peer.trace_total,wire_trace_truncated=peer.trace_total>len(peer.trace),worker_events=list(peer.events),worker_event_total=peer.event_total,worker_events_truncated=peer.event_total>len(peer.events),client_events=peer.local_events)
        if transport is not None:transport.close()
    check['seconds']=round(time.monotonic()-started,6)
    return check,check['request'].get('my_discriminator')

def main():
    started=time.monotonic();report={'passed':False,'checks':[]}
    try:
        def alarm(_s,_f):raise TimeoutError('120-second overall BFD deadline exceeded')
        signal.signal(signal.SIGALRM,alarm);signal.alarm(120)
        parser=argparse.ArgumentParser(description=__doc__)
        parser.add_argument('--host',required=True);parser.add_argument('--port',type=int,required=True)
        parser.add_argument('--method',choices=tuple(METHODS.values())+('ALL',),default='ALL');parser.add_argument('--path',choices=('session',),default='session')
        parser.add_argument('--config-json',required=True);parser.add_argument('--interface',default='lo')
        parser.add_argument('--observer-host',default='127.0.0.1');parser.add_argument('--observer-port',type=int,default=18084)
        parser.add_argument('--expected-boot-id',required=True);parser.add_argument('--expected-runtime-id',required=True)
        try:args=parser.parse_args()
        except SystemExit as e:
            if e.code==0:return 0
            raise ValueError('invalid client arguments') from None
        cfg=load_config(args.config_json)
        if args.host!=cfg['bind_ip'] or args.port!=3784:raise ValueError('target must match applied bind_ip and fixed3784')
        if not ipaddress.IPv4Address(args.observer_host).is_loopback or not 1<=args.observer_port<=65535:raise ValueError('observer control address must be loopback')
        mode=cfg['scenario']['mode']
        if args.method not in ('ALL',METHODS[mode]):raise ValueError('method does not match applied target scenario; ALL validates current mode only')
        phase_budgets=budgets(cfg);observer=Observer(args,cfg);deadline=started+120
        previous=None
        for number in (1,2):
            check,previous=run_round(args,cfg,observer,phase_budgets,deadline,number,previous);report['checks'].append(check)
            if not check['passed']:break
        report['passed']=len(report['checks'])==2 and all(c['passed'] for c in report['checks'])
        if report['passed'] and report['checks'][0]['response']['epoch_id']==report['checks'][1]['response']['epoch_id']:raise ValueError('two rounds reused the same worker epoch')
        report['applied_mode']=mode;report['all_means_current_mode']=True;report['phase_budgets']=phase_budgets
    except Exception as error:report['passed']=False;report['error']=type(error).__name__+': '+str(error)[:300]
    finally:signal.alarm(0)
    checks=report['checks'];report['summary']={'total':len(checks),'passed':sum(c['passed'] for c in checks),'failed':sum(not c['passed'] for c in checks)};report['seconds']=round(time.monotonic()-started,6)
    raw=json.dumps(report,separators=(',',':'))
    if len(raw.encode())>524288:report={'passed':False,'checks':[],'summary':report['summary'],'error':'bounded report exceeded512KiB'};raw=json.dumps(report)
    print(raw);return 0 if report['passed'] else 1
if __name__=='__main__':sys.exit(main())
