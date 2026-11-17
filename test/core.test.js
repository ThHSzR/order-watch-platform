import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStatus, identifyCandidates } from '../src/parser.js';
import { transition } from '../src/state-machine.js';
test('mapeia textos conhecidos sem inventar status',()=>{
 assert.equal(parseStatus('Pedido enviado').state,'SHIPPED');
 assert.equal(parseStatus('Saiu para entrega').state,'OUT_FOR_DELIVERY');
 assert.deepEqual(parseStatus('Sua encomenda está a caminho?'),{state:'UNKNOWN',recognized:false});
});
test('filtra candidato GTA VI',()=>assert.equal(identifyCandidates([{title:'Grand Theft Auto VI PS5'},{title:'Controle'}]).length,1));
test('valida transições e estados terminais',()=>{
 assert.equal(transition('PREPARING','SHIPPED').changed,true);
 assert.equal(transition('OUT_FOR_DELIVERY','DELIVERY_DELAYED').changed,true);
 assert.equal(transition('DELIVERY_DELAYED','OUT_FOR_DELIVERY').changed,true);
 assert.equal(transition('DELIVERY_DELAYED','DELIVERED').changed,true);
 assert.throws(()=>transition('DELIVERED','SHIPPED'));
});
