#!/usr/bin/env python3
"""Send real RTP to the published UDP target and prove fresh receiver observations."""
from collections import Counter
import argparse
import ipaddress
import json
import math
import secrets
import signal
import socket
import struct
import sys
import time
from urllib.parse import urlencode
from rtp_wire import Deadline,bytes_info,remaining,uint,validate_config,validate_status

METHODS=('BASIC','CSRC_EXTENSION','PADDING','SEQUENCE')
class Parser(argparse.ArgumentParser):
    def error(self,message):raise ValueError(message)


def observer_get(host,port,path,deadline):
    # Numeric derived IP only, no HTTP proxy, URL override, or redirects.
    ip=ipaddress.IPv4Address(host)
    if ip.is_multicast or ip.is_unspecified or int(ip)==0xffffffff:raise ValueError('observer host must be a unicast/loopback numeric IPv4')
    with socket.create_connection((str(ip),port),timeout=remaining(deadline)) as connection:
        connection.settimeout(remaining(deadline));connection.sendall(f'GET {path} HTTP/1.1\r\nHost: {ip}\r\nConnection: close\r\n\r\n'.encode('ascii'))
        buffer=bytearray()
        while b'\r\n\r\n' not in buffer:
            if len(buffer)>=4096:raise ValueError('observer response headers exceed 4096 bytes')
            connection.settimeout(remaining(deadline));part=connection.recv(4096-len(buffer))
            if not part:raise ValueError('observer closed before complete response headers')
            buffer.extend(part)
        head,body=bytes(buffer).split(b'\r\n\r\n',1);lines=head.decode('ascii').split('\r\n');status=lines[0].split(' ')
        if len(status)<2 or status[0] not in ('HTTP/1.0','HTTP/1.1') or status[1]!='200':raise ValueError('private observer did not return HTTP 200 (redirects are refused)')
        headers={}
        for line in lines[1:]:
            if ':' not in line or line[:1].isspace():raise ValueError('invalid observer header')
            key,value=line.split(':',1);key=key.lower()
            if key in headers:raise ValueError('duplicate observer header')
            headers[key]=value.strip()
        raw_size=headers.get('content-length','')
        if not raw_size.isascii() or not raw_size.isdecimal() or len(raw_size)>5 or not 0<=int(raw_size)<=65536 or 'transfer-encoding' in headers:raise ValueError('observer must provide bounded fixed Content-Length')
        size=int(raw_size)
        if len(body)>size:raise ValueError('trailing observer response bytes')
        while len(body)<size:
            connection.settimeout(remaining(deadline));part=connection.recv(min(8192,size-len(body)))
            if not part:raise ValueError('observer closed before complete JSON body')
            body+=part
        remaining(deadline)
    def invalid_constant(value):raise ValueError('non-finite observer JSON number: '+value)
    result=json.loads(body,parse_constant=invalid_constant)
    if not isinstance(result,dict):raise ValueError('observer JSON must be an object')
    return result


