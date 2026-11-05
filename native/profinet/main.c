/* SPDX-License-Identifier: GPL-3.0-only
 * Project thin application for the unchanged, fixed p-net 0.2.0 library.
 * Native protocol handlers remain upstream. No Python-built DCP responses.
 */
#define _GNU_SOURCE
#include "pf_includes.h"
#include "app_utils.h"
#include "plab_options.h"
#include <arpa/inet.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <signal.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
typedef struct { pnet_im_1_t im1; pnet_im_2_t im2; pnet_im_3_t im3; pnet_im_4_t im4; } plab_im_nvm_t;
extern int pf_cmina_nbr_of_active_ars(pnet_t *net);
#define ABI "pnet-v0.2.0-linux-x86_64-v1"
static volatile sig_atomic_t running=1;
static uint64_t tick_sequence=0,snapshot_sequence=0,signal_sequence=0;
static uint64_t ms(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return (uint64_t)t.tv_sec*1000+t.tv_nsec/1000000;}
static void stop(int sig){(void)sig;running=0;}
static void escaped(FILE*f,const char*s,size_t cap){fputc('"',f);for(size_t i=0;i<cap&&s[i];i++){unsigned char c=s[i];if(c=='"'||c=='\\')fprintf(f,"\\%c",c);else if(c<32||c>=127)fprintf(f,"\\u%04x",c);else fputc(c,f);}fputc('"',f);}
static void iptext(FILE*f,uint32_t i){fprintf(f,"\"%u.%u.%u.%u\"",i>>24,(i>>16)&255,(i>>8)&255,i&255);}
static void suite(FILE*f,pf_ip_suite_t*i){fprintf(f,"{\"ip\":");iptext(f,i->ip_addr);fprintf(f,",\"netmask\":");iptext(f,i->ip_mask);fprintf(f,",\"gateway\":");iptext(f,i->ip_gateway);fputc('}',f);}
static int led(pnet_t*n,void*arg,bool state){(void)n;(void)arg;printf("PLAB_NATIVE {\"kind\":\"signal_transition\",\"sequence\":%"PRIu64",\"monotonic_ms\":%"PRIu64",\"state\":%s}\n",++signal_sequence,ms(),state?"true":"false");return 0;}
static int native_size(const char*name){if(!strcmp(name,PF_FILENAME_IP))return sizeof(pf_cmina_dcp_ase_t);if(!strcmp(name,PF_FILENAME_IM))return sizeof(plab_im_nvm_t);if(!strcmp(name,PF_FILENAME_PDPORT_1))return sizeof(pf_pdport_t);return -1;}
static bool wrapper_name(const char*n){return !strcmp(n,".")||!strcmp(n,"..")||!strcmp(n,".plab-store.json")||!strcmp(n,".writer.lock")||!strcmp(n,".initialized.json");}
static int read_native(int dir,const char*name,void*dst,size_t n){int fd=openat(dir,name,O_RDONLY|O_NOFOLLOW|O_NONBLOCK);if(fd<0)return -1;struct stat st;unsigned char h[8];int ok=fstat(fd,&st)==0&&S_ISREG(st.st_mode)&&st.st_uid==0&&(st.st_mode&0777)==0600&&st.st_nlink==1&&st.st_size==(off_t)(n+8)&&read(fd,h,8)==8&&!memcmp(h,"PNET\0\0\0\1",8)&&read(fd,dst,n)==(ssize_t)n;close(fd);return ok?0:-1;}
static int validate_store(const char*path,bool output){int fd=open(path,O_DIRECTORY|O_NOFOLLOW|O_RDONLY);if(fd<0)return -1;DIR*d=fdopendir(dup(fd));if(!d){close(fd);return -1;}struct dirent*e;int count=0,result=0;while((e=readdir(d))){if(wrapper_name(e->d_name))continue;int sz=native_size(e->d_name);if(sz<0){result=-1;break;}void*buf=calloc(1,sz);if(!buf||read_native(fd,e->d_name,buf,sz)){free(buf);result=-1;break;}if(!strcmp(e->d_name,PF_FILENAME_IP)){pf_cmina_dcp_ase_t*a=buf;size_t len=strnlen(a->station_name,sizeof(a->station_name));if(len==sizeof(a->station_name)||!pf_cmina_is_stationname_valid(a->station_name,len)||!pf_cmina_is_ipsuite_valid(&a->full_ip_suite.ip_suite))result=-1;}if(!strcmp(e->d_name,PF_FILENAME_PDPORT_1)){pf_pdport_t*a=buf;if(*((unsigned char*)&a->check.active)>1||*((unsigned char*)&a->adjust.active)>1||*((unsigned char*)&a->lldp_peer_info_updated)>1)result=-1;}free(buf);count++;if(result)break;}closedir(d);struct stat st;bool initialized=fstatat(fd,".initialized.json",&st,AT_SYMLINK_NOFOLLOW)==0;if((count>0||initialized)&&count!=3)result=-1;close(fd);if(output)printf("{\"valid\":%s,\"native_files\":%d,\"abi\":\"%s\"}\n",result?"false":"true",count,ABI);return result;}
static void snapshot(pnet_t*n,const char*path){pf_cmina_dcp_ase_t c,nv,c2,nv2;bool stable=false;for(int i=0;i<3;i++){memcpy(&c,&n->cmina_current_dcp_ase,sizeof(c));memcpy(&nv,&n->cmina_nonvolatile_dcp_ase,sizeof(nv));__sync_synchronize();memcpy(&c2,&n->cmina_current_dcp_ase,sizeof(c2));memcpy(&nv2,&n->cmina_nonvolatile_dcp_ase,sizeof(nv2));if(!memcmp(&c,&c2,sizeof(c))&&!memcmp(&nv,&nv2,sizeof(nv))){stable=true;break;}}
 char tmp[256];snprintf(tmp,sizeof(tmp),"%s.tmp",path);FILE*f=fopen(tmp,"w");if(!f)exit(6);fprintf(f,"{\"ready\":true,\"pid\":%d,\"monotonic_ms\":%"PRIu64",\"tick_sequence\":%"PRIu64",\"snapshot_sequence\":%"PRIu64",\"snapshot_stable\":%s,\"active_ar\":%u,\"signal_active\":%s,\"current\":{\"station_name\":",getpid(),ms(),tick_sequence,++snapshot_sequence,stable?"true":"false",pf_cmina_nbr_of_active_ars(n),pf_scheduler_is_running(&n->dcp_led_timeout)?"true":"false");escaped(f,c.station_name,sizeof(c.station_name));fprintf(f,",\"ip_suite\":");suite(f,&c.full_ip_suite.ip_suite);fprintf(f,"},\"nonvolatile\":{\"station_name\":");escaped(f,nv.station_name,sizeof(nv.station_name));fprintf(f,",\"ip_suite\":");suite(f,&nv.full_ip_suite.ip_suite);fprintf(f,"},\"sam_mac\":");bool sam_nonzero=false;for(int i=0;i<6;i++)sam_nonzero|=n->dcp_sam.addr[i]!=0;if(sam_nonzero){fputc('"',f);for(int i=0;i<6;i++)fprintf(f,"%s%02x",i?":":"",n->dcp_sam.addr[i]);fputc('"',f);}else fprintf(f,"null");fprintf(f,",\"factory\":{\"vendor_id\":%u,\"device_id\":%u,\"device_role\":%u,\"device_options_hex\":\"",(c.device_id.vendor_id_hi<<8)|c.device_id.vendor_id_lo,(c.device_id.device_id_hi<<8)|c.device_id.device_id_lo,c.device_role);for(size_t i=0;i<sizeof(plab_options);i++)fprintf(f,"%02x",plab_options[i]);fprintf(f,"\",\"product_name\":");escaped(f,c.product_name,sizeof(c.product_name));fprintf(f,"}}\n");if(fclose(f)||rename(tmp,path))exit(6);}
