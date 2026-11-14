import { config } from './config.js';
import { checkAmazon, manualAuth } from './amazon-browser.js';
import { transition } from './state-machine.js';
import { sendNotification } from './gateway.js';
import { ensureAdbForward } from './adb-forward.js';
import fs from 'node:fs';
import path from 'node:path';
import { runPollingLoop, shouldAlertAfterAuthChecks } from '@jeremias/order-watch-core';

const alerts=new Set(['SHIPPED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED']);
const label={SHIPPED:'PEDIDO ENVIADO',OUT_FOR_DELIVERY:'SAIU PARA ENTREGA',DELIVERED:'PEDIDO ENTREGUE',CANCELLED:'PEDIDO CANCELADO'};
const icon={SHIPPED:'🎮',OUT_FOR_DELIVERY:'🚚',DELIVERED:'✅',CANCELLED:'⚠️'};
const statusLabel={UNKNOWN:'Desconhecido',ORDER_CONFIRMED:'Pedido feito',PREPARING:'Preparando',SHIPPED:'Enviado',OUT_FOR_DELIVERY:'Saiu para entrega',DELIVERED:'Entregue',CANCELLED:'Cancelado'};
const logPath=path.join(path.dirname(config.dbPath),'watcher.log');
const log=(event,fields={})=>{
  const line=JSON.stringify({at:new Date().toISOString(),event,...fields});
  console.log(line);
  try { fs.appendFileSync(logPath,`${line}\n`,{mode:0o600}); } catch {}
};
const AUTH_ALERT_THRESHOLD=2;
const FAILURE_ALERT_THRESHOLD=3;

function messageFor(state,at){
  const date=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(at));
  return `${icon[state]} GTA VI — ${label[state]}\nA Amazon atualizou o status da sua pré-venda.\n📦 Status: ${label[state].replace('PEDIDO ','').replace('SAIU PARA ENTREGA','Saiu para entrega').replace('ENVIADO','Enviado').replace('ENTREGUE','Entregue').replace('CANCELADO','Cancelado')}\n🛒 Loja: Amazon Brasil\n🕒 Detectado em: ${date}`;
}

function formatEstimate(value){
  return value.split('/').map(day=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'long',timeZone:'UTC'}).format(new Date(`${day}T00:00:00.000Z`))).join(' a ');
}

function deliveryDateMessage(previous,current,state){
  return `🎮 GTA VI — DATA DE ENTREGA ALTERADA\nPrevisão anterior: ${formatEstimate(previous)}\nNova previsão: ${formatEstimate(current)}\nStatus do pedido: ${statusLabel[state]||state}\n🛒 Loja: Amazon Brasil`;
}

function shipmentEventMessage(event,state){
  const location=event.location?`\n📍 Local: ${event.location}`:'';
  const when=`${event.dateText}${event.timeText?`, ${event.timeText}`:''}`;
  return `🎮 GTA VI — MOVIMENTAÇÃO NO ENVIO\n📦 ${event.message}${location}\n🕒 ${when}\nStatus do pedido: ${statusLabel[state]||state}\n🛒 Amazon Brasil`;
}

async function drainQueue(store,send=sendNotification){
  let sentCount=0;
  while(true){
    const item=store.pending(); if(!item)return sentCount?{kind:'CONFIRMED',sentCount}:{kind:'EMPTY'};
    store.mark(item.id,'sending');
    let sent;
    try { sent=await send(item.id,JSON.parse(item.payload)); }
    catch { store.mark(item.id,'uncertain'); return {kind:'UNCERTAIN'}; }
    if(sent.kind==='CONFIRMED'){store.mark(item.id,'confirmed',new Date().toISOString());sentCount++;continue;}
    if(sent.kind==='UNCERTAIN')store.mark(item.id,'uncertain');
    else store.mark(item.id,'pending');
    return sent;
  }
}

