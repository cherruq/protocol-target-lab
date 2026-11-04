/* SPDX-License-Identifier: GPL-3.0-or-later
 * Project wrapper; protocol decoding/framing/queues remain lib60870-C.
 */
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include "cs101_slave.h"
#include "hal_serial.h"
#include "hal_thread.h"
static volatile sig_atomic_t running = 1;
static int ca, oa, ioa;
static bool value;
static int gi_stage;
static int gi_oa;
static CS101_ASDU gi_asdu;
static void stop_handler(int s) { (void)s; running = 0; }
static void raw_handler(void* p, uint8_t* b, int n, bool sent) {
    (void)p;
    printf("{\"event\":\"native_frame\",\"direction\":\"%s\",\"length\":%d,\"preview_hex\":\"", sent ? "tx" : "rx", n);
    for (int i=0;i<n && i<128;i++) printf("%02x",b[i]);
    printf("\",\"truncated\":%s}\n",n>128?"true":"false");
}
static bool allowed_ca(void* p,int received) { (void)p; return received==ca; }
static CS101_ASDU point_asdu(CS101_AppLayerParameters app,int cot,int originator) {
    CS101_ASDU a=CS101_ASDU_create(app,false,cot,originator,ca,false,false);
    if (!a) exit(4);
    InformationObject i=(InformationObject)SinglePointInformation_create(NULL,ioa,value,IEC60870_QUALITY_GOOD);
    if (!i || !CS101_ASDU_addInformationObject(a,i)) exit(4);
    InformationObject_destroy(i);
    return a;
}
static bool interrogation(void* p,IMasterConnection con,CS101_ASDU asdu,uint8_t qoi) {
    (void)p;
    if(qoi!=20 || CS101_ASDU_getCOT(asdu)!=CS101_COT_ACTIVATION) {
        IMasterConnection_sendACT_CON(con,asdu,true); return true;
    }
    gi_stage=1;
    gi_oa=CS101_ASDU_getOA(asdu);
    if(gi_oa<0) gi_oa=0;
    IMasterConnection_sendACT_CON(con,asdu,false);
    printf("{\"event\":\"native_gi\",\"ca\":%d,\"oa\":%d,\"ioa\":0,\"qoi\":20}\n",ca,CS101_ASDU_getOA(asdu));
    return true;
}
static CS101_ASDU next_gi(void* p,IMasterConnection con) {
    CS101_Slave slave=(CS101_Slave)p;
    CS101_AppLayerParameters app=CS101_Slave_getAppLayerParameters(slave);
    if(gi_asdu) { CS101_ASDU_destroy(gi_asdu); gi_asdu=NULL; }
    if(gi_stage==1) {
        gi_stage=2;
        gi_asdu=point_asdu(app,CS101_COT_INTERROGATED_BY_STATION,gi_oa);
        return gi_asdu;
    }
    if(gi_stage==2) {
        CS101_ASDU a=CS101_ASDU_create(app,false,CS101_COT_ACTIVATION_TERMINATION,gi_oa,ca,false,false);
        InformationObject i=(InformationObject)InterrogationCommand_create(NULL,0,20);
        if(!a || !i || !CS101_ASDU_addInformationObject(a,i)) exit(4);
        InformationObject_destroy(i);
        IMasterConnection_sendASDU(con,a);
        CS101_ASDU_destroy(a);
        gi_stage=0;
    }
    return NULL;
}
int main(int argc,char** argv) {
    if(argc!=12) return 2;
    setvbuf(stdout,NULL,_IOLBF,0);
    signal(SIGTERM,stop_handler); signal(SIGINT,stop_handler);
    int width=atoi(argv[2]);
    if(width!=1 && width!=2) return 2;
    ca=atoi(argv[5]); oa=atoi(argv[4]); ioa=atoi(argv[6]); value=atoi(argv[7])!=0;
    SerialPort port=SerialPort_create(argv[1],atoi(argv[9]),atoi(argv[10]),argv[11][0],1);
    if(!port || !SerialPort_open(port)) return 3;
    CS101_Slave slave=CS101_Slave_create(port,NULL,NULL,IEC60870_LINK_LAYER_UNBALANCED);
    if(!slave) return 4;
    CS101_Slave_setLinkLayerAddress(slave,atoi(argv[3]));
    CS101_AppLayerParameters app=CS101_Slave_getAppLayerParameters(slave);
    app->sizeOfCOT=width; app->sizeOfCA=width; app->sizeOfIOA=width==1?1:3; app->originatorAddress=oa;
    LinkLayerParameters ll=CS101_Slave_getLinkLayerParameters(slave);
    ll->addressLength=width; ll->useSingleCharACK=atoi(argv[8])!=0;
    CS101_Slave_setRawMessageHandler(slave,raw_handler,NULL);
    CS101_Slave_setAllowedCAHandler(slave,allowed_ca,NULL);
    CS101_Slave_setInterrogationHandler(slave,interrogation,NULL);
    CS101_Slave_setGetNextInterrogationASDUHandler(slave,next_gi,slave);
    CS101_ASDU sample=point_asdu(app,CS101_COT_SPONTANEOUS,oa);
    CS101_Slave_enqueueUserDataClass2(slave,sample); CS101_ASDU_destroy(sample);
    puts("{\"event\":\"native_ready\"}");
    while(running) { CS101_Slave_run(slave); Thread_sleep(1); }
    CS101_Slave_destroy(slave);
    if(gi_asdu) CS101_ASDU_destroy(gi_asdu);
    SerialPort_close(port); SerialPort_destroy(port);
    puts("{\"event\":\"native_closed\"}");
    return 0;
}
