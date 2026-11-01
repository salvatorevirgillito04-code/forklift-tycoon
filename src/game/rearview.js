import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Frustum } from '@babylonjs/core/Maths/math.frustum.js';

// Specchietto retrovisore mostrato in alto al centro dello schermo (prima e terza persona).
// Leggero: una piccola immagine aggiornata ogni REFRESH fotogrammi, che disegna solo gli oggetti vicini
// dentro l'inquadratura dello specchietto (escluso il muletto stesso).
// Babylon NON scarta da solo gli oggetti fuori dall'inquadratura di un'immagine come questa: li disegna tutti
// (e per ognuno ricontrolla i materiali), percio' la scelta degli oggetti si fa qui, con l'inquadratura vera.
const TEX_W = 96; // verticale: piu' alto che largo
const TEX_H = 144;
const RANGE = 30; // metri disegnati nello specchietto
const REFRESH = 3; // aggiornato 1 fotogramma su 3 (20 volte al secondo a 60 FPS): costa un terzo
const MIN_R = 0.5; // oggetti piu' piccoli (raggio in metri) non si notano in un'immagine cosi' piccola
const GAP_PX = 10; // distanza dalla minimappa
const TOP_PX = 8;
const DIST = 0.5; // distanza del pannello davanti alla camera principale

