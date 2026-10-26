// Chiavi pubbliche (publishable): sicure nel client, la protezione dei dati e' data dalle policy RLS.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://kypnpjgcyfltjmzquoin.supabase.co';
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_P057It0t7SzwSQBaQqbF4g_pkllk4yO';
export const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN
  || 'https://6f3dfce0ff1632c88ef2cb09068dc166@o4512301577076736.ingest.de.sentry.io/4512308270989392';
export const APP_VERSION = __APP_VERSION__; // da package.json
export const BUILD_DATE = __BUILD_DATE__;

// App nativa Android (Capacitor) e indirizzi pubblici del gioco
export const IS_NATIVE = !!window.Capacitor?.isNativePlatform?.();
// Indirizzo che riapre l'app Android dal link dell'email (registrato nell'AndroidManifest)
export const APP_LOGIN_URL = 'forklifttycoon://login';
export const WEB_URL = 'https://salvatorevirgillito04-code.github.io/forklift-tycoon/';
export const APK_URL = `${WEB_URL}forklift-tycoon.apk`;
