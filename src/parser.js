import { parseHTML } from 'linkedom';
import { stableEventKey } from '@jeremias/order-watch-core';
import { parseDeliveryEstimate } from './delivery-date.js';

export const STATES = ['UNKNOWN','ORDER_CONFIRMED','PREPARING','SHIPPED','OUT_FOR_DELIVERY','DELIVERY_DELAYED','DELIVERY_ATTEMPTED','DELIVERY_PROBLEM','DELIVERED','CANCELLED','AUTH_REQUIRED','CHECK_FAILED'];
const statusRules = [
  ['CANCELLED', /\b(cancelad[oa]|cancelled|pedido cancelado)\b/i],
  ['DELIVERY_ATTEMPTED', /\b(tentativa de entrega|tentamos entregar|n[aã]o conseguimos entregar|delivery attempted|attempted delivery)\b/i],
  ['DELIVERY_DELAYED', /\b(lamentamos o atraso|entrega atrasad[ao]|pacote atrasad[ao]|running late|delivery delayed)\b/i],
  ['DELIVERY_PROBLEM', /\b(problema com (?:a )?entrega|n[aã]o (?:pode|p[oô]de) ser entregue|pacote extraviado|undeliverable|delivery problem)\b/i],
  ['DELIVERED', /^(?:(?:seu\s+)?(?:pedido|pacote)\s+)?(?:foi\s+)?entregue\b|^delivered\b|\bentrega conclu[ií]da\b/i],
  ['OUT_FOR_DELIVERY', /\b(saiu para entrega|em rota de entrega|out for delivery)\b/i],
  ['SHIPPED', /\b(enviado|despachado|shipped)\b/i],
  ['PREPARING', /\b(preparando|prepara[cç][aã]o|processando|not yet shipped|preparing to ship)\b/i],
  ['ORDER_CONFIRMED', /\b(pedido feito|pedido confirmado|compra confirmada|pedido realizado|order placed)\b/i],
];
const text = node => node?.textContent?.replace(/\s+/g,' ').trim() || '';
const isGta = value => /grand theft auto\s*(vi|6)|\bgta\s*(vi|6)\b/i.test(value);

export function parseShipmentEvents(root) {
  return [...(root?.querySelectorAll?.('.tracking-event-message')||[])].map(node=>{
    const row=node.closest('.a-row.a-spacing-large')||node.parentElement?.parentElement?.parentElement;
    const dateText=text(row?.parentElement?.querySelector('.tracking-event-date'));
    const timeText=text(row?.querySelector('.tracking-event-time'));
    const message=text(node);
    const location=text(row?.querySelector('.tracking-event-location'));
    if(!dateText||!message)return null;
    const eventKey=stableEventKey([dateText,timeText,message,location]);
    return {eventKey,dateText,timeText,message,location};
  }).filter(Boolean);
}

export function parseStatus(value) {
  if (typeof value !== 'string' || !value.trim()) return { state:'UNKNOWN', recognized:false };
  const normalized=value.normalize('NFKC').replace(/\s+/g,' ').trim();
  if (/\b(?:n[aã]o\s+(?:foi\s+)?entregue|not\s+delivered)\b/i.test(normalized))
    return { state:'UNKNOWN',recognized:false };
  for (const [state,re] of statusRules) if (re.test(normalized)) return { state,recognized:true };
  return { state:'UNKNOWN',recognized:false };
}

export function classifyPage(html,url='') {
  const {document}=parseHTML(html||'');
  const pageText=text(document.body);
  if (/robot check|captcha|verificação de segurança|digite os caracteres|enter the characters you see/i.test(pageText) || document.querySelector('input[name="cvf_captcha_input"],input[name="captcha"]')) return 'BLOCKED';
  if (/\/ap\/signin/i.test(url) || document.querySelector('#ap_signin_form,input[type="password"]')) return 'AUTH_REQUIRED';
  return 'OK';
}

export function identifyCandidates(items) { return items.filter(item=>isGta(`${item.title??''} ${item.platform??''}`)); }

