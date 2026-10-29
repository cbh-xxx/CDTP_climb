let audio: AudioContext | null = null;
export function unlockSound() {
  try { audio ??= new AudioContext(); if (audio.state === 'suspended') void audio.resume().catch(() => undefined); }
  catch { /* Browser audio restrictions do not affect task state. */ }
}
export function playShortTone() {
  if (!audio || audio.state !== 'running') return;
  try {
    const oscillator = audio.createOscillator(); const gain = audio.createGain();
    oscillator.frequency.value = 660; oscillator.connect(gain); gain.connect(audio.destination);
    gain.gain.setValueAtTime(0.08, audio.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.22);
    oscillator.start(); oscillator.stop(audio.currentTime + 0.24);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  } catch { /* A missed tone never changes business state. */ }
}
