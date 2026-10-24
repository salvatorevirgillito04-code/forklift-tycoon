import { createClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/browser';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

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
  const redirectTo = window.location.origin;
  if (user && user.is_anonymous) {
    const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: redirectTo });
    if (error) throw error;
  } else {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    if (error) throw error;
  }
}

export async function logout() {
  await supabase.auth.signOut();
  setUser(null);
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
