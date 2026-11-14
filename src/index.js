import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { openStore } from './store.js';
import { transition } from './state-machine.js';
import { parseStatus } from './parser.js';
import { manualAuth } from './amazon-browser.js';
import { checkOnce, runScheduler, drainQueue } from './watcher.js';
import { acquireLock } from './lock.js';

const [cmd='status',arg] = process.argv.slice(2);
const lockPath=path.join(path.dirname(config.dbPath),'watcher.lock');
const readOnly=new Set(['status','history','outbox']).has(cmd)&&fs.existsSync(config.dbPath);
let release;
let store;
try{
  if(['run','check','auth','set-status','flush','retry-notification','pause','resume'].includes(cmd))release=acquireLock(lockPath);
  store=await openStore(config.dbPath,{readonly:readOnly});
  if(cmd==='status'){
    console.log(JSON.stringify({orderState:store.current()?.[0]??'UNKNOWN',deliveryEstimate:store.deliveryEstimate(),updatedAt:store.current()?.[1]??null,monitor:store.runtime(),history:store.history(),outbox:store.notifications()},null,2));
  }else if(cmd==='history')console.log(JSON.stringify(store.history(),null,2));
  else if(cmd==='outbox')console.log(JSON.stringify(store.notifications(),null,2));
  else if(cmd==='set-status'){
    const parsed=parseStatus(arg);const next=parsed.recognized?parsed.state:arg;
    const previous=store.current()?.[0]??'UNKNOWN';const change=transition(previous,next);
    if(!change.changed)console.log(`Sem alteração (${previous})`);
    else{const notification=['SHIPPED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'].includes(next)?{payload:{message:`🎮 GTA VI — ${next}`}}:null;const record=store.recordTransition(next,'manual',notification);if(record.notificationId)await drainQueue(store);console.log(JSON.stringify({previous:record.previous,next,notificationId:record.notificationId}));}
  }else if(cmd==='auth'){
    const result=await manualAuth();
    if(result.kind==='AUTHENTICATED'){
      store.recordCheck({monitorState:'READY',successAt:new Date().toISOString(),failures:0,paused:false,pauseReason:null,lastResult:'AUTHENTICATED'});
      console.log('Sessão validada no perfil exclusivo do watcher.');
    }else{
      const paused=['BLOCKED','AUTH_REQUIRED'].includes(result.kind);
      store.recordCheck({monitorState:result.kind,lastResult:result.kind,paused,pauseReason:paused?result.kind:null});
      console.log(`Autenticação não concluída: ${result.kind}`);
      process.exitCode=2;
    }
  }else if(cmd==='check'){
    const result=await checkOnce(store);console.log(JSON.stringify(result));
    if(result.kind==='AUTH_REQUIRED'||result.kind==='BLOCKED')process.exitCode=2;
  }else if(cmd==='run'){
    const controller=new AbortController();
    process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
    console.log(JSON.stringify({at:new Date().toISOString(),event:'watcher_started',intervalMinutes:config.CHECK_INTERVAL_MINUTES}));
    const result=await runScheduler(store,{signal:controller.signal});
    if(result.kind==='AUTH_REQUIRED'||result.kind==='BLOCKED')process.exitCode=2;
  }else if(cmd==='flush')console.log(JSON.stringify(await drainQueue(store)));
  else if(cmd==='retry-notification'){
    const row=store.notifications().find(item=>item.id===String(arg));
    if(!row||row.status!=='uncertain')throw Error('Notificação não está incerta ou ID não existe');
    store.mark(row.id,'pending');console.log('Notificação reencaminhada para a fila; confirme primeiro se a mensagem anterior chegou.');
  }else if(cmd==='pause'){store.setPaused(true,arg||'MANUAL');console.log('Watcher pausado.');}
  else if(cmd==='resume'){store.setPaused(false);store.recordCheck({monitorState:'READY',failures:0,lastResult:'RESUMED'});console.log('Watcher retomado.');}
  else{console.error('Uso: npm start -- [status|history|outbox|auth|check|run|set-status ESTADO|flush|retry-notification ID|pause|resume]');process.exitCode=2;}
}catch(error){console.error(JSON.stringify({event:'fatal',error:error.message}));process.exitCode=1;}
finally{release?.();store?.close();}
