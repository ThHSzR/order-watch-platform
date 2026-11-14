import { spawnSync } from 'node:child_process';
import { config } from './config.js';

export function ensureAdbForward(settings = config) {
  if (process.platform !== 'win32' || !settings.ADB_EXECUTABLE || !settings.ADB_SERIAL)
    return { kind: 'SKIPPED' };
  const port = settings.ADB_FORWARD_PORT;
  const result = spawnSync(settings.ADB_EXECUTABLE, [
    '-s', settings.ADB_SERIAL, 'forward', `tcp:${port}`, `tcp:${port}`,
  ], { encoding: 'utf8', timeout: 8000, windowsHide: true });
  if (result.error || result.status !== 0) return { kind: 'UNAVAILABLE' };
  return { kind: 'READY' };
}
