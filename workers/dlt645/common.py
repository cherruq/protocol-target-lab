"""Strict public software-meter configuration and redacted wire metadata."""
import hashlib
import ipaddress
import re
import time

def redacted_length(data):return dict(length=len(data),redacted=True)
def bytes_info(data):return dict(length=len(data),sha256=hashlib.sha256(data).hexdigest(),redacted=True)
def validate_config(value):
    keys={'wire_profile','bind_ip','port','meter_address','energy_hundredths','period_minutes','programming_key_enabled','max_connections','security'}
    if not isinstance(value,dict) or set(value)!=keys:raise ValueError('config: unexpected or missing fields')
    if value['wire_profile']!='dlt645-2007-tcp':raise ValueError('wire_profile: required dlt645-2007-tcp')
    if not isinstance(value['bind_ip'],str):raise ValueError('bind_ip: expected IPv4 string')
    ip=ipaddress.IPv4Address(value['bind_ip'])
    if ip.is_multicast or int(ip)==0xffffffff:raise ValueError('bind_ip: expected unicast/wildcard IPv4')
    addr=value['meter_address']
    if not isinstance(addr,str) or not re.fullmatch('[0-9]{12}',addr) or addr=='999999999999':raise ValueError('meter_address: expected 12 ASCII decimal digits excluding broadcast')
    for key,low,high in [('port',1,65535),('energy_hundredths',0,99999999),('period_minutes',1,99),('max_connections',1,128)]:
        if type(value[key]) is not int or not low<=value[key]<=high:raise ValueError(f'{key}: expected integer {low}..{high}')
    if type(value['programming_key_enabled']) is not bool:raise ValueError('programming_key_enabled: expected boolean')
    sec=value['security']
    if not isinstance(sec,dict):raise ValueError('security: expected tagged object')
    if sec.get('mode')=='reject':
        if set(sec)!={'mode'}:raise ValueError('security reject: unexpected fields')
    elif sec.get('mode')=='fixture':
        widths=dict(request_di=8,response_di=8,operator=8,request_hex=16,response_hex=24)
        if set(sec)!={'mode',*widths}:raise ValueError('security fixture: unexpected/missing fields')
        for key,size in widths.items():
            if not isinstance(sec[key],str) or not re.fullmatch('[0-9a-fA-F]{'+str(size)+'}',sec[key]):raise ValueError('security fixture: invalid '+key)
        if int(sec['request_di'],16) not in (0x07000001,0x07000002,0x07000003) or int(sec['response_di'],16)!=0x070000ff:raise ValueError('security fixture: unsupported request/response DI')
    else:raise ValueError('security: mode must be reject or fixture')
    return dict(value,bind_ip=str(ip))
def safe_config(config):
    result=dict(config);sec=config['security'];result['security']={'mode':sec['mode']}
    if sec['mode']=='fixture':
        for key in ('request_di','response_di'):result['security'][key]=sec[key]
        for key in ('operator','request_hex','response_hex'):result['security'][key]=bytes_info(bytes.fromhex(sec[key]))
    return result

def sanitize(value):
    if isinstance(value,dict):
        result={}
        for key,child in value.items():
            if key=='credential_sha256':result['credentials_redacted']=True
            elif key.endswith('_hex') and isinstance(child,str):
                try:result[key.removesuffix('_hex')]=redacted_length(bytes.fromhex(child))
                except ValueError:result[key.removesuffix('_hex')]={'redacted':True}
            else:result[key]=sanitize(child)
        return result
    if isinstance(value,(list,tuple)):return [sanitize(v) for v in value]
    return value

def remaining(deadline):
    value=deadline-time.monotonic()
    if value<=0:raise TimeoutError('absolute DL/T645 deadline exceeded')
    return min(3,value)
