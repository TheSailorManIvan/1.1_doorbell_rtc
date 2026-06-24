function generateRoomId() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

function getShareableLink(roomId) {
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  return url.toString();
}

function showQRCode(link) {
  const container = document.getElementById('qrcode');
  if (!container) return;

  container.innerHTML = '';

  if (!window.QRCode) {
    container.textContent = 'QR code needs internet for the QR library. The link still works.';
    return;
  }

  new QRCode(container, {
    text: link,
    width: 200,
    height: 200,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.H
  });
}

function appendMessage(chatHistory, text, className = '') {
  const msgDiv = document.createElement('div');
  msgDiv.className = className;
  msgDiv.textContent = text;
  chatHistory.appendChild(msgDiv);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

async function sendRoomEvent(roomId, payload) {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Send failed: ${response.status}`);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const roomFromUrl = urlParams.get('room');
  const isVisitor = Boolean(roomFromUrl);
  const roomId = roomFromUrl || localStorage.getItem('doorbellRoomId') || generateRoomId();

  localStorage.setItem('doorbellRoomId', roomId);

  const generateBtn = document.getElementById('generate-btn');
  const linkDisplay = document.getElementById('link-display');
  const homeownerSection = document.getElementById('homeowner-section');
  const visitorSection = document.getElementById('visitor-section');
  const homeownerStatusEl = document.getElementById('homeowner-status');
  const visitorStatusEl = document.getElementById('visitor-status');
  const messageInput = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const waitingBtn = document.getElementById('waiting-btn');
  const chatHistory = document.getElementById('chat-history');

  const statusEl = isVisitor ? visitorStatusEl : homeownerStatusEl;
  let eventSource = null;
  let connected = false;

  function setVisitorControlsEnabled(enabled) {
    sendBtn.disabled = !enabled;
    waitingBtn.disabled = !enabled;
  }

  function setConnectionState(isConnected) {
    connected = isConnected;

    if (isVisitor) {
      setVisitorControlsEnabled(isConnected);
      statusEl.textContent = isConnected
        ? 'Connected - send a message when you are ready'
        : 'Connecting...';
      return;
    }

    statusEl.textContent = isConnected
      ? 'Ready - share the link or QR code'
      : 'Connecting room...';
  }

  function connectToRoom() {
    if (eventSource) eventSource.close();

    setConnectionState(false);
    eventSource = new EventSource(`/api/rooms/${encodeURIComponent(roomId)}/events`);

    eventSource.addEventListener('open', () => {
      setConnectionState(true);
      sendRoomEvent(roomId, {
        sender: isVisitor ? 'visitor' : 'host',
        type: 'presence'
      }).catch(() => {});
    });

    eventSource.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'presence') {
        if (!isVisitor && data.sender === 'visitor') {
          statusEl.textContent = 'Visitor is connected';
        }
        if (isVisitor && data.sender === 'host') {
          statusEl.textContent = 'Host is waiting';
        }
        return;
      }

      if (data.type !== 'message') return;

      const label = data.sender === 'host' ? 'Host' : 'Visitor';
      appendMessage(chatHistory, `${label}: ${data.text}`, data.sender === 'host' ? 'host-message' : 'visitor-message');
    });

    eventSource.addEventListener('error', () => {
      setConnectionState(false);
    });
  }

  async function sendMessage(text) {
    if (!connected) {
      alert('Not connected yet - please wait');
      return;
    }

    await sendRoomEvent(roomId, {
      sender: isVisitor ? 'visitor' : 'host',
      type: 'message',
      text
    });
  }

  if (isVisitor) {
    homeownerSection.style.display = 'none';
    visitorSection.style.display = 'block';
    setVisitorControlsEnabled(false);
  } else {
    visitorSection.style.display = 'block';
    document.getElementById('visitor-greeting').textContent = 'Host reply';
    waitingBtn.style.display = 'none';
    visitorStatusEl.style.display = 'none';

    const link = getShareableLink(roomId);
    linkDisplay.textContent = link;
    showQRCode(link);

    generateBtn.addEventListener('click', async () => {
      const nextRoomId = generateRoomId();
      localStorage.setItem('doorbellRoomId', nextRoomId);
      const nextLink = getShareableLink(nextRoomId);
      linkDisplay.textContent = nextLink;
      showQRCode(nextLink);

      try {
        await navigator.clipboard.writeText(nextLink);
        alert('Link copied to clipboard.');
      } catch {
        alert(`Copy this link manually:\n${nextLink}`);
      }

      window.location.href = window.location.pathname;
    });
  }

  sendBtn.addEventListener('click', () => {
    const text = messageInput.value.trim();
    if (!text) return;

    sendMessage(text)
      .then(() => {
        messageInput.value = '';
      })
      .catch(() => {
        alert('Could not send the message. Check that the server is still running.');
      });
  });

  waitingBtn.addEventListener('click', () => {
    sendMessage("I'm waiting at the door!").catch(() => {
      alert('Could not send the waiting message.');
    });
  });

  messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') sendBtn.click();
  });

  connectToRoom();
});
