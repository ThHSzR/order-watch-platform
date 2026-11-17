const ORDER_STATES = ['UNKNOWN','ORDER_CONFIRMED','PREPARING','SHIPPED','OUT_FOR_DELIVERY','DELIVERY_DELAYED','DELIVERY_ATTEMPTED','DELIVERY_PROBLEM','DELIVERED','CANCELLED'];
const exceptions=['DELIVERY_DELAYED','DELIVERY_ATTEMPTED','DELIVERY_PROBLEM'];
const allowed = {
  UNKNOWN: ['ORDER_CONFIRMED','PREPARING','SHIPPED','OUT_FOR_DELIVERY',...exceptions,'DELIVERED','CANCELLED'],
  ORDER_CONFIRMED: ['PREPARING','SHIPPED','OUT_FOR_DELIVERY',...exceptions,'DELIVERED','CANCELLED'],
  PREPARING: ['SHIPPED','OUT_FOR_DELIVERY',...exceptions,'DELIVERED','CANCELLED'],
  SHIPPED: ['OUT_FOR_DELIVERY',...exceptions,'DELIVERED','CANCELLED'],
  OUT_FOR_DELIVERY: [...exceptions,'DELIVERED','CANCELLED'],
  DELIVERY_DELAYED: ['SHIPPED','OUT_FOR_DELIVERY','DELIVERY_ATTEMPTED','DELIVERY_PROBLEM','DELIVERED','CANCELLED'],
  DELIVERY_ATTEMPTED: ['SHIPPED','OUT_FOR_DELIVERY','DELIVERY_DELAYED','DELIVERY_PROBLEM','DELIVERED','CANCELLED'],
  DELIVERY_PROBLEM: ['SHIPPED','OUT_FOR_DELIVERY','DELIVERY_DELAYED','DELIVERY_ATTEMPTED','DELIVERED','CANCELLED'],
  DELIVERED: [], CANCELLED: [],
};
export function transition(current, next) {
  if (!ORDER_STATES.includes(next)) throw new Error(`Estado de pedido inválido: ${next}`);
  if (next === 'UNKNOWN' || current === next) return { changed: false, current };
  if (!allowed[current]?.includes(next)) throw new Error(`Transição inválida: ${current} -> ${next}`);
  return { changed: true, current: next };
}
