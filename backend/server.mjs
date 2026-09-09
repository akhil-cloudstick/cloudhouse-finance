import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Serves the Next.js static export (frontend/out — built via `npm run build`
// in frontend/, output: 'export'). Two real pages: /  and /app (client-side
// hash routing handles everything inside /app, e.g. #dashboard, #loan/GL-1001).
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'out');
const PORT = process.env.PORT || 8090;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};

/**
 * Resolves a request path to a file inside the export, mirroring how a real
 * static host serves Next.js's `output: 'export'` clean URLs:
 *   /            -> index.html
 *   /app         -> app.html   (falls back to app/index.html if present)
 *   /whatever.js -> whatever.js (exact asset match)
 * Returns null if nothing matches (caller should 404).
 */
function resolveFile(urlPath) {
  const clean = urlPath.replace(/\/+$/, '') || '/';
  const base = path.normalize(path.join(ROOT, clean));
  if (!base.startsWith(ROOT)) return null; // path traversal guard

  if (clean === '/') return path.join(ROOT, 'index.html');

  const candidates = [base, `${base}.html`, path.join(base, 'index.html')];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = resolveFile(urlPath);

  if (!file) {
    const notFound = path.join(ROOT, '404.html');
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    if (existsSync(notFound)) return createReadStream(notFound).pipe(res);
    return res.end('Not found');
  }

  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
  });
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`CloudHouse Gold Finance serving on :${PORT}`));
