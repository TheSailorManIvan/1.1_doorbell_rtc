import {
  createFreshStoredRoom,
  createInitialState,
  getShareableLink,
  getStoredMessages,
  isVisitorSender,
  storeMessage
} from './model.js';
import {
  createRoomEventSource,
  fetchPhoto,
  sendKeepAlive,
  sendRoomEvent,
  uploadPhoto
} from './api.js';
import { createDoorbellAudio } from './audio.js';
import {
  clearPhotoInputs,
  configureInitialView,
  enterAppView,
  flashRingAlert,
  getElements,
  renderMessage,
  renderPhotoGallery,
  resizeImage,
  setConnectionView,
  setPhotoButtonsBusy,
  setSoundButtonEnabled,
  showPhotoModal,
  showQRCode,
  showStopRingButton,
  stopRingAlert
} from './view.js';

document.addEventListener('DOMContentLoaded', () => {
  const state = createInitialState();
  const elements = getElements();
  const audio = createDoorbellAudio();
  const statusEl = state.isVisitor ? elements.visitorStatusEl : elements.homeownerStatusEl;
  const KEEP_ALIVE_INTERVAL_MS = 4 * 60 * 1000;
  const HEADER_ENLARGE_DURATION_MS = 2000;

  state.statusEl = statusEl;
  configureInitialView(elements, state, getShareableLink(state.roomId));

  function updateConnection(isConnected) {
    state.connected = isConnected;
    setConnectionView(elements, state, showPhoto);
  }

  function markVisitorPresent(data) {
    if (state.isVisitor || !data || !isVisitorSender(data.sender)) return;
    document.body.classList.add('visitor-present');
  }

  function updatePhotoUI() {
    setPhotoButtonsBusy(elements, state.connected, false);
    elements.viewPhotoBtn.style.display = 'none';
    renderPhotoGallery(elements, state.currentPhotos, state.connected, showPhoto);
  }

  async function keepHostAwake(force = false) {
    if (state.isVisitor) return;

    const now = Date.now();
    if (!force && now - state.lastKeepAliveAt < 30_000) return;
    state.lastKeepAliveAt = now;

    try {
      await sendKeepAlive(state.roomId);
    } catch {
      if (!state.connected) {
        statusEl.textContent = 'Reconnecting room or waking server...';
      }
    }
  }

  function startHostKeepAlive() {
    if (state.isVisitor || state.keepAliveInterval) return;

    keepHostAwake(true);
    state.keepAliveInterval = window.setInterval(keepHostAwake, KEEP_ALIVE_INTERVAL_MS);

    window.addEventListener('focus', () => keepHostAwake(true));
    window.addEventListener('online', () => keepHostAwake(true));
    window.addEventListener('pageshow', () => keepHostAwake(true));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) keepHostAwake(true);
    });
  }

  async function enableSound() {
    const enabled = await audio.enableSound();
    if (!enabled) {
      elements.enableSoundBtn.textContent = 'Sound Unavailable';
      elements.enableSoundBtn.disabled = true;
      return;
    }
    setSoundButtonEnabled(elements, true);
  }

  function enableSoundQuietly() {
    audio.enableSoundQuietly()
      .then((enabled) => {
        if (enabled) {
          elements.enableSoundBtn.disabled = true;
          elements.enableSoundBtn.textContent = 'Sound Ready';
        }
      })
      .catch(() => {});
  }

  function stopRingBecauseUserResponded() {
    audio.stopRingSequence();
    stopRingAlert(elements);
  }

  function playRingSequence(frequencies, options = {}) {
    const played = audio.playRingSequence(frequencies, options, flashRingAlert);
    if (options.repeatForMs && options.repeatForMs > (options.intervalMs || 3000)) {
      showStopRingButton(elements);
    }
    return played;
  }

  function handleRing(data, fromStoredHistory = false) {
    const isOwnRing = data.sender === state.eventSender;
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
    renderMessage(elements.chatHistory, data);

    if (isOwnRing || fromStoredHistory) return;

    flashRingAlert();
    const played = isWaitingRing
      ? playRingSequence([880, 660], { repeatForMs: 0, toneDuration: 0.18, gap: 0.05 })
      : data.sender === 'host'
        ? playRingSequence([784, 988, 784], { repeatForMs: 20_000, intervalMs: 2500, toneDuration: 0.2, gap: 0.06 })
        : playRingSequence([659, 523, 659, 523], { repeatForMs: 20_000, intervalMs: 3000, toneDuration: 0.22, gap: 0.07 });

    if (!played) {
      elements.enableSoundBtn.textContent = 'Enable Sound for Ring';
    }
  }

  function showStoredMessages() {
    for (const message of getStoredMessages(state.roomId)) {
      if (state.seenMessageIds.has(message.id)) continue;
      state.seenMessageIds.add(message.id);

      if (message.type === 'ring') {
        handleRing(message, true);
      } else {
        renderMessage(elements.chatHistory, message);
      }
    }
  }

  function handlePresence(data) {
    if (!state.isVisitor && data.sender === 'visitor') {
      markVisitorPresent(data);
      statusEl.textContent = 'Visitor is connected';
    }

    if (state.isVisitor && data.sender === 'host') {
      statusEl.textContent = 'Host is waiting';
      const now = Date.now();
      if (now - state.lastPresenceReplyAt > 2000) {
        state.lastPresenceReplyAt = now;
        sendRoomEvent(state.roomId, {
          sender: 'visitor',
          type: 'presence'
        }).catch(() => {});
      }
    }
  }

  function handleRoomEvent(data) {
    if (data.type === 'presence') {
      handlePresence(data);
      return;
    }

    if (
      data.type !== 'message' &&
      data.type !== 'ring' &&
      data.type !== 'photo' &&
      data.type !== 'photo-removed' &&
      data.type !== 'photo-expired'
    ) {
      return;
    }

    if (data.type === 'message' || data.type === 'ring') {
      if (state.seenMessageIds.has(data.id)) return;
      state.seenMessageIds.add(data.id);
      storeMessage(state.roomId, data);
    }

    if (data.type === 'ring') {
      markVisitorPresent(data);
      handleRing(data);
      return;
    }

    if (data.type === 'message') {
      markVisitorPresent(data);
      renderMessage(elements.chatHistory, data);
      return;
    }

    if (data.type === 'photo') {
      markVisitorPresent(data);
      state.currentPhotos[data.sender] = { uploadedAt: data.uploadedAt };
      updatePhotoUI();

      if (data.sender === state.photoSender) {
        elements.photoStatus.textContent = 'Your photo uploaded (expires in ~3 min)';
      } else if (data.sender.startsWith('visitor-')) {
        elements.photoStatus.textContent = 'Visitor photo available';
      } else {
        elements.photoStatus.textContent = 'Host photo available';
      }
      return;
    }

    delete state.currentPhotos[data.sender];
    updatePhotoUI();
    elements.photoStatus.textContent = data.sender === state.photoSender
      ? 'Your photo expired'
      : 'Photo expired';
  }

  function connectToRoom() {
    if (state.eventSource) state.eventSource.close();

    updateConnection(false);
    state.eventSource = createRoomEventSource(state.roomId);

    state.eventSource.addEventListener('open', () => {
      updateConnection(true);
      sendRoomEvent(state.roomId, {
        sender: state.eventSender,
        type: 'presence'
      }).catch(() => {});
    });

    state.eventSource.addEventListener('message', (event) => {
      handleRoomEvent(JSON.parse(event.data));
    });

    state.eventSource.addEventListener('error', () => {
      updateConnection(false);
    });
  }

  async function sendMessage(text) {
    if (!state.connected) {
      alert('Not connected yet - please wait');
      return;
    }

    await sendRoomEvent(state.roomId, {
      sender: state.eventSender,
      type: 'message',
      text
    });
  }

  async function sendRing(variant = 'doorbell') {
    const now = Date.now();
    if (now < state.ringCooldownUntil) return;

    if (!state.connected) {
      alert('Not connected yet - please wait');
      return;
    }

    const cooldownMs = variant === 'waiting' ? 3000 : 20_000;
    state.ringCooldownUntil = now + cooldownMs;
    elements.ringBtn.disabled = true;
    elements.waitingBtn.disabled = true;

    try {
      await sendRoomEvent(state.roomId, {
        sender: state.eventSender,
        type: 'ring',
        variant
      });
    } finally {
      window.setTimeout(() => {
        if (state.connected) {
          elements.ringBtn.disabled = false;
          elements.waitingBtn.disabled = false;
        }
      }, cooldownMs);
    }
  }

  async function showPhoto(sender) {
    const blob = await fetchPhoto(state.roomId, sender);
    showPhotoModal(blob);
  }

  async function uploadCurrentPhoto(file) {
    if (!state.connected || !file) return;

    if (file.size > 6 * 1024 * 1024) {
      alert('Photo is very large (>6MB). Please choose a smaller image (under 5MB recommended).');
      clearPhotoInputs(elements);
      return;
    }

    try {
      setPhotoButtonsBusy(elements, state.connected, true, 'Processing...');
      const resizedDataUrl = await resizeImage(file, 1600, 0.82);

      setPhotoButtonsBusy(elements, state.connected, true, 'Uploading...');
      await uploadPhoto(state.roomId, state.photoSender, resizedDataUrl);
      elements.photoStatus.textContent = 'Photo uploaded (expires in 3 min)';
    } catch (error) {
      alert(`Photo upload failed: ${error.message}`);
      elements.photoStatus.textContent = '';
    } finally {
      setPhotoButtonsBusy(elements, state.connected, false);
      clearPhotoInputs(elements);
    }
  }

  function generateNewHostRoom() {
    const nextRoomId = createFreshStoredRoom();
    const nextLink = getShareableLink(nextRoomId);
    elements.linkDisplay.textContent = nextLink;
    showQRCode(nextLink);

    navigator.clipboard.writeText(nextLink)
      .then(() => {
        alert('Link copied to clipboard.');
      })
      .catch(() => {
        alert(`Copy this link manually:\n${nextLink}`);
      })
      .finally(() => {
        window.location.href = window.location.pathname;
      });
  }

  function exitCurrentRoom() {
    const message = state.isVisitor
      ? 'Exit this visitor room and create your own rooBell room?'
      : 'Exit this host room and create a fresh rooBell room?';

    if (!window.confirm(message)) return;

    stopRingBecauseUserResponded();
    if (state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
    }

    createFreshStoredRoom();
    window.location.href = window.location.pathname;
  }

  function handleStopRingControl(event) {
    event.preventDefault();
    event.stopPropagation();
    stopRingBecauseUserResponded();
  }

  function setupHeaderLogo() {
    if (!elements.circularBoard) return;

    let enlargeTimeout = null;
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    function clearTouchTransform() {
      if (!isTouchDevice) return;

      elements.circularBoard.style.transform = 'scale(1)';
      setTimeout(() => {
        if (!elements.circularBoard.classList.contains('enlarged')) {
          elements.circularBoard.style.transform = '';
        }
      }, 50);
    }

    elements.circularBoard.addEventListener('click', () => {
      if (elements.circularBoard.classList.contains('enlarged')) {
        elements.circularBoard.classList.remove('enlarged');
        if (enlargeTimeout) {
          clearTimeout(enlargeTimeout);
          enlargeTimeout = null;
        }
        clearTouchTransform();
        return;
      }

      elements.circularBoard.classList.add('enlarged');
      audio.playHappyBell();
      if (enlargeTimeout) clearTimeout(enlargeTimeout);
      enlargeTimeout = setTimeout(() => {
        elements.circularBoard.classList.remove('enlarged');
        enlargeTimeout = null;
        clearTouchTransform();
      }, HEADER_ENLARGE_DURATION_MS);
    });

    if (!isTouchDevice) {
      elements.circularBoard.addEventListener('mouseenter', () => {
        audio.playHappyBell();
      });
    }
  }

  function enterApp() {
    enterAppView(elements, state.isVisitor);
    showStoredMessages();
    connectToRoom();
    startHostKeepAlive();
    updatePhotoUI();
  }

  setupHeaderLogo();

  if (!state.isVisitor) {
    elements.generateBtn.addEventListener('click', generateNewHostRoom);
  }

  elements.sendBtn.addEventListener('click', () => {
    const text = elements.messageInput.value.trim();
    if (!text) return;

    sendMessage(text)
      .then(() => {
        elements.messageInput.value = '';
      })
      .catch(() => {
        alert('Could not send the message. Check that the server is still running.');
      });
  });

  elements.waitingBtn.addEventListener('click', () => {
    Promise.all([
      sendMessage("I'm waiting at the door!"),
      sendRing('waiting')
    ]).catch(() => {
      alert('Could not send the waiting message.');
    });
  });

  elements.ringBtn.addEventListener('click', () => {
    sendRing().catch(() => {
      alert('Could not send the ring.');
    });
  });

  elements.exitRoomBtn.addEventListener('click', exitCurrentRoom);

  elements.stopRingBtn.addEventListener('pointerdown', handleStopRingControl);
  elements.stopRingBtn.addEventListener('touchstart', handleStopRingControl);
  elements.stopRingBtn.addEventListener('click', handleStopRingControl);

  elements.enableSoundBtn.addEventListener('click', () => {
    enableSound().catch(() => {
      elements.enableSoundBtn.textContent = 'Sound Blocked';
    });
  });

  elements.printQrBtn.addEventListener('click', () => {
    window.print();
  });

  elements.uploadPhotoBtn.addEventListener('click', () => {
    if (state.connected) elements.photoInput.click();
  });

  elements.choosePhotoBtn.addEventListener('click', () => {
    if (state.connected) elements.choosePhotoInput.click();
  });

  elements.photoInput.addEventListener('change', () => {
    const file = elements.photoInput.files[0];
    if (file) uploadCurrentPhoto(file);
  });

  elements.choosePhotoInput.addEventListener('change', () => {
    const file = elements.choosePhotoInput.files[0];
    if (file) uploadCurrentPhoto(file);
  });

  elements.messageInput.addEventListener('input', stopRingBecauseUserResponded);

  elements.messageInput.addEventListener('keydown', (event) => {
    stopRingBecauseUserResponded();
    if (event.key === 'Enter') elements.sendBtn.click();
  });

  elements.startBtn.addEventListener('click', () => {
    if (elements.startSection.classList.contains('is-starting')) return;

    enableSoundQuietly();
    elements.startSection.classList.add('is-starting');
    window.setTimeout(enterApp, 220);
  });
});
