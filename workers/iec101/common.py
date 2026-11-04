#!/usr/bin/env python3
"""MIT: strict dual-profile configuration and independent wire utilities."""
import ipaddress
import json

DEFAULT_CONFIG = {
    'wire_profile':'iec101-unbalanced-dual', 'bind_ip':'0.0.0.0',
    'serial':{'baud_rate':9600,'data_bits':8,'parity':'N','stop_bits':1},
    'single':{'port':24741,'link_address':1,'originator_address':0,'common_address':1,
              'single_char_ack':False,'point':{'ioa':1,'value':True}},
    'double':{'port':24742,'link_address':4660,'originator_address':7,'common_address':513,
              'single_char_ack':False,'point':{'ioa':1,'value':True}},
}

def exact(obj, keys):
    if type(obj) is not dict or set(obj) != set(keys):
        raise ValueError('required keys: '+','.join(keys))

def integer(v, low, high):
    if type(v) is not int or not low <= v <= high:
        raise ValueError(f'integer out of range {low}..{high}')

def validate_config(c):
    exact(c, ('wire_profile','bind_ip','serial','single','double'))
    if c['wire_profile'] != 'iec101-unbalanced-dual': raise ValueError('invalid wire_profile')
    if type(c['bind_ip']) is not str: raise ValueError('bind_ip must be IPv4')
    ip=ipaddress.IPv4Address(c['bind_ip'])
    if ip.is_multicast or int(ip)==0xffffffff: raise ValueError('bind_ip must be unicast or wildcard')
    exact(c['serial'], ('baud_rate','data_bits','parity','stop_bits'))
    for k,v in DEFAULT_CONFIG['serial'].items():
        if type(c['serial'][k]) is not type(v) or c['serial'][k] != v: raise ValueError('fixed software serial profile is 9600/8/N/1')
    for name in ('single','double'):
        p=c[name]; exact(p, ('port','link_address','originator_address','common_address','single_char_ack','point'))
        integer(p['port'],1,65535)
        maximum=254 if name=='single' else 65534
        for k in ('link_address','common_address'): integer(p[k],1,maximum)
        integer(p['originator_address'],0,0 if name=='single' else 255)
        if type(p['single_char_ack']) is not bool: raise ValueError('single_char_ack must be bool')
        exact(p['point'],('ioa','value')); integer(p['point']['ioa'],1,255 if name=='single' else 16777215)
        if type(p['point']['value']) is not bool: raise ValueError('point.value must be bool')
    if c['single']['port']==c['double']['port']: raise ValueError('channel ports must differ')
    return c

def load_config(text):
    def pairs(rows):
        d={}
        for k,v in rows:
            if k in d: raise ValueError('duplicate config key')
            d[k]=v
        return d
    return validate_config(json.loads(text, object_pairs_hook=pairs))

def fixed(control, address, width):
    body=bytes([control])+address.to_bytes(width,'little')
    return b'\x10'+body+bytes([sum(body)&255,0x16])

def variable(control, address, width, asdu):
    body=bytes([control])+address.to_bytes(width,'little')+asdu
    if len(body)>255: raise ValueError('FT1.2 body too long')
    return bytes([0x68,len(body),len(body),0x68])+body+bytes([sum(body)&255,0x16])

def gi_request(profile,width):
    return bytes([100,1,6])+(bytes([profile['originator_address']]) if width==2 else b'')+profile['common_address'].to_bytes(width,'little')+bytes(1 if width==1 else 3)+b'\x14'

def decode_asdu(raw,width):
    header=2+width+width; iw=1 if width==1 else 3
    if len(raw)<header: raise ValueError('short ASDU')
    typ,vsq,cot=raw[:3]
    if vsq != 1 or cot&0xc0: raise ValueError('unexpected ASDU VSQ/PN/TEST')
    oa=raw[3] if width==2 else None
    ca=int.from_bytes(raw[2+width:header],'little')
    if typ not in (1,100) or len(raw)!=header+iw+1: raise ValueError('unexpected ASDU type/size')
    ioa=int.from_bytes(raw[header:header+iw],'little'); v=raw[-1]
    result={'type':typ,'cot':cot,'originator_address':oa,'originator_encoded':width==2,'common_address':ca,'ioa':ioa}
    if typ==1:
        if v&0xfe: raise ValueError('invalid/non-good SIQ')
        result.update(value=bool(v&1),quality=0)
    else:
        if ioa!=0 or v!=20: raise ValueError('unexpected interrogation shape')
        result['qoi']=v
    return result

def decode_frame(raw,width):
    if raw==b'\xe5': return {'kind':'e5','asdu':None}
    if raw[:1]==b'\x10':
        if len(raw)!=width+4: raise ValueError('fixed length mismatch')
        body=raw[1:-2]
    elif raw[:1]==b'\x68':
        if len(raw)<6 or raw[1]!=raw[2] or raw[3]!=0x68 or len(raw)!=raw[1]+6: raise ValueError('variable framing mismatch')
        body=raw[4:-2]
        if len(body)<1+width: raise ValueError('short variable body')
    else: raise ValueError('unknown start')
    if raw[-1]!=0x16 or sum(body)&255!=raw[-2]: raise ValueError('checksum/end mismatch')
    control=body[0]
    if control&0xc0: raise ValueError('not secondary unbalanced frame')
    payload=body[1+width:]
    return {'kind':'variable' if raw[0]==0x68 else 'fixed','function':control&15,'acd':bool(control&0x20),'dfc':bool(control&0x10),'link_address':int.from_bytes(body[1:1+width],'little'),'asdu':decode_asdu(payload,width) if payload else None}
