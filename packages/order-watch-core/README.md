# @jeremias/order-watch-core

Reusable primitives for small authenticated order and shipment monitors.

## Included

- `runPollingLoop`: recurring checks with abort support and caller-defined stop conditions.
- `stableEventKey`: stable SHA-256 keys for normalized event fields.
- `shouldAlertAfterAuthChecks`: an explicit consecutive-failure threshold policy.

The consuming application owns its adapters, persistent storage, credentials, and notification transport. Persist the auth failure count in the host application's database so a process restart does not reset the threshold.

For another local application, install the package from this checkout with `npm install file:../path/to/amazon-order-watcher/packages/order-watch-core`. It can later be published or referenced from a remote Git repository without changing the import API.

## Example

```js
import { runPollingLoop, shouldAlertAfterAuthChecks, stableEventKey } from '@jeremias/order-watch-core';

const eventKey = stableEventKey([date, message, location]);
if (shouldAlertAfterAuthChecks(consecutiveAuthChecks, 2)) await sendAuthWarning();

await runPollingLoop({
  check: checkOrder,
  intervalMs: 10 * 60_000,
  signal,
  stopWhen: result => result.kind === 'STOPPED',
});
```
