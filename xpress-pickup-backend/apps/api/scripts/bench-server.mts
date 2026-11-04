// Benchmark host: serves the real API handlers (same route() wrapper, same database code) from a
// plain Node HTTP server, one worker per core — like several Function App instances — without
// the Functions Core Tools emulator, which is built for debugging and caps out far lower.
// For measuring the application locally; production runs on Azure Functions.
//   pnpm --filter api bench:serve -- --port 7090 --workers 4
import cluster from 'node:cluster';
import { createServer, type IncomingMessage } from 'node:http';
import { availableParallelism } from 'node:os';
import { HttpRequest, InvocationContext, type HttpResponseInit } from '@azure/functions';
import { loadLocalSettings } from './localSettings.mjs';

loadLocalSettings();
if (process.env.APP_ENV === 'prod') {
  console.error('bench:serve is for local measurement only.');
  process.exit(1);
}

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const PORT = arg('port', 7090);
const WORKERS = arg('workers', availableParallelism());

if (cluster.isPrimary) {
  console.log(`bench:serve on :${PORT} with ${WORKERS} workers`);
  for (let i = 0; i < WORKERS; i++) cluster.fork();
  cluster.on('exit', (w, code) => console.error(`worker ${w.process.pid} exited (${code})`));
} else {
  const { route } = await import('../src/lib/http');
  const pub = await import('../src/functions/public');
  const me = await import('../src/functions/me');
  const orders = await import('../src/functions/orders');
  type H = (req: HttpRequest) => Promise<HttpResponseInit>;
  const table: [string, RegExp, H, string[]][] = [
    ['GET', /^\/api\/areas$/, pub.areasHandler as H, []],
    ['GET', /^\/api\/shops$/, pub.shopsHandler, []],
    ['GET', /^\/api\/shops\/([^/]+)$/, pub.shopDetailHandler, ['code']],
    ['GET', /^\/api\/shops\/([^/]+)\/items$/, pub.shopItemsHandler, ['code']],
    ['GET', /^\/api\/me$/, (r) => me.getMeHandler(r), []],
    ['POST', /^\/api\/orders$/, orders.placeOrderHandler, []],
  ];
  const routes = table.map(([m, re, h, names]) => ({ m, re, names, run: route(h) }));
  const ctx = new InvocationContext();

  const readBody = (req: IncomingMessage) =>
    new Promise<string>((done) => {
      let s = '';
      req.on('data', (c) => (s += c)).on('end', () => done(s));
    });

  createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    for (const r of routes) {
      const m = req.method === r.m ? r.re.exec(url.pathname) : null;
      if (!m) continue;
      const body = req.method === 'GET' ? undefined : await readBody(req);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
      const out = (await r.run(
        new HttpRequest({
          method: req.method!,
          url: url.toString(),
          headers,
          params: Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1]!)])),
          body: body === undefined ? undefined : { string: body },
        }),
        ctx,
      )) as HttpResponseInit;
      const h = { ...(out.headers as Record<string, string> | undefined) };
      let payload: string | Buffer | undefined;
      if (out.jsonBody !== undefined) {
        payload = JSON.stringify(out.jsonBody);
        h['content-type'] = 'application/json';
      } else if (out.body != null) {
        payload = out.body as string | Buffer;
      }
      res.writeHead(out.status ?? 200, h);
      res.end(payload);
      return;
    }
    res.writeHead(404).end();
  }).listen(PORT).keepAliveTimeout = 65_000;
}
