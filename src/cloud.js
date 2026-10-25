import { createClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/browser';
import { SUPABASE_URL, SUPABASE_KEY, IS_NATIVE, WEB_URL, APP_LOGIN_URL } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

let user = null;
const listeners = new Set();

export const getUser = () => user;
export const isOnline = () => !!user;
export const isLinked = () => !!user && !user.is_anonymous;
export const onAuthChange = (fn) => listeners.add(fn);

function setUser(u) {
  user = u;
  Sentry.setUser(u ? { id: u.id } : null);
  listeners.forEach((fn) => fn(u));
}

// Sessione esistente, altrimenti accesso anonimo come ospite.
export async function initAuth() {
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      setUser(data.session.user);
    } else {
      const { data: anon, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      setUser(anon.user);
    }
  } catch (err) {
    console.warn('Cloud non disponibile, salvataggio locale', err);
    Sentry.captureException(err, { tags: { area: 'auth' } });
    setUser(null);
  }
  supabase.auth.onAuthStateChange((_event, session) => {
    if ((session?.user?.id || null) !== (user?.id || null) || session?.user?.is_anonymous !== user?.is_anonymous) {
      setUser(session?.user || null);
    }
  });
  return user;
}

// Ospite -> collega l'email all'utente anonimo (i progressi restano).
// Gia' collegato altrove -> magic link per entrare con quell'account.
export async function linkEmail(email) {
  // Nell'app il link dell'email riapre l'app (forklifttycoon://login), sul sito torna al sito
  const redirectTo = IS_NATIVE ? APP_LOGIN_URL : window.location.origin + import.meta.env.BASE_URL;
  if (user && user.is_anonymous) {
    const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: redirectTo });
    if (!error) return;
    // Email gia' usata da un account (es. login fatto sul sito): si entra in quell'account
    if (error.code !== 'email_exists' && !/already/i.test(error.message)) throw error;
    const { error: otpError } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    if (otpError) throw otpError;
  } else {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    if (error) throw error;
  }
}

// App Android: il link dell'email arriva come forklifttycoon://login#access_token=...
// Ritorna un messaggio d'errore da mostrare, oppure null.
export async function handleLoginUrl(url) {
  if (!url?.startsWith(APP_LOGIN_URL)) return null;
  const parts = new URL(url.replace(APP_LOGIN_URL, 'https://app.local/login'));
  const params = new URLSearchParams(parts.hash.slice(1));
  parts.searchParams.forEach((v, k) => params.set(k, v));
  if (params.get('error_description')) return params.get('error_description').replace(/\+/g, ' ');
  if (params.get('access_token') && params.get('refresh_token')) {
    const { error } = await supabase.auth.setSession({
      access_token: params.get('access_token'), refresh_token: params.get('refresh_token'),
    });
    return error?.message || null;
  }
  if (params.get('code')) {
    const { error } = await supabase.auth.exchangeCodeForSession(params.get('code'));
    return error?.message || null;
  }
  // Solo conferma (es. cambio email): aggiorna l'utente corrente
  const { data } = await supabase.auth.refreshSession();
  if (data?.user) setUser(data.user);
  return null;
}

export async function logout() {
  await supabase.auth.signOut();
  setUser(null);
}

// Account sviluppatore: lo decide il database (solo email confermate nell'elenco developers).
export async function checkDeveloper() {
  if (!user || user.is_anonymous) return false;
  const { data, error } = await supabase.rpc('is_developer');
  if (error) return false;
  return data === true;
}

export async function loadCloudSave() {
  if (!user) return null;
  const { data, error } = await supabase.from('player_saves').select('data, updated_at').eq('user_id', user.id).maybeSingle();
  if (error) {
    Sentry.captureException(error, { tags: { area: 'load' } });
    return null;
  }
  return data;
}

export async function writeCloudSave(save) {
  if (!user) return false;
  const { error } = await supabase.from('player_saves').upsert({
    user_id: user.id,
    display_name: save.name?.slice(0, 24) || null,
    level: save.level,
    coins: Math.floor(save.coins),
    data: save,
  });
  if (error) {
    Sentry.captureException(error, { tags: { area: 'save' } });
    return false;
  }
  return true;
}
