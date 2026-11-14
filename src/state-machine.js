const ORDER_STATES = ['UNKNOWN','ORDER_CONFIRMED','PREPARING','SHIPPED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'];
const allowed = {
  UNKNOWN: ['ORDER_CONFIRMED','PREPARING','SHIPPED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'],
  ORDER_CONFIRMED: ['PREPARING','SHIPPED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'],
  PREPARING: ['SHIPPED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'],
  SHIPPED: ['OUT_FOR_DELIVERY','DELIVERED','CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED','CANCELLED'],
  DELIVERED: [], CANCELLED: [],
};
export function transition(current, next) {
  if (!ORDER_STATES.includes(next)) throw new Error(`Estado de pedido inválido: ${next}`);
  if (next === 'UNKNOWN' || current === next) return { changed: false, current };
  if (!allowed[current]?.includes(next)) throw new Error(`Transição inválida: ${current} -> ${next}`);
  return { changed: true, current: next };
}
