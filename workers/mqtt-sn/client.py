#!/usr/bin/env python3
"""Real MQTT-SN QoS1 gateway checks with independent private-broker delivery proof."""
import argparse
import json
import secrets
import signal
import sys
import time
from mqttsn_wire import NORMAL_ID,PREDEFINED_ID,Deadline,Session,Trace,discovery,preview,timeout,validate_config
from mqtt_wire import Session as MqttSession,read_utf,utf

METHODS=('CONNECT','REGISTER_PUBLISH','PREDEFINED_PUBLISH','DISCOVERY')
class Parser(argparse.ArgumentParser):
    def error(self,message):raise ValueError(message)

class Subscriber(MqttSession):
    def __init__(self,config,topics,deadline,trace):
        self.deadline=deadline
        super().__init__('127.0.0.1',config['broker_port'],4,'plab-sub-'+secrets.token_hex(5),1048576,'independent-subscriber',trace)
        try:
            self.send(0x82,b'\0\1'+b''.join(utf(t)+b'\1' for t in topics))
            body=self.expect(9)
            if body!=b'\0\1'+b'\1'*len(topics):raise ValueError('independent subscriber SUBACK did not grant QoS1 for all topics')
        except BaseException:self.sock.close();raise
    def send(self,header,body=b''):
        if hasattr(self,'sock'):self.sock.settimeout(timeout(self.deadline))
        super().send(header,body)
    def recv(self):
        self.sock.settimeout(timeout(self.deadline));return super().recv()
    def delivery(self,topic,payload):
        until=min(self.deadline,time.monotonic()+3)
        for _ in range(64):
            self.sock.settimeout(timeout(until));header,body=super().recv()
            if header>>4!=3 or ((header>>1)&3)!=1:raise ValueError('subscriber expected real QoS1 PUBLISH')
            actual,at=read_utf(body,0)
            if at+2>len(body):raise ValueError('truncated subscriber packet id')
            ident=int.from_bytes(body[at:at+2],'big');at+=2
            if not ident:raise ValueError('subscriber packet id zero')
            self.send(0x40,ident.to_bytes(2,'big'))
            if actual==topic and body[at:]==payload and not header&1:return dict(topic=actual,qos=1,payload=preview(body[at:]),packet_id=ident)
        raise ValueError('independent subscriber did not observe matching topic/payload within message budget')

def check(host,port,config,method,round_number,deadline,used_ports):
    started=time.monotonic();trace=Trace();sn=None;subscriber=None
    report=dict(name=f'{method}/round-{round_number}',passed=False,request=dict(method=method,path='plab/test'),response={})
    try:
        if method=='DISCOVERY':report['response']['gateway']=discovery(host,config,deadline,trace)
        else:
            mappings=config['predefined_topics'] if method=='PREDEFINED_PUBLISH' else [dict(topic='plab/test/'+secrets.token_hex(6))]
            if method!='CONNECT':subscriber=Subscriber(config,[p['topic'] for p in mappings],deadline,trace)
            client_id=PREDEFINED_ID if method=='PREDEFINED_PUBLISH' else NORMAL_ID
            sn=Session(host,port,client_id,deadline,trace,used_ports[client_id]);report['request'].update(client_id=client_id,clean_session=True,source_port=sn.source_port,qos=1 if method!='CONNECT' else None)
            deliveries=[]
            if method!='CONNECT':
                for entry in mappings:
                    msg_id=secrets.randbelow(65535)+1
                    ident=entry['topic_id'] if method=='PREDEFINED_PUBLISH' else sn.register(entry['topic'],msg_id)
                    payload=secrets.token_bytes(24);publish_id=secrets.randbelow(65535)+1
                    sn.publish(ident,payload,publish_id,method=='PREDEFINED_PUBLISH')
                    deliveries.append(dict(topic_id=ident,msg_id=publish_id,puback_return_code=0,delivered=subscriber.delivery(entry['topic'],payload)))
                report['response']['deliveries']=deliveries
            sn.disconnect();report['response']['disconnected']=True
        report['passed']=True
    except Exception as exc:report['error']=str(exc)[:1024]
    finally:
        if sn is not None:sn.close()
        if subscriber is not None:
            try:subscriber.close()
            except Exception:pass
        report['response']['trace']=trace
        if method=='DISCOVERY':report['response']['queries_sent']=sum(e['protocol']=='MQTT-SN' and e['direction']=='send' and e.get('type_id')==1 for e in trace)
    report['seconds']=round(time.monotonic()-started,6);return report

def main():
    started=time.monotonic();deadline=started+30;result=dict(passed=False,checks=[])
    signal.signal(signal.SIGALRM,lambda *_:(_ for _ in ()).throw(Deadline('overall MQTT-SN deadline exceeded (30 seconds)')));signal.alarm(30)
    try:
        parser=Parser(description=__doc__);parser.add_argument('--host',required=True);parser.add_argument('--port',type=int,required=True);parser.add_argument('--method',choices=(*METHODS,'ALL'),default='ALL');parser.add_argument('--path',default='plab/test');parser.add_argument('--config-json',required=True)
        args=parser.parse_args();config=validate_config(json.loads(args.config_json))
        if not 1<=args.port<=65535:raise ValueError('port: expected 1..65535')
        if args.path!='plab/test':raise ValueError('path: expected plab/test')
        used={NORMAL_ID:set(),PREDEFINED_ID:set()}
        for method in METHODS if args.method=='ALL' else [args.method]:
            for number in (1,2):
                if time.monotonic()>=deadline:raise Deadline('overall MQTT-SN deadline exceeded (30 seconds)')
                result['checks'].append(check(args.host,args.port,config,method,number,deadline,used))
        result['target']=dict(host=args.host[:253],port=args.port,broker_host='127.0.0.1',broker_port=config['broker_port'])
    except Exception as exc:result['error']=str(exc)[:1024]
    finally:signal.alarm(0)
    passed=sum(c['passed'] for c in result['checks']);result['summary']=dict(total=len(result['checks']),passed=passed,failed=len(result['checks'])-passed);result['passed']=bool(result['checks']) and passed==len(result['checks']) and 'error' not in result;result['seconds']=round(time.monotonic()-started,6)
    raw=json.dumps(result,separators=(',',':'))
    if len(raw.encode())>512*1024:result=dict(passed=False,checks=[],summary=result['summary'],seconds=result['seconds'],error='MQTT-SN report exceeded 512 KiB limit');raw=json.dumps(result,separators=(',',':'))
    print(raw,flush=True);return 0 if result['passed'] else 1
if __name__=='__main__':sys.exit(main())
