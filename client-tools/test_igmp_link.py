"""MIT. Pure safety regression fixtures for the narrow native link helper."""
import io
import ipaddress
import json
import struct
import time
import unittest
from unittest import mock
import igmp_link as h

SPEC={'schema_version':1,'deployment_id':'00000000-0000-4000-8000-000000000001','instance_id':'igmp-demo','role':'target','link':{'outer_interface':'eth0','local_outer_ip':'192.0.2.20','peer_outer_ip':'192.0.2.10','vni':1919,'udp_port':47895,'mtu':1400,'inner_cidr':'198.18.19.20/24','inner_mac':'02:00:00:00:19:20'}}

class MemberTests(unittest.TestCase):
    def read(self,name,header,group='0113C0EF',users='1'):
        data='Idx Device : Count Querier\n'+header+'\n\t'+group+' '+users+' 0:00000000 0\n'
        with mock.patch('builtins.open',return_value=io.StringIO(data)):return h.active_memberships(name)
    def test_long_name_attached_colon(self):self.assertEqual(self.read('plig1234567890','3 plig1234567890: 1 V2')[0]['users'],1)
    def test_short_name_spaced_colon(self):self.assertEqual(self.read('eth0','3 eth0      : 1 V2')[0]['group'],'239.192.19.1')
    def test_unrelated_interface_ignored(self):self.assertEqual(self.read('eth1','3 eth0 : 1 V2'),[])
    def test_only_automatic_allhosts_ignored(self):self.assertEqual(self.read('eth0','3 eth0 : 1 V2','010000E0','1'),[])
    def test_explicit_additional_allhosts_ref_blocks(self):self.assertEqual(self.read('eth0','3 eth0 : 1 V2','010000E0','2'),[{'group':'224.0.0.1','users':2}])
    def test_malformed_group_blocks(self):
        with self.assertRaises(h.HelperError):self.read('eth0','3 eth0 : 1 V2','xyz','1')
    def test_nonmulticast_group_blocks(self):
        with self.assertRaises(h.HelperError):self.read('eth0','3 eth0 : 1 V2','0100007F','1')
    def test_invalid_user_count_blocks(self):
        for count in ('-1','0','NaN','4294967296'):
            with self.subTest(count=count),self.assertRaises(h.HelperError):self.read('eth0','3 eth0 : 1 V2',users=count)

class RouteTests(unittest.TestCase):
    def setUp(self):self.inner=ipaddress.IPv4Interface('198.18.19.20/24');self.row={'dst':'198.18.19.0/24','dev':'pligtest','protocol':'kernel','scope':'link','prefsrc':'198.18.19.20','flags':[]}
    def test_connected_route(self):self.assertTrue(h.automatic_route4(self.row,self.inner,'pligtest'))
    def test_fake_kernel_extra_prefix(self):self.row['dst']='203.0.113.0/24';self.assertFalse(h.automatic_route4(self.row,self.inner,'pligtest'))
    def test_kernel_gateway_or_metric_not_automatic(self):
        for key,value in [('gateway','198.18.19.1'),('metric',7)]:
            r={**self.row,key:value};self.assertFalse(h.automatic_route4(r,self.inner,'pligtest'))
    def test_local_and_broadcast(self):
        for kind,dst,scope in [('local','198.18.19.20','host'),('broadcast','198.18.19.255','link')]:self.assertTrue(h.automatic_route4({**self.row,'type':kind,'dst':dst,'scope':scope,'table':'local'},self.inner,'pligtest'))
    def test_native_ipv6_multicast_only(self):
        r={'type':'multicast','dst':'ff00::/8','dev':'pligtest','table':'local','protocol':'kernel','metric':256,'flags':[],'pref':'medium'};self.assertTrue(h.automatic_route6(r,'pligtest'));r['dst']='2001:db8::/64';self.assertFalse(h.automatic_route6(r,'pligtest'))

