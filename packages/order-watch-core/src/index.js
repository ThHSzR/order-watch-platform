import { createHash } from 'node:crypto';

export function stableEventKey(parts, locale = 'pt-BR') {
  const normalized = parts.map(value => String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase(locale));
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function shouldAlertAfterAuthChecks(consecutiveChecks, threshold = 2) {
  return Number.isInteger(consecutiveChecks) && consecutiveChecks > threshold;
}

function waitFor(ms, signal) {
  return new Promise(resolve => {
    let timer;
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    if (signal?.aborted) return done();
    timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

export async function runPollingLoop({ check, intervalMs, signal, stopWhen = () => false, onCycle = () => {}, wait = waitFor }) {
  if (typeof check !== 'function') throw new TypeError('check must be a function');
  if (!Number.isFinite(intervalMs) || intervalMs < 1) throw new RangeError('intervalMs must be positive');
  while (!signal?.aborted) {
    const result = await check();
    await onCycle(result);
    if (stopWhen(result)) return result;
    await wait(intervalMs, signal);
  }
  return { kind: 'STOPPED' };
}
