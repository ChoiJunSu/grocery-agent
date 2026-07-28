// 로컬 정적 서버 + 스냅샷 API. 의존성 없이 node:http만 쓴다.
//
//   npm start   → http://localhost:3100

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { loadEnv, log, ROOT } from './util.js';

loadEnv();
const { CONFIG } = await import('./config.js');

const PUBLIC = path.join(ROOT, 'public');
const SNAPSHOT = path.join(ROOT, 'data', 'snapshot.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/snapshot') {
    if (!fs.existsSync(SNAPSHOT)) {
      res.writeHead(404, { 'Content-Type': MIME['.json'] });
      res.end(JSON.stringify({ error: 'snapshot 없음. 먼저 `npm run collect` 를 실행할 것.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    fs.createReadStream(SNAPSHOT).pipe(res);
    return;
  }

  // 정적 파일 — public 밖으로 못 나가게 막는다
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(CONFIG.port, () => {
  log.info(`http://localhost:${CONFIG.port}`);
  if (!fs.existsSync(SNAPSHOT)) log.warn('data/snapshot.json 없음 — 먼저 `npm run collect`');
});
