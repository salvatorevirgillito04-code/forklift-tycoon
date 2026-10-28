import {
  Color3, Color4, Vector3, Scene, Mesh, MeshBuilder, ShaderMaterial, Effect, VertexData, DynamicTexture,
  StandardMaterial, PBRMaterial, SpotLight, Constants,
} from '@babylonjs/core';
import { WAREHOUSES, WORLD } from '../data.js';
import { PLOT, plotToWorld } from './world.js';

// Orario e meteo del contratto: luce, cielo, nebbia, superfici bagnate o innevate, luci di notte, pioggia e neve.
// Tutto e' creato una volta sola all'avvio (niente scatti cambiando contratto) e acceso/spento qui.

const c3 = (h) => Color3.FromHexString(h);
// luce del sole/luna, ambiente, esposizione e colori del cielo per ogni orario
const TIMES = {
  day: {
    sunDir: new Vector3(-0.45, -1, -0.35), sun: 3.2, sunColor: '#fff5e0', hemi: 0.32, hemiGround: '#59544d',
    env: 0.75, exposure: 1.4, fog: '#9ea8bd', top: '#5b8fd6', horizon: '#c7d8ec', photo: true,
  },
  sunset: {
    sunDir: new Vector3(-0.9, -0.28, -0.35), sun: 2.4, sunColor: '#ffa45e', hemi: 0.26, hemiGround: '#6b4a3a',
    env: 0.5, exposure: 1.35, fog: '#d99a78', top: '#3b4f8f', horizon: '#ffad6b', glow: '#ff8a3d',
  },
  dawn: {
    sunDir: new Vector3(0.9, -0.3, 0.35), sun: 2.0, sunColor: '#ffc3a0', hemi: 0.3, hemiGround: '#5a5560',
    env: 0.55, exposure: 1.35, fog: '#c9b8c4', top: '#6f8fc4', horizon: '#f6c6b6', glow: '#ffb38a',
  },
  night: {
    sunDir: new Vector3(0.3, -1, 0.5), sun: 0.55, sunColor: '#9fb4ff', hemi: 0.33, hemiGround: '#262b40',
    env: 0.2, exposure: 1.45, fog: '#0c1220', top: '#03060f', horizon: '#14203a', stars: true, lights: true,
  },
};
// il brutto tempo copre il cielo: meno sole, piu' luce diffusa, nebbia piu' vicina
const WEATHER = {
  clear: { sun: 1, hemi: 1, fogStart: 70, fogEnd: 160 },
  rain: { sun: 0.3, hemi: 1.35, fogStart: 25, fogEnd: 120, overcast: '#7d8794', wet: true },
  snow: { sun: 0.45, hemi: 1.6, fogStart: 20, fogEnd: 110, overcast: '#c3cad3', snow: true },
  fog: { sun: 0.4, hemi: 1.4, fogDensity: 0.028, overcast: '#b5bcc4' },
};

