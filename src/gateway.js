import { config } from './config.js';
export function validateBridgeUrl(settings) {
  const url = new URL(settings.TAILSCALE_NOTIFY_URL);
  const loopback = ['127.0.0.1','localhost','[::1]'].includes(url.hostname.toLowerCase());
  const pinned = settings.TAILSCALE_NOTIFY_HOST && url.hostname.toLowerCase() === settings.TAILSCALE_NOTIFY_HOST.toLowerCase();
  if (!loopback && !pinned) throw new Error('Destino da ponte não autorizado; defina TAILSCALE_NOTIFY_HOST');
  const octets=url.hostname.split('.').map(Number);
  const tailnetIpv4=octets.length===4 && octets.every(value=>Number.isInteger(value)&&value>=0&&value<=255) && octets[0]===100 && octets[1]>=64 && octets[1]<=127;
  if (!loopback && url.protocol==='http:' && !tailnetIpv4)
    throw new Error('HTTP da ponte só é permitido no loopback ou em IPv4 da Tailnet');
  if (!['http:','https:'].includes(url.protocol) || url.pathname !== '/send' || url.username || url.password || url.search || url.hash)
    throw new Error('URL da ponte inválida');
  return url.href;
}
export async function sendNotification(notificationId, payload, fetchFn = fetch, settings = config) {
  if (!settings.TAILSCALE_NOTIFY_URL || !settings.TAILSCALE_TOKEN) return { kind: 'SKIPPED', reason: 'bridge_not_configured' };
  const bridgeUrl = validateBridgeUrl(settings);
  const id = `amazon-order-${notificationId}`;
  try {
    const response = await fetchFn(bridgeUrl, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type':'application/json', authorization:`Bearer ${settings.TAILSCALE_TOKEN}`, 'idempotency-key': id },
      body: JSON.stringify({ text: payload.message }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.receiptId) return { kind: 'CONFIRMED' };
    if (body.accepted === false) return { kind: 'REJECTED', status: response.status };
    return { kind: 'UNCERTAIN', status: response.status };
  } catch (error) {
    const code = error?.cause?.code;
    if (['ECONNREFUSED','EHOSTUNREACH','ENETUNREACH','ENOTFOUND'].includes(code))
      return { kind: 'SKIPPED', reason: 'bridge_unreachable' };
    return { kind: 'UNCERTAIN' };
  }
}