static void copyip(pnet_cfg_ip_addr_t*o,const char*s){struct in_addr a;if(inet_pton(AF_INET,s,&a)!=1)exit(2);uint32_t v=ntohl(a.s_addr);o->a=v>>24;o->b=v>>16;o->c=v>>8;o->d=v;}
int main(int argc,char**argv){umask(077);setvbuf(stdout,NULL,_IOLBF,0);signal(SIGTERM,stop);signal(SIGINT,stop);
 if(argc==2&&!strcmp(argv[1],"--abi")){printf("{\"abi\":\"%s\",\"magic_hex\":\"504e4554\",\"file_version\":1,\"files\":{\"pnet_data_ip.bin\":%zu,\"pnet_data_im.bin\":%zu,\"pnet_data_pdport_1.bin\":%zu}}\n",ABI,sizeof(pf_cmina_dcp_ase_t)+8,sizeof(plab_im_nvm_t)+8,sizeof(pf_pdport_t)+8);return 0;}
 if(argc==3&&!strcmp(argv[1],"--validate-store"))return validate_store(argv[2],true)?3:0;
 if(argc==3&&!strcmp(argv[1],"--saved-view")){if(validate_store(argv[2],false))return 3;int dir=open(argv[2],O_DIRECTORY|O_NOFOLLOW|O_RDONLY);pf_cmina_dcp_ase_t a;if(dir<0||read_native(dir,PF_FILENAME_IP,&a,sizeof(a)))return 3;close(dir);printf("{\"station_name\":");escaped(stdout,a.station_name,sizeof(a.station_name));printf(",\"ip_suite\":");suite(stdout,&a.full_ip_suite.ip_suite);printf("}\n");return 0;}

 if(argc!=9){fprintf(stderr,"native requires interface station ip mask gateway store snapshot gate\n");return 2;}if(strlen(argv[1])>=16||strlen(argv[2])>=PNET_STATION_NAME_MAX_SIZE||strlen(argv[6])>=PNET_MAX_DIRECTORYPATH_SIZE)return 2;
 if(validate_store(argv[6],false)){fprintf(stderr,"existing native store failed ABI/semantic validation; preserved\n");return 3;}
 uint64_t gate_until=ms()+2000;bool gate_ready=false;while(running&&ms()<gate_until){int gate=open(argv[8],O_RDONLY|O_NOFOLLOW|O_NONBLOCK);if(gate>=0){struct stat st;gate_ready=fstat(gate,&st)==0&&S_ISREG(st.st_mode)&&st.st_uid==0&&(st.st_mode&0777)==0600;close(gate);break;}os_usleep(1000);}if(!gate_ready)return 7;
 pnet_cfg_t cfg={0};app_utils_pnet_cfg_init_default(&cfg);app_utils_netif_namelist_t list;uint16_t ports=1;pnet_if_cfg_t netif={0};if(app_utils_pnet_cfg_init_netifs(argv[1],&list,&ports,&netif))return 4;cfg.if_cfg=netif;cfg.num_physical_ports=ports;strcpy(cfg.station_name,argv[2]);strcpy(cfg.file_directory,argv[6]);copyip(&cfg.if_cfg.ip_cfg.ip_addr,argv[3]);copyip(&cfg.if_cfg.ip_cfg.ip_mask,argv[4]);copyip(&cfg.if_cfg.ip_cfg.ip_gateway,argv[5]);cfg.signal_led_cb=led;cfg.send_hello=false;cfg.pnal_cfg.eth_recv_thread.prio=0;cfg.pnal_cfg.bg_worker_thread.prio=0;
 pnet_t*n=pnet_init(&cfg);if(!n)return 5;uint64_t last=0;while(running){pnet_handle_periodic(n);tick_sequence++;uint64_t now=ms();if(now-last>=100){snapshot(n,argv[7]);last=now;}os_usleep(cfg.tick_us);}return 0;}
