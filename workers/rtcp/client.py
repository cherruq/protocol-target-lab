#!/usr/bin/env python3
"""Send real RTCP to the published UDP target and prove fresh receiver observations."""
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
from rtcp_wire import Deadline,bytes_info,remaining,uint,validate_config,validate_status

METHODS=('SR_SDES','REPORT_BLOCKS','SDES_ITEMS','PADDING')
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


def build_compound(fields,cname,blocks=b'',extra_items=(),padding=0,profile_extension=b''):
    # Independent packet constructor and expected model; never invoke the receiver parser.
    ssrc,msw,lsw,rtptime,packets,octets=fields;rc=len(blocks)//24
    sr_body=struct.pack('!6I',*fields)+blocks+profile_extension
    sr=struct.pack('!BBH',128|rc,200,len(sr_body)//4)+sr_body
    items=[(1,cname),*extra_items]
    sdes_body=struct.pack('!I',ssrc)+b''.join(bytes([kind,len(value)])+value for kind,value in items)+b'\0'
    sdes_body+=b'\0'*((-len(sdes_body))%4)
    sdes=struct.pack('!BBH',129|(32 if padding else 0),202,(len(sdes_body)+padding)//4)+sdes_body
    if padding:sdes+=b'\xa5'*(padding-1)+bytes([padding])
    primary=dict(ssrc=ssrc,ntp_msw=msw,ntp_lsw=lsw,ntp64_hex=f'{msw:08x}{lsw:08x}',rtp_timestamp=rtptime,sender_packet_count=packets,sender_octet_count=octets,report_count=rc,report_blocks=bytes_info(blocks),profile_extension=bytes_info(profile_extension))
    expected=dict(packet_profile='sr-sdes',primary_sr=primary,cname=cname.decode('utf-8'),cname_data=bytes_info(cname),subpacket_count=2,sender_report_count=1,sdes_chunk_count=1,sdes_item_count=len(items),matching_item_count=len(items),subpackets=[dict(packet_type=200,count=rc,length_words=len(sr_body)//4,offset=0,packet_length=len(sr),padding_octets=0,body=bytes_info(sr_body)),dict(packet_type=202,count=1,length_words=(len(sdes_body)+padding)//4,offset=len(sr),packet_length=len(sdes),padding_octets=padding,body=bytes_info(sdes_body))],subpackets_truncated=False,matching_items=[dict(kind=kind,value=bytes_info(value)) for kind,value in items[:8]],matching_items_truncated=len(items)>8)
    return sr+sdes,expected


def case_packets(method,round_number):
    fields=tuple(secrets.randbits(32) for _ in range(6));cname=('plab-'+secrets.token_hex(8)).encode()
    if method=='REPORT_BLOCKS':return [build_compound(fields,bytes([96+round_number]),blocks=secrets.token_bytes(24))]
    if method=='SDES_ITEMS':return [build_compound(fields,('plab-'+secrets.token_hex(4)).encode(),extra_items=[(2,b'node'),(99,secrets.token_bytes(2))])]
    if method=='PADDING':return [build_compound(fields,cname,padding=4)]
    return [build_compound(fields,cname)]


def validate_observations(snapshot,status,expected_raw,expected_rtcp):
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
        if event.get('accepted') is not True:raise ValueError('receiver rejected RTCP packet: '+str(event.get('error_code'))[:80])
        if json.dumps(event.get('raw'),sort_keys=True,separators=(',',':'))!=json.dumps(bytes_info(expected_raw),sort_keys=True,separators=(',',':')) or json.dumps(event.get('rtcp'),sort_keys=True,separators=(',',':'))!=json.dumps(expected_rtcp,sort_keys=True,separators=(',',':')):raise ValueError('received raw hash or SR/CNAME fields differ from actual sent packet')
        if not isinstance(event.get('received_monotonic'),(int,float)) or type(event.get('received_monotonic')) is bool or not math.isfinite(event['received_monotonic']):raise ValueError('invalid observation timestamp')
        valid.append(event)
    return valid


def run_check(host,port,observer_host,observer_port,config,method,number,deadline,health=False):
    started=time.monotonic();phase=min(deadline,started+3)
    result=dict(name=f'{method}/round-{number}',passed=False,request=dict(method=method,path='session',transport='UDP',target=[host[:253],port],packets=[]),response=dict(observation_source='private receiver observer',rtcp_reply_expected=False))
    try:
        baseline=validate_status(observer_get(observer_host,observer_port,'/v1/status',phase))
        if type(baseline.get('max_packet_size')) is not int or baseline.get('max_packet_size')!=config['max_packet_size'] or baseline.get('packet_profile')!='sr-sdes' or json.dumps(baseline.get('udp_bound'))!=json.dumps(['0.0.0.0',5005]):raise ValueError('observer applied RTCP configuration/listener does not match')
        frames=case_packets('SR_SDES' if health else method,number);by_hash={};required=Counter()
        with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as udp:
            udp.settimeout(remaining(phase));udp.connect((host,port))
            result['request']['source_port']=udp.getsockname()[1]
            for raw,expected in frames:
                if len(raw)>config['max_packet_size']:raise ValueError('case packet exceeds configured capacity')
                udp.settimeout(remaining(phase));udp.send(raw);info=bytes_info(raw);by_hash[info['sha256']]=(raw,expected);required[info['sha256']]+=1
                result['request']['packets'].append(dict(raw=info,rtcp=expected))
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
                reply=udp.recv(65535);result['response']['unexpected_udp_reply']=bytes_info(reply);raise ValueError('RTCP receiver unexpectedly sent an application reply')
            except BlockingIOError:pass
        remaining(phase);result['passed']=True
    except Exception as exc:result['error']=str(exc)[:512]
    result['seconds']=round(time.monotonic()-started,6);return result


def main():
    started=time.monotonic();deadline=started+30;report=dict(passed=False,checks=[])
    signal.signal(signal.SIGALRM,lambda *_:(_ for _ in ()).throw(Deadline('RTCP client overall deadline exceeded (30 seconds)')));signal.alarm(30)
    try:
        parser=Parser(description=__doc__);parser.add_argument('--host',required=True);parser.add_argument('--port',type=int,required=True);parser.add_argument('--observer-host',required=True);parser.add_argument('--observer-port',type=int,default=18081);parser.add_argument('--method',choices=(*METHODS,'ALL'),default='ALL');parser.add_argument('--path',default='session');parser.add_argument('--config-json',required=True);parser.add_argument('--health',action='store_true')
        args=parser.parse_args();config=validate_config(json.loads(args.config_json))
        if not 1<=args.port<=65535 or not 1<=args.observer_port<=65535:raise ValueError('target/observer port: expected 1..65535')
        if args.path!='session':raise ValueError('path: expected session')
        for method in ('SR_SDES',) if args.health else METHODS if args.method=='ALL' else (args.method,):
            for number in (1,) if args.health else (1,2):
                remaining(deadline);report['checks'].append(run_check(args.host,args.port,args.observer_host,args.observer_port,config,method,number,deadline,args.health))
    except Exception as exc:report['error']=str(exc)[:512]
    finally:signal.alarm(0)
    passed=sum(c['passed'] for c in report['checks']);report['summary']=dict(total=len(report['checks']),passed=passed,failed=len(report['checks'])-passed);report['passed']=bool(report['checks']) and passed==len(report['checks']) and 'error' not in report;report['seconds']=round(time.monotonic()-started,6)
    raw=json.dumps(report,separators=(',',':'),allow_nan=False)
    if len(raw.encode())>524288:report=dict(passed=False,checks=[],summary=report['summary'],seconds=report['seconds'],error='bounded RTCP report exceeded 512 KiB');raw=json.dumps(report,separators=(',',':'))
    print(raw,flush=True);return 0 if report['passed'] else 1
if __name__=='__main__':sys.exit(main())
