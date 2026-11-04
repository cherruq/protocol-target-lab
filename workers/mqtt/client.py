#!/usr/bin/env python3
"""Real independent publisher/subscriber MQTT 3.1.1 and 5 QoS validation."""
import argparse
import json
import secrets
import signal
import struct
import sys
import time
from mqtt_wire import Session,preview,properties,read_utf,utf,validate_config

METHODS={f'MQTT{version}_QOS{qos}':(4 if version=='311' else 5,qos) for version in ('311','5') for qos in (0,1,2)}
class Deadline(Exception):pass
class Parser(argparse.ArgumentParser):
    def error(self,message):raise ValueError(message)

def check_delivery(host,port,config,method,round_number):
    version,qos=METHODS[method];token=secrets.token_hex(6);topic='plab/test/'+token;payload=secrets.token_bytes(24)
    trace=[];sessions=[];started=time.monotonic()
    check=dict(name=f'{method}/round-{round_number}',passed=False,request=dict(protocol='5' if version==5 else '3.1.1',qos=qos,topic=topic,payload=preview(payload)))
    try:
        subscriber=Session(host,port,version,'plab-s-'+token,config['max_packet_size'],'subscriber',trace);sessions.append(subscriber)
        # SUBACK proves the real independent subscriber is registered before publication.
        subscriber.send(0x82,b'\0\1'+(b'\0' if version==5 else b'')+utf(topic)+bytes([qos]))
        suback=subscriber.expect(9)
        if len(suback)<3 or suback[:2]!=b'\0\1':raise ValueError('SUBACK packet identifier mismatch')
        at=2
        if version==5:_,at=properties(suback,at)
        if suback[at:]!=bytes([qos]):raise ValueError('SUBACK did not grant requested QoS')
        publisher=Session(host,port,version,'plab-p-'+token,config['max_packet_size'],'publisher',trace);sessions.append(publisher)
        body=utf(topic)+(b'\0\2' if qos else b'')+(b'\0' if version==5 else b'')+payload
        publisher.send(0x30+(qos<<1),body)
        if qos==1:publisher.ack(4,2)
        elif qos==2:
            publisher.ack(5,2);publisher.send(0x62,b'\0\2');publisher.ack(7,2)
        header,body=subscriber.recv()
        if header!=0x30+(qos<<1):raise ValueError('subscriber PUBLISH flags/QoS mismatch')
        actual_topic,at=read_utf(body,0);ident=None
        if qos:
            if at+2>len(body):raise ValueError('truncated subscriber packet ID')
            ident=int.from_bytes(body[at:at+2],'big');at+=2
            if not ident:raise ValueError('subscriber packet ID must be nonzero')
        props=[]
        if version==5:props,at=properties(body,at)
        delivered=body[at:]
        if actual_topic!=topic or delivered!=payload:raise ValueError('independent subscriber topic/payload mismatch')
        if qos==1:subscriber.send(0x40,ident.to_bytes(2,'big'))
        elif qos==2:
            subscriber.send(0x50,ident.to_bytes(2,'big'));subscriber.ack(6,ident);subscriber.send(0x70,ident.to_bytes(2,'big'))
        check['response']=dict(delivered=True,protocol='5' if version==5 else '3.1.1',qos=qos,topic=actual_topic,payload=preview(delivered),packet_id=ident,properties=props)
        check['passed']=True
    except (ValueError,TypeError,OSError,UnicodeError,struct.error) as exc:
        check['error']=str(exc)[:1024]
    finally:
        for session in reversed(sessions):
            try:session.close()
            except (OSError,ValueError):pass
    check.setdefault('response',{})['packets']=trace
    check['seconds']=round(time.monotonic()-started,6)
    return check

def main():
    started=time.monotonic();report=dict(passed=False,checks=[])
    signal.signal(signal.SIGALRM,lambda *_:(_ for _ in ()).throw(Deadline('overall MQTT test deadline exceeded (30 seconds)')));signal.alarm(30)
    try:
        parser=Parser(description=__doc__);parser.add_argument('--host',required=True);parser.add_argument('--port',type=int,required=True);parser.add_argument('--method',choices=(*METHODS,'ALL'),default='ALL');parser.add_argument('--path',default='plab/test');parser.add_argument('--config-json',required=True)
        args=parser.parse_args();config=validate_config(json.loads(args.config_json))
        if not 1<=args.port<=65535:raise ValueError('port: expected 1..65535')
        if args.path!='plab/test':raise ValueError('path: expected fixed test prefix plab/test')
        if config['max_connections']<2:raise ValueError('independent delivery test requires max_connections >=2 (subscriber and publisher)')
        for method in METHODS if args.method=='ALL' else [args.method]:
            for round_number in (1,2):report['checks'].append(check_delivery(args.host,args.port,config,method,round_number))
        report['target']=dict(host=args.host[:253],port=args.port,topic_prefix=args.path)
    except (ValueError,TypeError,OSError,Deadline) as exc:report['error']=str(exc)[:1024]
    finally:signal.alarm(0)
    passed=sum(c['passed'] for c in report['checks']);report['summary']=dict(total=len(report['checks']),passed=passed,failed=len(report['checks'])-passed)
    report['passed']=bool(report['checks']) and passed==len(report['checks']) and 'error' not in report
    report['seconds']=round(time.monotonic()-started,6)
    text=json.dumps(report,separators=(',',':'))
    if len(text.encode())>512*1024:
        report=dict(passed=False,checks=[],summary=report['summary'],seconds=report['seconds'],error='MQTT report exceeded 512 KiB limit');text=json.dumps(report,separators=(',',':'))
    print(text,flush=True);return 0 if report['passed'] else 1

if __name__=='__main__':sys.exit(main())
