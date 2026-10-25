import {
  Engine, Scene, Vector3, Color3, Color4, HemisphericLight, DirectionalLight, ShadowGenerator,
  FreeCamera, CubeTexture, ImageProcessingConfiguration, Ray, Scalar,
} from '@babylonjs/core';
import * as Sentry from '@sentry/browser';
import { createMaterials } from './materials.js';
import { World } from './world.js';
import { PalletManager } from './pallets.js';
import { Forklift } from './forklift.js';
import { Mission } from './mission.js';
import { Controls } from './controls.js';
import { Hud } from './hud.js';
import { TRUCK } from './models.js';
import { createRearview } from './rearview.js';
import { WorkerBots } from './workerbots.js';
import { vehicleById } from '../data.js';
import { t } from '../i18n.js';

const ENV_URL = 'https://assets.babylonjs.com/environments/environmentSpecular.env';
const SUN_DIR = new Vector3(-0.45, -1, -0.35).normalize();

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = 'menu';
    this.paused = false;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.lookIdle = 0;
    this.menuAngle = 0;
  }

  async init(settings) {
    this.settings = settings;
    this.engine = new Engine(this.canvas, true, { stencil: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' }, true);
    const scene = new Scene(this.engine);
    this.scene = scene;
    scene.clearColor = new Color4(0.62, 0.77, 0.92, 1);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.0055;
    scene.fogColor = new Color3(0.68, 0.8, 0.92);
    scene.skipPointerMovePicking = true;
    scene.imageProcessingConfiguration.toneMappingEnabled = true;
    scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    scene.imageProcessingConfiguration.exposure = 1.1;
    try {
      scene.environmentTexture = CubeTexture.CreateFromPrefilteredData(ENV_URL, scene);
      scene.environmentIntensity = 0.7;
    } catch (err) {
      Sentry.captureException(err);
    }

    const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), scene);
    hemi.intensity = 0.45;
    hemi.groundColor = new Color3(0.35, 0.33, 0.3);
    const sun = new DirectionalLight('sun', SUN_DIR, scene);
    sun.intensity = 2.6;
    sun.diffuse = new Color3(1, 0.96, 0.88);
    sun.shadowMinZ = 1;
    sun.shadowMaxZ = 220;
    sun.autoUpdateExtends = false;
    sun.shadowFrustumSize = 80;
    this.sun = sun;

    this.camera = new FreeCamera('cam', new Vector3(0, 30, -60), scene);
    this.camera.minZ = 0.05;
    this.camera.maxZ = 600;
    this.camera.fov = 0.95;
    this.camera.inputs.clear();

    this.applyQuality(settings.quality);
    this.mats = createMaterials(scene);
    this.world = new World(scene, this.mats, this.shadowGen, t('saleSign'));
    this.pallets = new PalletManager(scene, this.mats, this.shadowGen);
    this.env = { colliders: this.world.colliders, pallets: this.pallets, truckBedHeight: TRUCK.bedHeight };
    this.mission = new Mission(scene, this.mats, this.env, this.shadowGen);
    this.bots = new WorkerBots(scene, this.mats, this.env);
    this.world.freezeStatics();
    this.bindLook();

    window.addEventListener('resize', () => this.engine.resize());
    this.engine.runRenderLoop(() => this.frame());
  }

  applyQuality(q) {
    const dpr = window.devicePixelRatio || 1;
    // Sui telefoni con densita' di pixel alta non serve disegnare ogni pixel fisico
    this.engine.setHardwareScalingLevel(q === 'high' ? 1 / Math.min(dpr, 1.5) : 1);
    if (q === 'high' && !this.shadowGen) {
      this.shadowGen = new ShadowGenerator(1024, this.sun);
      this.shadowGen.usePercentageCloserFiltering = true;
      this.shadowGen.bias = 0.0015;
      this.shadowGen.normalBias = 0.02;
      this.scene.meshes.forEach((m) => {
        if (m.metadata === 'wall' || m.name.startsWith('crown')) this.shadowGen.addShadowCaster(m);
      });
    }
    if (this.shadowGen) this.shadowGen.getShadowMap().refreshRate = q === 'high' ? 1 : 0;
    if (this.pallets) this.pallets.shadowGen = this.shadowGen;
    if (this.mission) this.mission.shadowGen = this.shadowGen;
    this.sun.shadowEnabled = q === 'high';
  }

  setSettings(settings) {
    this.settings = settings;
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
      this.lookPitch = Scalar.Clamp(this.lookPitch + (e.clientY - last.y) * k, -0.6, 0.5);
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
    await this.forklift.build(this.settings.quality === 'high' ? this.shadowGen : null);
    const start = await this.mission.start(contract);
    this.forklift.place(start.x, start.z, start.yaw);
    this.bots.shadowGen = this.settings.quality === 'high' ? this.shadowGen : null;
    this.bots.setWorkers(workers);
    this.cabHidden = null;
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
    this.mode = 'play';
    Sentry.addBreadcrumb({ category: 'mission', message: `start ${contract.type} lv${contract.level}` });
  }

  clearFadedWalls() {
    for (const m of this.fadedWalls || []) m.visibility = 1;
    this.fadedWalls = null;
  }

  stopMission() {
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

  frame() {
    const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000);
    try {
      if (this.mode === 'play' && !this.paused) this.step(dt);
      else if (this.mode === 'play' && this.mission.finished) this.mission.animateLeaving(dt);
      this.updateCamera(dt);
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
    this.bots.update(dt, f);
    this.pallets.update(dt);
    for (const ev of f.events) {
      if (ev === 'dropped') {
        this.mission.drops += 1;
        this.hud.toast(t('palletDropped'), 'bad');
      } else if (ev === 'tooHeavy') this.hud.toast(t('tooHeavy'), 'bad');
      else if (ev === 'insertDeeper') this.hud.toast(t('insertDeeper'), 'warn');
      else if (ev === 'widen') this.hud.toast(t('widenForks'), 'warn');
    }
    f.events.length = 0;
    const outcome = this.mission.update(dt, f);
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
      this.sun.position = new Vector3(0, 0, 18).subtract(SUN_DIR.scale(100));
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
      target = pos.add(new Vector3(fwd.x, -0.5 - this.lookPitch, fwd.z));
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
      const hits = this.scene.multiPickWithRay(new Ray(origin, dir.scale(1 / len), len + 0.5), (m) => m.metadata === 'wall') || [];
      const faded = new Set(hits.map((h) => h.pickedMesh));
      for (const m of this.fadedWalls || []) if (!faded.has(m)) m.visibility = 1;
      for (const m of faded) m.visibility = 0.25;
      this.fadedWalls = faded;
      const goal = desired;
      if (!this.camPos) this.camPos = goal.clone();
      this.camPos = Vector3.Lerp(this.camPos, goal, 1 - Math.exp(-dt * 7));
      cam.position.copyFrom(this.camPos);
      cam.fov = 0.95;
    }
    cam.setTarget(target);
    this.sun.position = base.subtract(SUN_DIR.scale(100));
    f.model?.root.computeWorldMatrix(true);
    this.rearview?.update(f.model?.root, f.geo.s);
    // Cabina chiusa: si vede da fuori, in prima persona viene nascosta per una vista pulita
    const firstPerson = this.settings.view === 'first';
    if (f.model?.cabShell?.length && this.cabHidden !== firstPerson) {
      this.cabHidden = firstPerson;
      f.model.cabShell.forEach((m) => m.setEnabled(!firstPerson));
    }
  }
}
