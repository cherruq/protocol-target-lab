#!/usr/bin/env python3
"""Resolve a fixed compiler input across Docker config-ID/OCI-manifest-ID presentations."""
import hashlib,json,pathlib,subprocess,sys
LOCK=pathlib.Path(__file__).with_name('dependencies.lock.json')
def profile(v):return hashlib.sha256(json.dumps({'RootFS':v['RootFS'],'Config':v['Config']},sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()).hexdigest()
def resolve():
 c=json.loads(LOCK.read_text());refs=[c['build_image'],c['build_image_prepared_ref']]
 ids=subprocess.check_output(['docker','image','ls','-q','--no-trunc'],text=True).splitlines()
 if len(ids)>2048:raise ValueError('compiler image candidate budget')
 for ref in dict.fromkeys(refs+ids):
  r=subprocess.run(['docker','image','inspect',ref],capture_output=True,text=True)
  if r.returncode:continue
  rows=json.loads(r.stdout)
  if len(rows)==1 and profile(rows[0])==c['build_content_sha256']:return rows[0]['Id']
 raise ValueError('fixed compiler input missing: import only sources/build-input/compiler-image.tar explicitly before rebuilding')
if __name__=='__main__':
 try:print(resolve())
 except Exception as e:print(str(e),file=sys.stderr);raise SystemExit(1)
