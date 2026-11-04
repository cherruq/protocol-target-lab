#!/usr/bin/env python3
"""Resolve a content-locked broker input across Docker config/manifest ID formats."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys


def content_sha256(inspected):
    profile={key:inspected[key] for key in ('RootFS','Config')}
    if not isinstance(profile['RootFS'],dict) or not isinstance(profile['Config'],dict):
        raise ValueError('broker input lacks complete RootFS/Config objects')
    raw=json.dumps(profile,sort_keys=True,separators=(',',':')).encode('utf-8')
    return hashlib.sha256(raw).hexdigest()


def matching_id(inspected,lock):
    if content_sha256(inspected)!=lock['content_sha256']:return None
    labels=inspected['Config'].get('Labels') or {}
    if any(labels.get(key)!=value for key,value in lock['required_labels'].items()):return None
    ident=inspected.get('Id','')
    if not re.fullmatch(r'sha256:[0-9a-f]{64}',ident):raise ValueError('broker input has invalid engine image ID')
    return ident


def resolve(lock):
    refs=list(dict.fromkeys([lock['image_id'],*lock.get('known_engine_ids',[]),*lock.get('candidate_refs',[])]))
    checked=set()
    for ref in refs:
        result=subprocess.run(['docker','image','inspect',ref],capture_output=True,text=True)
        if result.returncode:continue
        for item in json.loads(result.stdout):
            checked.add(item['Id'])
            match=matching_id(item,lock)
            if match:return match
    # An archive saved by immutable ID need not acquire a repository tag.
    result=subprocess.run(['docker','image','ls','--all','--quiet','--no-trunc'],capture_output=True,text=True,check=True)
    remaining=[ref for ref in dict.fromkeys(result.stdout.split()) if ref not in checked]
    for at in range(0,len(remaining),64):
        result=subprocess.run(['docker','image','inspect',*remaining[at:at+64]],capture_output=True,text=True)
        if result.returncode:continue
        for item in json.loads(result.stdout):
            match=matching_id(item,lock)
            if match:return match
    raise ValueError('missing content-locked Mosquitto input; explicitly load sources/build-input/broker-input-image.tar from MQTT-SN assets for a development rebuild')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lock',type=Path,default=Path(__file__).resolve().parents[1]/'images/mqtt-sn/dependencies.lock.json')
    parser.add_argument('--inspect-json',type=Path,help='validate an existing read-only Docker inspect report instead of querying Docker')
    args=parser.parse_args();lock=json.loads(args.lock.read_text())['broker']
    if args.inspect_json:
        values=json.loads(args.inspect_json.read_text());values=values if isinstance(values,list) else [values]
        for value in values:
            match=matching_id(value,lock)
            if match:print(match);return 0
        raise ValueError('inspect report does not match complete locked broker content/capabilities')
    print(resolve(lock));return 0


if __name__=='__main__':
    try:sys.exit(main())
    except (ValueError,KeyError,TypeError,OSError,subprocess.SubprocessError) as exc:
        print('MQTT-SN broker input: '+str(exc),file=sys.stderr);sys.exit(1)
