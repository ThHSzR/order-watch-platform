import test from 'node:test';
import assert from 'node:assert/strict';
import { runPollingLoop } from '@jeremias/order-watch-core';

const tenMinutes=10*60_000;

test('internet indisponível por 30 minutos: tenta a cada 10 e recupera',async()=>{
  let now=0;
  const checks=[];
  const result=await runPollingLoop({
    intervalMs:tenMinutes,
    wait:async ms=>{now+=ms;},
    check:async()=>{checks.push(now);return {kind:now<30*60_000?'OFFLINE':'ONLINE'};},
    stopWhen:value=>value.kind==='ONLINE',
  });
  assert.equal(result.kind,'ONLINE');
  assert.deepEqual(checks,[0,tenMinutes,2*tenMinutes,3*tenMinutes]);
});

test('internet disponível por 20 minutos, queda por 30 e retorno',async()=>{
  let now=0;
  const observations=[];
  await runPollingLoop({
    intervalMs:tenMinutes,
    wait:async ms=>{now+=ms;},
    check:async()=>{
      const kind=now<20*60_000||now>=50*60_000?'ONLINE':'OFFLINE';
      observations.push([now,kind]);
      return {kind};
    },
    stopWhen:()=>now>=50*60_000,
  });
  assert.deepEqual(observations,[
    [0,'ONLINE'],[tenMinutes,'ONLINE'],[2*tenMinutes,'OFFLINE'],
    [3*tenMinutes,'OFFLINE'],[4*tenMinutes,'OFFLINE'],[5*tenMinutes,'ONLINE'],
  ]);
});
