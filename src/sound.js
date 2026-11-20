const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const STYLES = {
  arena: {bpm: 114, finalBpm: 132, bass: [55, 55, 65.406, 73.416, 55, 55, 82.407, 73.416], arp: [220, 293.665, 329.628, 440, 261.626, 329.628, 391.995, 293.665]},
  race: {bpm: 128, finalBpm: 140, bass: [55, 55, 61.735, 65.406, 49, 49, 55, 58.27], arp: [440, 523.251, 659.255, 783.991, 392, 493.883, 587.33, 739.989]},
  meltdown: {bpm: 120, finalBpm: 136, bass: [46.249, 46.249, 51.913, 46.249, 43.654, 43.654, 41.203, 43.654], arp: [185, 220, 277.183, 369.994, 174.614, 220, 261.626, 349.228]},
};

/** Offline Web Audio soundscape. Initialization is deferred to a user gesture. */
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicEnabled = true;
    this.musicVolume = 1;
    this.sfxVolume = 1;
    this.playing = false;
    this.voices = new Set();
    this.seed = 0x741ae936;
    this.nextMusicAt = 0;
    this.musicStep = 0;
    this.lastCollisionAt = -99;
    this.lastHitAt = -99;
    this.lastTick = -1;
    this.lastTickAt = -99;
    this.lastKnockoutAt = -99;
    this.rpm = 42;
    this.available = true;
    this.style = STYLES.arena;
  }

  random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  init() {
    if (!this.available) return false;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume()?.catch?.(() => {});
      return true;
    }
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) { this.available = false; return false; }
    try {
      const ctx = this.ctx = new Context();
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.62;
      const compressor = this.compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 18;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.16;
      this.master.connect(compressor); compressor.connect(ctx.destination);
      this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.8 * this.sfxVolume; this.sfxBus.connect(this.master);
      this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0; this.musicBus.connect(this.master);

      // Shared procedural noise; no sample downloads and no gameplay RNG draws.
      this.noiseBuffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 2), ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = this.random() * 2 - 1;

      this.engineFilter = ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass'; this.engineFilter.frequency.value = 720; this.engineFilter.Q.value = 1.1;
      // Gentle soft-clipping saturator for punchy rally/V6 engine warmth.
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = i * 2 / 255 - 1; curve[i] = Math.tanh(x * 2.1); }
      shaper.curve = curve; shaper.oversample = '2x';
      this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0;
      this.engineFilter.connect(shaper); shaper.connect(this.engineGain); this.engineGain.connect(this.sfxBus);
      this.engineLow = this._continuousOscillator('sawtooth', 44, 0.42, this.engineFilter);
      this.engineMid = this._continuousOscillator('triangle', 66, 0.48, this.engineFilter);
      this.engineHigh = this._continuousOscillator('sawtooth', 88, 0.18, this.engineFilter);
      this.engineSub = this._continuousOscillator('sine', 22, 0.52, this.engineFilter);
      this.tire = this._continuousNoise('bandpass', 1650, 0.8);
      this.wind = this._continuousNoise('lowpass', 1100, 0.4);
      this.nextMusicAt = ctx.currentTime + 0.05;
      if (ctx.state === 'suspended') ctx.resume()?.catch?.(() => {});
      return true;
    } catch {
      this.ctx?.close?.()?.catch?.(() => {});
      this.ctx = null; this.available = false;
      return false;
    }
  }

  _continuousOscillator(type, frequency, volume, destination) {
    const oscillator = this.ctx.createOscillator(), gain = this.ctx.createGain();
    oscillator.type = type; oscillator.frequency.value = frequency; gain.gain.value = volume;
    oscillator.connect(gain); gain.connect(destination); oscillator.start();
    return oscillator;
  }

  _continuousNoise(type, frequency, q) {
    const source = this.ctx.createBufferSource(), filter = this.ctx.createBiquadFilter(), gain = this.ctx.createGain();
    source.buffer = this.noiseBuffer; source.loop = true;
    filter.type = type; filter.frequency.value = frequency; filter.Q.value = q;
    gain.gain.value = 0; source.connect(filter); filter.connect(gain); gain.connect(this.sfxBus); source.start();
    return {source, filter, gain};
  }

  _ready() { return !!this.ctx && !this.muted && this.ctx.state !== 'closed'; }

  _finishVoice(source, nodes) {
    this.voices.add(source);
    source.onended = () => {
      this.voices.delete(source);
      for (const node of nodes) { try { node.disconnect(); } catch {} }
    };
  }

  _output(gain, pan, destination, nodes) {
    if (Math.abs(pan) > 0.01 && this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner(); panner.pan.value = clamp(pan, -1, 1);
      gain.connect(panner); panner.connect(destination); nodes.push(panner);
    } else gain.connect(destination);
  }

  _osc(frequency, duration, type, volume, endFrequency = frequency, pan = 0, when = null, destination = null) {
    if (!this._ready() || this.voices.size >= 64) return;
    const ctx = this.ctx, at = Math.max(ctx.currentTime, when ?? ctx.currentTime), life = Math.max(0.025, duration);
    const oscillator = ctx.createOscillator(), gain = ctx.createGain();
    oscillator.type = type; oscillator.frequency.setValueAtTime(Math.max(20, frequency), at);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), at + life);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(clamp(volume, 0.0001, 0.4), at + Math.min(0.006, life * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + life);
    oscillator.connect(gain);
    const nodes = [oscillator, gain];
    this._output(gain, pan, destination || this.sfxBus, nodes);
    this._finishVoice(oscillator, nodes);
    oscillator.start(at); oscillator.stop(at + life + 0.02);
  }

  _noise(duration, volume, frequency, endFrequency = frequency, type = 'bandpass', pan = 0, when = null, destination = null) {
    if (!this._ready() || this.voices.size >= 64) return;
    const ctx = this.ctx, at = Math.max(ctx.currentTime, when ?? ctx.currentTime), life = clamp(duration, 0.025, 1.7);
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = type; filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(Math.max(40, frequency), at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFrequency), at + life);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(clamp(volume, 0.0001, 0.4), at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + life);
    source.connect(filter); filter.connect(gain);
    const nodes = [source, filter, gain];
    this._output(gain, pan, destination || this.sfxBus, nodes);
    this._finishVoice(source, nodes);
    source.start(at, this.random() * 0.2); source.stop(at + life + 0.02);
  }

  tone(frequency, duration = 0.12, type = 'sine', volume = 0.07, end = 70) {
    this._osc(frequency, duration, type, volume, end);
  }

  setMuted(value) {
    this.muted = !!value;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.62, this.ctx.currentTime, 0.025);
    return this.muted;
  }

  setLevels({musicVolume,sfxVolume}) {
    if(Number.isFinite(sfxVolume)){
      this.sfxVolume = clamp(sfxVolume,0,1);
      if(this.ctx)this.sfxBus.gain.setTargetAtTime(.8*this.sfxVolume,this.ctx.currentTime,.03);
    }
    if(Number.isFinite(musicVolume)){
      this.musicVolume = clamp(musicVolume,0,1);
      this.setMusic(this.musicEnabled);
    }
  }

  setMusic(value) {
    this.musicEnabled = !!value;
    if (this.ctx) {
      this.musicBus.gain.setTargetAtTime(this.musicEnabled && this.playing ? 0.2*this.musicVolume : 0, this.ctx.currentTime, 0.15);
      this.nextMusicAt = this.ctx.currentTime + 0.05;
    }
    return this.musicEnabled;
  }

  _music(finalRound) {
    const ctx = this.ctx;
    if (!this._ready() || !this.musicEnabled || !this.playing) { this.nextMusicAt = ctx.currentTime + 0.05; return; }
    if (this.nextMusicAt < ctx.currentTime - 0.1) this.nextMusicAt = ctx.currentTime + 0.025;
    const style = this.style || STYLES.arena;
    const interval = 60 / (finalRound ? style.finalBpm : style.bpm) / 2;
    let scheduled = 0;
    while (this.nextMusicAt < ctx.currentTime + 0.08 && scheduled++ < 3) {
      const step = this.musicStep++ % 32, at = this.nextMusicAt, bus = this.musicBus;
      if (step % 4 === 0) this._osc(115, 0.17, 'sine', 0.29, 43, 0, at, bus);
      if (step % 4 === 2) {
        this._noise(0.1, 0.11, 1800, 750, 'bandpass', 0.12, at, bus);
        this._osc(170, 0.09, 'triangle', 0.065, 85, -0.08, at, bus);
      }
      this._noise(step % 2 ? 0.04 : 0.025, step % 2 ? 0.035 : 0.025, 6500, 4400, 'highpass', step % 2 ? -0.3 : 0.3, at, bus);
      if (step % 2 === 0) {
        const bass = style.bass[Math.floor(step / 4)];
        this._osc(bass, interval * 1.45, 'triangle', 0.16, bass * 0.996, 0, at, bus);
      }
      if (step % 2 === 1) {
        const note = style.arp[Math.floor(step / 4)];
        this._osc(note, 0.15, 'sine', 0.045, note, step % 4 === 1 ? -0.22 : 0.22, at, bus);
      }
      this.nextMusicAt += interval;
    }
  }

  update(state = {}, dt = 1 / 60) {
    if (!this.ctx) return;
    // Retain compatibility while main migrates from update(speed).
    if (typeof state === 'number') state = {speed: state, throttle: state ? 1 : 0, playing: state !== 0, grounded: true};
    const ctx = this.ctx, now = ctx.currentTime;
    const speed = Math.abs(Number(state.speed) || 0), throttle = Math.abs(Number(state.throttle) || 0);
    const playing = !!state.playing, falling = !!state.falling, revving = !!state.revving;
    const gearSaw = speed > 6 ? ((speed % 9) / 9) * 10 : 0;
    const targetRPM = 42 + Math.min(speed, 35) * 3.1 + gearSaw + throttle * 16 + (!state.grounded ? 15 : 0) + (state.boost ? 24 : 0);
    this.rpm += (targetRPM - this.rpm) * (1 - Math.exp(-Math.max(0, dt) * 9.5));
    this.engineLow.frequency.setTargetAtTime(this.rpm, now, 0.065);
    this.engineMid.frequency.setTargetAtTime(this.rpm * 1.498, now, 0.065);
    this.engineHigh.frequency.setTargetAtTime(this.rpm * 2.02, now, 0.065);
    this.engineSub.frequency.setTargetAtTime(this.rpm * 0.5, now, 0.08);
    this.engineFilter.frequency.setTargetAtTime(380 + this.rpm * 4.2 + throttle * 620 + (state.boost ? 480 : 0), now, 0.085);
    this.engineGain.gain.setTargetAtTime((playing || revving) && !falling ? 0.032 + Math.min(speed, 26) * 0.00085 + throttle * 0.015 : 0, now, 0.07);
    const braking = typeof state.brake === 'number' ? state.brake : state.brake ? 1 : 0;
    const slip = Math.max(braking, clamp(Math.abs(Number(state.lateral) || 0) / 8, 0, 1));
    this.tire.gain.gain.setTargetAtTime(playing && state.grounded && speed > 3 ? Math.min(0.06, slip * speed * 0.0024) : 0, now, 0.08);
    this.tire.filter.frequency.setTargetAtTime(1150 + speed * 46, now, 0.12);
    this.wind.gain.gain.setTargetAtTime(playing ? (falling ? 0.07 : Math.min(0.026, speed * 0.0007 + (state.boost ? 0.012 : 0))) : 0, now, 0.12);
    this.wind.filter.frequency.setTargetAtTime(falling ? 1700 : 550 + speed * 26, now, 0.15);
    const musical = playing || revving;
    if (musical !== this.playing) {
      this.playing = musical;
      this.nextMusicAt = now + 0.05;
      this.musicBus.gain.setTargetAtTime(musical && this.musicEnabled ? 0.2*this.musicVolume : 0, now, 0.15);
    }
    this._music(!!state.finalRound);
  }

  hit(power = 1, pan = 0) {
    if (!this._ready() || this.ctx.currentTime - this.lastHitAt < 0.025) return;
    this.lastHitAt = this.ctx.currentTime;
    const amount = clamp(power, 0.45, 2.4);
    // Heavy bass punch + crisp metallic fender crunch + coiled spring twang.
    this._osc(135, 0.22, 'triangle', 0.24 * amount, 34, pan);
    this._osc(310, 0.14, 'sawtooth', 0.075 * amount, 110, pan);
    this._osc(760, 0.11, 'triangle', 0.075 * amount, 240, pan);
    this._osc(1380, 0.075, 'sine', 0.055 * amount, 780, pan);
    this._noise(0.14, 0.2 * amount, 2600, 520, 'bandpass', pan);
  }

  collision(strength = 1, pan = 0) {
    if (!this._ready() || this.ctx.currentTime - this.lastCollisionAt < 0.05) return;
    this.lastCollisionAt = this.ctx.currentTime;
    const amount = clamp(strength, 0.18, 2.2);
    this._osc(460 + amount * 145, 0.15, 'triangle', 0.068 * amount, 160, pan);
    this._osc(1280 + amount * 210, 0.08, 'sine', 0.036 * amount, 740, pan);
    this._noise(0.1 + amount * 0.028, 0.12 * amount, 1950, 520, 'bandpass', pan);
    if (amount > 0.75) this._osc(98, 0.14, 'sine', 0.09 * amount, 40, pan);
  }

  landing(strength = 1, pan = 0) {
    const amount = clamp(strength, 0.2, 2);
    this._osc(85, 0.16, 'sine', 0.08 * amount, 36, pan);
    this._noise(0.13, 0.07 * amount, 760, 190, 'lowpass', pan);
  }

  pickup() {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    this._osc(523.25, 0.13, 'sine', 0.095, 523.25, -0.15, t);
    this._osc(659.25, 0.13, 'sine', 0.095, 659.25, 0, t + 0.07);
    this._osc(783.99, 0.23, 'triangle', 0.08, 1046.5, 0.15, t + 0.14);
  }

  fall() {
    this._noise(0.85, 0.11, 2400, 160, 'bandpass');
    this._osc(185, 0.65, 'sine', 0.055, 34);
  }

  tick(lastSeconds) {
    if (!this._ready()) return;
    const second = Math.ceil(Number(lastSeconds));
    if (second > 10 || second <= 0) { this.lastTick = -1; return; }
    if (second === this.lastTick || this.ctx.currentTime - this.lastTickAt < 0.15) return;
    this.lastTick = second; this.lastTickAt = this.ctx.currentTime;
    this._osc(68,.15,'sine',second<=3?.14:.08,34,0,this.ctx.currentTime);
    this._osc(61,.11,'sine',.055,32,0,this.ctx.currentTime+.16);
    this._osc(second <= 3 ? 1046.5 : 784, second <= 3 ? 0.12 : 0.055, 'sine', second <= 3 ? 0.095 : 0.045, second <= 3 ? 880 : 740);
  }

  knockout(combo = 1) {
    if (!this._ready() || this.ctx.currentTime - this.lastKnockoutAt < 0.12) return;
    this.lastKnockoutAt = this.ctx.currentTime;
    const t = this.ctx.currentTime, transpose = 1 + Math.min(3, Math.max(0, combo - 1)) * 0.12;
    this._osc(523.25 * transpose, 0.14, 'triangle', 0.12, 523.25 * transpose, -0.2, t);
    this._osc(659.25 * transpose, 0.16, 'triangle', 0.12, 659.25 * transpose, 0, t + 0.08);
    this._osc(783.99 * transpose, 0.3, 'triangle', 0.13, 1046.5 * transpose, 0.2, t + 0.16);
    this._osc(110, 0.22, 'sine', 0.12, 44, 0, t);
  }

  setStyle(name) { this.style = STYLES[name] || STYLES.arena; this.musicStep = 0; }

  countdown(value) {
    if (!this._ready()) return;
    if (value === 'GO') { this._osc(988, 0.5, 'square', 0.07, 988); this._osc(1318.5, 0.5, 'triangle', 0.06, 1318.5); this._osc(110, 0.4, 'sine', 0.14, 55); }
    else this._osc(659.25, 0.16, 'square', 0.06, 659.25);
  }

  boost() {
    if (!this._ready()) return;
    this._noise(0.55, 0.12, 600, 3800, 'bandpass');
    this._osc(140, 0.45, 'sawtooth', 0.035, 420);
  }

  finalLap() {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this._osc(f, 0.18, 'square', 0.045, f, 0, t + i * 0.09));
  }

  fanfare(win = false) {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    const notes = win ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : [392, 493.88, 587.33, 783.99];
    notes.forEach((f, i) => { this._osc(f, 0.32, 'triangle', 0.08, f, (i % 2 ? 0.2 : -0.2), t + i * 0.12); this._osc(f / 2, 0.32, 'square', 0.025, f / 2, 0, t + i * 0.12); });
    this._osc(110, 0.6, 'sine', 0.12, 55, 0, t);
  }
}
