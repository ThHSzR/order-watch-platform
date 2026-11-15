import test from 'node:test';
import assert from 'node:assert/strict';
import { sendNotification, validateBridgeUrl } from '../src/gateway.js';

const settings = { TAILSCALE_NOTIFY_URL:'http://100.64.0.1/send', TAILSCALE_NOTIFY_HOST:'100.64.0.1', TAILSCALE_TOKEN:'x'.repeat(32) };
test('adapta fila ao formato da ponte Baileys e usa idempotência', async () => {
  let request;
  const result = await sendNotification('42',{message:'🎮 GTA VI — Enviado'},async (url,options)=>{
    request={url,options}; return new Response(JSON.stringify({receiptId:'Baileys-ID'}),{status:200});
  },settings);
  assert.equal(result.kind,'CONFIRMED');
  assert.equal(request.url,settings.TAILSCALE_NOTIFY_URL);
  assert.equal(request.options.headers['idempotency-key'],'amazon-order-42');
  assert.equal(request.options.redirect,'error');
  assert.deepEqual(JSON.parse(request.options.body),{text:'🎮 GTA VI — Enviado'});
});
test('recusa destino não autorizado e URL com credenciais ou parâmetros',()=>{
  assert.throws(()=>validateBridgeUrl({...settings,TAILSCALE_NOTIFY_URL:'https://example.com/send'}));
  assert.throws(()=>validateBridgeUrl({...settings,TAILSCALE_NOTIFY_URL:'http://100.64.0.2/send'}));
  assert.throws(()=>validateBridgeUrl({...settings,TAILSCALE_NOTIFY_URL:'http://user@100.64.0.1/send'}));
  assert.throws(()=>validateBridgeUrl({...settings,TAILSCALE_NOTIFY_URL:'http://100.64.0.1/send?next=evil'}));
  assert.throws(()=>validateBridgeUrl({...settings,TAILSCALE_NOTIFY_URL:'http://example.com/send',TAILSCALE_NOTIFY_HOST:'example.com'}));
  assert.equal(validateBridgeUrl({...settings,TAILSCALE_NOTIFY_URL:'http://127.0.0.1/send'}),'http://127.0.0.1/send');
});
test('não repete automaticamente quando a resposta é incerta', async () => {
  const result=await sendNotification('7',{message:'🎮 GTA VI'},async()=>new Response('{}',{status:202}),settings);
  assert.equal(result.kind,'UNCERTAIN');
});
test('usa Tailnet após recusa de conexão ADB, com a mesma chave de idempotência', async () => {
  const routes=[];
  const dual={...settings,TAILSCALE_NOTIFY_URL:'http://127.0.0.1:18761/send',TAILSCALE_NOTIFY_FALLBACK_URL:settings.TAILSCALE_NOTIFY_URL};
  const result=await sendNotification('43',{message:'🎮 GTA VI — teste'},async(url,options)=>{
    routes.push({url,id:options.headers['idempotency-key']});
    if(routes.length===1)throw Object.assign(new Error('connect'),{cause:{code:'ECONNREFUSED'}});
    return new Response(JSON.stringify({receiptId:'Baileys-ID'}),{status:200});
  },dual);
  assert.equal(result.kind,'CONFIRMED');
  assert.deepEqual(routes.map(route=>route.url),[dual.TAILSCALE_NOTIFY_URL,dual.TAILSCALE_NOTIFY_FALLBACK_URL]);
  assert.deepEqual(routes.map(route=>route.id),['amazon-order-43','amazon-order-43']);
});
test('não troca de rota depois de resposta ambígua',async()=>{
  let attempts=0;
  const dual={...settings,TAILSCALE_NOTIFY_URL:'http://127.0.0.1:18761/send',TAILSCALE_NOTIFY_FALLBACK_URL:settings.TAILSCALE_NOTIFY_URL};
  const result=await sendNotification('44',{message:'🎮 GTA VI — teste'},async()=>{
    attempts++;
    throw new DOMException('timeout','TimeoutError');
  },dual);
  assert.equal(result.kind,'UNCERTAIN');
  assert.equal(attempts,1);
});
