#!/usr/bin/env python3
"""Generate an isolated anonymous MQTT config, then exec real Mosquitto."""
import argparse
import json
import os
import sys
from mqtt_wire import validate_config

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--config-json',required=True)
    args=parser.parse_args()
    try:
        config=validate_config(json.loads(args.config_json))
        # All lines are constants or validated integers. Listener comes first: no implicit 1883.
        text='\n'.join(['listener 18883 0.0.0.0','protocol mqtt','socket_domain ipv4',f'max_connections {config["max_connections"]}','allow_anonymous true','persistence false',f'max_packet_size {config["max_packet_size"]}','log_dest stdout','log_type all','connection_messages true','log_timestamp true'])+'\n'
        # Anonymous, unlinked descriptor survives exec; no config/log/state file remains behind.
        fd=os.memfd_create('protocol-target-lab-mqtt-config',flags=0)
        os.write(fd,text.encode());os.lseek(fd,0,os.SEEK_SET)
        print(json.dumps(dict(event='mosquitto_exec',implementation='mosquitto',version='2.0.18',internal_port=18883,config=config),separators=(',',':')),flush=True)
        os.execv('/usr/local/sbin/mosquitto',['mosquitto','-c',f'/proc/self/fd/{fd}'])
    except (ValueError,TypeError,OSError) as exc:
        print(json.dumps(dict(event='configuration_error',error=str(exc)[:1024])),file=sys.stderr,flush=True);return 2

if __name__=='__main__':sys.exit(main())
