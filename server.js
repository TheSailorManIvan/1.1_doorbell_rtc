const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
const PUBLIC_DIR = __dirname;
const rooms = new Map();
const MAX_ROOM_HISTORY = 50;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
}

function getRoomClients(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      clients: new Set(),
      history: []
    });
  }
  return rooms.get(roomId);
}

function broadcast(roomId, data) {
  const room = rooms.get(roomId);
  if (!room) return;

  if (data.type === 'message') {
    room.history.push(data);
    room.history = room.history.slice(-MAX_ROOM_HISTORY);
  }

  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of room.clients) {
    client.write(message);
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

function handleEventStream(roomId, req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 3000\n\n');

  const room = getRoomClients(roomId);
  room.clients.add(res);

  for (const message of room.history) {
    res.write(`data: ${JSON.stringify(message)}\n\n`);
  }

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    room.clients.delete(res);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 20_000) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });

    req.on('error', reject);
  });
}

async function handlePostEvent(roomId, req, res) {
  try {
    const data = await readJsonBody(req);
    const sender = data.sender === 'host' ? 'host' : 'visitor';
    const type = data.type === 'presence' ? 'presence' : 'message';
    const text = typeof data.text === 'string' ? data.text.trim().slice(0, 1000) : '';

    if (type === 'message' && !text) {
      sendJson(res, 400, { error: 'Message text is required' });
      return;
    }

    broadcast(roomId, {
      id: crypto.randomUUID(),
      sender,
      type,
      text,
      sentAt: new Date().toISOString()
    });

    sendJson(res, 202, { ok: true });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const eventMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/events$/);

  if (url.pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (eventMatch && req.method === 'GET') {
    handleEventStream(decodeURIComponent(eventMatch[1]), req, res);
    return;
  }

  if (eventMatch && req.method === 'POST') {
    handlePostEvent(decodeURIComponent(eventMatch[1]), req, res);
    return;
  }

  if (req.method === 'GET') {
    serveStatic(req, res);
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
});

function getLanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((networkInterface) => {
      return networkInterface
        && networkInterface.family === 'IPv4'
        && !networkInterface.internal;
    })
    .map((networkInterface) => networkInterface.address);
}

server.listen(PORT, HOST, () => {
  console.log(`Doorbell RTC running at http://${HOST}:${PORT}`);
  if (HOST === '127.0.0.1') {
    console.log('For phones or other computers on Wi-Fi, run: HOST=0.0.0.0 node server.js');
  } else {
    const lanUrls = getLanAddresses().map((address) => `http://${address}:${PORT}`);

    if (lanUrls.length > 0) {
      console.log('Try these from another device on the same Wi-Fi:');
      for (const url of lanUrls) console.log(`  ${url}`);
    } else {
      console.log('No LAN IPv4 address found. Check your Wi-Fi connection.');
    }
  }
});