class ConfigTests(unittest.TestCase):
    def test_group31_derived_not_name_only(self):
        owner='ffffffff-ffff-4fff-8fff-ffffffffffff';g=h.atomic_group(owner);self.assertGreaterEqual(g,1);self.assertLessEqual(g,0x7fffffff);self.assertEqual(g,h.atomic_group(owner))
    def test_bool_schema_rejected(self):
        s=json.loads(json.dumps(SPEC));s['schema_version']=True
        with self.assertRaises(h.UsageError):h.validate_spec(s)
    def test_bad_native_ranges(self):
        for key,value in [('vni',0),('udp_port',1023),('mtu',575),('inner_cidr','198.18.19.0/24'),('inner_mac','ff:ff:ff:ff:ff:ff')]:
            s=json.loads(json.dumps(SPEC));s['link'][key]=value
            with self.subTest(key=key),self.assertRaises((ValueError,h.HelperError)):h.validate_spec(s)
    def test_quiescing_journal_exact_boolean(self):
        owner='00000000-0000-4000-8000-000000000002';r={'schema_version':1,'protocol':'igmp-link','spec':SPEC,'owner_id':owner,'name':'plig'+owner.replace('-','')[:10],'alias':h.alias(SPEC,owner),'atomic_group_id':h.atomic_group(owner),'link_sha256':h.digest(SPEC['link']),'phase':'ready','ifindex':3,'network_namespace':{'device':5,'inode':1},'boot_id':owner,'vxlan_attributes_sha256':'0'*64}
        store=h.Store(h.Path('/unused'));store.check_receipt({**r,'quiescing':{'original_up':True}})
        for q in (None,{},True,{'original_up':1},{'original_up':True,'extra':False}):
            with self.subTest(q=q),self.assertRaises(h.HelperError):store.check_receipt({**r,'quiescing':q})

class NamespaceTests(unittest.TestCase):
    def test_missing_device_in_wrong_namespace_preserves_receipt(self):
        receipt={'name':'pligtest','boot_id':'same','network_namespace':{'device':1,'inode':10}}
        store=mock.Mock()
        with mock.patch.object(h,'boot_id',return_value='same'),mock.patch.object(h,'namespace',return_value={'device':1,'inode':11}),mock.patch.object(h,'link',return_value=None),self.assertRaises(h.HelperError):h.delete(receipt,store,time.monotonic()+1)
        store.remove.assert_not_called()
    def test_missing_old_boot_device_can_recover(self):
        receipt={'name':'pligtest','boot_id':'old','network_namespace':{'device':1,'inode':10}}
        with mock.patch.object(h,'boot_id',return_value='new'),mock.patch.object(h,'namespace',return_value={'device':1,'inode':11}),mock.patch.object(h,'link',return_value=None):self.assertIsNone(h.verify(receipt,time.monotonic()+1))