// Pioggia (righe) e neve (fiocchi): quadratini mossi interamente dalla scheda video attorno alla camera.
// Dentro i capannoni non cade niente (rettangoli dei tetti passati allo shader).
Effect.ShadersStore.precipVertexShader = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 viewProjection;
uniform vec3 cam;
uniform float time, speed, size, len, drift;
uniform vec4 roofs[10];
varying vec2 vUv;
varying float vFade;
const float BOX = 26.0;
const float H = 16.0;
void main() {
  vec3 p = position;
  p.y = mod(p.y - time * speed, H);
  p.x += sin(time * 1.3 + position.z * 3.0) * drift;
  p.z += cos(time * 1.1 + position.x * 3.0) * drift;
  // il volume segue la camera senza scatti (avvolto su se stesso)
  vec3 w;
  w.x = cam.x + mod(p.x - cam.x + BOX * 0.5, BOX) - BOX * 0.5;
  w.z = cam.z + mod(p.z - cam.z + BOX * 0.5, BOX) - BOX * 0.5;
  w.y = cam.y - 4.0 + p.y;
  float inside = 0.0;
  for (int i = 0; i < 10; i++) {
    vec4 r = roofs[i];
    if (w.x > r.x && w.x < r.z && w.z > r.y && w.z < r.w && w.y < 9.6) inside = 1.0;
  }
  // rivolto verso la camera attorno all'asse verticale (pioggia) o del tutto (neve)
  vec3 toCam = normalize(vec3(cam.x - w.x, 0.0, cam.z - w.z));
  vec3 side = vec3(-toCam.z, 0.0, toCam.x);
  w += side * (uv.x - 0.5) * size + vec3(0.0, 1.0, 0.0) * (uv.y - 0.5) * len;
  float d = length(w - cam);
  vFade = (1.0 - inside) * clamp(d / 1.2, 0.0, 1.0) * clamp((BOX * 0.5 - d) / 4.0, 0.0, 1.0);
  vUv = uv;
  gl_Position = viewProjection * vec4(w, 1.0);
}`;
Effect.ShadersStore.precipFragmentShader = `
precision mediump float;
varying vec2 vUv;
varying float vFade;
uniform vec3 color;
uniform float alpha, round;
void main() {
  vec2 q = vUv - 0.5;
  float a = round > 0.5 ? smoothstep(0.5, 0.15, length(q)) : (1.0 - abs(q.x) * 2.0) * smoothstep(0.0, 0.3, vUv.y);
  a *= alpha * vFade;
  if (a < 0.01) discard;
  gl_FragColor = vec4(color, a);
}`;

// Cielo a sfumatura (alba, tramonto, notte, cielo coperto): orizzonte -> zenit, bagliore del sole, stelle
Effect.ShadersStore.gradskyVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main() { vDir = position; gl_Position = worldViewProjection * vec4(position, 1.0); }`;
Effect.ShadersStore.gradskyFragmentShader = `
precision mediump float;
varying vec3 vDir;
uniform vec3 top, horizon, glow, sunDir;
uniform float glowAmt, stars;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.1, 1.0);
  vec3 c = mix(horizon, top, pow(max(h, 0.0), 0.55));
  float s = max(dot(d, -sunDir), 0.0);
  c += glow * glowAmt * (pow(s, 6.0) * 0.6 + pow(s, 60.0));
  if (stars > 0.5 && d.y > 0.05) {
    vec3 g = floor(d * 180.0);
    float n = hash(g);
    c += vec3(step(0.996, n) * (0.5 + 0.5 * hash(g + 1.0))) * smoothstep(0.05, 0.3, d.y);
  }
  gl_FragColor = vec4(c, 1.0);
}`;

const DRY = { brake: 1, accel: 1, steer: 30, stability: 1 };

export class Environment {
  constructor(scene, { sun, hemi, sky, mats, camera, world }) {
    Object.assign(this, { scene, sun, hemi, sky, mats, camera, world });
    this.time = 'day';
    this.weather = 'clear';
    this.t = 0;
    this.base = this.saveMaterials();
    this.buildGradientSky();
    this.buildPrecip();
    this.buildNightLights();
    this.buildPuddles();
    this.snowMat = this.makeSnowMaterial();
    this.apply('day', 'clear');
  }

  // valori di partenza dei materiali che cambiano col meteo (per tornare al sereno)
  saveMaterials() {
    const m = this.mats;
    const keep = (mat) => ({ mat, rough: mat.roughness, metal: mat.metallic, color: mat.albedoColor.clone() });
    return { concrete: keep(m.concrete), asphalt: keep(m.asphalt), roof: keep(m.roof) };
  }

  buildGradientSky() {
    const dome = MeshBuilder.CreateSphere('gradSky', { diameter: 300, segments: 16, sideOrientation: Mesh.BACKSIDE }, this.scene);
    const mat = new ShaderMaterial('gradSkyMat', this.scene, 'gradsky', {
      attributes: ['position'], uniforms: ['worldViewProjection', 'top', 'horizon', 'glow', 'sunDir', 'glowAmt', 'stars'],
    });
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    dome.material = mat;
    dome.infiniteDistance = true;
    dome.applyFog = false;
    dome.isPickable = false;
    dome.renderingGroupId = 0;
    dome.setEnabled(false);
    this.gradSky = { dome, mat };
  }

