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

  const qrImage = document.createElement('img');
  qrImage.alt = 'QR code for the visitor doorbell link';
  qrImage.src = `/api/qr.svg?text=${encodeURIComponent(link)}`;
  qrImage.width = 240;
  qrImage.height = 240;

  const openLink = document.createElement('a');
  openLink.href = link;
  openLink.textContent = 'Open visitor link';
  openLink.target = '_blank';
  openLink.rel = 'noopener';

  container.append(qrImage, openLink);
}

function appendMessage(chatHistory, text, className = '') {
  const msgDiv = document.createElement('div');
  msgDiv.className = className;
  msgDiv.textContent = text;
  chatHistory.appendChild(msgDiv);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

function getStoredMessages(roomId) {
  try {
    return JSON.parse(localStorage.getItem(`doorbellMessages:${roomId}`) || '[]');
  } catch {
    return [];
  }
}

function storeMessage(roomId, message) {
  const messages = getStoredMessages(roomId);
  if (messages.some((storedMessage) => storedMessage.id === message.id)) return;

  messages.push(message);
  localStorage.setItem(`doorbellMessages:${roomId}`, JSON.stringify(messages.slice(-50)));
}

function renderMessage(chatHistory, message) {
  if (message.type === 'ring') {
    const text = message.variant === 'waiting'
      ? 'Visitor is waiting at the door'
      : message.sender === 'host'
        ? 'Host pinged the visitor'
        : 'Visitor rang the doorbell';
    appendMessage(chatHistory, text, 'ring-message');
    return;
  }

  const label = message.sender === 'host' ? 'Host' : 'Visitor';
  appendMessage(
    chatHistory,
    `${label}: ${message.text}`,
    message.sender === 'host' ? 'host-message' : 'visitor-message'
  );
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

  const startSection = document.getElementById('start-section');
  const startBtn = document.getElementById('start-btn');
  const profilesSection = document.getElementById('profiles-section');
  const generateBtn = document.getElementById('generate-btn');
  const linkDisplay = document.getElementById('link-display');
  const homeownerSection = document.getElementById('homeowner-section');
  const visitorSection = document.getElementById('visitor-section');
  const soundSection = document.getElementById('sound-section');
  const homeownerStatusEl = document.getElementById('homeowner-status');
  const visitorStatusEl = document.getElementById('visitor-status');
  const messageInput = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const waitingBtn = document.getElementById('waiting-btn');
  const ringBtn = document.getElementById('ring-btn');
  const stopRingBtn = document.getElementById('stop-ring-btn');
  const enableSoundBtn = document.getElementById('enable-sound-btn');
  const chatHistory = document.getElementById('chat-history');

  const statusEl = isVisitor ? visitorStatusEl : homeownerStatusEl;
  let eventSource = null;
  let connected = false;
  let audioContext = null;
  let ringCooldownUntil = 0;
  let activeRingInterval = null;
  let activeRingTimeout = null;
  const activeOscillators = new Set();
  let soundWasEnabled = false;
  const seenMessageIds = new Set();

  startBtn.textContent = isVisitor ? 'Join Doorbell' : 'Start Doorbell';

  function setVisitorControlsEnabled(enabled) {
    sendBtn.disabled = !enabled;
    waitingBtn.disabled = !enabled;
    ringBtn.disabled = !enabled;
  }

  function setSoundButtonEnabled(enabled) {
    soundWasEnabled = enabled;
    enableSoundBtn.disabled = enabled;
    enableSoundBtn.textContent = enabled ? 'Sound Enabled' : 'Enable Sound';
  }

  function setConnectionState(isConnected) {
    connected = isConnected;

    if (isVisitor) {
      setVisitorControlsEnabled(isConnected);
      statusEl.textContent = isConnected
        ? 'Connected - send a message when you are ready'
        : 'Connecting or waking server...';
      return;
    }

    statusEl.textContent = isConnected
      ? 'Ready - share the link or QR code'
      : 'Connecting room or waking server...';
  }

  async function enableSound() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      enableSoundBtn.textContent = 'Sound Unavailable';
      enableSoundBtn.disabled = true;
      return;
    }

    audioContext = audioContext || new AudioContext();

    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    playTone([660], 0.06, 0.03);
    setSoundButtonEnabled(true);
  }

  function enableSoundQuietly() {
    if (soundWasEnabled) return;

    enableSound()
      .then(() => {
        enableSoundBtn.textContent = 'Sound Ready';
      })
      .catch(() => {});
  }

  function playTone(frequencies, duration = 0.18, gap = 0.08) {
    if (!audioContext || audioContext.state !== 'running') return false;

    const now = audioContext.currentTime;
    frequencies.forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const start = now + index * (duration + gap);
      const end = start + duration;

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      activeOscillators.add(oscillator);
      oscillator.addEventListener('ended', () => {
        activeOscillators.delete(oscillator);
      });
      oscillator.start(start);
      oscillator.stop(end + 0.02);
    });

    return true;
  }

  function stopRingSequence() {
    if (activeRingInterval) {
      window.clearInterval(activeRingInterval);
      activeRingInterval = null;
    }

    if (activeRingTimeout) {
      window.clearTimeout(activeRingTimeout);
      activeRingTimeout = null;
    }

    for (const oscillator of activeOscillators) {
      try {
        oscillator.stop();
      } catch {
        // The oscillator may already have stopped naturally.
      }
    }

    activeOscillators.clear();

    stopRingBtn.style.display = 'none';
  }

  function stopRingBecauseUserResponded() {
    stopRingSequence();
    document.body.classList.remove('ring-alert');
  }

  function handleStopRingControl(event) {
    event.preventDefault();
    event.stopPropagation();
    stopRingBecauseUserResponded();
  }

  function playRingSequence(frequencies, options = {}) {
    const repeatForMs = options.repeatForMs || 0;
    const intervalMs = options.intervalMs || 3000;
    const toneDuration = options.toneDuration || 0.16;
    const gap = options.gap || 0.08;

    stopRingSequence();
    const played = playTone(frequencies, toneDuration, gap);

    if (repeatForMs <= intervalMs) return played;

    stopRingBtn.style.display = 'inline-block';

    activeRingInterval = window.setInterval(() => {
      playTone(frequencies, toneDuration, gap);
      flashRingAlert();
    }, intervalMs);

    activeRingTimeout = window.setTimeout(() => {
      stopRingSequence();
    }, repeatForMs);

    return played;
  }

  function flashRingAlert() {
    document.body.classList.remove('ring-alert');
    void document.body.offsetWidth;
    document.body.classList.add('ring-alert');
    window.setTimeout(() => {
      document.body.classList.remove('ring-alert');
    }, 1400);
  }

  function handleRing(data, fromStoredHistory = false) {
    const isOwnRing = data.sender === (isVisitor ? 'visitor' : 'host');
    const isWaitingRing = data.variant === 'waiting';
    const incomingText = data.sender === 'host'
      ? 'Host is calling you'
      : isWaitingRing
        ? 'Visitor is waiting at the door'
        : 'Visitor is ringing';
    const sentText = data.sender === 'host'
      ? 'Ping sent to visitor'
      : isWaitingRing
        ? 'Waiting notice sent to host'
        : 'Ring sent to host';

    statusEl.textContent = isOwnRing ? sentText : incomingText;
    renderMessage(chatHistory, data);

    if (isOwnRing || fromStoredHistory) return;

    flashRingAlert();
    const played = isWaitingRing
      ? playRingSequence([880, 660], { repeatForMs: 0, toneDuration: 0.12, gap: 0.05 })
      : data.sender === 'host'
        ? playRingSequence([784, 988], { repeatForMs: 20_000, intervalMs: 2500, toneDuration: 0.14, gap: 0.07 })
        : playRingSequence([659, 523, 659, 523], { repeatForMs: 20_000, intervalMs: 3000, toneDuration: 0.16, gap: 0.08 });

    if (!played) {
      enableSoundBtn.textContent = 'Enable Sound for Ring';
    }
  }

  function showStoredMessages() {
    for (const message of getStoredMessages(roomId)) {
      if (seenMessageIds.has(message.id)) continue;
      seenMessageIds.add(message.id);

      if (message.type === 'ring') {
        handleRing(message, true);
      } else {
        renderMessage(chatHistory, message);
      }
    }
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

      if (data.type !== 'message' && data.type !== 'ring') return;
      if (seenMessageIds.has(data.id)) return;

      seenMessageIds.add(data.id);
      storeMessage(roomId, data);

      if (data.type === 'ring') {
        handleRing(data);
      } else {
        renderMessage(chatHistory, data);
      }
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

  async function sendRing(variant = 'doorbell') {
    const now = Date.now();
    if (now < ringCooldownUntil) return;

    if (!connected) {
      alert('Not connected yet - please wait');
      return;
    }

    const cooldownMs = variant === 'waiting' ? 3000 : 20_000;
    ringCooldownUntil = now + cooldownMs;
    ringBtn.disabled = true;
    waitingBtn.disabled = true;

    try {
      await sendRoomEvent(roomId, {
        sender: isVisitor ? 'visitor' : 'host',
        type: 'ring',
        variant
      });
    } finally {
      window.setTimeout(() => {
        if (connected) {
          ringBtn.disabled = false;
          waitingBtn.disabled = false;
        }
      }, cooldownMs);
    }
  }

  if (isVisitor) {
    setVisitorControlsEnabled(false);
  } else {
    document.getElementById('visitor-greeting').textContent = 'Host reply';
    ringBtn.textContent = 'Ping Visitor';
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
    Promise.all([
      sendMessage("I'm waiting at the door!"),
      sendRing('waiting')
    ]).catch(() => {
      alert('Could not send the waiting message.');
    });
  });

  ringBtn.addEventListener('click', () => {
    sendRing().catch(() => {
      alert('Could not send the ring.');
    });
  });

  stopRingBtn.addEventListener('pointerdown', handleStopRingControl);
  stopRingBtn.addEventListener('touchstart', handleStopRingControl);
  stopRingBtn.addEventListener('click', handleStopRingControl);

  enableSoundBtn.addEventListener('click', () => {
    enableSound().catch(() => {
      enableSoundBtn.textContent = 'Sound Blocked';
    });
  });

  messageInput.addEventListener('input', stopRingBecauseUserResponded);

  messageInput.addEventListener('keydown', (event) => {
    stopRingBecauseUserResponded();
    if (event.key === 'Enter') sendBtn.click();
  });

  startBtn.addEventListener('click', () => {
    enableSoundQuietly();
    startSection.style.display = 'none';
    profilesSection.style.display = 'flex';
    soundSection.style.display = 'block';

    if (isVisitor) {
      homeownerSection.style.display = 'none';
      visitorSection.style.display = 'block';
    } else {
      homeownerSection.style.display = 'block';
      visitorSection.style.display = 'block';
    }

    showStoredMessages();
    connectToRoom();
  });
});
