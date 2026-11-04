"""Frozen, bounded three-role IEC104 workspace configuration."""
import hashlib
import ipaddress
import math
import struct

MAX_FLOAT32=struct.unpack('<f',bytes.fromhex('ffff7f7f'))[0]
def float32(value):return struct.unpack('<f',struct.pack('<f',value))[0]
def validate_config(value):
    if not isinstance(value,dict) or set(value)!={'bind_ip','port','max_connections','points'}:raise ValueError('config: expected bind_ip, port, max_connections, points only')
    if not isinstance(value['bind_ip'],str):raise ValueError('bind_ip: expected IPv4 string')
    ip=ipaddress.IPv4Address(value['bind_ip'])
    if ip.is_multicast or int(ip)==0xffffffff:raise ValueError('bind_ip: expected unicast/wildcard IPv4')
    for key,lo,hi in [('port',1,65535),('max_connections',1,64)]:
        if type(value[key]) is not int or not lo<=value[key]<=hi:raise ValueError(f'{key}: expected integer {lo}..{hi}')
    points=value['points']
    if not isinstance(points,dict) or set(points)!={'single','measured','command'}:raise ValueError('points: expected single, measured, command roles')
    result={};seen=set()
    for role in ('single','measured','command'):
        point=points[role];keys={'ca','ioa'}|({'value'} if role!='command' else set())
        if not isinstance(point,dict) or set(point)!=keys:raise ValueError('points.'+role+': unexpected fields')
        for key,lo,hi in [('ca',1,65534),('ioa',1,16777215)]:
            if type(point[key]) is not int or not lo<=point[key]<=hi:raise ValueError(f'points.{role}.{key}: expected integer {lo}..{hi}')
        if (point['ca'],point['ioa']) in seen:raise ValueError('points: duplicate CA/IOA')
        seen.add((point['ca'],point['ioa']));result[role]=dict(point)
        if role=='single' and type(point['value']) is not bool:raise ValueError('single.value: expected boolean')
        if role=='measured':
            x=point['value']
            if type(x) not in (int,float) or abs(x)>MAX_FLOAT32 or not math.isfinite(x):raise ValueError('measured.value: expected finite float32-range number')
            result[role]['value']=float32(x)
    return dict(value,bind_ip=str(ip),points=result)

def preview(data):return dict(length=len(data),preview_hex=data[:128].hex(),truncated=len(data)>128,sha256=hashlib.sha256(data).hexdigest())
