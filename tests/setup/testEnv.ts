import os from 'os';
import http from 'http';
import https from 'https';
import SupertestTest from 'supertest/lib/test';

/**
 * Runs before any module is loaded (jest `setupFiles`), so these values win over `.env`
 * (dotenv never overrides variables that are already set).
 *
 * Tests use their own Redis database: a developer's running `npm run dev` worker reads
 * database 0, and would otherwise pick up and process jobs the tests enqueue — including
 * sending their emails.
 */
process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379/15';

/**
 * Node 19+ keeps HTTP connections alive by default, and every test file in a jest worker
 * shares Node's global agent. supertest starts a throwaway server per request, so a pooled
 * socket could outlive its server and be reused if a later server gets the same port.
 */
http.globalAgent = new http.Agent({ keepAlive: false });

/**
 * supertest calls `app.listen(0)`, which binds `::` (every interface), then requests
 * `127.0.0.1:<port>`. With jest workers running in parallel, macOS lets another process bind
 * `127.0.0.1` on that same port and receive the request instead — another suite's app
 * (random 400/404s) or a non-HTTP socket (hang until timeout). Connect over the loopback of the
 * family the server actually bound, which no other process can take over.
 */
// Some Linux hosts (e.g. IPv6-disabled containers) still bind `::` but have no `::1`
const hasIPv6Loopback = Object.values(os.networkInterfaces()).some((addresses) =>
  addresses?.some((address) => address.internal && address.address === '::1')
);

SupertestTest.prototype.serverAddress = function (this: any, app: any, path: string) {
  if (!app.address()) this._server = app.listen(0);
  const { port, family } = app.address();
  const protocol = app instanceof https.Server ? 'https' : 'http';
  const host = family === 'IPv6' && hasIPv6Loopback ? '[::1]' : '127.0.0.1';
  return `${protocol}://${host}:${port}${path}`;
};