async function noteFailure(store,result,{send,logger,error}={}){
  const failures=(store.runtime().failures||0)+1;
  store.recordCheck({monitorState:'CHECK_FAILED',lastResult:result,failures});
  logger('check_failed',{result,error,failures});
  if(failures>=FAILURE_ALERT_THRESHOLD){
    const alertId=store.queueFailureAlert({message:`⚠️ GTA VI — MONITORAMENTO COM FALHAS\nA consulta do pedido falhou ${failures} vezes consecutivas. Último resultado: ${result}. O monitor continuará tentando a cada ${config.CHECK_INTERVAL_MINUTES} minutos.\n🛒 Amazon Brasil`});
    if(alertId)logger('monitor_failure_alert_queued',{notificationId:alertId,failures});
    const delivery=await drainQueue(store,send);
    if(delivery.kind!=='EMPTY')logger('monitor_failure_alert_delivery',{result:delivery.kind});
  }
  return {kind:'CHECK_FAILED',result,failures};
}

function noteRecovery(store,logger){
  const notificationId=store.clearFailureAlert({message:'✅ GTA VI — MONITORAMENTO RESTABELECIDO\nA consulta do pedido voltou a funcionar.\n🛒 Amazon Brasil'});
  if(notificationId)logger('monitor_recovery_queued',{notificationId});
}

async function noteAuthRequired(store,reason,send,logger){
  const consecutiveChecks=store.recordAuthCheck();
  store.recordCheck({monitorState:reason,attemptAt:new Date().toISOString(),lastResult:reason,paused:true,pauseReason:reason});
  logger('auth_required_check',{reason,consecutiveChecks,alertThreshold:AUTH_ALERT_THRESHOLD});
  if(!shouldAlertAfterAuthChecks(consecutiveChecks,AUTH_ALERT_THRESHOLD))return;
  const alertId=store.queueAuthAlert({message:`⚠️ GTA VI — AUTENTICAÇÃO AMAZON PENDENTE\nA janela Chromium foi aberta automaticamente, mas a Amazon ainda exige login ou verificação após ${consecutiveChecks} checagens consecutivas. Conclua na janela aberta para retomar o monitoramento.\n🛒 Amazon Brasil`});
  if(alertId)logger('monitor_auth_alert_queued',{reason,notificationId:alertId});
  const delivery=await drainQueue(store,send);
  if(delivery.kind!=='EMPTY')logger('monitor_auth_alert_delivery',{reason,result:delivery.kind});
}

