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

  let mySender = isVisitor ? 'visitor' : 'host';
  if (isVisitor) {
    let vId = localStorage.getItem('doorbellVisitorId');
    if (!vId) {
      vId = 'v' + Math.random().toString(36).substr(2, 8);
      localStorage.setItem('doorbellVisitorId', vId);
    }
    mySender = `visitor-${vId}`;
  }
  const roomId = roomFromUrl || localStorage.getItem('doorbellRoomId') || generateRoomId();

  localStorage.setItem('doorbellRoomId', roomId);

  const startSection = document.getElementById('start-section');
  const startBtn = document.getElementById('start-btn');
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
  const uploadPhotoBtn = document.getElementById('upload-photo-btn');
  const photoInput = document.getElementById('photo-input');
  const viewPhotoBtn = document.getElementById('view-photo-btn');
  const photoStatus = document.getElementById('photo-status');
  const multiPhotoButtons = document.getElementById('multi-photo-buttons');
  const chatHistory = document.getElementById('chat-history');
  const circularBoard = document.querySelector('.circular-board');

  if (circularBoard) {
    let enlargeTimeout = null;
    circularBoard.addEventListener('click', () => {
      if (circularBoard.classList.contains('enlarged')) {
        circularBoard.classList.remove('enlarged');
        if (enlargeTimeout) {
          clearTimeout(enlargeTimeout);
          enlargeTimeout = null;
        }
      } else {
        circularBoard.classList.add('enlarged');
        playHappyBell();
        if (enlargeTimeout) clearTimeout(enlargeTimeout);
        enlargeTimeout = setTimeout(() => {
          circularBoard.classList.remove('enlarged');
          enlargeTimeout = null;
        }, 3000);
      }
    });

    // Play sound on hover for symmetry (desktop)
    circularBoard.addEventListener('mouseenter', () => {
      playHappyBell();
    });
  }

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
  let currentPhotos = { host: [], visitor: [] }; // arrays of {id, uploadedAt}

  startBtn.textContent = isVisitor ? 'Join rooBell' : 'Start rooBell';
  document.body.classList.add(isVisitor ? 'visitor-mode' : 'host-mode');

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
    } else {
      statusEl.textContent = isConnected
        ? 'Ready - share the link or QR code'
        : 'Connecting room or waking server...';
    }

    updatePhotoUI();
  }

  function updatePhotoUI() {
    const mySide = isVisitor ? 'visitor' : 'host';
    const otherSide = isVisitor ? 'host' : 'visitor';

    // Upload is always available (once connected)
    uploadPhotoBtn.disabled = !connected;
    uploadPhotoBtn.textContent = 'Upload photo of where I am';

    if (isVisitor) {
      // Visitor sees host's photo
      const hostPhoto = currentPhotos['host'];
      if (hostPhoto && hostPhoto.uploadedAt) {
        viewPhotoBtn.style.display = 'inline-block';
        viewPhotoBtn.disabled = !connected;
        viewPhotoBtn.textContent = 'View host photo';
        photoStatus.textContent = 'Host photo available';
      } else {
        viewPhotoBtn.style.display = 'none';
        photoStatus.textContent = '';
      }
      if (multiPhotoButtons) multiPhotoButtons.innerHTML = '';
    } else {
      // Host hides single view, uses multi buttons for visitors
      viewPhotoBtn.style.display = 'none';
      renderMultiVisitorPhotos();
    }
  }

  function renderMultiVisitorPhotos() {
    if (isVisitor || !multiPhotoButtons) return;
    multiPhotoButtons.innerHTML = '';
    const visitorKeys = Object.keys(currentPhotos).filter(k => k.startsWith('visitor-'));
    visitorKeys.slice(0, 4).forEach((key, idx) => {
      const btn = document.createElement('button');
      btn.textContent = `Visitor ${idx + 1} photo`;
      btn.onclick = () => showPhoto(key);
      multiPhotoButtons.appendChild(btn);
    });
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

  async function playHappyBell() {
    if (!audioContext) return;
    if (audioContext.state === 'suspended') {
      try { await audioContext.resume(); } catch {}
    }
    if (audioContext.state !== 'running') return;
    try {
      const response = await fetch('1%20sound/3%20happybell.mp3');
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start(0);
    } catch (err) {
      console.warn('Could not play happybell sound:', err);
    }
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

  async function uploadCurrentPhoto(file) {
    if (!connected || !file) return;

    // Client-side guard for very large files
    if (file.size > 6 * 1024 * 1024) {
      alert('Photo is very large (>6MB). Please choose a smaller image (under 5MB recommended).');
      photoInput.value = '';
      return;
    }

    try {
      uploadPhotoBtn.disabled = true;
      uploadPhotoBtn.textContent = 'Processing...';

      // Resize/compress image client-side before upload (aim for good quality up to ~5MB originals)
      const resizedDataUrl = await resizeImage(file, 1600, 0.82);

      uploadPhotoBtn.textContent = 'Uploading...';

      const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: mySender, image: resizedDataUrl })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Upload failed');
      }

      photoStatus.textContent = 'Photo uploaded (expires in 3 min)';
    } catch (err) {
      alert('Photo upload failed: ' + err.message);
      photoStatus.textContent = '';
    } finally {
      uploadPhotoBtn.disabled = !connected;
      uploadPhotoBtn.textContent = 'Upload photo of where I am';
      photoInput.value = '';
    }
  }

  function resizeImage(file, maxWidth, quality) {
    return new Promise((resolve) => {
      const img = new Image();
      const reader = new FileReader();

      reader.onload = (e) => {
        img.src = e.target.result;
      };

      img.onload = () => {
        let { width, height } = img;

        // Downscale if needed
        if (width > maxWidth) {
          height = Math.round(height * (maxWidth / width));
          width = maxWidth;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        let dataUrl = canvas.toDataURL('image/jpeg', quality);

        // If still too big after first pass, reduce quality further
        if (dataUrl.length > 5.5 * 1024 * 1024) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        }

        resolve(dataUrl);
      };

      reader.readAsDataURL(file);
    });
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

      if (data.type !== 'message' && data.type !== 'ring' && 
          data.type !== 'photo' && data.type !== 'photo-removed' && data.type !== 'photo-expired') return;

      if (data.type === 'message' || data.type === 'ring') {
        if (seenMessageIds.has(data.id)) return;
        seenMessageIds.add(data.id);
        storeMessage(roomId, data);
      }

      if (data.type === 'ring') {
        handleRing(data);
      } else if (data.type === 'message') {
        renderMessage(chatHistory, data);
      } else if (data.type === 'photo') {
        currentPhotos[data.sender] = { uploadedAt: data.uploadedAt };
        updatePhotoUI();

        const mySide = isVisitor ? 'visitor' : 'host';
        if (data.sender === mySide) {
          photoStatus.textContent = 'Your photo uploaded (expires in ~3 min)';
        } else if (data.sender.startsWith('visitor-')) {
          photoStatus.textContent = 'New visitor photo available';
        } else {
          photoStatus.textContent = 'New photo available';
        }
      } else if (data.type === 'photo-removed' || data.type === 'photo-expired') {
        delete currentPhotos[data.sender];
        updatePhotoUI();
        const mySide = isVisitor ? 'visitor' : 'host';
        if (data.sender === mySide) {
          photoStatus.textContent = 'Your photo expired';
        } else {
          photoStatus.textContent = 'Photo expired';
        }
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

  async function viewOtherPhoto() {
    if (!connected) return;

    if (isVisitor) {
      // Visitor views the host's photo
      const hostInfo = currentPhotos['host'];
      if (!hostInfo) {
        alert('No photo available');
        return;
      }
      try {
        viewPhotoBtn.disabled = true;
        viewPhotoBtn.textContent = 'Loading...';
        await showPhoto('host');
      } catch (err) {
        alert('Could not load photo: ' + err.message);
      } finally {
        viewPhotoBtn.disabled = !connected;
        viewPhotoBtn.textContent = 'View host photo';
      }
    } else {
      // Host should use the multi buttons instead
      // This button is hidden for host
    }
  }

  async function showPhoto(sender) {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/photo?sender=${sender}`);
    if (!res.ok) throw new Error('Photo not available or expired');

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:9999;';
    modal.innerHTML = `
      <div style="background:white;padding:12px;border-radius:8px;max-width:90vw;max-height:90vh;">
        <img src="${url}" style="max-width:80vw;max-height:70vh;display:block;margin-bottom:12px;border-radius:4px;" />
        <button style="width:100%">Close</button>
      </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('button');
    const cleanup = () => {
      URL.revokeObjectURL(url);
      modal.remove();
    };
    closeBtn.onclick = cleanup;
    modal.onclick = (e) => { if (e.target === modal) cleanup(); };
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

  // Photo upload
  uploadPhotoBtn.addEventListener('click', () => {
    if (!connected) return;
    photoInput.click();
  });

  photoInput.addEventListener('change', () => {
    const file = photoInput.files[0];
    if (file) {
      uploadCurrentPhoto(file);
    }
  });

  viewPhotoBtn.addEventListener('click', () => {
    viewOtherPhoto();
  });

  messageInput.addEventListener('input', stopRingBecauseUserResponded);

  messageInput.addEventListener('keydown', (event) => {
    stopRingBecauseUserResponded();
    if (event.key === 'Enter') sendBtn.click();
  });

  startBtn.addEventListener('click', () => {
    enableSoundQuietly();
    startSection.style.display = 'none';
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

    // Make sure photo UI reflects current connection + any pre-existing photos
    updatePhotoUI();
  });
});
