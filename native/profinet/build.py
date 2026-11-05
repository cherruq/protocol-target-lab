"""Configure an extracted, fixed upstream tree offline; no native protocol patches."""
import pathlib,shutil,subprocess,sys
root=pathlib.Path(sys.argv[1]);build=pathlib.Path(sys.argv[2]);native=pathlib.Path(__file__).resolve().parent
pnet=next(root.glob('p-net-*'));osal=next(root.glob('osal-*'));tools=next(root.glob('cmake-tools-*'))
shutil.copytree(tools,pnet/'cmake/tools',dirs_exist_ok=True)
shutil.copy2(native/'main.c',pnet/'src/ports/linux/plab_main.c')
# Export the fixed upstream read-only DeviceOptions table without altering its handlers.
import re
text=(pnet/'src/common/pf_dcp.c').read_text().split('static const pf_dcp_opt_sub_t device_options[] = {',1)[1].split('};',1)[0]
text=re.sub(r'#if 0.*?#endif','',text,flags=re.S)
text=re.sub(r'//[^\n]*','',text)
entries=re.findall(r'\{(PF_DCP_\w+),\s*(PF_DCP_\w+)\}',text)
if len(entries)!=14:raise ValueError('fixed upstream DeviceOptions table changed')
(pnet/'src/ports/linux/plab_options.h').write_text('static const unsigned char plab_options[] = {'+','.join(x for pair in entries for x in pair)+'};\n')

p=pnet/'cmake/Linux.cmake';s=p.read_text().replace('src/ports/linux/sampleapp_main.c','src/ports/linux/plab_main.c');p.write_text(s)
p=pnet/'CMakeLists.txt';p.write_text(p.read_text()+'\ntarget_include_directories(pn_dev PRIVATE ${PROFINET_SOURCE_DIR}/src/common ${PROFINET_SOURCE_DIR}/src/device)\n')
subprocess.run(['cmake','-S',str(pnet),'-B',str(build),'-DBUILD_TESTING=OFF','-DPNET_OPTION_SNMP=OFF','-DCMAKE_DISABLE_FIND_PACKAGE_Osal=TRUE','-DFETCHCONTENT_SOURCE_DIR_OSAL='+str(osal),'-DFETCHCONTENT_FULLY_DISCONNECTED=ON','-DCMAKE_BUILD_TYPE=Release'],check=True)
subprocess.run(['cmake','--build',str(build),'--parallel','2'],check=True)
