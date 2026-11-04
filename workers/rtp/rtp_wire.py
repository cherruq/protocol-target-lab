"""Original, bounded RFC3550 RTPv2 structure receiver utilities; payload is opaque."""
import hashlib
import ipaddress
import math
import struct
import time

MAX_DATAGRAM=65507
PREVIEW_BYTES=128
class PacketError(ValueError):pass
class Deadline(ValueError):pass

def validate_config(value):
    if not isinstance(value,dict) or set(value)!={'bind_ip','port','max_packet_size'}:
        raise ValueError('config: expected bind_ip,port,max_packet_size only')
    if not isinstance(value['bind_ip'],str):raise ValueError('bind_ip: expected IPv4 string')
    ip=ipaddress.IPv4Address(value['bind_ip'])
    if ip.is_multicast or int(ip)==0xffffffff:raise ValueError('bind_ip: expected unicast/wildcard IPv4')
    for key,low,high in [('port',1,65535),('max_packet_size',64,MAX_DATAGRAM)]:
        if type(value[key]) is not int or not low<=value[key]<=high:raise ValueError(f'{key}: expected integer {low}..{high}')
    return dict(value,bind_ip=str(ip))

def bytes_info(raw):
    return dict(length=len(raw),sha256=hashlib.sha256(raw).hexdigest(),preview_hex=raw[:PREVIEW_BYTES].hex(),truncated=len(raw)>PREVIEW_BYTES)

def decode_rtp(raw):
    if len(raw)<12:raise PacketError('short_header')
    first,second,sequence,timestamp,ssrc=struct.unpack_from('!BBHII',raw)
    if first>>6!=2:raise PacketError('wrong_version')
    padding=bool(first&32);extension=bool(first&16);cc=first&15;cursor=12+4*cc
    if cursor>len(raw):raise PacketError('truncated_csrc')
    csrc=list(struct.unpack_from('!'+str(cc)+'I',raw,12)) if cc else []
    profile=None;words=0;extension_bytes=b''
    if extension:
        if cursor+4>len(raw):raise PacketError('truncated_extension_header')
        profile,words=struct.unpack_from('!HH',raw,cursor);cursor+=4
        end=cursor+4*words
        if end>len(raw):raise PacketError('truncated_extension_data')
        extension_bytes=raw[cursor:end];cursor=end
    end=len(raw);padding_octets=0
    if padding:
        if end<=cursor or raw[-1]==0 or raw[-1]>end-cursor:raise PacketError('invalid_padding')
        padding_octets=raw[-1];end-=padding_octets
    return dict(version=2,padding=padding,extension=extension,marker=bool(second&128),payload_type=second&127,sequence=sequence,timestamp=timestamp,ssrc=ssrc,csrc=csrc,extension_profile=profile,extension_words=words,extension_data=bytes_info(extension_bytes),padding_octets=padding_octets,payload_offset=cursor,payload=bytes_info(raw[cursor:end]))

def remaining(deadline):
    value=deadline-time.monotonic()
    if value<=0:raise Deadline('absolute RTP observation deadline exceeded')
    return min(3,value)

def uint(value,bits):return type(value) is int and 0<=value<(1<<bits)

def validate_status(value):
    import re
    if not isinstance(value,dict) or value.get('schema_version')!=1 or type(value.get('schema_version')) is not int or value.get('implementation')!='stdlib-rfc3550-v2':raise ValueError('observer identity/schema mismatch')
    if not isinstance(value.get('boot_id'),str) or not re.fullmatch('[0-9a-f]{32}',value['boot_id']):raise ValueError('observer boot identity invalid')
    if not uint(value.get('counter'),64):raise ValueError('observer counter invalid')
    return value
