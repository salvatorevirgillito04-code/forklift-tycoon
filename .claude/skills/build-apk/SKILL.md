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
- Il versionCode cresce sempre, e ogni numero si usa una volta sola. Lo storico è in **`android/VERSIONI.md`**
  (unica fonte: i codici delle prove non compaiono in git log). Usa il primo numero libero e, dopo la build,
  aggiungi una riga allo storico e committala sul ramo di lavoro.
- APK di prova: versionName `X.Y.Z-<nome>-test`.
- APK ufficiale (solo dopo il sì): aggiorna **prima della build** `version` in `package.json`. Il versionName è uguale a quella versione.

## 2. Build
Usa percorsi assoluti: in ogni chiamata Bash degli agenti la cartella di lavoro può tornare quella di partenza.
```bash
R=$(git rev-parse --show-toplevel)
cd "$R"
S=<cartella con il keystore>
# prova: VITE_TEST_BUILD=1 attiva il contatore prestazioni nelle impostazioni. Ufficiale: senza.
VITE_TEST_BUILD=1 npm run build
npx cap sync android
cd "$R/android"
export ANDROID_HOME=/opt/android-sdk KEYSTORE_FILE=$S/forklift-tycoon.keystore \
  KEYSTORE_PASSWORD="$(cat $S/password.txt)" KEY_PASSWORD="$(cat $S/password.txt)" KEY_ALIAS=forklift \
  VERSION_CODE=<primo libero da android/VERSIONI.md> VERSION_NAME=<versione>-<nome>-test
./gradlew assembleRelease -q
```

## 3. Verifica (obbligatoria)
```bash
R=$(git rev-parse --show-toplevel); APK="$R/android/app/build/outputs/apk/release/app-release.apk"
BT=$(ls -d /opt/android-sdk/build-tools/* | tail -1)
$BT/apksigner verify --print-certs "$APK" | grep SHA-256
$BT/aapt2 dump badging "$APK" | head -1
```
- SHA-256 deve essere `f534a8c61ee1bf953c396af05b53d0d38e51afd7257c17bb75dbff30213c99a1`. Se è diverso, fermati.
- Il pacchetto deve essere `io.github.salvatorevirgillito.forklifttycoon`, con il versionCode e il versionName attesi.
- Il build non deve contenere segreti. Usa pattern precisi, perché la parola "password" compare sempre nella libreria di Supabase:
  ```bash
  ls "$R/dist/assets" >/dev/null || echo "ERRORE: dist/assets mancante"   # il controllo deve vedere la cartella
  grep -rlE "tsk_|TRIPO_API_KEY|tools/tripo|\.keystore" "$R/dist/assets" && echo "SEGRETO?" || echo "ok pattern"
  grep -rlF -f "$S/password.txt" "$R/dist/assets" && echo "PASSWORD NEL BUILD" || echo "ok password"   # non stampa il valore
  ```
  La chiave publishable di Supabase e il DSN di Sentry sono pubblici per scelta.

## 4. Consegna
- **Prova**: copia l'APK nello scratchpad con un nome chiaro (es. `forklift-tycoon-<nome>-TEST.apk`), invialo al
  proprietario e **non metterlo nel repository**. Elenca i test manuali da fare sul telefono.
- **Ufficiale**, solo dopo il "sì": copia in `downloads/forklift-tycoon.apk` (la `version` di `package.json` è già aggiornata
  al passo 1), scrivi le note di rilascio in italiano e fai il merge su `main`, che pubblica il sito. Poi controlla che il sito risponda.
- Mai `gh workflow run` del deploy senza approvazione: pubblica il sito come un push su `main`.
- Ricorda al proprietario che l'APK si installa sopra la versione esistente e mantiene i salvataggi solo se la firma è la stessa.
