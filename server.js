const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const QRCode = require('qrcode');

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

async function sendQrCode(res, text) {
  if (!text || text.length > 2000) {
    sendJson(res, 400, { error: 'QR text is required and must be shorter than 2000 characters' });
    return;
  }

  try {
    const svg = await QRCode.toString(text, {
      type: 'svg',
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 240,
      color: {
        dark: '#111827',
        light: '#ffffff'
      }
    });

    res.writeHead(200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(svg);
  } catch (error) {
    sendJson(res, 500, { error: 'Could not generate QR code' });
  }
}

function getRoomClients(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      clients: new Set(),
      history: [],
      photos: { host: null, visitor: null },
      photoTimeouts: { host: null, visitor: null }
    });
  }
  return rooms.get(roomId);
}

function broadcast(roomId, data) {
  const room = rooms.get(roomId);
  if (!room) return;

  if (data.type === 'message' || data.type === 'ring') {
    room.history.push(data);
    room.history = room.history.slice(-MAX_ROOM_HISTORY);
  }

  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of room.clients) {
    client.write(message);
  }
}

function setRoomPhoto(roomId, sender, dataUrl) {
  const room = rooms.get(roomId);
  if (!room) return;

  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return;

  const mime = match[1];
  const base64 = dataUrl;

  // Clear previous timeout
  if (room.photoTimeouts[sender]) {
    clearTimeout(room.photoTimeouts[sender]);
  }

  const uploadedAt = new Date().toISOString();
  room.photos[sender] = { data: base64, mime, uploadedAt };

  broadcast(roomId, { type: 'photo', sender, uploadedAt });

  // Auto-expire after 3 minutes
  room.photoTimeouts[sender] = setTimeout(() => {
    room.photos[sender] = null;
    room.photoTimeouts[sender] = null;
    broadcast(roomId, { type: 'photo-expired', sender });
  }, 3 * 60 * 1000);
}

function getRoomPhoto(roomId, sender) {
  const room = rooms.get(roomId);
  if (!room || !room.photos[sender]) return null;

  const photo = room.photos[sender];
  const age = Date.now() - new Date(photo.uploadedAt).getTime();
  if (age > 3 * 60 * 1000) {
    room.photos[sender] = null;
    if (room.photoTimeouts[sender]) {
      clearTimeout(room.photoTimeouts[sender]);
      room.photoTimeouts[sender] = null;
    }
    return null;
  }
  return photo;
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let requestedPath = '/index.html';

  try {
    requestedPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  } catch {
    sendJson(res, 400, { error: 'Invalid path' });
    return;
  }

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

  // Send current photos if available
  if (room.photos.host) {
    res.write(`data: ${JSON.stringify({ type: 'photo', sender: 'host', uploadedAt: room.photos.host.uploadedAt })}\n\n`);
  }
  if (room.photos.visitor) {
    res.write(`data: ${JSON.stringify({ type: 'photo', sender: 'visitor', uploadedAt: room.photos.visitor.uploadedAt })}\n\n`);
  }

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    room.clients.delete(res);
  });
}

function readJsonBody(req, maxBytes = 20000) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
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
    const allowedTypes = new Set(['message', 'presence', 'ring']);
    const type = allowedTypes.has(data.type) ? data.type : 'message';
    const allowedRingVariants = new Set(['doorbell', 'waiting']);
    const variant = allowedRingVariants.has(data.variant) ? data.variant : 'doorbell';
    const text = typeof data.text === 'string' ? data.text.trim().slice(0, 1000) : '';

    if (type === 'message' && !text) {
      sendJson(res, 400, { error: 'Message text is required' });
      return;
    }

    broadcast(roomId, {
      id: crypto.randomUUID(),
      sender,
      type,
      variant: type === 'ring' ? variant : undefined,
      text,
      sentAt: new Date().toISOString()
    });

    sendJson(res, 202, { ok: true });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

async function handlePhotoUpload(roomId, req, res) {
  try {
    // Allow much larger body for images (base64 encoded)
    const data = await readJsonBody(req, 5 * 1024 * 1024); // ~5MB max JSON body
    const sender = data.sender === 'host' ? 'host' : 'visitor';

    if (!data.image || typeof data.image !== 'string') {
      sendJson(res, 400, { error: 'image (data URL) is required' });
      return;
    }

    // Basic validation: must be image data URL
    if (!/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(data.image)) {
      sendJson(res, 400, { error: 'Invalid image format. Use data URL.' });
      return;
    }

    // Size check after client-side resizing (limit ~1.5MB image)
    const base64Length = data.image.length - data.image.indexOf(',') - 1;
    const approxBytes = Math.floor(base64Length * 0.75);
    if (approxBytes > 1.5 * 1024 * 1024) {
      sendJson(res, 400, { error: 'Photo too large (max ~1.5MB after compression)' });
      return;
    }

    setRoomPhoto(roomId, sender, data.image);
    sendJson(res, 200, { ok: true });
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

  if (url.pathname === '/api/qr.svg') {
    sendQrCode(res, url.searchParams.get('text'));
    return;
  }

  // Photo upload
  const photoMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/photo$/);
  if (photoMatch && req.method === 'POST') {
    const roomId = decodeURIComponent(photoMatch[1]);
    handlePhotoUpload(roomId, req, res);
    return;
  }

  // Photo retrieval
  if (photoMatch && req.method === 'GET') {
    const roomId = decodeURIComponent(photoMatch[1]);
    const sender = url.searchParams.get('sender') || 'visitor';
    const photo = getRoomPhoto(roomId, sender);
    if (!photo) {
      sendJson(res, 404, { error: 'No current photo or expired' });
      return;
    }
    // Serve the image
    const base64Data = photo.data.split(',')[1];
    const buffer = Buffer.from(base64Data, 'base64');
    res.writeHead(200, {
      'Content-Type': photo.mime,
      'Cache-Control': 'no-store, max-age=0',
      'Content-Length': buffer.length
    });
    res.end(buffer);
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
