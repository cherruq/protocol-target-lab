#!/usr/bin/env python3
"""MIT: bounded dual PTY/TCP supervisor; lib60870 owns all FT1.2 behavior."""
import argparse
import hashlib
import json
import os
import pty
import queue
import selectors
import signal
import socket
import subprocess
import sys
import threading
import time
import tty
from common import load_config

NATIVE='/opt/protocol-target-lab/native_slave'
PENDING=65536

class Supervisor:
    def __init__(self, config, native=NATIVE):
        self.config=config; self.native=native; self.stopping=False; self.error=None
        self.selector=selectors.DefaultSelector(); self.listeners={}; self.sessions={}
        self.logs=queue.Queue(256); self.log_error=None
        self.logger=threading.Thread(target=self.output, name='bounded-stdout',daemon=True)
        self.logger.start()
    def output(self):
        try:
            while True:
                item=self.logs.get()
                if item is None: return
                print(json.dumps(item,separators=(',',':')),flush=True)
        except Exception as error: self.log_error=type(error).__name__
    def log(self,event,**values):
        item={'event':event,'time_ns':time.time_ns(),**values}
        try: self.logs.put_nowait(item)
        except queue.Full: raise RuntimeError('bounded log queue overflow')
    def register(self, file, events, data):
        try: self.selector.get_key(file)
        except KeyError:
            if events: self.selector.register(file,events,data)
        else:
            if events: self.selector.modify(file,events,data)
            else: self.selector.unregister(file)
    def unregister(self,file):
        try: self.selector.unregister(file)
        except (KeyError,ValueError): pass
    def refresh(self,s):
        live=not s['closing']
        self.register(s['sock'],(selectors.EVENT_READ if live and not s['input_eof'] else 0) | (selectors.EVENT_WRITE if live and s['tcp_out'] else 0),(s,'tcp'))
        self.register(s['master'],(selectors.EVENT_READ if live and s['ready'] else 0) | (selectors.EVENT_WRITE if live and s['ready'] and s['pty_out'] else 0),(s,'pty'))
    def accept(self,listener,name):
        for _ in range(32):
            try: conn,peer=listener.accept()
            except BlockingIOError: return
            conn.setblocking(False)
            if name in self.sessions or self.stopping:
                conn.close(); self.log('connection_rejected',channel=name,reason='one active session per channel'); continue
            master=slave=None; child=None
            try:
                master,slave=pty.openpty(); tty.setraw(slave); os.set_blocking(master,False)
                p=self.config[name]; width=1 if name=='single' else 2
                args=[self.native,os.ttyname(slave),str(width),str(p['link_address']),str(p['originator_address']),str(p['common_address']),str(p['point']['ioa']),str(int(p['point']['value'])),str(int(p['single_char_ack'])),'9600','8','N']
                child=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,bufsize=0,close_fds=True)
                os.set_blocking(child.stdout.fileno(),False)
                s={'name':name,'sock':conn,'master':master,'slave':slave,'child':child,'pipe':child.stdout,'line':bytearray(),'tcp_out':bytearray(),'pty_out':bytearray(),'tcp_since':None,'pty_since':None,'ready':False,'started':time.monotonic(),'closing':False,'close_since':None,'killed':False,'input_eof':False,'drain_started':None,'last_io':time.monotonic()}
                self.sessions[name]=s
                self.register(child.stdout,selectors.EVENT_READ,(s,'log')); self.refresh(s)
                self.log('session_started',channel=name,child_pid=child.pid,peer_ip=peer[0],peer_port=peer[1])
            except BaseException:
                conn.close()
                for fd in (master,slave):
                    if fd is not None: os.close(fd)
                if child is not None:
                    child.kill(); child.wait(timeout=3); child.stdout.close()
                raise
    def close_session(self,s,reason):
        if s['closing']: return
        s['closing']=True; s['close_since']=time.monotonic()
        self.refresh(s)
        self.log('session_closing',channel=s['name'],reason=reason)
        if s['child'].poll() is None: s['child'].terminate()
    def reap(self,s):
        child=s['child']; child.wait(timeout=0)
        for obj in (s['sock'],s['master'],s['pipe']): self.unregister(obj)
        # Release private native/PTY resources and slot before sending final TCP EOF.
        os.close(s['master']); os.close(s['slave']); s['pipe'].close()
        del self.sessions[s['name']]
        s['sock'].close()
        self.log('session_closed',channel=s['name'],child_pid=child.pid,child_exit=child.returncode)
    def append(self,s,key,data):
        if len(s[key])+len(data)>PENDING:
            self.close_session(s,'pending byte limit'); return
        if not s[key]: s['tcp_since' if key=='tcp_out' else 'pty_since']=time.monotonic()
        s[key].extend(data)
    def pump(self,s,kind,mask):
        if kind=='log':
            try: data=os.read(s['pipe'].fileno(),8192)
            except BlockingIOError: return
            if not data:
                self.unregister(s['pipe'])
                if not s['closing']: raise RuntimeError('native stdout closed unexpectedly: '+s['name'])
                return
            s['line'].extend(data)
            while b'\n' in s['line']:
                line,_,tail=s['line'].partition(b'\n'); s['line']=bytearray(tail)
                if len(line)>4096: raise RuntimeError('native line exceeds 4096 bytes')
                try: record=json.loads(line)
                except (ValueError,UnicodeError): record={'event':'native_diagnostic','length':len(line),'preview':line[:128].decode('utf8','replace')}
                if not isinstance(record,dict): raise RuntimeError('invalid native log shape')
                if record.get('event')=='native_ready': s['ready']=True
                self.log('native',channel=s['name'],child_pid=s['child'].pid,record=record)
            if len(s['line'])>4096: raise RuntimeError('unterminated native line exceeds 4096 bytes')
            self.refresh(s); return
        if s['closing']: return
        source=s['sock'] if kind=='tcp' else s['master']
        try:
            if mask&selectors.EVENT_READ:
                data=source.recv(8192) if kind=='tcp' else os.read(source,8192)
                if not data:
                    if kind=='tcp':
                        s['input_eof']=True; s['drain_started']=time.monotonic(); self.refresh(s); return
                    raise RuntimeError('unexpected PTY EOF')
                s['last_io']=time.monotonic()
                self.log('bridge_bytes',channel=s['name'],direction='tcp_to_pty' if kind=='tcp' else 'pty_to_tcp',length=len(data),sha256=hashlib.sha256(data).hexdigest(),preview_hex=data[:128].hex(),truncated=len(data)>128)
                self.append(s,'pty_out' if kind=='tcp' else 'tcp_out',data)
            if mask&selectors.EVENT_WRITE and not s['closing']:
                pending=s['tcp_out' if kind=='tcp' else 'pty_out']
                if pending:
                    n=source.send(pending) if kind=='tcp' else os.write(source,pending)
                    if n<=0: raise RuntimeError('zero write')
                    del pending[:n]
                    s['last_io']=time.monotonic()
                    if not pending: s['tcp_since' if kind=='tcp' else 'pty_since']=None
        except BlockingIOError: pass
        except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError):
            self.close_session(s,'peer connection error')
        self.refresh(s)
    def run(self):
        try:
            for name,port in (('single',24741),('double',24742)):
                sock=socket.socket(); sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
                try: sock.bind(('0.0.0.0',port)); sock.listen(16); sock.setblocking(False)
                except BaseException: sock.close(); raise
                self.listeners[name]=sock; self.selector.register(sock,selectors.EVENT_READ,(name,'listen'))
            self.log('ready',channels=['single','double'],internal_ports=[24741,24742],serial=self.config['serial'])
            while not self.stopping or self.sessions:
                if self.log_error: raise RuntimeError('stdout logger failed: '+self.log_error)
                if self.stopping:
                    for sock in self.listeners.values(): self.unregister(sock); sock.close()
                    self.listeners.clear()
                    for s in list(self.sessions.values()): self.close_session(s,'service stop')
                for key,mask in self.selector.select(.02):
                    item,kind=key.data
                    if kind=='listen': self.accept(key.fileobj,item)
                    elif item['name'] in self.sessions: self.pump(item,kind,mask)
                now=time.monotonic()
                for s in list(self.sessions.values()):
                    if s['child'].poll() is not None:
                        if not s['closing']: raise RuntimeError('native child died unexpectedly: '+s['name'])
                        self.reap(s); continue
                    if s['closing']:
                        if now-s['close_since']>2 and not s['killed']: s['child'].kill(); s['killed']=True
                        if now-s['close_since']>3: raise RuntimeError('native child did not reap')
                    elif s['input_eof'] and ((s['ready'] and not s['tcp_out'] and not s['pty_out'] and now-max(s['last_io'],s['drain_started'])>.35) or now-s['drain_started']>3):
                        self.close_session(s,'peer EOF drained')
                    elif not s['ready'] and now-s['started']>3: raise RuntimeError('native ready deadline exceeded')
                    elif any(s[k] is not None and now-s[k]>3 for k in ('tcp_since','pty_since')):
                        self.close_session(s,'absolute drain deadline')
            return 0
        except BaseException as error:
            self.error=type(error).__name__+': '+str(error)[:256]
            try: self.log('fatal',error=self.error)
            except RuntimeError: pass
            return 1
        finally:
            for sock in self.listeners.values(): self.unregister(sock); sock.close()
            for s in list(self.sessions.values()):
                try:
                    if s['child'].poll() is None: s['child'].terminate()
                    try: s['child'].wait(timeout=1)
                    except subprocess.TimeoutExpired: s['child'].kill(); s['child'].wait(timeout=2)
                finally:
                    for obj in (s['sock'],s['pipe']):
                        try: obj.close()
                        except OSError: pass
                    for fd in (s['master'],s['slave']):
                        try: os.close(fd)
                        except OSError: pass
            self.selector.close()
            try: self.logs.put(None,timeout=.2)
            except queue.Full: pass
            self.logger.join(timeout=1)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config-json',required=True)
    args=parser.parse_args()
    try: cfg=load_config(args.config_json)
    except (ValueError,TypeError) as e:
        print(json.dumps({'event':'config_error','error':str(e)[:256]}),flush=True); return 2
    s=Supervisor(cfg)
    def stop(_signum,_frame): s.stopping=True
    signal.signal(signal.SIGTERM,stop); signal.signal(signal.SIGINT,stop)
    return s.run()
if __name__=='__main__': sys.exit(main())
