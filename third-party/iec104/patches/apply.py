#!/usr/bin/env python3
"""Apply the checked, exact-context unified project patch without external patch tools."""
import hashlib
import json
from pathlib import Path
import re
import sys

root=Path(__file__).resolve().parent
meta=json.loads((root/'source.json').read_text())
source=Path(sys.argv[1])/meta['source_file']
original=source.read_bytes()
if hashlib.sha256(original).hexdigest()!=meta['original_sha256']:
    raise SystemExit('IEC104 patch source hash mismatch')
patch=(root/meta['patch_file']).read_bytes()
if hashlib.sha256(patch).hexdigest()!=meta['patch_sha256']:
    raise SystemExit('IEC104 patch hash mismatch')
lines=patch.decode().splitlines(keepends=True)
if lines[:2]!=['--- a/'+meta['source_file']+'\n','+++ b/'+meta['source_file']+'\n']:
    raise SystemExit('Unexpected patch target')
old=original.decode().splitlines(keepends=True);result=[];cursor=0;at=2
while at<len(lines):
    match=re.fullmatch(r'@@ -(\d+),(\d+) \+(\d+),(\d+) @@\n',lines[at])
    if not match:raise SystemExit('Invalid patch hunk header')
    start=int(match[1])-1;before=[];after=[];at+=1
    while at<len(lines) and not lines[at].startswith('@@'):
        line=lines[at];at+=1
        if line[:1] not in (' ','+','-'):raise SystemExit('Invalid patch hunk line')
        if line[0] in (' ','-'):before.append(line[1:])
        if line[0] in (' ','+'):after.append(line[1:])
    if start<cursor or len(before)!=int(match[2]) or len(after)!=int(match[4]) or old[start:start+len(before)]!=before:
        raise SystemExit('Patch context/count mismatch')
    result.extend(old[cursor:start]);result.extend(after);cursor=start+len(before)
result.extend(old[cursor:]);patched=''.join(result).encode()
if hashlib.sha256(patched).hexdigest()!=meta['patched_sha256']:
    raise SystemExit('Patched IEC104 source hash mismatch')
source.write_bytes(patched)
print('Applied IEC104 '+meta['id']+' with original/patch/result SHA-256 verification')