export async function checkOnce(store,{source='amazon',check=checkAmazon,authenticate=manualAuth,forward=ensureAdbForward,send=sendNotification,logger=log}={}){
  const runtime=store.runtime();
  if(runtime.paused&&!['AUTH_REQUIRED','BLOCKED'].includes(runtime.pause_reason))return {kind:'PAUSED',reason:runtime.pause_reason};
  const attemptAt=new Date().toISOString();
  store.recordCheck({monitorState:'CHECKING',attemptAt,lastResult:'CHECKING'});
  try{
    const bridge=forward();
    if(bridge.kind==='UNAVAILABLE')logger('bridge_forward_unavailable');
    let result=await check(config);
    if(result.kind==='AUTH_REQUIRED'||result.kind==='BLOCKED'){
      const reason=result.kind;
      await noteAuthRequired(store,reason,send,logger);
      logger('visible_browser_opening',{reason});
      const session=await authenticate(config,{waitIndefinitely:true,authCheckIntervalMs:config.CHECK_INTERVAL_MINUTES*60_000,onAuthRequiredCheck:pageReason=>noteAuthRequired(store,pageReason,send,logger)});
      if(session.kind==='AUTHENTICATED'){
        store.clearAuthAlert();
        store.recordCheck({monitorState:'CHECKING',paused:false,pauseReason:null,lastResult:'AUTHENTICATED'});
        logger('visible_browser_session_restored');
        result=await check(config);
      }
    }
    if(result.kind==='AUTH_REQUIRED'||result.kind==='BLOCKED'){
      const reason=result.kind;
      store.recordCheck({monitorState:reason,lastResult:reason,paused:true,pauseReason:reason});
      logger('monitor_suspended',{reason});
      return {kind:reason};
    }
    if(result.kind!=='ORDER'||!result.recognized){
      return noteFailure(store,result.kind==='ORDER'?'UNKNOWN_STATUS':result.kind,{send,logger});
    }
    const previous=store.current()?.[0]||'UNKNOWN';
    let change;
    try { change=transition(previous,result.state); }
    catch(error) { return noteFailure(store,'STATE_CONFLICT',{send,logger,error:error.message}); }
    store.clearAuthAlert();
    const shipment=store.recordShipmentEvents(result.shipmentEvents||[],event=>({message:shipmentEventMessage(event,result.state)}));
    if(shipment.baseline)logger('shipment_tracking_baseline_saved',{events:shipment.added});
    else if(shipment.added)logger('shipment_events_detected',{count:shipment.added,notificationIds:shipment.notificationIds});
    if(result.deliveryEstimate){
      const estimate=store.recordDeliveryEstimate(result.deliveryEstimate,(previous,current)=>({message:deliveryDateMessage(previous,current,result.state)}));
      if(estimate.changed){
        logger(estimate.previous?'delivery_estimate_changed':'delivery_estimate_baseline_saved',{
          estimate:estimate.current,notificationId:estimate.notificationId??undefined,
        });
      }
    }
    if(previous==='UNKNOWN'){
      store.recordTransition(result.state,'baseline',null);
      store.recordCheck({monitorState:'READY',successAt:new Date().toISOString(),failures:0,paused:false,pauseReason:null,lastResult:result.state});
      noteRecovery(store,logger);
      await drainQueue(store,send);
      logger('baseline_saved',{state:result.state});
      return {kind:'BASELINE',state:result.state};
    }
    if(!change.changed){
      store.recordCheck({monitorState:'READY',successAt:new Date().toISOString(),failures:0,paused:false,pauseReason:null,lastResult:result.state});
      noteRecovery(store,logger);
      const delivery=await drainQueue(store,send);
      if(delivery.kind!=='EMPTY')logger('outbox_drain',{result:delivery.kind});
      logger('check_unchanged',{state:result.state});
      return {kind:'UNCHANGED',state:result.state};
    }
    const at=new Date().toISOString();
    const notification=alerts.has(result.state)?{payload:{message:messageFor(result.state,at)}}:null;
    store.recordTransition(result.state,source,notification);
    store.recordCheck({monitorState:'READY',successAt:at,failures:0,paused:false,pauseReason:null,lastResult:result.state});
    noteRecovery(store,logger);
    const delivery=await drainQueue(store,send);
    logger('status_changed',{from:previous,to:result.state,notification:notification?delivery.kind:'NOT_REQUIRED'});
    return {kind:'CHANGED',from:previous,to:result.state,delivery:notification?delivery.kind:'NOT_REQUIRED'};
  }catch(error){
    return noteFailure(store,error.name==='TimeoutError'?'TIMEOUT':'NETWORK_OR_BROWSER_ERROR',{send,logger,error:error.name||'Error'});
  }
}

export async function runScheduler(store,{check=checkAmazon,signal}={}){
  if(!config.orderId)throw Error('Configure AMAZON_ORDER_ID no arquivo .env');
  return runPollingLoop({
    check:()=>checkOnce(store,{check}),
    intervalMs:config.CHECK_INTERVAL_MINUTES*60_000,
    signal,
    stopWhen:result=>['AUTH_REQUIRED','BLOCKED','PAUSED'].includes(result.kind),
    onCycle:result=>{
      if(['AUTH_REQUIRED','BLOCKED','PAUSED'].includes(result.kind))return;
    const failures=store.runtime().failures||0;
      log('next_check_scheduled',{minutes:config.CHECK_INTERVAL_MINUTES,failures});
    },
  });
}

export { drainQueue };
