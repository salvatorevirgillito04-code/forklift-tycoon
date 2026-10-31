---
name: tripo-sicuro
description: Uso sicuro di Tripo 3D per i modelli di Forklift Tycoon - inventario dei GLB, verifica dei costi sulla documentazione ufficiale, stima, richiesta di approvazione esplicita prima di ogni operazione che consuma crediti, controllo e integrazione dei modelli. Usala ogni volta che si parla di Tripo, modelli 3D nuovi o sostituzione di asset.
---
# Tripo 3D in sicurezza

## Regole (dal proprietario, sempre valide)
- La chiave si legge **solo** da strumenti di sviluppo locali (`TRIPO_API_KEY` o `~/.config/tripo/key`) o dalla
  connessione Tripo già configurata nella sessione. **Mai** nel codice del gioco, nell'APK, nei log, nei salvataggi,
  in Git o nella chat. Non chiedere al proprietario di incollare la chiave.
- **Non inventare** endpoint, parametri o funzioni: verificali sulla documentazione ufficiale (developers.tripo3d.com).
  Se una pagina non è leggibile, dillo e non procedere a indovinare.
- **Prima di ogni operazione che consuma crediti**:
  1. verifica il costo (listino ufficiale e consumi reali dell'account);
  2. indica quale asset riguarda;
  3. spiega quale miglioramento porta;
  4. chiedi l'**approvazione esplicita** e aspetta.
- Mai generazioni a pagamento automatiche. Mai chiamate Tripo nel gameplay Android. Mai sostituire asset senza approvazione.

## Strumenti (nessun credito)
```bash
node tools/tripo/tripo.mjs balance        # saldo
node tools/tripo/tripo.mjs usage 20       # ultimi consumi reali
node tools/tripo/tripo.mjs estimate text-to-3d+texture +smart-low-poly
```
Oppure, solo dalla sessione principale (non dagli agenti), con la connessione Tripo della sessione: solo saldo e
consumi, cioè le operazioni gratuite. Gli agenti usano solo `tools/tripo/tripo.mjs`, che non ha comandi a pagamento.

## Costi
Listino ufficiale (ottobre 2026), in crediti:
- testo→3D: 10, oppure 20 con texture;
- immagine→3D: 20, oppure 30 con texture;
- smart low-poly: +10;
- texture: 10–30;
- retopology: 10–40;
- rig: 25 (il controllo preliminare del rig è gratis);
- retarget: 10 per animazione.

**Attenzione**: i consumi reali di questo account sono stati più alti (testo→3D 30–40, retarget 20). Indica sempre una
stima prudente e, dopo la prima operazione, verifica il costo vero con `usage`. Saldo al 31/10/2026: 1480 crediti.

## Flusso per un modello nuovo o migliorato
1. Inventario: triangoli, materiali, texture e peso del modello attuale (script con gltf-transform nello scratchpad).
2. Prima prova a migliorarlo **senza crediti**: semplificazione con meshoptimizer, texture più leggere, LOD.
3. Proposta con asset, problema, miglioramento atteso, costo stimato e alternativa gratuita. Poi **aspetta il sì**.
4. Dopo l'approvazione: genera, salva in `tools/tripo/out/` (escluso da Git) e controlla scala, orientamento,
   triangoli e texture.
5. Ottimizza, poi screenshot prima/dopo nel gioco. Sostituisci in `public/models/` solo dopo l'approvazione.
6. Registra il costo vero (da `usage`) nel rapporto.
