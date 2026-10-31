---
name: misura-prestazioni
description: Misura e confronta le prestazioni di Forklift Tycoon tra versioni (es. A = main pubblica, B = ramo precedente, C = lavoro attuale) su scenari fissi, trova le cause dei picchi (shader, GC, caricamenti, ombre, specchietto, risoluzione) e separa le misure dalle ipotesi. Usala per ogni lavoro sulle prestazioni o sulla grafica.
---
# Misura prestazioni

## Cosa vale e cosa no
- Sul computer si usa Chromium senza schermo con grafica software (SwiftShader). **Gli FPS misurati qui non valgono per il telefono.**
- Qui valgono: draw call, triangoli, mesh attive, tempi della logica (step), allocazioni e GC, confronti tra versioni.
- Gli FPS reali arrivano solo dal telefono, con il contatore dell'APK di prova (Impostazioni → Contatore FPS):
  - FPS medio, minimo e 1% low calcolati sugli ultimi 10 s di gioco vero;
  - picchi con la causa: logica, disegno, ombre, specchietto, "fuori" (GPU, caricamenti asincroni, browser),
    nuovi oggetti, shader, GC, risoluzione.

## 1. Preparare le versioni
```bash
tools/perf/confronto.sh main 5181          # A: versione pubblica
tools/perf/confronto.sh <altro-ramo> 5182  # B (se serve)
npx vite --port 5173                       # C: lavoro attuale
```

## 2. Misure
- **Draw call e triangoli** (fisso e ripetibile, la misura principale):
  `node tools/perf/sweep.cjs A=5181 B=5182 C=5173`
- **Scenari** (piazzale, interno, guida, operai, pioggia, neve, prima persona):
  `node tools/perf/scenari.cjs A=5181 C=5173 --out perf-out/scenari.json`
  (`SC=guida node tools/perf/scenari.cjs ...` per un solo scenario). Pochi fotogrammi e rumore: usali per tempi della logica, memoria e GC, non per gli FPS.
- **Allocazioni** (chi produce lavoro per il GC):
  `node tools/perf/allocazioni.cjs <meteo> [varianti] [porta]`, es. `node tools/perf/allocazioni.cjs clear nomirror 5173`.
  Varianti per isolare le cause: `nomirror`, `noshadow`, `nopeople`, `nolights` (anche unite: `nomirror,noshadow`).
- **Aspetto**: `node tools/perf/shots.cjs <porta> <etichetta> [meteo] perf-out`.

## 3. Rapporto
- Una tabella per versione e scenario con le misure.
- Le **misure** separate dalle **ipotesi**, con quello che va verificato sul telefono.
- Ogni ottimizzazione proposta con il guadagno misurato e il costo (es. +draw call contro -triangoli).
- Non dichiarare raggiunto l'obiettivo FPS senza una misura fatta sul telefono.

## 4. Pulizia
`tools/perf/confronto.sh --stop 5181` (e per le altre porte). `git worktree list` deve mostrare solo il progetto.

## Cose già note (ottobre 2026)
- 2.9.0: circa 118 draw call e 276 mila triangoli (sweep piazzale). Fase 1.1: circa 152 draw call e 169 mila triangoli.
- Allocazioni: circa 0,7–1,2 MB per fotogramma, quasi metà dalla preparazione dei materiali non congelati
  (`PBRMaterial.isReadyForSubMesh` → `_prepareEffect`). Proposta in attesa di approvazione: congelare i materiali statici.
- Picchi: creazione degli operai quando si cambia lotto, shader alla prima comparsa, specchietto a fotogrammi alterni.
