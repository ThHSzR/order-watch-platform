import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { config } from './config.js';
import { classifyPage, parseOrder } from './parser.js';

function ensureConfigured(cfg) {
  if (!cfg.orderId || !cfg.orderUrl) throw new Error('Defina AMAZON_ORDER_ID no arquivo .env');
}

async function withBrowser(headless, fn, cfg = config) {
  ensureConfigured(cfg);
  fs.mkdirSync(cfg.profileDir,{recursive:true});
  const context = await chromium.launchPersistentContext(cfg.profileDir, {
    headless,
    viewport:{width:1365,height:900},
    acceptDownloads:false,
    args:['--disable-background-networking','--no-first-run','--no-default-browser-check'],
  });
  try {
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultNavigationTimeout(45_000);
    page.setDefaultTimeout(15_000);
    return await fn(page);
  } finally { await context.close(); }
}

async function readOrder(page,cfg) {
  await page.goto(cfg.orderUrl,{waitUntil:'domcontentloaded',timeout:45_000});
  await page.waitForTimeout(1800);
  const url=page.url();
  const html=await page.content();
  const kind=classifyPage(html,url);
  if(kind!=='OK') return {kind};
  return parseOrder(html,{orderId:cfg.orderId,asin:cfg.asin},url);
}

export async function checkAmazon(cfg = config) {
  return withBrowser(true,page=>readOrder(page,cfg),cfg);
}

export async function manualAuth(cfg = config, { waitIndefinitely = false, authCheckIntervalMs = 60_000, onAuthRequiredCheck = null } = {}) {
  return withBrowser(false,async page=>{
    await page.goto(cfg.orderUrl,{waitUntil:'domcontentloaded',timeout:45_000});
    process.stdout.write('Faça login e conclua MFA manualmente nesta janela Chromium. Ela ficará aberta até a sessão ser validada ou você interromper com Ctrl+C.\n');
    const deadline=waitIndefinitely?Infinity:Date.now()+60*60_000;
    let lastNotice='';
    let lastAuthCheckAt=Date.now();
    let authState=null;
    while(Date.now()<deadline){
      try {
        const url=page.url();const html=await page.content();const pageKind=classifyPage(html,url);
        if(pageKind==='BLOCKED'){
          authState='BLOCKED';
          if(lastNotice!=='BLOCKED')process.stdout.write('A Amazon mostrou uma verificação. Conclua-a manualmente na janela; o watcher continuará aguardando.\n');
          lastNotice='BLOCKED';
        } else if(pageKind==='AUTH_REQUIRED'){
          authState='AUTH_REQUIRED';
          if(lastNotice!=='AUTH_REQUIRED')process.stdout.write('Aguardando login e código MFA na janela.\n');
          lastNotice='AUTH_REQUIRED';
        } else {
          authState=null;
          lastAuthCheckAt=Date.now();
          const result=parseOrder(html,{orderId:cfg.orderId,asin:cfg.asin},url);
          if(result.kind==='ORDER' && result.recognized)return {kind:'AUTHENTICATED',state:result.state,recognized:true};
          if(lastNotice!==result.kind){
            process.stdout.write(`Página aberta; aguardando confirmação do pedido (${result.kind}).\n`);
            lastNotice=result.kind;
          }
        }
      } catch(error) {
        if(page.isClosed())return {kind:'AUTH_REQUIRED'};
        if(lastNotice!=='PAGE_TRANSITION')process.stdout.write('A Amazon está carregando a próxima etapa; mantendo a janela aberta.\n');
        lastNotice='PAGE_TRANSITION';
      }
      if(authState&&Date.now()-lastAuthCheckAt>=authCheckIntervalMs){
        lastAuthCheckAt=Date.now();
        if(onAuthRequiredCheck)await onAuthRequiredCheck(authState);
      }
      await page.waitForTimeout(2000);
    }
    return {kind:'AUTH_REQUIRED'};
  },cfg);
}
