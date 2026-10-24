import { t } from '../i18n.js';
import { ICONS } from '../ui/icons.js';

// Raccoglie l'input da touch, volante, giroscopio e tastiera in un unico stato.
export class Controls {
  constructor(root, settings) {
    this.root = root;
    this.settings = settings;
    this.state = {
      throttle: 0, brake: 0, steerAxis: 0, steerTarget: null,
      lift: 0, spread: 0, tilt: 0, gear: 1, sensitivity: settings.sensitivity,
    };
    this.held = new Set();
    this.keys = new Set();
    this.wheelAngle = 0;
    this.wheelDragging = false;
    this.gyroValue = 0;
    this.onKeyDown = (e) => this.handleKey(e, true);
    this.onKeyUp = (e) => this.handleKey(e, false);
    this.onMotion = (e) => this.handleMotion(e);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.render();
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('devicemotion', this.onMotion);
    this.root.innerHTML = '';
  }

  setSettings(settings) {
    this.settings = settings;
    this.state.sensitivity = settings.sensitivity;
    this.render();
  }

  static async requestGyroPermission() {
    const DM = window.DeviceMotionEvent;
    if (DM && typeof DM.requestPermission === 'function') {
      try {
        return (await DM.requestPermission()) === 'granted';
      } catch {
        return false;
      }
    }
    return !!DM;
  }

  render() {
    const mode = this.settings.steering;
    window.removeEventListener('devicemotion', this.onMotion);
    if (mode === 'gyro') window.addEventListener('devicemotion', this.onMotion);

    const forkBtn = (action, icon, label) =>
      `<button class="ctl-btn fork-btn" data-hold="${action}" aria-label="${label}">${icon}<span>${label}</span></button>`;
    const left = mode === 'arrows'
      ? `<div class="steer-arrows">
           <button class="ctl-btn arrow-btn" data-hold="left" aria-label="left">${ICONS.arrowLeft}</button>
           <button class="ctl-btn arrow-btn" data-hold="right" aria-label="right">${ICONS.arrowRight}</button>
         </div>`
      : mode === 'wheel'
        ? `<div class="steer-wheel" data-wheel>${ICONS.wheel}</div>`
        : `<button class="ctl-btn pedal brake" data-hold="brake" aria-label="brake">${ICONS.pedal}<span>STOP</span></button>`;
    const right = mode === 'gyro'
      ? `<button class="ctl-btn pedal gas" data-hold="gas" aria-label="gas">${ICONS.pedal}<span>GAS</span></button>`
      : `<button class="ctl-btn pedal brake" data-hold="brake" aria-label="brake">${ICONS.pedal}<span>STOP</span></button>
         <button class="ctl-btn pedal gas" data-hold="gas" aria-label="gas">${ICONS.pedal}<span>GAS</span></button>`;

    this.root.innerHTML = `
      <div class="fork-pad">
        <div class="fork-title">${t('forks')}</div>
        ${forkBtn('liftUp', ICONS.up, t('up'))}${forkBtn('liftDown', ICONS.down, t('down'))}
        ${forkBtn('narrow', ICONS.narrow, t('narrow'))}${forkBtn('widen', ICONS.widen, t('widen'))}
        ${forkBtn('tiltBack', ICONS.tiltBack, t('tiltBack'))}${forkBtn('tiltFwd', ICONS.tiltFwd, t('tiltFwd'))}
      </div>
      <div class="ctl-left">${left}</div>
      <div class="ctl-right">
        <button class="ctl-btn gear-btn" data-gear aria-label="${t('gear')}"><b class="${this.state.gear > 0 ? 'on' : ''}">F</b><b class="${this.state.gear < 0 ? 'on' : ''}">R</b></button>
        <div class="pedals">${right}</div>
      </div>`;

    this.root.querySelectorAll('[data-hold]').forEach((el) => {
      const action = el.dataset.hold;
      const down = (e) => {
        e.preventDefault();
        el.setPointerCapture?.(e.pointerId);
        this.held.add(action);
        el.classList.add('pressed');
      };
      const up = () => {
        this.held.delete(action);
        el.classList.remove('pressed');
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    this.root.querySelector('[data-gear]').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.toggleGear();
    });

    const wheel = this.root.querySelector('[data-wheel]');
    if (wheel) this.bindWheel(wheel);
  }

  toggleGear() {
    this.state.gear = -this.state.gear;
    const b = this.root.querySelectorAll('[data-gear] b');
    b[0]?.classList.toggle('on', this.state.gear > 0);
    b[1]?.classList.toggle('on', this.state.gear < 0);
  }

  bindWheel(el) {
    let last = 0;
    const angleOf = (e) => {
      const r = el.getBoundingClientRect();
      return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this.wheelDragging = true;
      last = angleOf(e);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.wheelDragging) return;
      const a = angleOf(e);
      let d = a - last;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      last = a;
      this.wheelAngle = Math.max(-Math.PI * 1.5, Math.min(Math.PI * 1.5, this.wheelAngle + d));
    });
    const release = () => { this.wheelDragging = false; };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    this.wheelEl = el.querySelector('svg');
  }

  handleMotion(e) {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x === null) return;
    const angle = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
    // In orizzontale il "volante" e' la rotazione attorno all'asse perpendicolare allo schermo.
    let v;
    if (angle === 90) v = g.y;
    else if (angle === 270 || angle === -90) v = -g.y;
    else v = -g.x;
    v /= 9.81;
    this.gyroValue = this.settings.invertGyro ? -v : v;
  }

  handleKey(e, down) {
    const k = e.key.toLowerCase();
    if (down && k === 'g') this.toggleGear();
    if (down) this.keys.add(k);
    else this.keys.delete(k);
  }

  update(dt) {
    const s = this.state;
    const h = this.held, k = this.keys;
    const any = (...names) => names.some((n) => k.has(n));
    s.throttle = h.has('gas') || any('w', 'arrowup') ? 1 : 0;
    s.brake = h.has('brake') || any('s', 'arrowdown', ' ') ? 1 : 0;
    s.lift = (h.has('liftUp') || any('r') ? 1 : 0) - (h.has('liftDown') || any('f') ? 1 : 0);
    s.spread = (h.has('widen') || any('x') ? 1 : 0) - (h.has('narrow') || any('z') ? 1 : 0);
    s.tilt = (h.has('tiltBack') || any('q') ? 1 : 0) - (h.has('tiltFwd') || any('e') ? 1 : 0);
    s.steerAxis = (h.has('right') || any('d', 'arrowright') ? 1 : 0) - (h.has('left') || any('a', 'arrowleft') ? 1 : 0);
    s.steerTarget = null;
    const sens = this.settings.sensitivity;
    if (this.settings.steering === 'wheel' && s.steerAxis === 0) {
      if (!this.wheelDragging) this.wheelAngle *= Math.max(0, 1 - dt * 4);
      s.steerTarget = Math.max(-1, Math.min(1, (this.wheelAngle / (Math.PI * 1.25)) * sens));
      if (this.wheelEl) this.wheelEl.style.transform = `rotate(${this.wheelAngle}rad)`;
    } else if (this.settings.steering === 'gyro' && s.steerAxis === 0) {
      const v = this.gyroValue;
      const dead = Math.abs(v) < 0.04 ? 0 : v;
      s.steerTarget = Math.max(-1, Math.min(1, (dead / 0.55) * sens));
    }
    return s;
  }
}
