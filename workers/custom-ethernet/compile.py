#!/usr/bin/env python3
"""MIT. Read-only live compiler and owned temporary socket capability probe."""
import argparse
import json
import signal
from ethernet_wire import *

def main():
    p=argparse.ArgumentParser(description=__doc__);config_arguments(p);p.add_argument('--interface',required=True);p.add_argument('--verify-memberships',action='store_true');a=p.parse_args()
    def expired(_s,_f):raise TimeoutError('compiler deadline')
    signal.signal(signal.SIGALRM,expired);signal.alarm(8)
    try:
        cfg=config_from_arguments(a)
        if cfg['link']['mode']=='host-interface' and a.verify_memberships:raise ValueError('host probe cannot change memberships')
        info=interface_info(a.interface);raw=response_frame(cfg);mtu_check(raw,info['mtu']);program,library=compile_filter(a.interface,cfg['packet_filter'])
        t=Transport(a.interface,program,cfg['multicast_macs'] if a.verify_memberships else (),cfg['promiscuous'] if a.verify_memberships else False)
        try:proof=t.proof()
        finally:t.close()
        result={'schema_version':1,'protocol':'custom-ethernet','passed':True,'config_sha256':canonical_hash(cfg),'interface':info,'active_frame':summary(raw),'filter':proof,'library':library,'capture_snaplen':SNAPLEN}
        print(json.dumps(result,separators=(',',':')));return 0
    except Exception as e:print(json.dumps({'schema_version':1,'protocol':'custom-ethernet','passed':False,'error':str(e)[:512]},separators=(',',':')));return 1
    finally:signal.alarm(0)
if __name__=='__main__':raise SystemExit(main())
