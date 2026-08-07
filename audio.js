export function createDoorbellAudio() {
  let audioContext = null;
  let activeRingInterval = null;
  let activeRingTimeout = null;
  let soundWasEnabled = false;
  let lastBellPlay = 0;
  const activeOscillators = new Set();

  async function enableSound() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return false;

    audioContext = audioContext || new AudioContext();

    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    playTone([660], 0.06, 0.03);
    soundWasEnabled = true;
    return true;
  }

  function enableSoundQuietly() {
    if (soundWasEnabled) return Promise.resolve(true);
    return enableSound().catch(() => false);
  }

  function playTone(frequencies, duration = 0.18, gap = 0.08, peakGain = 0.18, waveform = 'sine') {
    if (!audioContext || audioContext.state !== 'running') return false;

    const now = audioContext.currentTime;
    frequencies.forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const start = now + index * (duration + gap);
      const end = start + duration;

      oscillator.type = waveform;
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peakGain, start + 0.02);
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
    const now = Date.now();
    if (now - lastBellPlay < 300) return;
    lastBellPlay = now;

    if (!audioContext) return;
    if (audioContext.state === 'suspended') {
      try {
        await audioContext.resume();
      } catch {}
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
    } catch (error) {
      console.warn('Could not play happybell sound:', error);
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
      } catch {}
    }

    activeOscillators.clear();
  }

  function playRingSequence(frequencies, options = {}, onRepeat = () => {}) {
    const repeatForMs = options.repeatForMs || 0;
    const intervalMs = options.intervalMs || 3000;
    const toneDuration = options.toneDuration || 0.16;
    const gap = options.gap || 0.08;
    const peakGain = options.peakGain || 0.85;
    const waveform = options.waveform || 'square';

    stopRingSequence();
    const played = playTone(frequencies, toneDuration, gap, peakGain, waveform);

    if (repeatForMs <= intervalMs) return played;

    activeRingInterval = window.setInterval(() => {
      playTone(frequencies, toneDuration, gap, peakGain, waveform);
      onRepeat();
    }, intervalMs);

    activeRingTimeout = window.setTimeout(stopRingSequence, repeatForMs);

    return played;
  }

  return {
    enableSound,
    enableSoundQuietly,
    playHappyBell,
    playRingSequence,
    stopRingSequence
  };
}
