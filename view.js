export function getElements() {
  return {
    startSection: document.getElementById('start-section'),
    startBtn: document.getElementById('start-btn'),
    startPrompt: document.getElementById('start-prompt'),
    generateBtn: document.getElementById('generate-btn'),
    printQrBtn: document.getElementById('print-qr-btn'),
    linkDisplay: document.getElementById('link-display'),
    homeownerSection: document.getElementById('homeowner-section'),
    visitorSection: document.getElementById('visitor-section'),
    hostJumpRow: document.getElementById('host-jump-row'),
    hostBackRow: document.getElementById('host-back-row'),
    soundSection: document.getElementById('sound-section'),
    homeownerStatusEl: document.getElementById('homeowner-status'),
    visitorStatusEl: document.getElementById('visitor-status'),
    messageInput: document.getElementById('message-input'),
    sendBtn: document.getElementById('send-btn'),
    waitingBtn: document.getElementById('waiting-btn'),
    ringBtn: document.getElementById('ring-btn'),
    stopRingBtn: document.getElementById('stop-ring-btn'),
    exitRoomBtn: document.getElementById('exit-room-btn'),
    enableSoundBtn: document.getElementById('enable-sound-btn'),
    uploadPhotoBtn: document.getElementById('upload-photo-btn'),
    photoInput: document.getElementById('photo-input'),
    choosePhotoBtn: document.getElementById('choose-photo-btn'),
    choosePhotoInput: document.getElementById('choose-photo-input'),
    viewPhotoBtn: document.getElementById('view-photo-btn'),
    photoStatus: document.getElementById('photo-status'),
    multiPhotoButtons: document.getElementById('multi-photo-buttons'),
    chatHistory: document.getElementById('chat-history'),
    circularBoard: document.querySelector('.circular-board')
  };
}

export function showQRCode(link) {
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

export function appendMessage(chatHistory, text, className = '') {
  const msgDiv = document.createElement('div');
  msgDiv.className = className;
  msgDiv.textContent = text;
  chatHistory.appendChild(msgDiv);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

export function renderMessage(chatHistory, message) {
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

export function setVisitorControlsEnabled(elements, enabled) {
  elements.sendBtn.disabled = !enabled;
  elements.waitingBtn.disabled = !enabled;
  elements.ringBtn.disabled = !enabled;
}

export function setSoundButtonEnabled(elements, enabled) {
  elements.enableSoundBtn.disabled = enabled;
  elements.enableSoundBtn.textContent = enabled ? 'Sound Enabled' : 'Enable Sound';
}

export function setPhotoButtonsBusy(elements, isConnected, isBusy, label = '') {
  elements.uploadPhotoBtn.disabled = isBusy || !isConnected;
  elements.choosePhotoBtn.disabled = isBusy || !isConnected;
  elements.uploadPhotoBtn.textContent = isBusy ? label : 'Take photo of where I am';
  elements.choosePhotoBtn.textContent = isBusy ? label : 'Upload existing photo';
}

export function clearPhotoInputs(elements) {
  elements.photoInput.value = '';
  elements.choosePhotoInput.value = '';
}

export function renderPhotoGallery(elements, photos, isConnected, onShowPhoto) {
  if (!elements.multiPhotoButtons) return;

  elements.multiPhotoButtons.innerHTML = '';
  const photoButtons = [];
  const hostPhoto = photos.host;
  const visitorKeys = Object.keys(photos)
    .filter((key) => key.startsWith('visitor-'))
    .sort((a, b) => {
      const aTime = new Date(photos[a]?.uploadedAt || 0).getTime();
      const bTime = new Date(photos[b]?.uploadedAt || 0).getTime();
      return aTime - bTime;
    })
    .slice(0, 4);

  if (hostPhoto && hostPhoto.uploadedAt) {
    photoButtons.push({ sender: 'host', label: 'Host photo' });
  }

  visitorKeys.forEach((key, index) => {
    photoButtons.push({ sender: key, label: `Visitor ${index + 1} photo` });
  });

  photoButtons.forEach(({ sender, label }) => {
    const button = document.createElement('button');
    button.disabled = !isConnected;
    button.textContent = label;
    button.onclick = () => onShowPhoto(sender);
    elements.multiPhotoButtons.appendChild(button);
  });
}

export function showPhotoModal(blob) {
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
  modal.onclick = (event) => {
    if (event.target === modal) cleanup();
  };
}

export function setConnectionView(elements, state, onShowPhoto) {
  if (state.isVisitor) {
    setVisitorControlsEnabled(elements, state.connected);
    state.statusEl.textContent = state.connected
      ? 'Connected - send a message when you are ready'
      : 'Connecting or waking server...';
  } else {
    state.statusEl.textContent = state.connected
      ? 'Ready - share the link or QR code'
      : 'Connecting room or waking server...';
  }

  setPhotoButtonsBusy(elements, state.connected, false);
  elements.viewPhotoBtn.style.display = 'none';
  renderPhotoGallery(elements, state.currentPhotos, state.connected, onShowPhoto);
}

export function flashRingAlert() {
  document.body.classList.remove('ring-alert');
  void document.body.offsetWidth;
  document.body.classList.add('ring-alert');
  window.setTimeout(() => {
    document.body.classList.remove('ring-alert');
  }, 1400);
}

export function stopRingAlert(elements) {
  document.body.classList.remove('ring-alert');
  elements.stopRingBtn.style.display = 'none';
}

export function showStopRingButton(elements) {
  elements.stopRingBtn.style.display = 'inline-block';
}

export function enterAppView(elements, isVisitor) {
  document.body.classList.add('app-started');
  elements.startSection.style.display = 'none';
  elements.soundSection.style.display = 'block';

  if (isVisitor) {
    elements.homeownerSection.style.display = 'none';
    elements.hostJumpRow.style.display = 'none';
    elements.hostBackRow.style.display = 'none';
  } else {
    elements.homeownerSection.style.display = 'block';
    elements.hostJumpRow.style.display = 'flex';
    elements.hostBackRow.style.display = 'flex';
  }

  elements.visitorSection.style.display = 'block';
}

export function configureInitialView(elements, state, shareableLink) {
  elements.startPrompt.textContent = state.isVisitor ? 'Join rooBell' : 'Start rooBell';
  elements.startBtn.setAttribute('aria-label', elements.startPrompt.textContent);
  document.body.classList.add(state.isVisitor ? 'visitor-mode' : 'host-mode');

  if (state.isVisitor) {
    setVisitorControlsEnabled(elements, false);
    return;
  }

  document.getElementById('visitor-greeting').textContent = 'Host reply';
  elements.ringBtn.textContent = 'Ping Visitor';
  elements.waitingBtn.style.display = 'none';
  elements.visitorStatusEl.style.display = 'none';
  elements.linkDisplay.textContent = shareableLink;
  showQRCode(shareableLink);
}

export function resizeImage(file, maxWidth, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (event) => {
      img.src = event.target.result;
    };

    img.onload = () => {
      let { width, height } = img;

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
      if (dataUrl.length > 5.5 * 1024 * 1024) {
        dataUrl = canvas.toDataURL('image/jpeg', 0.6);
      }

      resolve(dataUrl);
    };

    reader.readAsDataURL(file);
  });
}