def build_packet(payload,sequence,timestamp,ssrc,marker=False,csrc=(),extension=None,padding=0,pt=96):
    # Independently construct the expected fields, never call receiver decode_rtp.
    extension_profile,extension_bytes=extension if extension is not None else (None,b'')
    first=128|len(csrc)|(16 if extension is not None else 0)|(32 if padding else 0)
    raw=struct.pack('!BBHII',first,(128 if marker else 0)|pt,sequence,timestamp,ssrc)+b''.join(struct.pack('!I',v) for v in csrc)
    if extension is not None:raw+=struct.pack('!HH',extension_profile,len(extension_bytes)//4)+extension_bytes
    payload_offset=len(raw);raw+=payload
    if padding:raw+=b'\xa5'*(padding-1)+bytes([padding])
    expected=dict(version=2,padding=bool(padding),extension=extension is not None,marker=marker,payload_type=pt,sequence=sequence,timestamp=timestamp,ssrc=ssrc,csrc=list(csrc),extension_profile=extension_profile,extension_words=len(extension_bytes)//4,extension_data=bytes_info(extension_bytes),padding_octets=padding,payload_offset=payload_offset,payload=bytes_info(payload))
    return raw,expected


def case_packets(method,round_number):
    ssrc=secrets.randbits(32);sequence=secrets.randbits(16);timestamp=secrets.randbits(32);payload=secrets.token_bytes(24)
    if method=='CSRC_EXTENSION':return [build_packet(payload,sequence,timestamp,ssrc,csrc=[secrets.randbits(32) for _ in range(3)],extension=(0x1234,secrets.token_bytes(8)))]
    if method=='PADDING':return [build_packet(payload,sequence,timestamp,ssrc,padding=7)]
    if method=='SEQUENCE':
        frames=[build_packet(payload,n,(timestamp+i*160)&0xffffffff,ssrc) for i,n in enumerate((65534,65535,0,1))]
        return frames+[frames[1]]
    return [build_packet(payload,sequence,timestamp,ssrc,marker=round_number==2)]


def validate_observations(snapshot,status,expected_raw,expected_rtp):
    if snapshot.get('schema_version')!=1 or type(snapshot.get('schema_version')) is not int or snapshot.get('boot_id')!=status['boot_id']:raise ValueError('observer boot/schema changed during receive proof')
    if not uint(snapshot.get('counter'),64) or snapshot['counter']<status['counter']:raise ValueError('observer counter regressed')
    events=snapshot.get('events')
    if not isinstance(events,list) or len(events)>16 or type(snapshot.get('matched_count')) is not int or not len(events)<=snapshot['matched_count']<=256 or snapshot.get('returned_count')!=len(events) or type(snapshot.get('returned_count')) is not int or type(snapshot.get('truncated')) is not bool or snapshot['truncated']!=(snapshot['matched_count']>len(events)):raise ValueError('invalid bounded observation result')
    last=status['counter'];valid=[]
    for event in events:
        if not isinstance(event,dict) or event.get('boot_id')!=status['boot_id'] or not uint(event.get('event_id'),64) or not last<event['event_id']<=snapshot['counter']:raise ValueError('stale/repeated observation event id')
        last=event['event_id']
        source=event.get('source')
        if not isinstance(source,list) or len(source)!=2 or not isinstance(source[0],str) or type(source[1]) is not int or not 1<=source[1]<=65535:raise ValueError('invalid observed UDP source')
        ipaddress.IPv4Address(source[0])
        if event.get('accepted') is not True:raise ValueError('receiver rejected RTP packet: '+str(event.get('error_code'))[:80])
        if json.dumps(event.get('raw'),sort_keys=True,separators=(',',':'))!=json.dumps(bytes_info(expected_raw),sort_keys=True,separators=(',',':')) or json.dumps(event.get('rtp'),sort_keys=True,separators=(',',':'))!=json.dumps(expected_rtp,sort_keys=True,separators=(',',':')):raise ValueError('received raw/payload hash or RTP fields differ from actual sent packet')
        if not isinstance(event.get('received_monotonic'),(int,float)) or type(event.get('received_monotonic')) is bool or not math.isfinite(event['received_monotonic']):raise ValueError('invalid observation timestamp')
        valid.append(event)
    return valid


def run_check(host,port,observer_host,observer_port,config,method,number,deadline,health=False):
    started=time.monotonic();phase=min(deadline,started+3)
    result=dict(name=f'{method}/round-{number}',passed=False,request=dict(method=method,path='stream',transport='UDP',target=[host[:253],port],packets=[]),response=dict(observation_source='private receiver observer',rtp_reply_expected=False))
    try:
        baseline=validate_status(observer_get(observer_host,observer_port,'/v1/status',phase))
        if type(baseline.get('max_packet_size')) is not int or baseline.get('max_packet_size')!=config['max_packet_size'] or json.dumps(baseline.get('udp_bound'))!=json.dumps(['0.0.0.0',5004]):raise ValueError('observer applied RTP configuration/listener does not match')
        frames=case_packets('BASIC' if health else method,number);by_hash={};required=Counter()
        with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as udp:
            udp.settimeout(remaining(phase));udp.connect((host,port))
            result['request']['source_port']=udp.getsockname()[1]
            for raw,expected in frames:
                if len(raw)>config['max_packet_size']:raise ValueError('case packet exceeds configured capacity')
                udp.settimeout(remaining(phase));udp.send(raw);info=bytes_info(raw);by_hash[info['sha256']]=(raw,expected);required[info['sha256']]+=1
                result['request']['packets'].append(dict(raw=info,rtp=expected))
            found={};after_counter=baseline['counter']
            while len(found)<len(required):
                for sha,count in required.items():
                    if sha in found:continue
                    snapshot=observer_get(observer_host,observer_port,'/v1/observations?'+urlencode(dict(after=baseline['counter'],raw_sha256=sha)),phase)
                    valid=validate_observations(snapshot,baseline,*by_hash[sha]);after_counter=max(after_counter,snapshot['counter'])
                    if len(valid)>=count:found[sha]=valid[:count]
                if len(found)<len(required):time.sleep(min(0.02,remaining(phase)))
            observed=[event for group in found.values() for event in group];observed.sort(key=lambda e:e['event_id'])
            if len({e['event_id'] for e in observed})!=len(observed):raise ValueError('observer reused an event id for different sent packets')
            result['response'].update(boot_id=baseline['boot_id'],before_counter=baseline['counter'],after_counter=after_counter,observations=observed)
            udp.setblocking(False)
            try:
                reply=udp.recv(65535);result['response']['unexpected_udp_reply']=bytes_info(reply);raise ValueError('RTP receiver unexpectedly sent an application reply')
            except BlockingIOError:pass
        remaining(phase);result['passed']=True
    except Exception as exc:result['error']=str(exc)[:512]
    result['seconds']=round(time.monotonic()-started,6);return result


def main():
    started=time.monotonic();deadline=started+30;report=dict(passed=False,checks=[])
    signal.signal(signal.SIGALRM,lambda *_:(_ for _ in ()).throw(Deadline('RTP client overall deadline exceeded (30 seconds)')));signal.alarm(30)
    try:
        parser=Parser(description=__doc__);parser.add_argument('--host',required=True);parser.add_argument('--port',type=int,required=True);parser.add_argument('--observer-host',required=True);parser.add_argument('--observer-port',type=int,default=18081);parser.add_argument('--method',choices=(*METHODS,'ALL'),default='ALL');parser.add_argument('--path',default='stream');parser.add_argument('--config-json',required=True);parser.add_argument('--health',action='store_true')
        args=parser.parse_args();config=validate_config(json.loads(args.config_json))
        if not 1<=args.port<=65535 or not 1<=args.observer_port<=65535:raise ValueError('target/observer port: expected 1..65535')
        if args.path!='stream':raise ValueError('path: expected stream')
        for method in ('BASIC',) if args.health else METHODS if args.method=='ALL' else (args.method,):
            for number in (1,) if args.health else (1,2):
                remaining(deadline);report['checks'].append(run_check(args.host,args.port,args.observer_host,args.observer_port,config,method,number,deadline,args.health))
    except Exception as exc:report['error']=str(exc)[:512]
    finally:signal.alarm(0)
    passed=sum(c['passed'] for c in report['checks']);report['summary']=dict(total=len(report['checks']),passed=passed,failed=len(report['checks'])-passed);report['passed']=bool(report['checks']) and passed==len(report['checks']) and 'error' not in report;report['seconds']=round(time.monotonic()-started,6)
    raw=json.dumps(report,separators=(',',':'),allow_nan=False)
    if len(raw.encode())>524288:report=dict(passed=False,checks=[],summary=report['summary'],seconds=report['seconds'],error='bounded RTP report exceeded 512 KiB');raw=json.dumps(report,separators=(',',':'))
    print(raw,flush=True);return 0 if report['passed'] else 1
if __name__=='__main__':sys.exit(main())
