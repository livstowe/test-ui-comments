import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/filter.js': ['filter.js', 'text/javascript; charset=utf-8'],
  '/state.js': ['state.js', 'text/javascript; charset=utf-8'],
  '/notice.js': ['notice.js', 'text/javascript; charset=utf-8'],
};

export function createDemoServer() {
  return createServer(async (request, response) => {
    const file = files[new URL(request.url, 'http://localhost').pathname];
    if (!file || request.method !== 'GET') {
      response.writeHead(404).end('Not found');
      return;
    }
    try {
      const body = await readFile(new URL(file[0], import.meta.url));
      response.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' }).end(body);
    } catch {
      response.writeHead(500).end('Demo file unavailable');
    }
  });
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  createDemoServer().listen(4080, '127.0.0.1', () => console.log('Item board ready at http://127.0.0.1:4080'));
}
