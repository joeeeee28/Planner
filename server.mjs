// Tiny production static server for the built app (dist/).
// No dependencies, no host checks — serves the SPA with correct content types
// and falls back to index.html for unknown paths (hash routing doesn't need
// rewrites, but deep-link-friendly anyway).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('./dist', import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

const server = createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (pathname === '/') pathname = '/index.html';
    // prevent path traversal
    const filePath = normalize(join(ROOT, pathname));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    try {
      const info = await stat(filePath);
      if (info.isFile()) {
        const body = await readFile(filePath);
        res.writeHead(200, {
          'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
          'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        });
        res.end(body);
        return;
      }
    } catch {
      /* not found — fall through to SPA fallback */
    }
    // SPA fallback
    const body = await readFile(join(ROOT, 'index.html'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  } catch (err) {
    res.writeHead(500);
    res.end(`Server error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Growth OS production server listening on http://0.0.0.0:${PORT} (serving ${ROOT})`);
});
