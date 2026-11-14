import { config } from './config.js';
export async function sendNotification(notificationId, payload, fetchFn = fetch, settings = config) {
  if (!settings.TAILSCALE_NOTIFY_URL || !settings.TAILSCALE_TOKEN) return { kind: 'SKIPPED', reason: 'bridge_not_configured' };
  const id = `amazon-order-${notificationId}`;
  try {
    const response = await fetchFn(settings.TAILSCALE_NOTIFY_URL, {
      method: 'POST',
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
