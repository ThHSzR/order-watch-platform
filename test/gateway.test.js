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
