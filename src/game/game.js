// Solo i pezzi di Babylon usati (il pacchetto intero pesa il triplo): questi registrano ombre e istanze
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent.js';
import '@babylonjs/core/Meshes/instancedMesh.js';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { CubeTexture } from '@babylonjs/core/Materials/Textures/cubeTexture.js';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { Scalar } from '@babylonjs/core/Maths/math.scalar.js';
import { PhotoDome } from '@babylonjs/core/Helpers/photoDome.js';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation.js';
import * as Sentry from '@sentry/browser';
import { createMaterials } from './materials.js';
import { ShadowCasters } from './shadows.js';
import { World } from './world.js';
import { PalletManager } from './pallets.js';
import { Forklift } from './forklift.js';
import { Mission } from './mission.js';
import { Controls } from './controls.js';
import { Hud } from './hud.js';
import { TRUCK, FORK, loadDecor } from './models.js';
import { createRearview } from './rearview.js';
import { WorkerBots } from './workerbots.js';
import { GameAudio } from './audio.js';
import { Environment } from './environment.js';
import { Traffic } from './traffic.js';
import { People } from './people.js';
import { vehicleById } from '../data.js';
import { t } from '../i18n.js';

// Cielo e luce ambiente dallo stesso HDRI (Poly Haven, CC0): riflessi coerenti con il cielo visibile
const TEX_URL = `${import.meta.env.BASE_URL}textures/`;
const ENV_URL = `${TEX_URL}sky.env`;
const SKY_ROTATION = 2.36; // allinea il sole del panorama alla direzione della luce
const SUN_DIR = new Vector3(-0.45, -1, -0.35).normalize();

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = 'menu';
    this.paused = false;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.lookIdle = 0;
    this.audio = new GameAudio();
    this.menuAngle = 0;
  }

  async init(settings) {
    this.settings = settings;
    this.engine = new Engine(this.canvas, true, { stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance', alpha: false }, true);
    const scene = new Scene(this.engine);
    this.scene = scene;
    scene.clearColor = new Color4(0.62, 0.77, 0.92, 1);
    // Foschia lineare: oltre 160 m tutto e' coperto e non viene piu' disegnato (camera.maxZ),
    // colore preso dall'orizzonte del cielo panoramico
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogStart = 70;
    scene.fogEnd = 160;
    scene.fogColor = new Color3(0.62, 0.66, 0.74);
    scene.skipPointerMovePicking = true;
    scene.imageProcessingConfiguration.toneMappingEnabled = true;
    scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    scene.imageProcessingConfiguration.exposure = 1.4;
    try {
      scene.environmentTexture = CubeTexture.CreateFromPrefilteredData(ENV_URL, scene);
      scene.environmentIntensity = 0.75;
    } catch (err) {
      Sentry.captureException(err);
    }

    const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), scene);
    hemi.intensity = 0.32;
    hemi.groundColor = new Color3(0.35, 0.33, 0.3);
    const sun = new DirectionalLight('sun', SUN_DIR, scene);
    sun.intensity = 3.2;
    sun.diffuse = new Color3(1, 0.96, 0.88);
    sun.shadowMinZ = 1;
    sun.shadowMaxZ = 220;
    sun.autoUpdateExtends = false;
    sun.shadowFrustumSize = 60; // ombre entro ~30 m: mappa piu' piccola = ombre piu' nitide
    this.sun = sun;

    this.camera = new FreeCamera('cam', new Vector3(0, 30, -60), scene);
    this.camera.minZ = 0.05;
    this.camera.maxZ = 170;
    this.camera.fov = 0.95;
    this.camera.inputs.clear();

    // Oggetti che fanno ombra: il generatore cambia con la qualita' grafica
    this.shadowGen = new ShadowCasters();
    this.mats = createMaterials(scene);
    // Con le mipmap: senza, il telefono campiona l'immagine intera a ogni pixel (molto lento)
    this.sky = new PhotoDome('sky', `${TEX_URL}sky.jpg`, { resolution: 24, size: 320, generateMipMaps: true }, scene);
    this.sky.mesh.infiniteDistance = true; // segue la camera: sempre dentro la distanza di disegno
    this.sky.mesh.applyFog = false;
    this.sky.mesh.isPickable = false;
    this.sky.rotation.y = SKY_ROTATION;
    this.world = new World(scene, this.mats, this.shadowGen, t('saleSign'), await loadDecor(scene));
    this.pallets = new PalletManager(scene, this.mats, this.shadowGen);
    this.pallets.shelves = this.world.shelves;
    this.env = { colliders: this.world.colliders, pallets: this.pallets, truckBedHeight: TRUCK.bedHeight };
    this.mission = new Mission(scene, this.mats, this.env, this.shadowGen);
    this.bots = new WorkerBots(scene, this.mats, this.env);
    this.bots.shadowGen = this.shadowGen;
    this.traffic = new Traffic(scene, this.env, this.audio);
    await this.traffic.init();
    this.people = new People(scene, this.env);
    await this.people.init();
    this.applyQuality(settings.quality);
    this.world.freezeStatics();
    // orario e meteo dei contratti (dopo l'unione dei fissi: scambia i materiali di terra con la neve)
    this.envFx = new Environment(scene, { sun, hemi, sky: this.sky, mats: this.mats, camera: this.camera, world: this.world });
    this.envFx.setSkyAllowed(this.skyAllowed !== false);
    this.env.grip = (x, z) => this.envFx.grip(x, z);
    this.envFx.onThunder = (delay, near) => this.audio.thunder(delay, near);
    this.bindLook();

    window.addEventListener('resize', () => this.engine.resize());
    this.engine.runRenderLoop(() => this.frame());
  }

  // Bassa: niente ombre ne' cielo, risoluzione ridotta; Media: nitida, ombre leggere;
  // Alta: piu' nitida, ombre piu' definite.
  applyQuality(q) {
    this.quality = q;
    const dev = this.devToggles || { sky: true, shadows: true };
    const dpr = window.devicePixelRatio || 1;
    // Risoluzione: Media e Alta vicine a quella reale dello schermo (immagine nitida);
    // il costo e' compensato da materiali leggeri e ombre solo vicino al muletto
    // Si parte prudenti e si sale solo se il telefono regge; la nitidezza trovata si ricorda
    this.maxScale = { high: Math.min(dpr, 1.8), medium: Math.min(dpr, 1.5), low: 1 }[q] || 1;
    const start = { high: Math.min(dpr, 1.5), medium: Math.min(dpr, 1.3), low: 1 }[q] || 1;
    let saved = NaN;
    try { saved = parseFloat(localStorage.getItem(`forklift-res-${q}`)); } catch { /* storage non disponibile */ }
    this.scale = Math.min(this.maxScale, Number.isFinite(saved) ? saved : start);
    this.lowCount = 0;
    this.highCount = 0;
    this.engine.setHardwareScalingLevel(1 / this.scale);
    const mode = q === 'low' || !dev.shadows ? null : q;
    if (mode !== this.shadowMode) {
      this.shadowMode = mode;
      let gen = null;
      if (mode) {
        // Una sola mappa d'ombra attorno al muletto: Alta piu' definita, Media piu' leggera
        // 1024 basta per ombre entro ~30 m; Alta ha i bordi piu' morbidi
        gen = new ShadowGenerator(1024, this.sun);
        gen.usePercentageCloserFiltering = true;
        gen.filteringQuality = mode === 'high' ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_LOW;
        gen.bias = 0.0015;
        gen.normalBias = 0.02;
        // Aggiornate a ogni fotogramma: lavoro costante = niente scatti (a fotogrammi alterni
        // un fotogramma era leggero e il successivo pesante, e il gioco sembrava a scatti)
        gen.getShadowMap().refreshRate = 1;
      }
      this.shadowGen.attach(gen);
      this.shadowCull = 0; // al prossimo passo solo gli oggetti vicini
    }
    this.sun.shadowEnabled = !!mode;
    this.skyAllowed = q !== 'low' && dev.sky;
    if (this.envFx) this.envFx.setSkyAllowed(this.skyAllowed);
    else this.sky.setEnabled(this.skyAllowed);
  }

  // Menu sviluppatore: spegne singoli effetti per capire cosa pesa sul telefono
  setDevToggles(toggles) {
    this.devToggles = toggles;
    this.applyQuality(this.quality);
  }

  // Contatore prestazioni (solo menu sviluppatore): FPS, chiamate di disegno, oggetti visibili
  setPerfOverlay(on) {
    this.perfEl?.remove();
    this.perfEl = null;
    clearInterval(this.perfTimer);
    if (!on) return;
    this.instr ||= new SceneInstrumentation(this.scene);
    this.instr.captureFrameTime = true;
    const el = document.createElement('div');
    el.className = 'perf-overlay';
    document.querySelector('#app').appendChild(el);
    this.perfEl = el;
    this.perfTimer = setInterval(() => {
      const ms = this.instr.frameTimeCounter.lastSecAverage;
      el.textContent = `${this.engine.getFps().toFixed(0)} FPS · ${ms.toFixed(1)} ms · draw ${this.instr.drawCallsCounter.current}`
        + ` · mesh ${this.scene.getActiveMeshes().length} · ${this.quality} ×${(1 / this.engine.getHardwareScalingLevel()).toFixed(2)}`;
    }, 500);
  }

  setSettings(settings) {
    this.settings = settings;
    this.audio.setVolumes(settings.sfxVolume ?? 0.8, settings.musicVolume ?? 0.5);
    this.applyQuality(settings.quality);
    this.controls?.setSettings(settings);
    this.rearview?.setEnabled(settings.mirrors !== false);
  }

  setOwnedWarehouses(ids) {
    this.world.setOwned(ids);
    this.hud?.setOwned(ids);
  }

  // Trascinare sullo schermo (fuori dai comandi) ruota la visuale.
  bindLook() {
    let last = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'play') return;
      last = { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    window.addEventListener('pointermove', (e) => {
      if (!last || e.pointerId !== last.id) return;
      const k = 0.006 * this.settings.sensitivity;
      this.lookYaw = Scalar.Clamp(this.lookYaw + (e.clientX - last.x) * k, -Math.PI, Math.PI);
      // in prima persona si puo' guardare molto piu' in alto (pallet sugli scaffali)
      this.lookPitch = Scalar.Clamp(this.lookPitch + (e.clientY - last.y) * k, this.settings.view === 'first' ? -1.1 : -0.6, 0.5);
      last.x = e.clientX;
      last.y = e.clientY;
      this.lookIdle = 0;
    });
    const end = (e) => { if (last && e.pointerId === last.id) last = null; };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    this.isLooking = () => !!last;
  }

  async startMission(contract, { vehicleId, hudRoot, controlsRoot, onResult, onSettings, onMap, onCamera, owned, workers, coins }) {
    this.stopMission();
    this.mode = 'loading';
    const vehicle = vehicleById(vehicleId);
    this.forklift = new Forklift(this.scene, this.mats, vehicle);
    await this.forklift.build(this.shadowGen);
    // intensita' della pioggia: fissa per contratto (dal suo seme)
    this.envFx.apply(contract.time || 'day', contract.weather || 'clear', ['light', 'medium', 'heavy'][(contract.seed || 0) % 3]);
    const start = await this.mission.start(contract);
    this.forklift.place(start.x, start.z, start.yaw);
    this.bots.setWorkers(workers);
    // Operai vicini creati ora, durante il caricamento: crearli mentre si gioca bloccava il gioco un attimo
    await this.bots.prewarm(this.forklift);
    this.shadowGen.cull(this.forklift.x, this.forklift.z, 28);
    this.hud = new Hud(hudRoot, { onSettings, onMap, onCamera, coins });
    this.rearview = createRearview(this.scene, this.camera);
    this.rearview.setEnabled(this.settings.mirrors !== false);
    this.hud.setOwned(owned);
    this.hud.setObjective(contract);
    this.controls = new Controls(controlsRoot, this.settings);
    this.onResult = onResult;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.camPos = null;
    this.paused = false;
    // Materiali e shader compilati prima di iniziare (la prima comparsa di un materiale costa un attimo)
    await Promise.race([this.scene.whenReadyAsync(), new Promise((r) => setTimeout(r, 4000))]);
    this.mode = 'play';
    if (this.mission.drive) this.hud.toast(t('truckArriving'));
    Sentry.addBreadcrumb({ category: 'mission', message: `start ${contract.type} lv${contract.level}` });
  }

  clearFadedWalls() {
    for (const m of this.fadedWalls || []) m.visibility = 1;
    this.fadedWalls = null;
  }

  stopMission() {
    this.envFx?.apply('day', 'clear'); // menu sempre di giorno col sereno
    this.clearFadedWalls();
    this.rearview?.dispose();
    this.rearview = null;
    this.mission.cleanup();
    this.bots?.clear();
    this.forklift?.dispose();
    this.forklift = null;
    this.controls?.dispose();
    this.controls = null;
    this.hud = null;
    this.mode = 'menu';
    this.paused = false;
  }

  setPaused(p) {
    this.paused = p;
  }

  // Risoluzione dinamica (mai sopra il massimo del livello grafico, mai sotto i punti CSS dello schermo)
  adaptResolution(realDt) {
    // Controllo ogni secondo sulla mediana: sotto 45 FPS scende subito, sotto 52 per 2 secondi scende un po',
    // sopra 58 per 4 secondi sale un po'. La nitidezza raggiunta viene ricordata per la prossima volta.
    this.frameTimes ||= [];
    this.frameTimes.push(realDt);
    this.resTimer = (this.resTimer || 0) + realDt;
    if (this.resTimer < 1 || this.mode !== 'play' || this.paused) {
      if (this.mode !== 'play' || this.paused) this.frameTimes.length = 0;
      return;
    }
    this.resTimer = 0;
    // Mediana del secondo appena passato: un singolo fotogramma lento (un attimo) non conta,
    // conta solo un rallentamento che dura (e che una nitidezza minore puo' davvero risolvere)
    const sorted = this.frameTimes.sort((x, y) => x - y);
    const fps = 1 / Math.max(1e-3, sorted[Math.floor(sorted.length / 2)]);
    this.frameTimes.length = 0;
    this.lowCount = fps < 52 ? this.lowCount + 1 : 0;
    this.highCount = fps > 58 ? this.highCount + 1 : 0;
    let next = this.scale;
    if (fps < 45) next = this.scale - 0.2;
    else if (this.lowCount >= 2) next = this.scale - 0.1;
    else if (this.highCount >= 4) next = this.scale + 0.1;
    next = Math.max(1, Math.min(this.maxScale, next));
    if (Math.abs(next - this.scale) > 0.01) {
      this.scale = next;
      this.lowCount = 0;
      this.highCount = 0;
      this.engine.setHardwareScalingLevel(1 / next);
      try { localStorage.setItem(`forklift-res-${this.quality}`, next.toFixed(2)); } catch { /* storage non disponibile */ }
    }
  }

  frame() {
    const realDt = Math.min(0.25, this.engine.getDeltaTime() / 1000);
    this.adaptResolution(realDt);
    const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000) * (this.timeScale || 1);
    try {
      if (this.mode === 'play' && !this.paused) this.step(dt);
      else if (this.mode === 'play' && this.mission.finished) this.mission.driveTruck(dt, null, this.traffic.cars, this.people.list);
      // traffico: sempre in movimento (anche nel menu); col gioco in pausa resta fermo
      if (!(this.mode === 'play' && this.paused)) {
        const playing = this.mode === 'play' ? this.forklift : null;
        this.traffic.update(dt, playing, this.mission.drive ? [this.mission.moveCol] : []);
        const T = this.envFx;
        this.traffic.setLights(!!T && (T.time !== 'day' || T.weather !== 'clear'));
      }
      this.updateCamera(dt);
      this.audio.update(this.mode === 'play' ? this.forklift : null, this.mode === 'play' && !this.paused);
      this.envFx?.update(realDt, this.mode === 'play' ? this.forklift : null);
      if (this.envFx && this.forklift) this.audio.setWeather(this.envFx.weather, this.envFx.isOutside(this.forklift.x, this.forklift.z), this.envFx.rainLevel);
      // gocce sulla visuale: prima persona, pioggia, all'aperto
      if (this.hud) {
        const f = this.forklift;
        this.hud.rainDrops.frame(realDt, this.mode === 'play' && !this.paused && this.settings.view === 'first'
          && this.envFx.weather === 'rain' && this.envFx.isWetAt(f.x, f.z) > 0.5);
      }
      this.scene.render();
    } catch (err) {
      Sentry.captureException(err);
      this.engine.stopRenderLoop();
      throw err;
    }
  }

  step(dt) {
    const input = this.controls.update(dt);
    const f = this.forklift;
    f.update(dt, input, this.env);
    this.shadowCull = (this.shadowCull || 0) - dt;
    if (this.shadowCull <= 0) {
      this.shadowCull = 0.5;
      this.shadowGen.cull(f.x, f.z, 28);
    }
    this.bots.update(dt, f);
    this.people.update(dt, f, [f, ...[...this.bots.bots.values()].map((b) => b.f)]);
    this.pallets.update(dt);
    for (const ev of f.events) {
      this.audio.event(ev);
      if (ev === 'dropped') {
        this.mission.drops += 1;
        this.hud.toast(t('palletDropped'), 'bad');
      } else if (ev === 'tooHeavy') this.hud.toast(t('tooHeavy'), 'bad');
      else if (ev === 'insertDeeper') this.hud.toast(t('insertDeeper'), 'warn');
      else if (ev === 'widen') this.hud.toast(t('widenForks'), 'warn');
      else if ((ev === 'hitCar' || ev === 'hitPerson') && this.mission.bump()) {
        this.hud.toast(t(ev, { n: this.mission.bumpPctTotal }), 'bad');
      }
    }
    f.events.length = 0;
    const outcome = this.mission.update(dt, f, this.traffic.cars, this.people.list);
    if (this.mission.justParked) {
      this.mission.justParked = false;
      this.hud.toast(t('truckParked'), 'good');
    }
    this.hud.update({ forklift: f, mission: this.mission, pallets: this.pallets });
    if (outcome) {
      this.paused = true;
      const result = outcome === 'complete' ? this.mission.result() : null;
      setTimeout(() => this.onResult?.(outcome, result, this.mission.contract), outcome === 'complete' ? 1200 : 300);
    }
    if (!this.isLooking()) {
      this.lookIdle += dt;
      if (this.lookIdle > 1.2) {
        this.lookYaw *= Math.max(0, 1 - dt * 2.5);
        this.lookPitch *= Math.max(0, 1 - dt * 2.5);
      }
    }
  }

  updateCamera(dt) {
    const cam = this.camera;
    const f = this.forklift;
    if (this.mode !== 'play' || !f) {
      // Menu: ripresa lenta sul quartiere
      this.menuAngle += dt * 0.05;
      const r = 55;
      cam.position.set(Math.sin(this.menuAngle) * r, 22, 20 + Math.cos(this.menuAngle) * r);
      cam.setTarget(new Vector3(0, 4, 18));
      cam.fov = 0.9;
      this.sun.position = new Vector3(0, 0, 18).subtract((this.envFx?.sunDir || SUN_DIR).scale(100));
      return;
    }
    const yaw = f.yaw + this.lookYaw;
    const fwd = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const base = new Vector3(f.x, 0, f.z);
    let pos, target;
    if (this.settings.view === 'first') {
      this.clearFadedWalls();
      const fy = f.yaw;
      // Occhio del guidatore al centro: si guarda attraverso il montante, tra le catene
      const [ex, ey, ez] = f.geo.eye;
      pos = base.add(new Vector3(ex * Math.cos(fy) + ez * Math.sin(fy), ey, -ex * Math.sin(fy) + ez * Math.cos(fy)));
      // Sguardo inclinato quanto serve a tenere in vista le forche (sui muletti grandi l'occhio e' piu' alto e lontano):
      // il punto a 3/4 delle forche resta sotto il centro di 0.3 rad (meta' strada verso il bordo basso)
      const ahead = f.geo.forkBase + FORK.length * 0.75 - ez;
      // forche basse: sguardo in giu' sulle punte; forche alte: lo sguardo sale con loro (centro del carico)
      const low = Math.max(Math.atan(0.5), Math.atan2(ey, ahead) - 0.3);
      const high = Math.atan2(ey - f.forkY - 0.5, ahead) + 0.12;
      const want = Math.min(low, high);
      this.fpTilt = this.fpTilt === undefined ? want : this.fpTilt + (want - this.fpTilt) * Math.min(1, dt * 4);
      target = pos.add(new Vector3(fwd.x, -Math.tan(Scalar.Clamp(this.fpTilt + this.lookPitch, -1.2, 1.3)), fwd.z));
      cam.fov = 1.2;
      cam.position.copyFrom(pos);
    } else {
      const dist = 6.8 * f.geo.s;
      target = base.add(new Vector3(0, 1.3 * f.geo.s + f.forkY * 0.25, 0)).add(fwd.scale(1.6));
      const desired = base.add(fwd.scale(-dist)).add(new Vector3(0, 3.4 * f.geo.s + this.lookPitch * 5, 0));
      // Muri tra camera e muletto: diventano semitrasparenti (la camera resta dietro)
      const origin = base.add(new Vector3(0, 1.6, 0));
      const dir = desired.subtract(origin);
      const len = dir.length();
      // Muri che coprono la camera: controllati ogni 4 fotogrammi (il raggio crea molta memoria temporanea)
      this.wallCheck = ((this.wallCheck || 0) + 1) % 4;
      if (this.wallCheck === 0 || !this.fadedWalls) {
        const hits = this.scene.multiPickWithRay(new Ray(origin, dir.scale(1 / len), len + 0.5), (m) => m.metadata === 'wall') || [];
        const faded = new Set(hits.map((h) => h.pickedMesh));
        for (const m of this.fadedWalls || []) if (!faded.has(m)) m.visibility = 1;
        for (const m of faded) m.visibility = 0.25;
        this.fadedWalls = faded;
      }
      const goal = desired;
      if (!this.camPos) this.camPos = goal.clone();
      this.camPos = Vector3.Lerp(this.camPos, goal, 1 - Math.exp(-dt * 7));
      cam.position.copyFrom(this.camPos);
      cam.fov = 0.95;
    }
    cam.setTarget(target);
    this.sun.position = base.subtract((this.envFx?.sunDir || SUN_DIR).scale(100));
    f.model?.root.computeWorldMatrix(true);
    this.rearview?.update(f.model?.root, f.geo.s);
    const firstPerson = this.settings.view === 'first';
    if (f.model?.roof?.length && (this.roofSeeThrough !== firstPerson || this.roofModel !== f.model)) {
      // dal posto di guida il tetto si vede in trasparenza: si guardano i pallet in alto
      this.roofSeeThrough = firstPerson;
      this.roofModel = f.model; // muletto nuovo (contratto o cambio mezzo): va riapplicato
      f.model.roof.forEach((m) => {
        m.visibility = firstPerson ? 0.3 : 1;
        m.material.transparencyMode = firstPerson ? 2 : 0; // 2 = trasparenza, 0 = opaco
      });
    }
  }
}