export function createRearview(scene, mainCam) {
  const rtt = new RenderTargetTexture('rearviewRTT', { width: TEX_W, height: TEX_H }, scene, false);
  rtt.refreshRate = REFRESH;
  rtt.renderParticles = false;
  rtt.renderSprites = false;
  rtt.wrapU = Texture.WRAP_ADDRESSMODE;
  rtt.uScale = -1; // immagine specchiata come uno specchio vero

  const cam = new FreeCamera('rearviewCam', Vector3.Zero(), scene, false);
  cam.minZ = 0.2;
  cam.maxZ = RANGE + 10;
  cam.fov = 0.95; // immagine stretta: angolo verticale piu' ampio per vedere abbastanza dietro
  rtt.activeCamera = cam;

  let root = null; // muletto da escludere
  const list = [];
  const camPos = new Vector3();
  const back = new Vector3();
  let planes = null; // piani dell'inquadratura dello specchietto
  rtt.renderList = [];
  // Lista calcolata a ogni aggiornamento: solo oggetti visibili, vicini e dietro al muletto
  rtt.getCustomRenderList = () => {
    list.length = 0;
    const vp = cam.getViewMatrix(true).multiply(cam.getProjectionMatrix(true));
    if (!planes) planes = Frustum.GetPlanes(vp);
    else Frustum.GetPlanesToRef(vp, planes);
    for (const m of scene.meshes) {
      if (m.metadata?.rearview || !m.isEnabled() || !m.isVisible || m.visibility < 1) continue;
      if (root && m.isDescendantOf(root)) continue;
      const bs = m.getBoundingInfo().boundingSphere;
      if (bs.radiusWorld < MIN_R) continue; // pezzi piccoli: invisibili nello specchietto
      const dx = bs.centerWorld.x - camPos.x, dz = bs.centerWorld.z - camPos.z;
      const dist = Math.hypot(dx, dz) - bs.radiusWorld;
      if (dist > RANGE) continue;
      // dietro al muletto (con un po' di margine laterale)
      if (dx * back.x + dz * back.z < -bs.radiusWorld - 2) continue;
      if (!m.isInFrustum(planes)) continue; // fuori dall'inquadratura dello specchietto
      list.push(m);
    }
    return list;
  };
  scene.customRenderTargets.push(rtt);

  // Pannello davanti alla camera principale, disegnato sopra la scena
  const frame = MeshBuilder.CreatePlane('rearviewFrame', { size: 1 }, scene);
  const glass = MeshBuilder.CreatePlane('rearviewGlass', { size: 1 }, scene);
  for (const m of [frame, glass]) {
    m.parent = mainCam;
    m.renderingGroupId = 1;
    m.isPickable = false;
    m.metadata = { rearview: true };
  }
  const frameMat = new StandardMaterial('rearviewFrameMat', scene);
  frameMat.disableLighting = true;
  frameMat.emissiveColor = new Color3(0.08, 0.09, 0.1);
  frame.material = frameMat;
  const mat = new StandardMaterial('rearviewMat', scene);
  mat.emissiveTexture = rtt;
  mat.disableLighting = true;
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  glass.material = mat;

  let enabled = true;
  let heightPx = 0;
  let pushPx = 0; // quanto deve scendere il pannello compiti (0 se lo specchietto non lo tocca)
  let layoutKey = '';
  let leftPx = 0;
  let miniH = 0;
  const api = {
    setEnabled(on) {
      enabled = on;
      frame.setEnabled(on);
      glass.setEnabled(on);
      const i = scene.customRenderTargets.indexOf(rtt);
      if (on && i < 0) scene.customRenderTargets.push(rtt);
      if (!on && i >= 0) scene.customRenderTargets.splice(i, 1);
      document.documentElement.style.setProperty('--rearview-h', on ? `${pushPx}px` : '0px');
    },
    // Da chiamare dopo aver posizionato la camera principale
    update(forkliftRoot, scale = 1) {
      root = forkliftRoot;
      if (!enabled || !forkliftRoot) return;
      const engine = scene.getEngine();
      const sw = engine.getRenderWidth() * engine.getHardwareScalingLevel();
      const sh = engine.getRenderHeight() * engine.getHardwareScalingLevel();
      // Dimensioni e posizione in pixel CSS -> mondo, alla distanza DIST dalla camera
      // Alto come la minimappa (bordo compreso)
      if (!miniH) miniH = document.querySelector('.minimap')?.getBoundingClientRect().height || 110;
      const hPx = miniH - 8;
      const wPx = hPx * (TEX_W / TEX_H);
      const worldPerPx = (2 * Math.tan(mainCam.fov / 2) * DIST) / sh;
      // Posizione accanto alla minimappa: ricalcolata solo quando cambia lo schermo
      const key = `${sw}x${sh}`;
      if (key !== layoutKey) {
        layoutKey = key;
        const mini = document.querySelector('.minimap')?.getBoundingClientRect();
        miniH = mini ? mini.height : miniH;
        leftPx = (mini ? mini.right : 0) + GAP_PX + 4;
        heightPx = hPx;
        // Il pannello compiti scende solo se lo specchietto arriva fino a lui (schermi stretti)
        const panel = document.querySelector('.task-panel')?.getBoundingClientRect();
        const panelLeft = panel ? panel.left : sw / 2 - 120;
        pushPx = leftPx + wPx + 4 > panelLeft - 6 ? hPx + 8 : 0;
        document.documentElement.style.setProperty('--rearview-h', `${pushPx}px`);
      }
      const xPx = leftPx + wPx / 2 - sw / 2;
      const yPx = sh / 2 - (TOP_PX + 4 + hPx / 2);
      glass.position.set(xPx * worldPerPx, yPx * worldPerPx, DIST);
      glass.scaling.set(wPx * worldPerPx, hPx * worldPerPx, 1);
      frame.position.set(xPx * worldPerPx, yPx * worldPerPx, DIST + 0.001);
      frame.scaling.set((wPx + 8) * worldPerPx, (hPx + 8) * worldPerPx, 1);
      // Telecamera dello specchietto: sopra il tettuccio, guarda indietro e un po' in basso
      const m = forkliftRoot.getWorldMatrix();
      Vector3.TransformCoordinatesToRef(new Vector3(0, 2.5 * scale, -0.6 * scale), m, camPos);
      Vector3.TransformNormalToRef(new Vector3(0, -0.18, -1), m, back);
      back.normalize();
      cam.position.copyFrom(camPos);
      cam.setTarget(camPos.add(back));
    },
    dispose() {
      const i = scene.customRenderTargets.indexOf(rtt);
      if (i >= 0) scene.customRenderTargets.splice(i, 1);
      rtt.dispose();
      cam.dispose();
      frame.dispose();
      glass.dispose();
      mat.dispose();
      frameMat.dispose();
      document.documentElement.style.setProperty('--rearview-h', '0px');
    },
  };
  return api;
}
