# Strumento Tripo 3D (solo sviluppo)

Serve a controllare i crediti e a preparare le richieste a Tripo 3D. **Non fa parte del gioco**: non entra nel sito né nell'APK, e il gioco non chiama mai Tripo.

## Chiave

La chiave si legge solo sul computer di sviluppo, in uno di questi due modi:
- dalla variabile d'ambiente `TRIPO_API_KEY`;
- dal file `~/.config/tripo/key`, fuori dal progetto.

Non va mai messa nel codice del gioco, nell'APK, nei log, nei salvataggi o in Git.

## Comandi

Nessuno di questi comandi consuma crediti.

```
node tools/tripo/tripo.mjs balance                    # saldo crediti
node tools/tripo/tripo.mjs usage 20                   # ultimi consumi
node tools/tripo/tripo.mjs task <task_id>             # stato di un task
node tools/tripo/tripo.mjs estimate text-to-3d+texture +smart-low-poly   # stima costo
```

## Regole per le generazioni

Le generazioni consumano crediti, quindi **non sono implementate**. Prima di aggiungerne una:
1. verificare la pagina ufficiale dell'endpoint;
2. stimare il costo con `estimate`;
3. indicare quale asset si sostituisce e quale miglioramento porta;
4. ottenere l'approvazione esplicita.

I file generati vanno in `tools/tripo/out/` (esclusa da Git) e si controllano prima di toccare `public/models/`.

## Ottimizzazione senza crediti (Fase 1.1)

`barrel`, `cone`, `dumpster`, `barrier`, `lamp` e `pallet` sono stati semplificati con meshoptimizer (gltf-transform `simplify`): 30–55% di triangoli in meno, senza differenze visibili negli screenshot di confronto. Gli originali restano nella cronologia Git.
