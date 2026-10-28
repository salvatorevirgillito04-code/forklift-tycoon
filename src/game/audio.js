// Suoni del gioco (Web Audio).
// Motore e (se presenti) cicalino e idraulica sono registrazioni vere libere (pubblico dominio / CC0, Wikimedia Commons);
// la musica e' di OpenGameArt (CC0). Se un file manca si usa il suono generato dal codice.

const MUSIC_IN_GAME = 0.4; // in partita la musica resta bassa
const SOUNDS = `${import.meta.env.BASE_URL}sounds/`;
const TRACKS = ['music-rhythm-factory.mp3', 'music-apple-cider.mp3', 'music-shop-theme.mp3'];

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.sfxVol = 0.8;
    this.musicVol = 0.5;
    this.inGame = false;
    this.buffers = {};
    // Il browser fa partire l'audio solo dopo un tocco dell'utente
    const unlock = () => {
      this.start();
      if (this.ctx?.state === 'running') {
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      }
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) {
        this.ctx.suspend();
        this.track?.pause();
      } else {
        this.ctx.resume();
        if (this.musicVol > 0) this.track?.play().catch(() => {});
      }
    });
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume();
      if (this.track?.paused && this.musicVol > 0) this.track.play().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.sfx = ctx.createGain();
    this.music = ctx.createGain();
    this.sfx.connect(ctx.destination);
    this.music.connect(ctx.destination);
    this.noise = this.makeNoise();
    this.buildHydraulic();
    this.buildBeeper();
    this.buildWeather();
    this.applyVolumes();
    this.loadSounds();
    this.startMusic();
  }

  // Registrazioni: il motore vero sostituisce quello sintetico appena e' pronto
  async loadSounds() {
    const load = async (name) => {
      try {
        const res = await fetch(SOUNDS + name);
        if (!res.ok) return null;
        return await this.ctx.decodeAudioData(await res.arrayBuffer());
      } catch {
        return null;
      }
    };
    const [idle, rev, beep, up, down, rainL, rainM, rainH] = await Promise.all(
      ['engine-idle.ogg', 'engine-rev.ogg', 'beeper.ogg', 'hydraulic-up.ogg', 'hydraulic-down.ogg',
        'rain-light.ogg', 'rain-medium.ogg', 'rain-heavy.ogg'].map(load));
    // pioggia registrata (leggera, media, forte): un anello per tipo, passa da un filtro che la attutisce dentro i magazzini
    if (rainL && rainM && rainH) {
      const w = this.weatherFx;
      w.rainLoops = { light: rainL, medium: rainM, heavy: rainH };
      w.real = {};
      for (const [k, buf] of Object.entries(w.rainLoops)) {
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const g = this.ctx.createGain();
        g.gain.value = 0;
        src.connect(g).connect(w.muffle);
        src.start(0, Math.random() * buf.duration);
        w.real[k] = g;
      }
    }
    Object.assign(this.buffers, { beep, up, down });
    if (idle && rev) this.buildEngine(idle, rev);
    else this.buildSynthEngine();
    if (up) this.hydraulic.up = this.loopVoice(up);
    if (down) this.hydraulic.down = this.loopVoice(down);
  }

  // Anello che suona sempre, a volume 0 finche' serve
  loopVoice(buffer) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(this.sfx);
    src.start();
    return { src, g };
  }

  setVolumes(sfx, music) {
    this.sfxVol = sfx;
    this.musicVol = music;
    this.applyVolumes();
    if (this.track) {
      if (music <= 0) this.track.pause();
      else if (this.track.paused && this.ctx?.state === 'running') this.track.play().catch(() => {});
    }
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfx.gain.setTargetAtTime(this.sfxVol, t, 0.05);
    this.music.gain.setTargetAtTime(this.musicVol * (this.inGame ? MUSIC_IN_GAME : 1), t, 0.3);
  }

  // ---- Musica: i brani scelti, in ordine casuale, letti dal file man mano (poca memoria) ----
  startMusic() {
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    this.ctx.createMediaElementSource(el).connect(this.music);
    this.track = el;
    let order = [];
    const next = () => {
      if (!order.length) order = [...TRACKS].sort(() => Math.random() - 0.5);
      el.src = SOUNDS + order.pop();
      if (this.musicVol > 0) el.play().catch(() => {});
    };
    el.addEventListener('ended', next);
    el.addEventListener('error', () => setTimeout(next, 3000));
    next();
  }

  // Un secondo di rumore bianco riusato da idraulica e colpi
  makeNoise() {
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  noiseSource(loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  // Motore vero: minimo e su di giri si alternano con la velocita', il tono sale con i giri
  buildEngine(idle, rev) {
    const out = this.ctx.createGain();
    out.gain.value = 0;
    out.connect(this.sfx);
    const voice = (buffer) => {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const g = this.ctx.createGain();
      src.connect(g).connect(out);
      src.start(0, Math.random() * buffer.duration);
      return { src, g };
    };
    this.engine = { out, idle: voice(idle), rev: voice(rev), rpm: 0, real: true };
  }

  // Riserva sintetica (se le registrazioni non si caricano)
  buildSynthEngine() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    lp.Q.value = 2;
    const a = ctx.createOscillator();
    a.type = 'sawtooth';
    const b = ctx.createOscillator();
    b.type = 'square';
    const bGain = ctx.createGain();
    bGain.gain.value = 0.5;
    a.connect(lp);
    b.connect(bGain).connect(lp);
    lp.connect(out).connect(this.sfx);
    a.start();
    b.start();
    this.engine = { out, lp, a, b, rpm: 0, real: false };
  }

  // Idraulica sintetica: pompa (ronzio) + flusso dell'olio (fruscio scuro); le registrazioni, se ci sono, la sostituiscono
  buildHydraulic() {
    const ctx = this.ctx;
    const src = this.noiseSource(true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 650;
    bp.Q.value = 0.8;
    const pump = ctx.createOscillator();
    pump.type = 'sawtooth';
    pump.frequency.value = 95;
    const pf = ctx.createBiquadFilter();
    pf.type = 'lowpass';
    pf.frequency.value = 500;
    const pg = ctx.createGain();
    pg.gain.value = 0.5;
    const out = ctx.createGain();
    out.gain.value = 0;
    src.connect(bp).connect(out);
    pump.connect(pf).connect(pg).connect(out);
    out.connect(this.sfx);
    src.start();
    pump.start();
    this.hydraulic = { out, pump };
  }

  // Meteo: fruscio della pioggia (rumore filtrato) e vento con la neve (rumore scuro che va e viene)
  buildWeather() {
    const ctx = this.ctx;
    const rain = this.noiseSource(true);
    const rf = ctx.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = 2600;
    rf.Q.value = 0.35;
    const rg = ctx.createGain();
    rg.gain.value = 0;
    rain.connect(rf).connect(rg).connect(this.sfx);
    const wind = this.noiseSource(true);
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 420;
    wf.Q.value = 3;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    wind.connect(wf).connect(wg).connect(this.sfx);
    rain.start();
    wind.start(0, 0.37);
    // filtro della pioggia vera: aperto fuori, chiuso (cupo, attutito dal tetto) dentro
    const muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 18000;
    muffle.connect(this.sfx);
    this.weatherFx = { rg, rf, wg, wf, muffle, kind: 'clear', outside: 1, level: 'medium' };
  }

  // tipo di meteo della partita e quanto si e' all'aperto (dentro i magazzini e' attutito)
  setWeather(kind, outside = 1, level = 'medium') {
    if (!this.weatherFx) return;
    this.weatherFx.kind = kind;
    this.weatherFx.outside = outside;
    this.weatherFx.level = level;
  }

  updateWeather(t, playing) {
    const w = this.weatherFx;
    const out = playing ? 0.35 + 0.65 * w.outside : 0;
    if (w.real) {
      // registrazione: solo l'anello dell'intensita' del contratto
      for (const [k, g] of Object.entries(w.real)) g.gain.setTargetAtTime(w.kind === 'rain' && k === w.level ? 1.6 * out : 0, t, 0.5);
      w.muffle.frequency.setTargetAtTime(w.outside > 0.5 ? 18000 : 900, t, 0.4);
      w.rg.gain.setTargetAtTime(0, t, 0.2);
    } else {
      w.rg.gain.setTargetAtTime(w.kind === 'rain' ? 0.45 * out : 0, t, 0.4);
      w.rf.frequency.setTargetAtTime(1200 + 1600 * w.outside, t, 0.4); // dentro: piu' cupo (tetto)
    }
    // vento: raffiche lente
    const gust = 0.6 + 0.4 * Math.sin(t * 0.7) * Math.sin(t * 0.23 + 1);
    w.wg.gain.setTargetAtTime(w.kind === 'snow' ? 0.7 * out * gust : 0, t, 0.6);
    w.wf.frequency.setTargetAtTime(300 + 260 * gust, t, 0.6);
  }

  // Tuono: arriva dopo il lampo (delay s); vicino = forte e secco, lontano = cupo
  thunder(delay, near) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const s = this.noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(near ? 900 : 380, t);
    f.frequency.exponentialRampToValueAtTime(90, t + 3.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(near ? 2.6 : 1.5, t + (near ? 0.05 : 0.4));
    // brontolio: qualche ripresa prima di spegnersi
    g.gain.exponentialRampToValueAtTime(near ? 0.9 : 0.6, t + 0.9);
    g.gain.exponentialRampToValueAtTime(near ? 1.3 : 0.8, t + 1.4);
    g.gain.exponentialRampToValueAtTime(0.001, t + 4.2);
    s.loop = true;
    s.playbackRate.value = 0.6;
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t);
    s.stop(t + 4.4);
  }

  // Cicalino sintetico: tono puro ~1 kHz con poche armoniche, come quelli veri (riserva)
  buildBeeper() {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 1040;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2600;
    const out = ctx.createGain();
    out.gain.value = 0;
    osc.connect(f).connect(out).connect(this.sfx);
    osc.start();
    this.beeper = { out, next: 0 };
  }

  // Chiamata a ogni fotogramma: forklift = null fuori partita (motore spento)
  update(forklift, playing) {
    if (!this.ctx || this.ctx.state !== 'running' || !this.engine) return;
    const t = this.ctx.currentTime;
    if (this.inGame !== !!forklift) {
      this.inGame = !!forklift;
      this.applyVolumes();
    }
    const e = this.engine, h = this.hydraulic;
    this.updateWeather(t, !!forklift && playing);
    if (!forklift || !playing) {
      e.out.gain.setTargetAtTime(0, t, 0.15);
      h.out.gain.setTargetAtTime(0, t, 0.05);
      h.up?.g.gain.setTargetAtTime(0, t, 0.05);
      h.down?.g.gain.setTargetAtTime(0, t, 0.05);
      this.beeper.out.gain.setTargetAtTime(0, t, 0.01);
      return;
    }
    const veh = forklift.vehicle;
    const speed = Math.min(1, Math.abs(forklift.v) / veh.speed);
    const r = forklift.rates;
    const lift = Math.min(1, Math.abs(r.lift) / 0.5 + Math.abs(r.tilt) * 3 + Math.abs(r.spread) * 2);
    // giri: minimo + velocita' + pompa idraulica (che fa salire i giri come sui muletti veri)
    const target = Math.min(1, speed * 0.85 + lift * 0.45);
    e.rpm += (target - e.rpm) * 0.06;
    // muletti piu' grandi: motore piu' grave
    const size = 1.12 - (veh.scale - 1) * 0.35;
    if (e.real) {
      const rate = size * (0.9 + e.rpm * 0.45);
      e.idle.src.playbackRate.setTargetAtTime(rate, t, 0.08);
      e.rev.src.playbackRate.setTargetAtTime(rate * 0.92, t, 0.08);
      // dissolvenza a potenza costante tra minimo e su di giri
      e.idle.g.gain.setTargetAtTime(Math.cos(e.rpm * Math.PI / 2), t, 0.1);
      e.rev.g.gain.setTargetAtTime(Math.sin(e.rpm * Math.PI / 2), t, 0.1);
      e.out.gain.setTargetAtTime(0.38 + e.rpm * 0.18, t, 0.15);
    } else {
      const f = 40 * size * (1 + e.rpm * 1.8);
      e.a.frequency.setTargetAtTime(f, t, 0.05);
      e.b.frequency.setTargetAtTime(f / 2, t, 0.05);
      e.lp.frequency.setTargetAtTime(300 + e.rpm * 900, t, 0.05);
      e.out.gain.setTargetAtTime(0.105 * (0.55 + e.rpm * 0.6), t, 0.1);
    }
    // idraulica: registrazione di salita o discesa, oppure quella sintetica
    if (h.up && h.down) {
      const up = r.lift > 0.02 || Math.abs(r.tilt) > 0.01 || Math.abs(r.spread) > 0.01;
      h.up.g.gain.setTargetAtTime(up ? lift * 0.8 : 0, t, 0.05);
      h.down.g.gain.setTargetAtTime(r.lift < -0.02 ? Math.min(1, -r.lift / 0.5) * 0.8 : 0, t, 0.05);
    } else {
      h.out.gain.setTargetAtTime(lift * 0.1, t, 0.04);
      h.pump.frequency.setTargetAtTime(85 + lift * 40 + (r.lift > 0 ? 15 : 0), t, 0.05);
    }
    // cicalino: bip... bip... in retromarcia (mezzo secondo acceso, mezzo spento)
    const bp = this.beeper;
    const reversing = forklift.gear < 0 && Math.abs(forklift.v) > 0.03;
    if (reversing && t >= bp.next) {
      if (this.buffers.beep) {
        const s = this.ctx.createBufferSource();
        s.buffer = this.buffers.beep;
        const g = this.ctx.createGain();
        g.gain.value = 0.5;
        s.connect(g).connect(this.sfx);
        s.start(t, 0, Math.min(0.5, this.buffers.beep.duration));
      } else {
        bp.out.gain.setValueAtTime(0, t);
        bp.out.gain.linearRampToValueAtTime(0.07, t + 0.01);
        bp.out.gain.setValueAtTime(0.07, t + 0.45);
        bp.out.gain.linearRampToValueAtTime(0, t + 0.47);
      }
      bp.next = t + 1;
    } else if (!reversing) {
      bp.next = 0;
    }
  }

  // Colpi brevi: pallet appoggiato/preso (clack), caduto (tonfo)
  event(name) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx, t = ctx.currentTime;
    const hit = (freq, dur, vol, q = 1) => {
      const s = this.noiseSource();
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f).connect(g).connect(this.sfx);
      s.start(t);
      s.stop(t + dur + 0.05);
    };
    const thump = (freq, dur, vol) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(freq * 0.4, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(this.sfx);
      o.start(t);
      o.stop(t + dur + 0.05);
    };
    if (name === 'place' || name === 'pickup') {
      // legno del pallet sulle forche: colpo secco e basso
      hit(1400, 0.07, 0.4, 2);
      thump(110, 0.14, 0.35);
    } else if (name === 'dropped') {
      hit(700, 0.4, 0.8);
      thump(70, 0.45, 0.9);
    } else if (name === 'tooHeavy') {
      thump(200, 0.15, 0.25);
    }
  }
}
