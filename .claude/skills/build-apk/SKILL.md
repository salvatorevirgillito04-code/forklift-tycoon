---
name: build-apk
description: Prepara l'APK Android di Forklift Tycoon (di prova o ufficiale) con lo stesso pacchetto e la stessa firma, il versionCode corretto e la verifica SHA-256. Usala ogni volta che serve un APK da provare sul telefono o da pubblicare. La pubblicazione richiede sempre il si' esplicito del proprietario.
---
# Build APK

## 0. Prima di iniziare
- Il ramo è giusto? Per un APK di prova va bene un ramo di lavoro. Per un APK ufficiale serve l'approvazione del proprietario.
- `controllo-regressioni` è superato?
- **Keystore**: non è nel repository e non deve mai finirci. Cercalo nella sessione (es. `<scratchpad>/keys/`:
  `forklift-tycoon.keystore`, `password.txt`, `LEGGIMI.txt`). Se manca, chiedi al proprietario di **caricare i file**
  nella chat. Non chiedere mai di incollare la password nel testo e non mostrarla mai.

## 1. versionCode e versionName
- Il versionCode cresce sempre, e ogni numero si usa una volta sola. Storico: 27 = 2.9.0 pubblica,
  28 = guida fase 1 (prova), 29 = guida 1.1 (prova), 30 = 1.1b contatore (prova). Il prossimo libero è **31**.
  Dopo ogni build aggiorna questo storico.
- APK di prova: versionName `X.Y.Z-<nome>-test`. APK ufficiale: versionName uguale a `version` in `package.json`.

## 2. Build
```bash
S=<cartella con il keystore>
# prova: VITE_TEST_BUILD=1 attiva il contatore prestazioni nelle impostazioni. Ufficiale: senza.
VITE_TEST_BUILD=1 npm run build
npx cap sync android
cd android
export ANDROID_HOME=/opt/android-sdk KEYSTORE_FILE=$S/forklift-tycoon.keystore \
  KEYSTORE_PASSWORD="$(cat $S/password.txt)" KEY_PASSWORD="$(cat $S/password.txt)" KEY_ALIAS=forklift \
  VERSION_CODE=31 VERSION_NAME=2.9.0-nome-test
./gradlew assembleRelease -q
```

## 3. Verifica (obbligatoria)
```bash
BT=$(ls -d /opt/android-sdk/build-tools/* | tail -1)
$BT/apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk | grep SHA-256
$BT/aapt2 dump badging app/build/outputs/apk/release/app-release.apk | head -1
```
- SHA-256 deve essere `f534a8c61ee1bf953c396af05b53d0d38e51afd7257c17bb75dbff30213c99a1`. Se è diverso, fermati.
- Il pacchetto deve essere `io.github.salvatorevirgillito.forklifttycoon`, con il versionCode e il versionName attesi.
- Il build non deve contenere segreti: `grep -rl "TRIPO\|tripo.mjs\|password" dist/assets` non deve trovare nulla
  (la chiave publishable di Supabase va bene).

## 4. Consegna
- **Prova**: copia l'APK nello scratchpad con un nome chiaro (es. `forklift-tycoon-<nome>-TEST.apk`), invialo al
  proprietario e **non metterlo nel repository**. Elenca i test manuali da fare sul telefono.
- **Ufficiale**, solo dopo il "sì": copia in `downloads/forklift-tycoon.apk`, aggiorna `version` in `package.json`,
  scrivi le note di rilascio in italiano e fai il merge su `main`, che pubblica il sito. Poi controlla che il sito risponda.
- Ricorda al proprietario che l'APK si installa sopra la versione esistente e mantiene i salvataggi solo se la firma è la stessa.
