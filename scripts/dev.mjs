// Local dev server: serves the app's static files and the API on one origin.
// Runs in mock mode unless provider keys are present in the environment.
//   node scripts/dev.mjs            → http://localhost:8787
// Binds to loopback only (spec §2).

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { route } from '../worker.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const env = { ...process.env, ALLOWED_ORIGINS: `http://localhost:${PORT},http://127.0.0.1:${PORT}` };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
      const out = await route(request, env);
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(Buffer.from(await out.arrayBuffer()));
      return;
    }
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (p.includes('..')) { res.writeHead(400).end(); return; }
    let file = join(ROOT, p || 'index.html');
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500, { 'content-type': 'text/plain' }).end(e.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Voice Lab dev server: http://localhost:${PORT} (mode: ${env.DEEPGRAM_API_KEY || env.ANTHROPIC_API_KEY ? 'live' : 'mock'})`));
