export function generateRoomId() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

export function getShareableLink(roomId) {
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  return url.toString();
}

export function createInitialState() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomFromUrl = urlParams.get('room');
  const isVisitor = Boolean(roomFromUrl);
  let photoSender = isVisitor ? 'visitor' : 'host';

  if (isVisitor) {
    let visitorId = localStorage.getItem('doorbellVisitorId');
    if (!visitorId) {
      visitorId = `v${Math.random().toString(36).substr(2, 8)}`;
      localStorage.setItem('doorbellVisitorId', visitorId);
    }
    photoSender = `visitor-${visitorId}`;
  }

  const roomId = roomFromUrl || localStorage.getItem('doorbellRoomId') || generateRoomId();
  localStorage.setItem('doorbellRoomId', roomId);

  return {
    roomId,
    isVisitor,
    photoSender,
    eventSender: isVisitor ? 'visitor' : 'host',
    connected: false,
    ringCooldownUntil: 0,
    eventSource: null,
    currentPhotos: {},
    seenMessageIds: new Set(),
    keepAliveInterval: null,
    lastKeepAliveAt: 0,
    lastPresenceReplyAt: 0
  };
}

export function createFreshStoredRoom() {
  const nextRoomId = generateRoomId();
  localStorage.setItem('doorbellRoomId', nextRoomId);
  return nextRoomId;
}

export function getStoredMessages(roomId) {
  try {
    return JSON.parse(localStorage.getItem(`doorbellMessages:${roomId}`) || '[]');
  } catch {
    return [];
  }
}

export function storeMessage(roomId, message) {
  const messages = getStoredMessages(roomId);
  if (messages.some((storedMessage) => storedMessage.id === message.id)) return;

  messages.push(message);
  localStorage.setItem(`doorbellMessages:${roomId}`, JSON.stringify(messages.slice(-50)));
}

export function isVisitorSender(sender) {
  return sender === 'visitor' || (typeof sender === 'string' && sender.startsWith('visitor-'));
}
