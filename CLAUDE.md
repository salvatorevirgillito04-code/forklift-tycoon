# Forklift Tycoon — regole del progetto

Gioco 3D per telefono con un muletto: guida, contratti di carico, magazzini, operai IA ed eventi settimanali.
Tecnologie: Babylon.js 9 (import profondi), Vite, Capacitor Android, Supabase (salvataggi cloud ed eventi), Sentry.
Sito: https://salvatorevirgillito04-code.github.io/forklift-tycoon/ (GitHub Pages si pubblica a ogni push su `main`).

## Regole fisse (valgono per la sessione principale e per ogni agente)
1. **Parla sempre in italiano**: messaggi, rapporti, commenti nel codice, messaggi di commit.
2. **Fai sempre tante domande**: prima di ogni lavoro chiedi i dettagli che mancano, non indovinare.
3. **Prima l'analisi, poi il codice**: presenta cause, file da modificare, correzioni e rischi, poi aspetta l'approvazione.
4. **Non dichiarare mai test non eseguiti**: distingui sempre misure reali, ipotesi e test manuali da fare sul telefono.
   Le misure fatte sul computer (Chromium senza schermo, grafica software SwiftShader) non valgono come FPS del telefono.
5. **Mai su `main` senza approvazione**: niente merge, niente push su `main`, niente pubblicazione (sito, APK
   ufficiale, `downloads/forklift-tycoon.apk`) senza un "sì" esplicito. Commit e push sono permessi solo sui rami di lavoro,
   dopo che i test sono passati.
6. **Non toccare ciò che non è stato chiesto**: la logica gestionale, gli operai IA, i contratti, il garage, i magazzini,
   l'economia, la fisica e lo sterzo già approvati si cambiano solo se il lavoro lo richiede e con approvazione.
7. **Salvataggi compatibili**: i salvataggi locali e quelli su Supabase devono restare leggibili. Ogni campo nuovo ha un
   valore predefinito. Prima di modificare il database fai un backup (schema `backup`).
8. **Segreti**: le chiavi (Tripo, firma APK, password) non vanno mai nel codice del gioco, nell'APK, nei log, nei
   salvataggi, in Git o nella chat. Le chiavi pubbliche di Supabase (publishable) e il DSN di Sentry sono già pubblici per scelta.
9. **Tripo 3D consuma crediti**: prima di ogni operazione a pagamento stima il costo, indica l'asset e il miglioramento,
   e chiedi l'approvazione esplicita. Le chiamate a Tripo non vanno mai nel gioco (solo `tools/tripo`).
10. **Niente build iOS.** Obiettivo prestazioni: almeno 30 FPS stabili su Android medio e almeno 50 sull'Oppo Reno 12 del proprietario.

## Come si lavora: squadra di agenti (`.claude/agents/`)
Ogni lavoro passa dagli agenti giusti, in quest'ordine:

1. `analista`: studia il codice e prepara un rapporto con cause, file, rischi e domande. Poi **stop: serve l'approvazione**.
2. Lo specialista adatto, se serve: `fisica-guida`, `prestazioni`, `grafica-3d`, `supabase`, `interfaccia`, `gestionale`.
3. `sviluppatore`: scrive il codice approvato.
4. `revisore`: rilegge le modifiche e cerca errori, regressioni e codice inutile.
5. `verificatore`: esegue i test e i controlli visivi, e riporta solo ciò che ha eseguito davvero.
6. `sicurezza`: controlla segreti, permessi del database e dati personali.
7. `rilascio`: prepara l'APK di prova. La pubblicazione avviene solo dopo l'approvazione.

Per le piccole correzioni la sessione principale può saltare i passaggi 1 e 2, ma non 4, 5 e 6.

## Procedure ripetibili (`.claude/skills/`)
- `build-apk`: APK di prova o ufficiale, con firma e versionCode verificati.
- `controllo-regressioni`: banco di prova della guida, build, screenshot prima/dopo e salvataggi.
- `misura-prestazioni`: confronto tra versioni, scenari fissi, misure separate dalle ipotesi.
- `tripo-sicuro`: inventario dei modelli, stima dei costi, approvazione prima di consumare crediti.

## Comandi utili
- `npm run dev`: server di sviluppo (espone `window.__app` per i test).
- `npm run build`: build del sito; con `VITE_TEST_BUILD=1` attiva il contatore prestazioni nelle impostazioni.
- `npm run test:drive`: banco di prova della guida (6 muletti, sereno e neve). Deve finire con "Tutte le prove passate".
- `node tools/tripo/tripo.mjs balance|usage|task|estimate`: Tripo, senza crediti.
- `tools/perf/`: script di misura (vedi la skill `misura-prestazioni`).

## Mappa del codice
- `src/game/forklift.js`: fisica del muletto (sterzo posteriore, freni, carico, collisioni). Costanti dello sterzo in `STEER`.
- `src/game/game.js`: ciclo di gioco, camera, qualità grafica, risoluzione dinamica, contatore prestazioni.
- `src/game/perfmonitor.js`: misuratore (FPS, 1% low, picchi con causa).
- `src/game/world.js`: quartiere, capannoni, oggetti fissi uniti per materiale e per zona.
- `src/game/environment.js`: orario, meteo, nebbia, superfici bagnate o innevate.
- `src/game/workerbots.js`, `people.js`, `traffic.js`: operai IA, pedoni, auto.
- `src/game/mission.js`, `src/data.js`: contratti, magazzini, veicoli, economia.
- `src/state.js`: salvataggio (localStorage e Supabase), `src/cloud.js`, `src/events.js`: eventi e classifiche.
- `src/ui/`: schermate. `src/i18n.js`: testi in italiano, spagnolo e inglese.
- `tests/drive/run.cjs`: banco di prova della guida. `public/models/`: modelli GLB (Tripo 3D, ottimizzati).
