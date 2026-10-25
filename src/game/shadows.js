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

  attach(gen) {
    if (this.gen && this.gen !== gen) this.gen.dispose();
    this.gen = gen;
    if (gen) for (const m of this.set) gen.addShadowCaster(m);
  }
}
