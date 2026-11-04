#!/usr/bin/env python3
"""Real c104 2.2.1 controlled RTU with three finite in-memory point roles."""
import argparse
import importlib.metadata
import json
import signal
import sys
import threading
import c104
from iec104_config import preview,validate_config

def emit(event,**fields):print(json.dumps(dict(event=event,**fields),separators=(',',':')),flush=True)

def run(config):
    stop=threading.Event();server=c104.Server(ip='0.0.0.0',port=2404,max_connections=config['max_connections'])
    stations={ca:server.add_station(common_address=ca) for ca in sorted({p['ca'] for p in config['points'].values()})}
    roles={}
    for role,kind in [('single',c104.Type.M_SP_NA_1),('measured',c104.Type.M_ME_NC_1),('command',c104.Type.C_SC_NA_1)]:
        p=config['points'][role];point=stations[p['ca']].add_point(io_address=p['ioa'],type=kind,report_ms=0)
        if point is None:raise ValueError('native point creation failed: '+role)
        if role!='command':point.value=p['value']
        roles[role]=point
    def received(server:c104.Server,data:bytes)->None:emit('raw_received',packet=preview(data))
    def sent(server:c104.Server,data:bytes)->None:emit('raw_sent',packet=preview(data))
    def connected(server:c104.Server,ip:str)->bool:emit('connection_requested',source=ip[:64]);return True
    def command(point:c104.Point,previous_info:c104.Information,message:c104.IncomingMessage)->c104.ResponseState:
        # Direct command confirmation is emitted by the native stack after this callback.
        before=bool(roles['single'].value);after=bool(point.value);roles['single'].value=after
        emit('command_applied',ca=point.station.common_address,ioa=point.io_address,type='C_SC_NA_1',cot=str(message.cot),is_select=message.is_select_command,previous_value=before,value=after,target=config['points']['single'])
        return c104.ResponseState.SUCCESS
    roles['command'].on_receive(callable=command)
    server.on_receive_raw(callable=received);server.on_send_raw(callable=sent);server.on_connect(callable=connected)
    for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,lambda *_:stop.set())
    server.start()
    if not server.is_running:raise RuntimeError('native IEC104 server did not enter running state')
    emit('ready',implementation='c104',version=importlib.metadata.version('c104'),internal_port=2404,config=config,command_target='single',physical_execution=False)
    try:stop.wait()
    finally:server.stop();emit('stopped')

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--config-json',required=True);args=parser.parse_args()
    try:run(validate_config(json.loads(args.config_json)))
    except (ValueError,TypeError,OSError,RuntimeError) as exc:emit('startup_error',error=str(exc)[:1024]);return 2
    return 0
if __name__=='__main__':sys.exit(main())
