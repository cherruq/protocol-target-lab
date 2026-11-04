"""The build resolver must compare complete content while tolerating engine IDs."""
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import json
import subprocess
spec=importlib.util.spec_from_file_location('broker_input',Path(__file__).resolve().parents[2]/'scripts/mqtt-sn-broker-input.py')
resolver=importlib.util.module_from_spec(spec);spec.loader.exec_module(resolver)
class BrokerInputTests(unittest.TestCase):
    def setUp(self):
        self.item=dict(Id='sha256:'+'a'*64,RootFS=dict(Type='layers',Layers=['sha256:'+'1'*64]),Config=dict(Env=['A=1'],Cmd=['native'],Labels={'capability':'full-v1'},Entrypoint=None))
        self.lock=dict(content_sha256=resolver.content_sha256(self.item),required_labels={'capability':'full-v1'})
    def test_engine_id_change_and_key_order_do_not_change_content(self):
        changed=copy.deepcopy(self.item);changed['Id']='sha256:'+'b'*64;changed['Config']=dict(reversed(list(changed['Config'].items())))
        self.assertEqual(resolver.matching_id(changed,self.lock),changed['Id'])
    def test_any_layer_or_runtime_config_drift_rejects(self):
        for field in ('layer','env','label','extra-config-field'):
            changed=copy.deepcopy(self.item)
            if field=='layer':changed['RootFS']['Layers'].append('sha256:'+'2'*64)
            elif field=='env':changed['Config']['Env']=['A=2']
            elif field=='label':changed['Config']['Labels']['capability']='old'
            else:changed['Config']['UnexpectedField']=True
            self.assertIsNone(resolver.matching_id(changed,self.lock),field)
    def test_untagged_cross_engine_input_is_resolved_by_content(self):
        self.lock.update(image_id=self.item['Id'],candidate_refs=['public-broker:release'])
        changed=copy.deepcopy(self.item);changed['Id']='sha256:'+'b'*64
        drift=copy.deepcopy(self.item);drift['Config']['Env']=['UNAPPROVED=1']
        answers=[subprocess.CompletedProcess([],1,'','not found'),subprocess.CompletedProcess([],0,json.dumps([drift]),''),subprocess.CompletedProcess([],0,changed['Id']+'\n',''),subprocess.CompletedProcess([],0,json.dumps([changed]),'')]
        with patch.object(resolver.subprocess,'run',side_effect=answers) as run:
            self.assertEqual(resolver.resolve(self.lock),changed['Id'])
            self.assertEqual(run.call_args_list[-2].args[0],['docker','image','ls','--all','--quiet','--no-trunc'])
            self.assertEqual(run.call_args_list[-1].args[0],['docker','image','inspect',changed['Id']])
    def test_capabilities_are_required_even_with_matching_fingerprint(self):
        self.lock['required_labels']['capability']='other'
        self.assertIsNone(resolver.matching_id(self.item,self.lock))
if __name__=='__main__':unittest.main()
