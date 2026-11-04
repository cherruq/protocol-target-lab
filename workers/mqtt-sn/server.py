#!/usr/bin/env python3
"""Supervise real Paho MQTT-SN and a private loopback Mosquitto as one resource."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
from mqttsn_wire import Trace,discovery,validate_config
from mqtt_wire import Session

LOG_LOCK=threading.Lock()
def emit(event,**fields):
    with LOG_LOCK:print(json.dumps(dict(event=event,**fields),separators=(',',':')),flush=True)

def pump(component,stream):
    pending=bytearray()
    while True:
        data=os.read(stream.fileno(),4096)
        if not data:break
        pending.extend(data)
        while b'\n' in pending or len(pending)>=4096:
            at=pending.find(b'\n');size=at+1 if 0<=at<4096 else min(4096,len(pending));line=bytes(pending[:size]);del pending[:size]
            emit('native_log',component=component,message=line.decode('utf-8',errors='replace').rstrip('\r\n'),length=len(line),continued=at<0 or at>=4096)
    if pending:emit('native_log',component=component,message=pending.decode('utf-8',errors='replace'),length=len(pending),continued=False)

def broker_probe(config):
    trace=[];client=Session('127.0.0.1',config['broker_port'],4,'plab-sn-health',1048576,'health',trace)
    try:client.send(0xc0);assert client.expect(13)==b''
    finally:client.close()

def run(config):
    stop=threading.Event();children={};threads=[]
    for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,lambda *_:stop.set())
    work=Path('/run/protocol-target-lab/mqtt-sn');work.mkdir(parents=True,exist_ok=True)
    for name in ('ringbuffer.key','rbmutex.key'):
        path=work/name;path.unlink(missing_ok=True);path.touch(mode=0o600)
    broker=work/'mosquitto.conf';broker.write_text('\n'.join([f'listener {config["broker_port"]} 127.0.0.1','protocol mqtt','socket_domain ipv4','max_connections 128','allow_anonymous true','persistence false','max_packet_size 1048576','log_dest stdout','log_type all'])+'\n')
    topics=work/'predefinedTopic.conf';topics.write_text(''.join(f'*,{p["topic"]},{p["topic_id"]}\n' for p in config['predefined_topics']))
    gateway=work/'gateway.conf';gateway.write_text('\n'.join([f'GatewayID={config["gateway_id"]}','GatewayName=ProtocolTargetLab','MaxNumberOfClients=64','KeepAlive=60','BrokerName=127.0.0.1',f'BrokerPortNo={config["broker_port"]}','AggregatingGateway=NO','QoS-1=NO','Forwarder=NO','PredefinedTopic=YES','ClientAuthentication=NO',f'PredefinedTopicList={topics}',f'GatewayPortNo={config["port"]}',f'MulticastPortNo={config["discovery_port"]}',f'MulticastIP={config["discovery_group"]}','MulticastTTL=1','ShearedMemory=NO'])+'\n')
    def start(component,argv):
        p=subprocess.Popen(argv,cwd=work,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
        children[component]=p;t=threading.Thread(target=pump,args=(component,p.stdout),daemon=True);t.start();threads.append(t);emit('component_started',component=component,pid=p.pid)
    def check_children():
        for component,p in children.items():
            if p.poll() is not None:raise RuntimeError(f'{component} unexpectedly exited with code {p.returncode}')
    def ready(probe):
        until=time.monotonic()+12;last=None
        while not stop.is_set() and time.monotonic()<until:
            check_children()
            try:probe();return
            except (OSError,ValueError,AssertionError) as exc:last=exc;stop.wait(.1)
        if not stop.is_set():raise RuntimeError('component protocol readiness failed: '+str(last))
    try:
        start('broker',['/usr/local/sbin/mosquitto','-c',str(broker)]);ready(lambda:broker_probe(config))
        if stop.is_set():return
        start('gateway',['/usr/bin/stdbuf','-oL','-eL','/usr/local/sbin/MQTT-SNGateway','-f',str(gateway)])
        ready(lambda:discovery('127.0.0.1',config,time.monotonic()+3,Trace()))
        if stop.is_set():return
        emit('ready',implementation='Paho MQTTSNGateway',version='1.5.1',broker='Mosquitto 2.0.18/full-v1',config=config,components={name:p.pid for name,p in children.items()})
        while not stop.wait(.1):check_children()
    finally:
        for component,p in children.items():
            if p.poll() is None:
                try:os.killpg(p.pid,signal.SIGINT if component=='gateway' else signal.SIGTERM)
                except ProcessLookupError:pass
        until=time.monotonic()+3
        while time.monotonic()<until and any(p.poll() is None for p in children.values()):time.sleep(.05)
        for component,p in children.items():
            if p.poll() is None:
                emit('component_force_stop',component=component)
                try:os.killpg(p.pid,signal.SIGKILL)
                except ProcessLookupError:pass
            p.wait(timeout=2);emit('component_stopped',component=component,exit_code=p.returncode)
        for t in threads:t.join(timeout=1)
        emit('stopped')

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--config-json',required=True);args=parser.parse_args()
    try:run(validate_config(json.loads(args.config_json)))
    except (ValueError,TypeError,OSError,RuntimeError,AssertionError) as exc:emit('worker_error',error=str(exc)[:1024]);return 1
    return 0
if __name__=='__main__':sys.exit(main())
