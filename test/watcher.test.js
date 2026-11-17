import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../src/store.js';
import { checkOnce } from '../src/watcher.js';
import { authPageResolution } from '../src/amazon-browser.js';

const isolated={forward:()=>({kind:'SKIPPED'}),send:async()=>({kind:'SKIPPED'}),logger:()=>{}};

async function withStore(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'amazon-watcher-'));
  const store=await openStore(path.join(dir,'state.sqlite'));
  try{return await fn(store);}finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
}
test('primeira leitura salva a linha de base sem alerta',()=>withStore(async store=>{
  const result=await checkOnce(store,{...isolated,check:async()=>({kind:'ORDER',state:'ORDER_CONFIRMED',recognized:true})});
  assert.equal(result.kind,'BASELINE');
  assert.equal(store.current()[0],'ORDER_CONFIRMED');
  assert.equal(store.notifications().length,0);
}));
test('mudança para enviado cria uma única notificação persistente',()=>withStore(async store=>{
  store.recordTransition('ORDER_CONFIRMED','baseline',null);
  const result=await checkOnce(store,{...isolated,check:async()=>({kind:'ORDER',state:'SHIPPED',recognized:true})});
  assert.equal(result.kind,'CHANGED');
  assert.equal(store.current()[0],'SHIPPED');
  assert.equal(store.notifications().length,1);
  assert.equal(store.notifications()[0].status,'pending');
}));
test('status desconhecido e autenticação expirada preservam último status conhecido',()=>withStore(async store=>{
  store.recordTransition('ORDER_CONFIRMED','baseline',null);
  const unknown=await checkOnce(store,{...isolated,check:async()=>({kind:'ORDER',state:'UNKNOWN',recognized:false})});
  assert.equal(unknown.kind,'CHECK_FAILED');
  assert.equal(store.current()[0],'ORDER_CONFIRMED');
  const auth=await checkOnce(store,{...isolated,check:async()=>({kind:'AUTH_REQUIRED'}),authenticate:async()=>({kind:'AUTH_REQUIRED'})});
  assert.equal(auth.kind,'AUTH_REQUIRED');
  assert.equal(store.current()[0],'ORDER_CONFIRMED');
  assert.equal(store.runtime().paused,1);
}));
test('avisa apenas após três checagens seguidas de autenticação',()=>withStore(async store=>{
  const seen=[];
  const auth=await checkOnce(store,{
    ...isolated,
    send:async(id,payload)=>{seen.push({id,payload});return {kind:'CONFIRMED'};},
    check:async()=>({kind:'AUTH_REQUIRED'}),
    authenticate:async(_cfg,{onAuthRequiredCheck})=>{
      assert.equal(store.notifications().length,0);
      await onAuthRequiredCheck('AUTH_REQUIRED');
      assert.equal(store.notifications().length,0);
      await onAuthRequiredCheck('AUTH_REQUIRED');
      return {kind:'AUTH_REQUIRED'};
    },
  });
  assert.equal(auth.kind,'AUTH_REQUIRED');
  assert.equal(seen.length,1);
  assert.equal(store.notifications()[0].status,'confirmed');
  assert.equal(store.current()[0],'UNKNOWN');
}));
test('queda de internet preserva estado e a checagem seguinte recupera',()=>withStore(async store=>{
  store.recordTransition('SHIPPED','baseline',null);
  const offline=await checkOnce(store,{...isolated,check:async()=>{throw new Error('offline');}});
  assert.equal(offline.kind,'CHECK_FAILED');
  assert.equal(store.current()[0],'SHIPPED');
  assert.equal(store.runtime().failures,1);
  const recovered=await checkOnce(store,{...isolated,check:async()=>({kind:'ORDER',state:'SHIPPED',recognized:true})});
  assert.equal(recovered.kind,'UNCHANGED');
  assert.equal(store.runtime().failures,0);
}));
test('regressão de estado não grava movimentos nem previsão antes de leitura válida',()=>withStore(async store=>{
  store.recordTransition('SHIPPED','baseline',null);
  store.recordDeliveryEstimate('2026-11-16');
  store.recordShipmentEvents([]);
  const event={eventKey:'movement-1',dateText:'14 de novembro',timeText:'12:00',message:'Chegou à instalação',location:'São Paulo'};
  const send=async()=>({kind:'CONFIRMED'});
  const conflicting=await checkOnce(store,{...isolated,send,check:async()=>({kind:'ORDER',state:'PREPARING',recognized:true,deliveryEstimate:'2026-11-17',shipmentEvents:[event]})});
  assert.equal(conflicting.result,'STATE_CONFLICT');
  assert.equal(store.deliveryEstimate(),'2026-11-16');
  assert.equal(store.notifications().length,0);
  const valid=await checkOnce(store,{...isolated,send,check:async()=>({kind:'ORDER',state:'SHIPPED',recognized:true,deliveryEstimate:'2026-11-17',shipmentEvents:[event]})});
  assert.equal(valid.kind,'UNCHANGED');
  assert.equal(store.deliveryEstimate(),'2026-11-17');
  assert.deepEqual(store.notifications().map(item=>item.state).sort(),['DELIVERY_DATE_CHANGED','SHIPMENT_EVENT']);
}));
test('avisa uma vez após três falhas e confirma recuperação',()=>withStore(async store=>{
  const sent=[];
  const send=async(_id,payload)=>{sent.push(payload.message);return {kind:'CONFIRMED'};};
  for(let i=1;i<=4;i++){
    const result=await checkOnce(store,{...isolated,send,check:async()=>{throw new Error('offline');}});
    assert.equal(result.failures,i);
  }
  assert.equal(sent.length,1);
  assert.match(sent[0],/MONITORAMENTO COM FALHAS/);
  const recovered=await checkOnce(store,{...isolated,send,check:async()=>({kind:'ORDER',state:'ORDER_CONFIRMED',recognized:true})});
  assert.equal(recovered.kind,'BASELINE');
  assert.equal(sent.length,2);
  assert.match(sent[1],/MONITORAMENTO RESTABELECIDO/);
  assert.equal(store.runtime().failures,0);
}));
test('relata a recuperação mesmo quando a ponte esteve indisponível durante a falha',()=>withStore(async store=>{
  let bridgeReady=false;
  const sent=[];
  const send=async(_id,payload)=>{
    if(!bridgeReady)return {kind:'SKIPPED',reason:'bridge_unreachable'};
    sent.push(payload.message);
    return {kind:'CONFIRMED'};
  };
  for(let i=0;i<3;i++)await checkOnce(store,{...isolated,send,check:async()=>{throw new Error('offline');}});
  assert.equal(store.notifications()[0].status,'pending');
  bridgeReady=true;
  await checkOnce(store,{...isolated,send,check:async()=>({kind:'ORDER',state:'ORDER_CONFIRMED',recognized:true})});
  assert.equal(sent.length,1);
  assert.match(sent[0],/MONITORAMENTO RESTABELECIDO/);
  assert.equal(store.notifications().find(item=>item.state==='MONITOR_CHECK_FAILED').status,'cancelled');
}));
test('atraso altera estado e previsão uma vez, com dois alertas confirmados',()=>withStore(async store=>{
  store.recordTransition('OUT_FOR_DELIVERY','baseline',null);
  store.recordDeliveryEstimate('2026-11-16');
  const sent=[];
  const options={...isolated,send:async(_id,payload)=>{sent.push(payload.message);return {kind:'CONFIRMED'};},check:async()=>({kind:'ORDER',state:'DELIVERY_DELAYED',recognized:true,deliveryEstimate:'2026-11-20',shipmentEvents:[]})};
  assert.equal((await checkOnce(store,options)).kind,'CHANGED');
  assert.equal(store.current()[0],'DELIVERY_DELAYED');
  assert.equal(store.deliveryEstimate(),'2026-11-20');
  assert.deepEqual(store.notifications().map(item=>item.state).sort(),['DELIVERY_DATE_CHANGED','DELIVERY_DELAYED']);
  assert.equal(sent.length,2);
  assert.equal((await checkOnce(store,options)).kind,'UNCHANGED');
  assert.equal(sent.length,2);
}));
test('texto novo da Amazon gera alerta deduplicado e não paralisa consulta',()=>withStore(async store=>{
  store.recordTransition('OUT_FOR_DELIVERY','baseline',null);
  store.recordDeliveryEstimate('2026-11-16');
  const sent=[];
  let statusText='A transportadora informou um novo incidente.';
  const options={...isolated,send:async(_id,payload)=>{sent.push(payload.message);return {kind:'CONFIRMED'};},check:async()=>({kind:'ORDER',state:'UNKNOWN',recognized:false,statusText,deliveryEstimate:'2026-11-20',shipmentEvents:[]})};
  assert.equal((await checkOnce(store,options)).kind,'UNKNOWN_STATUS');
  assert.equal((await checkOnce(store,options)).kind,'UNKNOWN_STATUS');
  assert.equal(sent.length,2);
  assert.equal(store.deliveryEstimate(),'2026-11-20');
  assert.equal(store.current()[0],'OUT_FOR_DELIVERY');
  statusText='A transportadora alterou novamente o rastreio.';
  await checkOnce(store,options);
  assert.equal(sent.length,3);
  assert.equal(store.runtime().paused,0);
}));
test('página autenticada não reconhecida volta ao agendamento sem pausa',()=>withStore(async store=>{
  assert.deepEqual(authPageResolution({kind:'ORDER',state:'UNKNOWN',recognized:false},0),{kind:'AUTHENTICATED',state:'UNKNOWN',recognized:false});
  assert.equal(authPageResolution({kind:'ITEM_MISMATCH'},9_000),null);
  assert.deepEqual(authPageResolution({kind:'ITEM_MISMATCH'},10_000),{kind:'PAGE_UNRECOGNIZED',result:'ITEM_MISMATCH'});
  const result=await checkOnce(store,{...isolated,check:async()=>({kind:'AUTH_REQUIRED'}),authenticate:async()=>({kind:'PAGE_UNRECOGNIZED',result:'ITEM_MISMATCH'})});
  assert.equal(result.kind,'CHECK_FAILED');
  assert.equal(store.runtime().paused,0);
  assert.equal(store.runtime().last_result,'ITEM_MISMATCH');
}));
