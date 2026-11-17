import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { parseOrder, classifyPage, parseStatus, parseShipmentEvents } from '../src/parser.js';
import { parseDeliveryEstimate } from '../src/delivery-date.js';

const fixture=fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'fixtures','tracking.html'),'utf8');
const delayedFixture=fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'fixtures','delayed.html'),'utf8');
const orderId='111-1111111-1111111';
const asin='B000000001';
const url=`https://www.amazon.com.br/progress-tracker/package?orderId=${orderId}`;

test('reconhece o status ativo do rastreador e confirma produto e pedido específicos',()=>{
  const result=parseOrder(fixture,{orderId,asin},url);
  assert.equal(result.kind,'ORDER');
  assert.equal(result.state,'ORDER_CONFIRMED');
  assert.equal(result.recognized,true);
  assert.equal(result.statusText,'Pedido feito');
  assert.deepEqual(result.shipmentEvents,[]);
});
test('mapeia estados Amazon conhecidos e não inventa estado desconhecido',()=>{
  for(const [label,state] of [['Enviado','SHIPPED'],['Saiu para entrega','OUT_FOR_DELIVERY'],['Entregue','DELIVERED'],['Pedido cancelado','CANCELLED']]) assert.equal(parseStatus(label).state,state);
  assert.equal(parseStatus('Sua encomenda está a caminho').state,'UNKNOWN');
});
test('não confunde entrega negada com pedido entregue',()=>{
  for (const label of ['Não entregue','Não foi entregue','Ainda não entregue','Not delivered'])
    assert.deepEqual(parseStatus(label),{state:'UNKNOWN',recognized:false});
  assert.equal(parseStatus('Entregue').state,'DELIVERED');
});
test('recusa URL de outro pedido, produto errado e status ausente',()=>{
  assert.equal(parseOrder(fixture,{orderId,asin},url.replace(orderId,'222-2222222-2222222')).kind,'ORDER_MISMATCH');
  assert.equal(parseOrder(fixture,{orderId,asin:'B000000002'},url).kind,'ITEM_MISMATCH');
  assert.equal(parseOrder(fixture.replaceAll('Pedido feito',''),{orderId,asin},url).kind,'INCOMPLETE');
});
test('detecta autenticação e CAPTCHA sem tentar contorná-los',()=>{
  assert.equal(classifyPage('<form id="ap_signin_form"><input type="password"></form>','https://www.amazon.com.br/ap/signin'),'AUTH_REQUIRED');
  assert.equal(classifyPage('<h1>Robot Check</h1><input name="captcha">'),'BLOCKED');
});
test('extrai horários distintos de movimentos iguais no mesmo local',()=>{
  const html='<div><span class="tracking-event-date">14 de novembro</span><div class="a-row a-spacing-large"><span class="tracking-event-time">10:00</span><span class="tracking-event-message">Chegou à instalação</span><span class="tracking-event-location">São Paulo</span></div><div class="a-row a-spacing-large"><span class="tracking-event-time">11:00</span><span class="tracking-event-message">Chegou à instalação</span><span class="tracking-event-location">São Paulo</span></div></div>';
  const events=parseShipmentEvents(parseHTML(html).document);
  assert.deepEqual(events.map(event=>event.timeText),['10:00','11:00']);
  assert.notEqual(events[0].eventKey,events[1].eventKey);
});
test('reconhece atraso no layout de exceção e nova data sem confundir previsão com entrega',()=>{
  const result=parseOrder(delayedFixture,{orderId,asin},url);
  assert.equal(result.kind,'ORDER');
  assert.equal(result.state,'DELIVERY_DELAYED');
  assert.equal(result.deliveryEstimate,'2026-11-20');
  assert.equal(parseOrder(delayedFixture,{orderId,asin:'B000000002'},url).kind,'ITEM_MISMATCH');
  assert.equal(parseOrder(delayedFixture,{orderId,asin},url.replace(orderId,'222-2222222-2222222')).kind,'ORDER_MISMATCH');
  assert.equal(parseDeliveryEstimate('Chega até 20 novembro',new Date('2026-11-17T12:00:00Z')),'2026-11-20');
  assert.equal(parseStatus('Será entregue até 20 novembro').state,'UNKNOWN');
});
test('mantém o status clássico quando a página também contém carrossel de itens',()=>{
  const mixed=fixture.replace('</body>','<div id="itemImagesCarousel-container"><a href="https://www.amazon.com.br/gp/product/B000000001"><img alt="Grand Theft Auto VI - PlayStation 5"></a></div></body>');
  assert.equal(parseOrder(mixed,{orderId,asin},url).state,'ORDER_CONFIRMED');
});
test('distingue exceções de entrega e conserva texto novo como desconhecido',()=>{
  for(const [label,state] of [
    ['Entrega atrasada','DELIVERY_DELAYED'],['Tentativa de entrega','DELIVERY_ATTEMPTED'],
    ['Não conseguimos entregar','DELIVERY_ATTEMPTED'],['Problema com a entrega','DELIVERY_PROBLEM'],
  ])assert.equal(parseStatus(label).state,state);
  const changed=delayedFixture.replace('Lamentamos o atraso. Seu pacote ainda está a caminho e estimamos que será entregue até 20 novembro.','A transportadora informou um novo incidente.');
  const parsed=parseOrder(changed,{orderId,asin},url);
  assert.deepEqual({state:parsed.state,recognized:parsed.recognized,statusText:parsed.statusText},{state:'UNKNOWN',recognized:false,statusText:'A transportadora informou um novo incidente.'});
});