class QuiesceTests(unittest.TestCase):
    def setUp(self):
        self.record={'name':'pligtest','phase':'ready'};self.v={'flags':['UP']};self.store=mock.Mock();self.mdns=[{'group':'224.0.0.251','users':1}]
    def patches(self):
        return (mock.patch.object(h,'complete_alias',return_value=self.v),mock.patch.object(h,'verify',return_value=self.v),mock.patch.object(h,'require_admin'),mock.patch.object(h,'link',return_value=None))
    def test_data_and_unknown_refs_refuse_before_any_down(self):
        for refs in ([{'group':'239.192.19.1','users':1}],[{'group':'224.0.0.1','users':2}],[{'group':'224.0.0.252','users':1}]):
            with self.subTest(refs=refs),self.patches()[0],mock.patch.object(h,'active_memberships',return_value=refs),mock.patch.object(h,'ip') as ip,self.assertRaises(h.HelperError):h.delete(self.record,self.store,time.monotonic()+5)
            ip.assert_not_called();self.store.write.assert_not_called();self.store.remove.assert_not_called()
    def test_cooperative_drop_then_actual_zero_deletes(self):
        a,b,c,d=self.patches()
        with a,b,c,d,mock.patch.object(h,'active_memberships',side_effect=[self.mdns,[],[]]),mock.patch.object(h,'ip') as ip:h.delete(self.record,self.store,time.monotonic()+5)
        self.assertEqual([x.args[0] for x in ip.call_args_list],[['link','set','dev','pligtest','down'],['link','delete','dev','pligtest']]);self.store.write.assert_called_once();self.store.remove.assert_called_once()
    def test_held_mdns_refuses_and_restores_original_up(self):
        clock=[0.];a,b,c,d=self.patches()
        with a,b,c,d,mock.patch.object(h,'active_memberships',return_value=self.mdns),mock.patch.object(h,'ip') as ip,mock.patch.object(h.time,'monotonic',side_effect=lambda:clock[0]),mock.patch.object(h.time,'sleep',side_effect=lambda n:clock.__setitem__(0,clock[0]+n)),self.assertRaisesRegex(h.HelperError,'original UP verified'):h.delete(self.record,self.store,5)
        self.assertEqual([x.args[0][-1] for x in ip.call_args_list],['down','up']);self.assertNotIn('quiescing',self.record);self.store.remove.assert_not_called();self.assertLessEqual(clock[0],1.001)
    def test_original_down_is_not_turned_up(self):
        self.v['flags']=[];clock=[0.];a,b,c,d=self.patches()
        with a,b,c,d,mock.patch.object(h,'active_memberships',return_value=self.mdns),mock.patch.object(h,'ip') as ip,mock.patch.object(h.time,'monotonic',side_effect=lambda:clock[0]),mock.patch.object(h.time,'sleep',side_effect=lambda n:clock.__setitem__(0,clock[0]+n)),self.assertRaisesRegex(h.HelperError,'original DOWN retained'):h.delete(self.record,self.store,5)
        self.assertEqual([x.args[0][-1] for x in ip.call_args_list],['down']);self.assertEqual(self.record['quiescing'],{'original_up':False});self.store.remove.assert_not_called()
    def test_pending_down_without_refs_repeat_stop(self):
        self.record['quiescing']={'original_up':True};a,b,c,d=self.patches()
        with a,b,c,d,mock.patch.object(h,'active_memberships',return_value=[]),mock.patch.object(h,'ip') as ip:h.delete(self.record,self.store,time.monotonic()+5)
        self.assertEqual(ip.call_args.args[0],['link','delete','dev','pligtest']);self.store.remove.assert_called_once()
    def test_explicit_resume_up_and_clears_journal(self):
        self.record['quiescing']={'original_up':True};self.v['flags']=[]
        with mock.patch.object(h,'verify',return_value=self.v),mock.patch.object(h,'active_memberships',return_value=[]),mock.patch.object(h,'require_admin'),mock.patch.object(h,'ip') as ip:h.resume_quiescing(self.record,self.store,time.monotonic()+1)
        self.assertEqual(ip.call_args.args[0],['link','set','dev','pligtest','up']);self.assertNotIn('quiescing',self.record);self.store.write.assert_called_once()
    def test_explicit_resume_with_data_never_touches_link(self):
        self.record['quiescing']={'original_up':True}
        with mock.patch.object(h,'verify',return_value=self.v),mock.patch.object(h,'active_memberships',return_value=[{'group':'239.1.1.1','users':1}]),mock.patch.object(h,'ip') as ip,self.assertRaises(h.HelperError):h.resume_quiescing(self.record,self.store,time.monotonic()+1)
        ip.assert_not_called();self.store.write.assert_not_called()
    def test_pending_status_not_ready(self):
        r={'phase':'ready','quiescing':{'original_up':True},'spec':SPEC};v={**self.v,'ifname':'pligtest','ifindex':3,'address':'02:00:00:00:19:20','mtu':1400}
        self.assertFalse(h.output(SPEC,r,v,'status')['ready'])

