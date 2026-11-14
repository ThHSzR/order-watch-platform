import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../src/store.js';

test('persiste transições, reserva uma notificação e mantém deduplicação após reabrir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-watcher-'));
  const file = path.join(dir, 'db.sqlite');
  try {
    const store = await openStore(file);
    store.recordTransition('ORDER_CONFIRMED','manual',null);
    const result = store.recordTransition('SHIPPED','manual',{payload:{message:'fixture'}});
    assert.equal(result.previous,'ORDER_CONFIRMED');
    assert.equal(result.notificationId,'1');
    store.close();

    const again = await openStore(file);
    assert.equal(again.current()[0], 'SHIPPED');
    assert.equal(again.pending().id, '1');
    assert.equal(JSON.parse(again.pending().payload).message, 'fixture');
    again.mark('1','confirmed',new Date().toISOString());
    assert.equal(again.pending(),null);
    assert.equal(again.notifications()[0].status,'confirmed');
    again.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('reclassifica envio interrompido como incerto ao reiniciar', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-watcher-'));
  const file = path.join(dir, 'db.sqlite');
  try {
    const store = await openStore(file);
    store.recordTransition('ORDER_CONFIRMED','manual',null);
    store.recordTransition('SHIPPED','manual',{payload:{message:'fixture'}});
    store.mark('1','sending');
    store.close();
    const again = await openStore(file);
    assert.equal(again.notifications()[0].status,'uncertain');
    assert.equal(again.pending(),null);
    again.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
