import test from 'node:test';
import assert from 'node:assert/strict';
import { sendNotification } from '../src/gateway.js';

const settings = { TAILSCALE_NOTIFY_URL:'https://a30.example/send', TAILSCALE_TOKEN:'x'.repeat(32) };
test('adapta fila ao formato da ponte Baileys e usa idempotência', async () => {
  let request;
  const result = await sendNotification('42',{message:'🎮 GTA VI — Enviado'},async (url,options)=>{
    request={url,options}; return new Response(JSON.stringify({receiptId:'Baileys-ID'}),{status:200});
  },settings);
  assert.equal(result.kind,'CONFIRMED');
  assert.equal(request.url,settings.TAILSCALE_NOTIFY_URL);
  assert.equal(request.options.headers['idempotency-key'],'amazon-order-42');
  assert.deepEqual(JSON.parse(request.options.body),{text:'🎮 GTA VI — Enviado'});
});
test('não repete automaticamente quando a resposta é incerta', async () => {
  const result=await sendNotification('7',{message:'🎮 GTA VI'},async()=>new Response('{}',{status:202}),settings);
  assert.equal(result.kind,'UNCERTAIN');
});
