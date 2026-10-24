# Forklift Tycoon

Simulatore 3D di carrelli elevatori per smartphone. Sei un mulettista in proprio: accetti contratti di carico e scarico camion, guadagni monete d'oro, compri magazzini e muletti sempre più potenti.

**Gioca:** https://salvatorevirgillito04-code.github.io/forklift-tycoon/

## Installarlo sul telefono

Il gioco è una web app installabile (PWA) e si apre a schermo intero, in orizzontale, come un'app.

- **Android (Chrome):** apri il link e tocca **Installa app** nella Home del gioco, oppure menu ⋮ → **Installa app**.
- **iPhone (Safari):** apri il link, tocca Condividi → **Aggiungi alla schermata Home**.

## Cosa c'è nel gioco

- Contratti di carico e scarico con livelli infiniti: paga, numero di pallet e peso crescono a ogni livello.
- Guida con sterzo posteriore, forche (alza/abbassa, apri/chiudi, inclina), pallet che si spingono e cadono se guidi male.
- Prima e terza persona, specchietto retrovisore, minimappa e mappa del quartiere.
- Comandi touch: frecce, volante o giroscopio.
- Garage con 6 muletti e 10 magazzini da comprare.
- Lingue: italiano, spagnolo, inglese.

## Sviluppo

Richiede Node.js 22.

```bash
npm install
npm run dev      # server di sviluppo
npm run build    # build di produzione in dist/
```

Ogni push su `main` pubblica automaticamente il gioco su GitHub Pages (`.github/workflows/deploy.yml`).

Tecnologie: [Babylon.js](https://www.babylonjs.com/) per il 3D, Supabase per account e salvataggi, Sentry per gli errori.

### Modelli 3D personalizzati

I modelli sono generati nel codice. Per sostituirli con modelli `.glb` vedi [`public/models/README.md`](public/models/README.md).