  buildPrecip() {
    const make = (name, count, round) => {
      const pos = [], uv = [], idx = [];
      for (let i = 0; i < count; i++) {
        const x = (Math.random() - 0.5) * 26, y = Math.random() * 16, z = (Math.random() - 0.5) * 26;
        const b = i * 4;
        for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { pos.push(x, y, z); uv.push(u, v); }
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      const mesh = new Mesh(name, this.scene);
      const vd = new VertexData();
      vd.positions = pos;
      vd.uvs = uv;
      vd.indices = idx;
      vd.applyToMesh(mesh);
      const mat = new ShaderMaterial(name + 'Mat', this.scene, 'precip', {
        attributes: ['position', 'uv'],
        uniforms: ['viewProjection', 'cam', 'time', 'speed', 'size', 'len', 'drift', 'roofs', 'color', 'alpha', 'round'],
        needAlphaBlending: true,
      });
      mat.backFaceCulling = false;
      mat.disableDepthWrite = true;
      mat.alphaMode = Constants.ALPHA_COMBINE;
      mat.setFloat('round', round ? 1 : 0);
      // rettangoli dei tetti dei capannoni (niente pioggia dentro)
      const roofs = [];
      for (const wh of WAREHOUSES) {
        const B = PLOT.building;
        const [x0, z0] = plotToWorld(wh, B.u[0], B.w[0]);
        const [x1, z1] = plotToWorld(wh, B.u[1], B.w[1]);
        roofs.push(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1));
      }
      mat.setArray4('roofs', roofs);
      mesh.material = mat;
      mesh.alwaysSelectAsActiveMesh = true; // si muove nello shader: niente esclusione per fuori campo
      mesh.isPickable = false;
      mesh.applyFog = false;
      mesh.metadata = { rearview: true }; // non nello specchietto (lo shader segue la camera principale)
      mesh.setEnabled(false);
      return { mesh, mat };
    };
    this.rain = make('rain', 2000, false);
    const r = this.rain.mat;
    r.setFloat('speed', 14); r.setFloat('size', 0.018); r.setFloat('len', 0.55); r.setFloat('drift', 0.05);
    r.setColor3('color', new Color3(0.8, 0.85, 0.92)); r.setFloat('alpha', 0.55);
    this.snow = make('snow', 2400, true);
    const s = this.snow.mat;
    s.setFloat('speed', 1.4); s.setFloat('size', 0.085); s.setFloat('len', 0.085); s.setFloat('drift', 0.6);
    s.setColor3('color', new Color3(1, 1, 1)); s.setFloat('alpha', 0.95);
  }

