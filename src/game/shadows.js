// Elenco degli oggetti che fanno ombra, indipendente dal generatore di ombre in uso:
// cambiando qualita' grafica si sostituisce il generatore e gli oggetti vengono riassegnati.
export class ShadowCasters {
  constructor() {
    this.set = new Set();
    this.gen = null;
  }

  addShadowCaster(mesh) {
    if (this.set.has(mesh)) return;
    this.set.add(mesh);
    this.gen?.addShadowCaster(mesh);
    mesh.onDisposeObservable.addOnce(() => this.set.delete(mesh));
  }

  // Fanno ombra solo gli oggetti vicini al punto (x, z): meno disegni nella mappa delle ombre
  cull(x, z, radius) {
    const list = this.gen?.getShadowMap()?.renderList;
    if (!list) return;
    list.length = 0;
    for (const m of this.set) {
      if (!m.isEnabled() || m.isDisposed()) continue;
      if (!m.isWorldMatrixFrozen) m.computeWorldMatrix(true); // posizione aggiornata (muletti e pallet si muovono)
      const s = m.getBoundingInfo().boundingSphere;
      const c = s.centerWorld;
      if (Math.hypot(c.x - x, c.z - z) - s.radiusWorld < radius) list.push(m);
    }
  }

  attach(gen) {
    if (this.gen && this.gen !== gen) this.gen.dispose();
    this.gen = gen;
    if (gen) for (const m of this.set) gen.addShadowCaster(m);
  }
}
