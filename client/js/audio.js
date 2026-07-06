/* Web Audio API — fully procedural sounds, spatial 3D via PannerNode. */
const AudioSys = {
  ctx:null, master:null, sfx:null, music:null, listener:null, combatLevel:0, musicGain:null,

  init() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain(); this.sfx.connect(this.master);
    this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.12; this.musicGain.connect(this.master);
    document.addEventListener('click', () => this.ctx.resume(), { once:true });
    this.startMusic();
  },
  setVolume(v) { if (this.master) this.master.gain.value = v; },

  updateListener(pos, yaw) {
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
      l.forwardX.value = -Math.sin(yaw); l.forwardY.value = 0; l.forwardZ.value = -Math.cos(yaw);
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else { l.setPosition(pos.x,pos.y,pos.z); l.setOrientation(-Math.sin(yaw),0,-Math.cos(yaw),0,1,0); }
  },

  _panner(pos) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 3; p.maxDistance = 120; p.rolloffFactor = 1.2;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y, pos.z);
    p.connect(this.sfx); return p;
  },
  _noise(dur) {
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random()*2-1) * (1 - i/d.length);
    const src = this.ctx.createBufferSource(); src.buffer = buf; return src;
  },
  _burst(dest, { dur=0.15, freq=800, gain=0.5, type='lowpass' }) {
    const n = this._noise(dur);
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    n.connect(f); f.connect(g); g.connect(dest); n.start();
  },
  _tone(dest, { freq=440, dur=0.1, gain=0.2, type='sine', slide }) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, this.ctx.currentTime + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    o.connect(g); g.connect(dest); o.start(); o.stop(this.ctx.currentTime + dur);
  },

  gunshot(weapon, pos, suppressed) {
    if (!this.ctx) return;
    const dest = pos ? this._panner(pos) : this.sfx;
    const heavy = ['ak47','scarh','deagle','bolt','semisnp','pump','autosg','rocket'].includes(weapon);
    if (suppressed) this._burst(dest, { dur:0.08, freq:1500, gain:0.15 });
    else {
      this._burst(dest, { dur:heavy?0.22:0.12, freq:heavy?450:900, gain:heavy?0.65:0.4 });
      this._tone(dest, { freq:heavy?90:150, dur:0.1, gain:0.3, type:'square', slide:40 });
    }
    if (!pos) this.combatLevel = 1;
  },
  reloadSound(pos) { const d = pos ? this._panner(pos) : this.sfx;
    this._tone(d,{freq:900,dur:0.05,gain:0.15,type:'square'});
    setTimeout(()=>this._tone(d,{freq:600,dur:0.06,gain:0.15,type:'square'}),300);
    setTimeout(()=>this._tone(d,{freq:1100,dur:0.05,gain:0.18,type:'square'}),800); },
  emptyClick() { this._tone(this.sfx,{freq:1400,dur:0.03,gain:0.15,type:'square'}); },
  footstep(pos, surface) {
    const d = pos ? this._panner(pos) : this.sfx;
    const f = surface === 'metal' ? 700 : surface === 'wood' ? 420 : 260;
    this._burst(d, { dur:0.07, freq:f, gain:0.12 });
  },
  hitSound(head) { this._tone(this.sfx, { freq: head?1200:800, dur:0.07, gain:0.3, type:'square', slide:head?1600:600 }); },
  killSound() { this._tone(this.sfx,{freq:500,dur:0.1,gain:0.3,type:'square'}); setTimeout(()=>this._tone(this.sfx,{freq:750,dur:0.15,gain:0.3,type:'square'}),90); },
  damageSound() { this._burst(this.sfx, { dur:0.12, freq:300, gain:0.4 }); },
  explosion(pos) {
    const d = pos ? this._panner(pos) : this.sfx;
    this._burst(d, { dur:0.8, freq:200, gain:1.0 });
    this._tone(d, { freq:60, dur:0.6, gain:0.6, type:'sine', slide:25 });
    this.combatLevel = 1;
  },
  flashRing() { // tinnitus
    this._tone(this.sfx, { freq:3200, dur:2.5, gain:0.25, type:'sine' });
  },
  pinPull() { this._tone(this.sfx,{freq:2000,dur:0.04,gain:0.2,type:'square'}); },
  smokeHiss(pos) { const d = pos?this._panner(pos):this.sfx; this._burst(d,{dur:2.0,freq:3000,gain:0.15,type:'highpass'}); },
  voice(line) { // stylized radio blip standing in for VO
    this._tone(this.sfx,{freq:600,dur:0.05,gain:0.2,type:'square'});
    UI.centerMsg(`📻 ${line}`, 1500);
  },

  startMusic() { // simple generative menu/combat music loop
    const play = () => {
      if (!this.ctx || this.ctx.state !== 'running') { setTimeout(play, 500); return; }
      const notes = this.combatLevel > 0.3 ? [110,130.8,146.8,164.8] : [220,261.6,196,246.9];
      this._tone(this.musicGain, { freq: notes[Math.random()*notes.length|0], dur:1.2, gain:0.5, type:'triangle' });
      this.combatLevel = Math.max(0, this.combatLevel - 0.08);
      this.musicGain.gain.value = 0.08 + this.combatLevel * 0.1;
      setTimeout(play, this.combatLevel > 0.3 ? 350 : 900);
    };
    play();
  }
};
