import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../src/store.js';
import { checkOnce } from '../src/watcher.js';

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