  // Luci di notte "dipinte": macchie di luce a terra sotto i lampioni e nei capannoni (nessuna luce vera, leggere)
  buildNightLights() {
    const tex = new DynamicTexture('poolTex', 128, this.scene, true);
    const ctx = tex.getContext();
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,214,150,1)');
    g.addColorStop(0.45, 'rgba(255,190,110,0.45)');
    g.addColorStop(1, 'rgba(255,170,80,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    tex.update();
    tex.hasAlpha = true;
    const mat = new StandardMaterial('poolMat', this.scene);
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.disableLighting = true;
    mat.alphaMode = Constants.ALPHA_ADD;
    mat.disableDepthWrite = true;
    mat.fogEnabled = true;
    const pools = [];
    const add = (x, z, r, y = 0.03) => {
      const d = MeshBuilder.CreateGround('pool', { width: r * 2, height: r * 2 }, this.scene);
      d.position.set(x, y, z);
      pools.push(d);
    };
    // lampioni della strada: luce verso la strada e il marciapiede
    for (let x = WORLD.minX + 10; x < WORLD.maxX; x += 22) {
      for (const z of [-7.6, 7.6]) add(x, z * 0.62, 8);
    }
    for (const wh of WAREHOUSES) {
      // dentro: sotto le lampade a soffitto
      for (const u of [-8, 0, 8]) for (const w of [36, 46]) { const [x, z] = plotToWorld(wh, u, w); add(x, z, 7, 0.02); }
      // fuori: faro sopra il portone che illumina il piazzale
      const [x, z] = plotToWorld(wh, 0, PLOT.building.w[0] - 6);
      add(x, z, 10);
    }
    // scaffalature: corridoio illuminato davanti
    for (const wh of WAREHOUSES) {
      const R = PLOT.racks;
      for (let u = R.u[0] + 1.5; u < R.u[1]; u += 4.1) { const [x, z] = plotToWorld(wh, u, R.w[0] - 1.6); add(x, z, 3.6, 0.025); }
    }
    const merged = Mesh.MergeMeshes(pools, true, true);
    merged.name = 'nightPools';
    merged.material = mat;
    merged.isPickable = false;
    merged.setEnabled(false);
    this.pools = merged;
    // luce delle lampade sulla faccia della scaffalatura: pannello verticale sfumato (piu' chiaro in alto)
    const vt = new DynamicTexture('rackGlowTex', { width: 16, height: 128 }, this.scene, true);
    const vc = vt.getContext();
    const vg = vc.createLinearGradient(0, 0, 0, 128);
    vg.addColorStop(0, 'rgba(255,210,150,0.16)');
    vg.addColorStop(0.5, 'rgba(255,200,140,0.06)');
    vg.addColorStop(1, 'rgba(255,190,120,0)');
    vc.fillStyle = vg;
    vc.fillRect(0, 0, 16, 128);
    vt.update();
    vt.hasAlpha = true;
    const vm = new StandardMaterial('rackGlowMat', this.scene);
    vm.diffuseColor = Color3.Black();
    vm.specularColor = Color3.Black();
    vm.emissiveTexture = vt;
    vm.opacityTexture = vt;
    vm.disableLighting = true;
    vm.alphaMode = Constants.ALPHA_ADD;
    vm.disableDepthWrite = true;
    vm.backFaceCulling = false;
    const glows = [];
    for (const wh of WAREHOUSES) {
      const R = PLOT.racks;
      const [x0, z0] = plotToWorld(wh, R.u[0], R.w[0] - 0.12);
      const [x1] = plotToWorld(wh, R.u[1], R.w[0] - 0.12);
      const pl = MeshBuilder.CreatePlane('rackGlow', { width: Math.abs(x1 - x0), height: R.height }, this.scene);
      pl.position.set((x0 + x1) / 2, R.height / 2, z0);
      glows.push(pl);
    }
    const rg = Mesh.MergeMeshes(glows, true, true);
    rg.name = 'rackGlow';
    rg.material = vm;
    rg.isPickable = false;
    rg.setEnabled(false);
    this.rackGlow = rg;
    // fari del muletto (l'unica luce vera di notte: una sola, segue il giocatore)
    this.headlight = new SpotLight('headlight', Vector3.Zero(), new Vector3(0, -0.35, 1), 1.1, 2, this.scene);
    this.headlight.diffuse = c3('#fff1d6');
    this.headlight.specular = c3('#403a30');
    this.headlight.range = 30;
    this.headlight.intensity = 0;
    this.headlight.setEnabled(false);
  }

