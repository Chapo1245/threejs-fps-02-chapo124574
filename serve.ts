// serve.ts — tiny static server for play-testing game/ (Node 22 stdlib only).
// Serves ./game on http://localhost:8080. Not part of the entry program.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const root = join(process.cwd(), 'game');
const types: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
};

const server = createServer(async (req, res) => {
  const path = normalize(join(root, decodeURIComponent(req.url?.split('?')[0] || '/index.html')));
  if (!path.startsWith(root)) { res.writeHead(403); res.end(); return; }
  try {
    const data = await readFile(path.endsWith('/') ? join(path, 'index.html') : path);
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
server.listen(8080, () => console.log('COPPERLINE at http://localhost:8080'));