export function parseOrder(html,{orderId,asin=''}={},url='') {
  const page=classifyPage(html,url);
  if(page!=='OK') return {kind:page};
  if(!orderId || !/^[0-9]{3}-[0-9]{7}-[0-9]{7}$/.test(orderId)) throw Error('Número do pedido ausente ou inválido');
  let pageOrderId='';
  try { const parsed=new URL(url); pageOrderId=parsed.searchParams.get('orderId')||parsed.searchParams.get('orderID')||''; } catch {}
  if(pageOrderId && pageOrderId!==orderId) return {kind:'ORDER_MISMATCH'};
  const {document}=parseHTML(html);

  const exception=document.querySelector('#lexicalExceptionMessage-container');
  const itemCarousel=document.querySelector('#itemImagesCarousel-container');
  const tracker=document.querySelector('#mainContent-container .pt-card.status-card,.mainContent-container .pt-card.status-card,#mainContent-container .pt-card');
  if(exception||(itemCarousel&&!tracker)){
    const itemRoot=itemCarousel||document.querySelector('#pageContainer');
    const products=[...(itemRoot?.querySelectorAll('a[href*="/dp/"],a[href*="/gp/product/"]')||[])].filter(a=>{
      const label=[text(a),a.getAttribute('aria-label'),a.getAttribute('title'),...[...a.querySelectorAll('img')].map(img=>img.getAttribute('alt'))].filter(Boolean).join(' ');
      return isGta(label) && (!asin||a.href?.includes(`/dp/${asin}`)||a.href?.includes(`/gp/product/${asin}`));
    });
    if(products.length!==1)return {kind:products.length?'AMBIGUOUS':'ITEM_MISMATCH'};
    const statusText=text(exception?.querySelector('h1,h2,h3,h4'))||text(exception)||text(document.querySelector('#promise-background-container'));
    if(!statusText)return {kind:'INCOMPLETE'};
    const deliveryText=text(document.querySelector('#promise-background-container'))||null;
    const parsed=parseStatus(statusText);
    return {kind:'ORDER',state:parsed.state,recognized:parsed.recognized,statusText,deliveryText,deliveryEstimate:parseDeliveryEstimate(deliveryText),shipmentEvents:parseShipmentEvents(document)};
  }

  if(tracker) {
    const productRoot=document.querySelector('#topContent-container,.topContent-container');
    const products=[...(productRoot?.querySelectorAll('a')||[])].filter(a=>{
      const label=[text(a),a.getAttribute('aria-label'),a.getAttribute('title'),...[...(a.querySelectorAll('img')||[])].map(img=>img.getAttribute('alt'))].filter(Boolean).join(' ');
      return isGta(label);
    });
    const productMatches=products.filter(a=>!asin || a.href?.includes(`/dp/${asin}`) || a.href?.includes(`/gp/product/${asin}`));
    if(productMatches.length!==1) return {kind:productMatches.length?'AMBIGUOUS':'ITEM_MISMATCH'};
    const currentLabel=tracker.querySelector('.pt-status-milestone-label.active.current-label') || tracker.querySelector('.pt-status-main-status');
    const statusText=text(currentLabel);
    if(!statusText) return {kind:'INCOMPLETE'};
    const parsed=parseStatus(statusText);
    const deliveryNode=[...(productRoot?.querySelectorAll('h1,h2,h3,h4,[role="heading"]')||[])].find(node=>/(chega|entrega|delivery|arrives)/i.test(text(node)));
    const deliveryText=text(deliveryNode)||null;
    return {kind:'ORDER',state:parsed.state,recognized:parsed.recognized,statusText,deliveryText,deliveryEstimate:parseDeliveryEstimate(deliveryText),shipmentEvents:parseShipmentEvents(document)};
  }

  const cards=[...document.querySelectorAll('[data-order-id],.order-card,.order,.order-info')];
  const body=document.querySelector('main')||document.body;
  if(!cards.length && (text(body).includes(orderId)||pageOrderId===orderId)) cards.push(body);
  const matches=cards.filter(card=>card.getAttribute('data-order-id')===orderId||text(card).includes(orderId));
  if(matches.length!==1) return {kind:matches.length?'AMBIGUOUS':'NOT_FOUND'};
  const card=matches[0];
  const itemNode=card.querySelector('[data-item],.item,.product-title,.a-link-normal[href*="/dp/"]');
  const itemText=text(itemNode)||text(card);
  const asinMatches=!asin||card.querySelector(`[data-asin="${asin}"]`)||card.innerHTML.includes(`/dp/${asin}`)||card.innerHTML.includes(`/gp/product/${asin}`);
  if(!asinMatches||!isGta(itemText)) return {kind:'ITEM_MISMATCH'};
  const statusNode=card.querySelector('[data-status],.shipment-status,.delivery-status,.order-status,.status,.a-color-success');
  const statusText=text(statusNode);
  if(!statusText) return {kind:'INCOMPLETE'};
  const parsed=parseStatus(statusText);
  const deliveryNode=card.querySelector('[data-delivery-date],.delivery-date,.arrival-date,.delivery-estimate');
  const deliveryText=text(deliveryNode)||null;
  return {kind:'ORDER',state:parsed.state,recognized:parsed.recognized,statusText,deliveryText,deliveryEstimate:parseDeliveryEstimate(deliveryText),shipmentEvents:parseShipmentEvents(document)};
}
