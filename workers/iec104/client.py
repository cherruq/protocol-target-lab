#!/usr/bin/env python3
"""Bounded independent IEC104 verification, including observable command/restore state."""
import argparse
import json
import signal
import sys
import time
from iec104_config import validate_config
from iec104_wire import Deadline,Session

METHODS=('CONNECT','GI','READ','COMMAND')
class Parser(argparse.ArgumentParser):
    def error(self,message):raise ValueError(message)

def verify_single_gi(s,config,expected):
    result=s.gi(config);point=config['points']['single']
    values=[p['value'] for station in result if station['ca']==point['ca'] for p in station['points'] if p['type_id']==1 and p['ioa']==point['ioa']]
    if values!=[expected]:raise ValueError('GI single point did not reflect command/restored value')
    return result

def check(host,port,config,method,round_number,deadline):
    started=time.monotonic();trace=[];session=None;before=None;changed=False
    result=dict(name=f'{method}/round-{round_number}',passed=False,request=dict(method=method,path='station',points=config['points']),response={})
    try:
        if method=='COMMAND' and deadline-time.monotonic()<12:raise Deadline('insufficient remaining time for command and reserved restoration budget')
        work_deadline=deadline-10 if method=='COMMAND' else deadline
        session=Session(host,port,work_deadline,trace)
        if method=='CONNECT':
            session.u(67,131);session.u(19,35);result['response']['u_frames']=['STARTDT_CON','TESTFR_CON','STOPDT_CON']
        elif method=='GI':result['response']['stations']=session.gi(config)
        elif method=='READ':
            single=session.read(config['points']['single'],1);measured=session.read(config['points']['measured'],13)
            if measured!=config['points']['measured']['value']:raise ValueError('READ float32 measured value mismatch')
            result['response']['values']=dict(single=single,measured=measured)
        else:
            before=session.read(config['points']['single'],1);target=not before;changed=True
            confirmation=session.command(config['points']['command'],target)
            observed=session.read(config['points']['single'],1)
            if observed!=target:raise ValueError('command confirmed but associated single point did not change')
            stations=verify_single_gi(session,config,target)
            result['response'].update(previous_value=before,target_value=target,observed_value=observed,confirmation=confirmation,stations=stations)
        result['passed']=True
    except Exception as exc:result['error']=str(exc)[:1024]
    finally:
        if session is not None:session.close()
        if changed:
            restoration=dict(passed=False,expected_value=before);restore=None
            try:
                # Fresh connection recovers even if the tested connection failed. Reserve time
                # before mutation, and honor the absolute deadline during every restore socket op.
                last_error=None;retry_until=min(deadline,time.monotonic()+1)
                while time.monotonic()<retry_until:
                    try:restore=Session(host,port,deadline,trace);break
                    except Exception as exc:
                        last_error=exc;remaining=retry_until-time.monotonic()
                        if remaining>0:time.sleep(min(.02,remaining))
                if restore is None:raise ValueError('restoration reconnect failed: '+str(last_error))
                restoration['confirmation']=restore.command(config['points']['command'],before)
                restoration['observed_value']=restore.read(config['points']['single'],1)
                if restoration['observed_value']!=before:raise ValueError('restored READ value mismatch')
                restoration['stations']=verify_single_gi(restore,config,before);restoration['passed']=True
            except Exception as exc:restoration['error']=str(exc)[:1024];result['passed']=False;result['error']='command restoration failed: '+str(exc)[:900]
            finally:
                if restore is not None:restore.close()
            result['response']['restoration']=restoration
        result['response']['trace']=trace
    result['seconds']=round(time.monotonic()-started,6);return result

def main():
    started=time.monotonic();deadline=started+30;report=dict(passed=False,checks=[])
    signal.signal(signal.SIGALRM,lambda *_:(_ for _ in ()).throw(Deadline('overall IEC104 test deadline exceeded (30 seconds)')));signal.alarm(30)
    try:
        parser=Parser(description=__doc__);parser.add_argument('--host',required=True);parser.add_argument('--port',type=int,required=True);parser.add_argument('--method',choices=(*METHODS,'ALL'),default='ALL');parser.add_argument('--path',default='station');parser.add_argument('--config-json',required=True)
        args=parser.parse_args();config=validate_config(json.loads(args.config_json))
        if not 1<=args.port<=65535:raise ValueError('port: expected 1..65535')
        if args.path!='station':raise ValueError('path: expected station')
        for method in METHODS if args.method=='ALL' else [args.method]:
            for number in (1,2):
                if time.monotonic()>=deadline:raise Deadline('overall IEC104 test deadline exceeded (30 seconds)')
                report['checks'].append(check(args.host,args.port,config,method,number,deadline))
        report['target']=dict(host=args.host[:253],port=args.port)
    except Exception as exc:report['error']=str(exc)[:1024]
    finally:signal.alarm(0)
    passed=sum(c['passed'] for c in report['checks']);report['summary']=dict(total=len(report['checks']),passed=passed,failed=len(report['checks'])-passed);report['passed']=bool(report['checks']) and passed==len(report['checks']) and 'error' not in report;report['seconds']=round(time.monotonic()-started,6)
    output=json.dumps(report,separators=(',',':'))
    if len(output.encode())>512*1024:
        report=dict(passed=False,checks=[],summary=report['summary'],seconds=report['seconds'],error='IEC104 report exceeded 512 KiB limit');output=json.dumps(report,separators=(',',':'))
    print(output,flush=True);return 0 if report['passed'] else 1
if __name__=='__main__':sys.exit(main())
