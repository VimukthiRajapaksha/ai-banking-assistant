// Static file server for the built portal (dist/), with no dependencies.
//
// The WSO2 Developer Platform runs containers as a non-root user on a
// read-only filesystem, which rules out the Vite dev server (it writes its
// cache under node_modules) and stock nginx (it writes temp files). This
// writes nothing. Unknown paths that are not files get index.html, so client
// routes such as /oauth/callback survive a reload.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const ROOT = join(import.meta.dirname, 'dist');
const PORT = Number(process.env.PORT ?? 18000);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function fileAt(urlPath) {
  // normalize() resolves `..`, and the prefix check keeps the result inside ROOT.
  const path = normalize(join(ROOT, decodeURIComponent(urlPath)));
  if (!path.startsWith(ROOT)) return null;
  try {
    return (await stat(path)).isFile() ? path : null;
  } catch {
    return null;
  }
}

createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const urlPath = new URL(req.url ?? '/', 'http://localhost').pathname;
  // Hashed assets never change; index.html and the per-environment config.js
  // must be re-read on every load.
  const immutable = urlPath.startsWith('/assets/');
  const found = await fileAt(urlPath);
  if (!found && immutable) {
    // A missing asset is a stale page asking for an old build's file: say so,
    // rather than answering with index.html as JavaScript.
    res.writeHead(404).end();
    return;
  }
  const path = found ?? join(ROOT, 'index.html');
  res.writeHead(200, {
    'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(path).pipe(res);
}).listen(PORT, '0.0.0.0', () => console.log(`Portal on http://0.0.0.0:${PORT}`));
