---
name: controllo-regressioni
description: Controllo completo prima di un commit o di un APK di Forklift Tycoon - banco di prova della guida, build, avvio nel browser senza errori, screenshot prima/dopo e compatibilita' dei salvataggi. Usala dopo ogni modifica al codice.
---
# Controllo regressioni

Riporta **solo** ciò che hai eseguito davvero, con comando ed esito.

## 1. Banco di prova della guida (sempre, se la modifica tocca il gioco)
```bash
npm run test:drive -- --json <scratchpad>/drive.json
```
- Deve finire con **"Tutte le prove passate"** (246 prove: 6 muletti × sereno e neve).
- Se qualcosa fallisce: riporta le righe `FAIL` e i valori. **Non cambiare le soglie** per far passare il test.
- Con `VEH=d18 npm run test:drive` si prova un solo muletto, per controlli veloci (non basta per chiudere il lavoro).

## 2. Build
```bash
npm run build
```
Deve finire senza errori. Gli avvisi sulla dimensione dei file sono già noti.

## 3. Avvio nel browser
- Avvia il server di sviluppo `npx vite --port 5173` e aprilo con Playwright e Chromium, già installati:
  `require('playwright')`, `chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] })`.
- Aspetta `window.__app?.game?.world`, avvia un contratto con `window.__app.startMission({...})` ed esci con `exitMission()`.
- Non devono comparire errori nella pagina (`page.on('pageerror')`).

## 4. Aspetto (se la modifica tocca grafica, interfaccia o mondo)
```bash
tools/perf/confronto.sh <ramo-prima> 5181        # versione di prima
node tools/perf/shots.cjs 5181 prima clear perf-out
node tools/perf/shots.cjs 5173 dopo clear perf-out
tools/perf/confronto.sh --stop 5181
```
Confronta le immagini (affiancale e guardale). Le macchie a terra sono casuali a ogni avvio: non contano come differenza.
Ripeti con `rain` o `snow` se la modifica riguarda meteo o ambienti.

## 5. Salvataggi
- Se cambia `src/state.js` o la struttura dei dati, carica un salvataggio vecchio (es. dalla tabella di backup
  o creato con la versione su `main`) e controlla che si apra senza perdite.
- I campi nuovi devono avere un valore predefinito.

## 6. Rapporto
Una tabella con: controllo, comando, esito e numeri. In fondo, l'elenco dei **test manuali sul telefono** ancora da fare.