class PackageCleanupTests(unittest.TestCase):
    def records(self,n=2):return [{'owner_id':str(i),'spec':{'deployment_id':'different-'+str(i),'role':'peer'}} for i in range(n)]
    def test_all_deployments_in_explicit_state_root(self):
        store=mock.Mock();store.all.return_value=self.records()
        with mock.patch.object(h,'delete') as delete:r=h.cleanup_package(store,time.monotonic()+30)
        self.assertTrue(r['passed']);self.assertEqual(r['summary']['removed'],2);self.assertEqual([c.args[0] for c in delete.call_args_list],store.all.return_value)
    def test_partial_refusal_honest_and_other_receipts_attempted(self):
        store=mock.Mock();store.all.return_value=self.records()
        with mock.patch.object(h,'delete',side_effect=[h.HelperError('held actual reference'),None]):r=h.cleanup_package(store,time.monotonic()+30)
        self.assertFalse(r['passed']);self.assertEqual(r['summary'],{'total':2,'removed':1,'failed':1,'unprocessed':0,'details_truncated':False});self.assertIn('held actual reference',r['checks'][0]['error'])
    def test_absolute_package_deadline_does_not_start_more_work(self):
        store=mock.Mock();store.all.return_value=self.records()
        with mock.patch.object(h,'delete') as delete:r=h.cleanup_package(store,time.monotonic()-1)
        delete.assert_not_called();self.assertFalse(r['passed']);self.assertEqual(r['summary']['unprocessed'],2)
    def test_report_bound_does_not_hide_failure_counts(self):
        store=mock.Mock();store.all.return_value=self.records(100)
        with mock.patch.object(h,'delete',side_effect=h.HelperError('x'*10000)):r=h.cleanup_package(store,time.monotonic()+30)
        self.assertEqual(r['summary']['failed'],100);self.assertEqual(len(r['checks']),32);self.assertTrue(r['summary']['details_truncated']);self.assertLess(len(json.dumps(r).encode()),65536)
    def test_missing_old_boot_recreation_drops_old_quiesce_journal(self):
        r={'spec':SPEC,'name':'pligtest','alias':'owned-test','boot_id':'old','network_namespace':{'device':1,'inode':1},'phase':'ready','ifindex':3,'atomic_group_id':1,'vxlan_attributes_sha256':'old-kernel-attributes','quiescing':{'original_up':True}};store=mock.Mock();store.read.return_value=r
        with mock.patch.object(h,'preflight'),mock.patch.object(h,'verify',return_value=None),mock.patch.object(h,'boot_id',return_value='new'),mock.patch.object(h,'namespace',return_value={'device':1,'inode':2}),mock.patch.object(h,'link',return_value=None),mock.patch.object(h,'native_links',return_value=[]),mock.patch.object(h,'ip',side_effect=h.HelperError('controlled stop before new creation')),self.assertRaises(h.HelperError):h.start(SPEC,store,time.monotonic()+10)
        self.assertNotIn('quiescing',r);self.assertIsNone(r['vxlan_attributes_sha256']);self.assertEqual(r['phase'],'intent');self.assertEqual(r['boot_id'],'new');store.write.assert_called_once()

class FakeNetlink:
    def __init__(self,flag=0,error=0,trailing=b''):self.flag=flag;self.error=error;self.trailing=trailing
    def __enter__(self):return self
    def __exit__(self,*a):pass
    def bind(self,*a):pass
    def send(self,data):self.seq=struct.unpack_from('IHHII',data)[3]
    def settimeout(self,*a):pass
    def recvmsg(self,*a):return (struct.pack('IHHIIi',20,3,self.flag,self.seq,0,self.error)+self.trailing,[],0,(0,0))

class NetlinkTests(unittest.TestCase):
    def call(self,**kw):
        with mock.patch.object(h.socket,'socket',return_value=FakeNetlink(**kw)):return h.native_links(time.monotonic()+1)
    def test_complete_empty_dump(self):self.assertEqual(self.call(),[])
    def test_interrupted_done_not_absent(self):
        with self.assertRaises(h.HelperError):self.call(flag=0x10)
    def test_done_errno_not_absent(self):
        with self.assertRaises(h.HelperError):self.call(error=-4)
    def test_trailing_bytes_not_absent(self):
        with self.assertRaises(h.HelperError):self.call(trailing=b'x')
    def test_delete_does_not_remove_receipt_on_incomplete_dump(self):
        store=mock.Mock()
        with mock.patch.object(h.socket,'socket',return_value=FakeNetlink(flag=0x10)),self.assertRaises(h.HelperError):h.delete({'name':'pligtest','boot_id':h.boot_id(),'network_namespace':h.namespace()},store,time.monotonic()+1)
        store.remove.assert_not_called()

if __name__=='__main__':unittest.main()
