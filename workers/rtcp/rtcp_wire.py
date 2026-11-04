"""Original RFC3550 SR/SDES compound profile parser with complete bounded validation."""
import hashlib
import ipaddress
import re
import struct
import time

class PacketError(ValueError):pass
class Deadline(ValueError):pass

def bytes_info(raw):return dict(length=len(raw),sha256=hashlib.sha256(raw).hexdigest(),preview_hex=raw[:128].hex(),truncated=len(raw)>128)
def uint(value,bits):return type(value) is int and 0<=value<(1<<bits)
def remaining(deadline):
    value=deadline-time.monotonic()
    if value<=0:raise Deadline('absolute RTCP observation deadline exceeded')
    return min(3,value)
def validate_config(value):
    if not isinstance(value,dict) or set(value)!={'bind_ip','port','max_packet_size','packet_profile'}:raise ValueError('config: expected bind_ip,port,max_packet_size,packet_profile only')
    if value['packet_profile']!='sr-sdes':raise ValueError('packet_profile: required literal sr-sdes')
    if not isinstance(value['bind_ip'],str):raise ValueError('bind_ip: expected IPv4 string')
    ip=ipaddress.IPv4Address(value['bind_ip'])
    if ip.is_multicast or int(ip)==0xffffffff:raise ValueError('bind_ip: expected unicast/wildcard IPv4')
    for key,low,high in [('port',1,65535),('max_packet_size',64,65507)]:
        if type(value[key]) is not int or not low<=value[key]<=high:raise ValueError(f'{key}: expected integer {low}..{high}')
    return dict(value,bind_ip=str(ip))
def validate_status(value):
    if not isinstance(value,dict) or type(value.get('schema_version')) is not int or value['schema_version']!=1 or value.get('implementation')!='stdlib-rfc3550-rtcp-v2' or value.get('packet_profile')!='sr-sdes':raise ValueError('observer identity/schema/profile mismatch')
    if not isinstance(value.get('boot_id'),str) or not re.fullmatch('[0-9a-f]{32}',value['boot_id']) or not uint(value.get('counter'),64):raise ValueError('observer boot/counter invalid')
    return value

def decode_compound(raw):
    if len(raw)<4:raise PacketError('short_header')
    if len(raw)%4:raise PacketError('compound_unaligned')
    cursor=0;primary=None;cname=None;cname_raw=None;subpackets=[];matching_items=[]
    totals=dict(subpacket_count=0,sender_report_count=0,sdes_chunk_count=0,sdes_item_count=0,matching_item_count=0)
    while cursor<len(raw):
        first,kind,words=struct.unpack_from('!BBH',raw,cursor)
        if first>>6!=2:raise PacketError('wrong_version')
        end=cursor+(words+1)*4
        if end>len(raw):raise PacketError('packet_length_overrun')
        if cursor==0 and kind!=200:raise PacketError('compound_first_not_sr')
        if kind not in (200,202):raise PacketError('unsupported_packet_type')
        body_end=end;padding=0
        if first&32:
            if end!=len(raw):raise PacketError('padding_not_last')
            padding=raw[end-1]
            if not padding or padding%4 or padding>end-cursor-4:raise PacketError('invalid_padding')
            body_end-=padding
        body=raw[cursor+4:body_end];count=first&31;totals['subpacket_count']+=1
        if len(subpackets)<8:subpackets.append(dict(packet_type=kind,count=count,length_words=words,offset=cursor,packet_length=end-cursor,padding_octets=padding,body=bytes_info(body)))
        if kind==200:
            need=24+24*count
            if len(body)<need:raise PacketError('sr_count_length')
            values=struct.unpack_from('!6I',body);totals['sender_report_count']+=1
            if primary is None:
                ssrc,msw,lsw,rtptime,packets,octets=values
                primary=dict(ssrc=ssrc,ntp_msw=msw,ntp_lsw=lsw,ntp64_hex=f'{msw:08x}{lsw:08x}',rtp_timestamp=rtptime,sender_packet_count=packets,sender_octet_count=octets,report_count=count,report_blocks=bytes_info(body[24:need]),profile_extension=bytes_info(body[need:]))
        else:
            at=0
            for _ in range(count):
                if at+4>len(body):raise PacketError('truncated_sdes_chunk')
                ssrc=struct.unpack_from('!I',body,at)[0];at+=4;chunk_cname=None;ended=False;totals['sdes_chunk_count']+=1
                while at<len(body):
                    item_kind=body[at];at+=1
                    if item_kind==0:
                        aligned=(at+3)//4*4
                        if aligned>len(body) or any(body[at:aligned]):raise PacketError('invalid_sdes_alignment')
                        at=aligned;ended=True;break
                    if at>=len(body):raise PacketError('truncated_sdes_item')
                    size=body[at];at+=1
                    if at+size>len(body):raise PacketError('truncated_sdes_item')
                    value=body[at:at+size];at+=size;totals['sdes_item_count']+=1
                    if item_kind==1:
                        if chunk_cname is not None:raise PacketError('duplicate_cname')
                        if not value:raise PacketError('empty_cname')
                        try:chunk_cname=value.decode('utf-8')
                        except UnicodeDecodeError as exc:raise PacketError('invalid_cname_utf8') from exc
                        if ssrc==primary['ssrc']:
                            if cname is not None and cname!=chunk_cname:raise PacketError('conflicting_cname')
                            cname=chunk_cname;cname_raw=value
                    if ssrc==primary['ssrc']:
                        totals['matching_item_count']+=1
                        if len(matching_items)<8:matching_items.append(dict(kind=item_kind,value=bytes_info(value)))
                if not ended:raise PacketError('missing_sdes_end')
            if at!=len(body):raise PacketError('sdes_trailing_data')
        cursor=end
    if cname is None:raise PacketError('compound_missing_cname')
    return dict(packet_profile='sr-sdes',primary_sr=primary,cname=cname,cname_data=bytes_info(cname_raw),**totals,subpackets=subpackets,subpackets_truncated=totals['subpacket_count']>8,matching_items=matching_items,matching_items_truncated=totals['matching_item_count']>8)