  // Pozzanghere: chiazze scure e lucide sui piazzali e sulla strada (solo con la pioggia)
  buildPuddles() {
    const list = [];
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 70; i++) {
      const x = WORLD.minX + 6 + rnd() * (WORLD.maxX - WORLD.minX - 12);
      // non dentro i capannoni: solo strada e piazzali (|z| < 28)
      const z = (rnd() * 2 - 1) * 27;
      const d = MeshBuilder.CreateDisc('puddle', { radius: 0.8 + rnd() * 1.6, tessellation: 14 }, this.scene);
      d.rotation.x = Math.PI / 2;
      d.scaling.y = 0.5 + rnd() * 0.5;
      d.rotation.y = rnd() * Math.PI;
      d.position.set(x, 0.012, z);
      list.push(d);
    }
    const merged = Mesh.MergeMeshes(list, true, true);
    merged.name = 'puddles';
    const mat = new PBRMaterial('puddleMat', this.scene);
    mat.albedoColor = c3('#1b1e22');
    mat.metallic = 0.1;
    mat.roughness = 0.04;
    mat.alpha = 0.85;
    merged.material = mat;
    merged.receiveShadows = true;
    merged.isPickable = false;
    merged.setEnabled(false);
    this.puddles = merged;
  }

  // Neve a terra: bianco leggermente irregolare (stessa coordinata del mondo dei materiali di terra)
  makeSnowMaterial() {
    const tex = new DynamicTexture('snowTex', 256, this.scene, true);
    const ctx = tex.getContext();
    ctx.fillStyle = '#eef2f6';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1400; i++) {
      const v = 225 + Math.floor(Math.random() * 30);
      ctx.fillStyle = `rgba(${v - 8},${v - 3},${v},0.5)`;
      ctx.beginPath();
      ctx.arc(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 6, 0, Math.PI * 2);
      ctx.fill();
    }
    tex.update();
    tex.wrapU = tex.wrapV = 1;
    tex.uScale = tex.vScale = 1;
    const mat = new PBRMaterial('snowGround', this.scene);
    mat.albedoTexture = tex;
    mat.albedoColor = new Color3(1, 1, 1);
    mat.roughness = 0.85;
    mat.metallic = 0;
    return mat;
  }

  // meshes a terra/tetti col materiale originale (dopo l'unione dei fissi), per scambiarlo con la neve
  groundMeshes() {
    if (this.ground) return this.ground;
    const m = this.mats;
    const wanted = new Set([m.concrete, m.grass, m.roof]);
    this.ground = this.scene.meshes.filter((x) => wanted.has(x.material)).map((mesh) => ({ mesh, mat: mesh.material }));
    return this.ground;
  }

  apply(time = 'day', weather = 'clear') {
    const T = TIMES[time] || TIMES.day, W = WEATHER[weather] || WEATHER.clear;
    this.time = time;
    this.weather = weather;
    const scene = this.scene;
    const sunDir = T.sunDir.clone().normalize();
    this.sunDir = sunDir;
    this.sun.direction = sunDir;
    this.sun.intensity = T.sun * W.sun;
    this.sun.diffuse = c3(T.sunColor);
    this.hemi.intensity = T.hemi * W.hemi;
    this.hemiBase = this.hemi.intensity;
    this.flash = 0;
    this.nextBolt = weather === 'rain' ? 8 + Math.random() * 20 : Infinity;
    this.hemi.groundColor = c3(T.hemiGround);
    this.hemi.diffuse = time === 'night' ? c3('#8fa0d0') : Color3.White();
    scene.environmentIntensity = T.env * (weather === 'clear' ? 1 : 0.8);
    scene.imageProcessingConfiguration.exposure = T.exposure;
    // cielo: foto di giorno col sereno, altrimenti sfumatura (coperto = grigio, scurito di notte)
    const overcast = W.overcast && c3(W.overcast).scale(time === 'night' ? 0.12 : time === 'day' ? 1 : 0.7);
    const fogColor = overcast ? Color3.Lerp(c3(T.fog), overcast, time === 'night' ? 0.3 : 0.75) : c3(T.fog);
    const usePhoto = T.photo && weather === 'clear';
    this.photoSky = usePhoto;
    this.sky.setEnabled(usePhoto && this.skyAllowed !== false);
    this.gradSky.dome.setEnabled(!usePhoto);
    const gm = this.gradSky.mat;
    gm.setColor3('top', overcast ? overcast.scale(0.85) : c3(T.top));
    gm.setColor3('horizon', overcast || c3(T.horizon));
    gm.setColor3('glow', T.glow ? c3(T.glow) : Color3.Black());
    gm.setFloat('glowAmt', T.glow && !overcast ? (time === 'dawn' ? 0.45 : 1) : 0);
    gm.setVector3('sunDir', sunDir);
    gm.setFloat('stars', T.stars && !overcast ? 1 : 0);
    scene.clearColor = Color4.FromColor3(fogColor, 1);
    scene.fogColor = fogColor;
    if (W.fogDensity) {
      scene.fogMode = Scene.FOGMODE_EXP2;
      scene.fogDensity = W.fogDensity * (time === 'night' ? 1.2 : 1);
    } else {
      scene.fogMode = Scene.FOGMODE_LINEAR;
      scene.fogStart = W.fogStart * (time === 'night' ? 0.7 : 1);
      scene.fogEnd = W.fogEnd * (time === 'night' ? 0.8 : 1);
    }
    // superfici: bagnate (pioggia) o innevate (neve)
    const b = this.base;
    const wet = W.wet || W.snow;
    b.asphalt.mat.roughness = wet ? 0.28 : b.asphalt.rough;
    b.asphalt.mat.albedoColor = wet ? b.asphalt.color.scale(0.6) : b.asphalt.color;
    b.concrete.mat.roughness = W.wet ? 0.4 : b.concrete.rough;
    b.concrete.mat.albedoColor = W.wet ? b.concrete.color.scale(0.72) : b.concrete.color;
    for (const g of this.groundMeshes()) g.mesh.material = W.snow ? this.snowMat : g.mat;
    this.puddles.setEnabled(!!W.wet);
    this.rain.mesh.setEnabled(!!W.wet);
    this.snow.mesh.setEnabled(!!W.snow);
    // luci di notte (anche col cielo molto coperto all'alba/tramonto restano spente)
    this.pools.setEnabled(!!T.lights);
    this.rackGlow.setEnabled(!!T.lights);
    this.mats.light.emissiveColor = T.lights ? c3('#fff2b0').scale(2.2) : c3('#fff2b0');
    this.headlight.setEnabled(!!T.lights || weather === 'fog');
    this.headlight.intensity = T.lights ? 9 : 4;
  }

  // dentro la qualita' Bassa il cielo fotografico e' spento: lo decide la qualita'
  setSkyAllowed(on) {
    this.skyAllowed = on;
    this.sky.setEnabled(on && this.photoSky);
  }

  update(dt, forklift) {
    this.t += dt;
    // lampi con la pioggia ogni 30-60 s: luce improvvisa (doppio bagliore), poi il tuono
    if (forklift && this.weather === 'rain') {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.nextBolt = 30 + Math.random() * 30;
        const near = Math.random() < 0.35;
        this.flash = 0.45;
        this.onThunder?.(near ? 0.4 + Math.random() * 0.8 : 2 + Math.random() * 3, near);
      }
    }
    if (this.flash > 0) {
      this.flash -= dt;
      // due lampi ravvicinati
      const f = this.flash > 0.3 || (this.flash > 0.08 && this.flash < 0.18) ? 1 : 0;
      this.hemi.intensity = this.hemiBase + f * (this.time === 'night' ? 1.4 : 0.9);
      if (this.flash <= 0) this.hemi.intensity = this.hemiBase;
    }
    const cam = this.camera.globalPosition;
    for (const p of [this.rain, this.snow]) {
      if (!p.mesh.isEnabled()) continue;
      p.mat.setFloat('time', this.t);
      p.mat.setVector3('cam', cam);
    }
    if (this.headlight.isEnabled() && forklift) {
      const s = forklift.geo.s, yaw = forklift.yaw;
      const fwd = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      this.headlight.position.set(forklift.x - fwd.x * 0.2 * s, 2.1 * s, forklift.z - fwd.z * 0.2 * s);
      this.headlight.direction.set(fwd.x, -0.32, fwd.z);
    }
  }

  // Aderenza nel punto (x, z): 1 = asciutto. Pioggia: frenata ~20% piu' lunga; neve: ~45%, sterzo che scivola,
  // accelerazione un po' piu' debole, carico meno stabile in frenata e in curva.
  grip(x, z) {
    const w = this.isWetAt(x, z);
    if (!w) return DRY;
    const snow = this.weather === 'snow';
    const mix = (v) => 1 - w * (1 - v);
    return { brake: mix(snow ? 1 / 1.45 : 1 / 1.2), accel: mix(snow ? 0.8 : 0.95), steer: snow ? 4 + (1 - w) * 30 : 30, stability: mix(snow ? 0.75 : 0.9) };
  }

  // 1 all'aperto, 0 dentro un capannone (per attutire i suoni del meteo)
  isOutside(x, z) {
    for (const wh of WAREHOUSES) {
      const B = PLOT.building;
      const [x0, z0] = plotToWorld(wh, B.u[0], B.w[0]);
      const [x1, z1] = plotToWorld(wh, B.u[1], B.w[1]);
      if (x > Math.min(x0, x1) && x < Math.max(x0, x1) && z > Math.min(z0, z1) && z < Math.max(z0, z1)) return 0;
    }
    return 1;
  }

  // ci si trova all'aperto? (pioggia/neve fanno scivolare solo fuori e vicino al portone)
  isWetAt(x, z) {
    if (this.weather !== 'rain' && this.weather !== 'snow') return 0;
    for (const wh of WAREHOUSES) {
      const B = PLOT.building;
      const [x0, z0] = plotToWorld(wh, B.u[0], B.w[0]);
      const [x1, z1] = plotToWorld(wh, B.u[1], B.w[1]);
      if (x > Math.min(x0, x1) && x < Math.max(x0, x1) && z > Math.min(z0, z1) && z < Math.max(z0, z1)) {
        // dentro: ancora bagnato nei primi 4 metri dopo il portone, poi asciutto
        const w = Math.abs(z) - B.w[0];
        return w < 4 ? 1 - w / 4 : 0;
      }
    }
    return 1;
  }
}
