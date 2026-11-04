// Local dev host: serves every registered HTTP function from a plain Node server, for machines
// where Azure Functions Core Tools can't be installed. Timers are not run. Never for production.
//   pnpm --filter api dev:host            (port 7071, same as `func start`)
import { createServer, type IncomingMessage } from 'node:http';
import { createRequire } from 'node:module';
import type * as AzF from '@azure/functions';
import type { HttpResponseInit } from '@azure/functions';
import { loadLocalSettings } from './localSettings.mjs';

loadLocalSettings();
const azf = createRequire(import.meta.url)('@azure/functions') as typeof AzF;
const { HttpRequest, InvocationContext } = azf;
if (process.env.APP_ENV === 'prod') {
  console.error('dev:host is for local development only.');
  process.exit(1);
}
const PORT = Number(process.env.PORT ?? 7071);

type Reg = { methods: string[]; re: RegExp; names: string[]; handler: AzF.HttpHandler };
const regs: Reg[] = [];
const app = azf.app as unknown as Record<string, unknown>;
app.http = (_name: string, opts: AzF.HttpFunctionOptions) => {
  const names: string[] = [];
  const src = (opts.route ?? _name)
    .split('/')
    .map((seg) => {
      const m = /^\{(\*?)([^}:?]+)(?::[^}?]+)?(\?)?\}$/.exec(seg);
      if (!m) return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      names.push(m[2]!);
      return m[1] ? '(.*)' : m[3] ? '?([^/]*)' : '([^/]+)';
    })
    .join('/');
  regs.push({
    methods: (opts.methods ?? ['GET', 'POST']).map(String),
    re: new RegExp(`^/api/${src}/?$`),
    names,
    handler: opts.handler,
  });
};
for (const k of ['timer', 'storageQueue', 'storageBlob']) {
  try {
    app[k] = () => undefined;
  } catch {
    // read-only export
  }
}

await import('../src/index');
// Specific routes before catch-alls.
regs.sort((a, b) => a.names.length - b.names.length);
console.log(`dev:host on :${PORT} with ${regs.length} routes`);

const readBody = (req: IncomingMessage) =>
  new Promise<Buffer>((done) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c)).on('end', () => done(Buffer.concat(chunks)));
  });

const cookieHeader = (c: AzF.Cookie) => {
  let s = `${c.name}=${encodeURIComponent(c.value)}`;
  if (c.path) s += `; Path=${c.path}`;
  if (c.maxAge !== undefined) s += `; Max-Age=${c.maxAge}`;
  if (c.httpOnly) s += '; HttpOnly';
  if (c.secure) s += '; Secure';
  if (c.sameSite) s += `; SameSite=${c.sameSite}`;
  return s;
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = decodeURI(url.pathname);
  for (const r of regs) {
    if (!r.methods.includes(req.method ?? 'GET')) continue;
    const m = r.re.exec(path);
    if (!m) continue;
    const body = ['GET', 'HEAD'].includes(req.method!) ? undefined : await readBody(req);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers[k] = v;
      else if (Array.isArray(v)) headers[k] = v.join(', ');
    }
    try {
      const out = (await r.handler(
        new HttpRequest({
          method: req.method!,
          url: url.toString(),
          headers,
          params: Object.fromEntries(r.names.map((n, i) => [n, m[i + 1] ?? ''])),
          body: body === undefined ? undefined : { bytes: body },
        }),
        new InvocationContext({ functionName: 'dev' }),
      )) as HttpResponseInit;
      const h: Record<string, string | string[]> = {};
      new Headers(out.headers as ConstructorParameters<typeof Headers>[0]).forEach(
        (v, k) => (h[k] = v),
      );
      if (out.cookies?.length) h['set-cookie'] = out.cookies.map(cookieHeader);
      let payload: string | Buffer | Uint8Array | undefined;
      if (out.jsonBody !== undefined) {
        payload = JSON.stringify(out.jsonBody);
        h['content-type'] ??= 'application/json';
      } else if (out.body != null) {
        const b = out.body as unknown;
        if (typeof b === 'string' || b instanceof Uint8Array) payload = b;
        else if (b instanceof ArrayBuffer) payload = Buffer.from(b);
        else if (b instanceof Blob) payload = Buffer.from(await b.arrayBuffer());
        else payload = String(b);
      }
      res.writeHead(out.status ?? 200, h);
      res.end(payload);
    } catch (err) {
      console.error(err);
      res.writeHead(500).end();
    }
    return;
  }
  res.writeHead(404).end();
}).listen(PORT);
