import {
  MeshBuilder, StandardMaterial, RenderTargetTexture, FreeCamera, TransformNode, Vector3, Color3, Texture,
} from '@babylonjs/core';

// Specchietti retrovisori: ogni specchio ha una telecamera che guarda indietro
// e disegna la scena su una texture (specchiata in orizzontale come uno specchio vero).
const SIDES = [-1, 1];

export function createMirrors(scene, root, mats) {
  const items = SIDES.map((side) => {
    // Braccio fissato al montante anteriore del tettuccio, specchio verso l'esterno
    const mount = new TransformNode('mirrorMount', scene);
    mount.parent = root;
    mount.position.set(side * 0.62, 1.82, 0.14);

    const arm = MeshBuilder.CreateBox('mirrorArm', { width: 0.2, height: 0.025, depth: 0.025 }, scene);
    arm.parent = mount;
    arm.position.set(side * 0.08, 0, 0);
    arm.material = mats.darkSteel;

    const head = new TransformNode('mirrorHead', scene);
    head.parent = mount;
    head.position.set(side * 0.2, 0, 0);
    // La faccia dello specchio (-z locale) guarda indietro, ruotata verso il guidatore
    head.rotation.y = side * 0.32;

    const frame = MeshBuilder.CreateBox('mirrorFrame', { width: 0.3, height: 0.21, depth: 0.03 }, scene);
    frame.parent = head;
    frame.position.z = 0.016; // dietro al vetro
    frame.material = mats.rubber;

    const rtt = new RenderTargetTexture(`mirrorRTT${side}`, { width: 256, height: 180 }, scene, false);
    rtt.wrapU = Texture.WRAP_ADDRESSMODE;
    rtt.uScale = -1; // effetto specchio
    const cam = new FreeCamera(`mirrorCam${side}`, Vector3.Zero(), scene, false);
    cam.minZ = 0.1;
    cam.maxZ = 250;
    cam.fov = 0.75;
    rtt.activeCamera = cam;
    rtt.renderListPredicate = (m) => !m.metadata?.mirror && m.isEnabled() && m.isVisible;
    scene.customRenderTargets.push(rtt);

    const glass = MeshBuilder.CreatePlane('mirrorGlass', { width: 0.27, height: 0.18 }, scene);
    glass.parent = head;
    glass.position.z = -0.001;
    const mat = new StandardMaterial(`mirrorMat${side}`, scene);
    mat.emissiveTexture = rtt;
    mat.disableLighting = true;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    glass.material = mat;
    for (const m of [arm, frame, glass]) m.metadata = { mirror: true };

    return { side, head, glass, rtt, cam, mat };
  });

  const tmp = new Vector3();
  return {
    // Telecamere allineate allo specchio: guardano dietro al muletto, leggermente verso l'esterno
    update() {
      for (const it of items) {
        it.head.computeWorldMatrix(true);
        const wm = it.head.getWorldMatrix();
        Vector3.TransformCoordinatesToRef(Vector3.Zero(), wm, tmp);
        it.cam.position.copyFrom(tmp);
        // -z locale del muletto (indietro) ruotato verso l'esterno e un filo in basso
        const rootM = root.getWorldMatrix();
        const back = Vector3.TransformNormal(new Vector3(it.side * 0.5, -0.1, -1), rootM).normalize();
        it.cam.setTarget(tmp.add(back));
      }
    },
    dispose() {
      for (const it of items) {
        const i = scene.customRenderTargets.indexOf(it.rtt);
        if (i >= 0) scene.customRenderTargets.splice(i, 1);
        it.rtt.dispose();
        it.cam.dispose();
        it.mat.dispose();
      }
    },
  };
}

