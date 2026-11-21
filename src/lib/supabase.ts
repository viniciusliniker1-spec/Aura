import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const accessToken = import.meta.env.VITE_AURA_ACCESS_TOKEN;

export const isSupabaseConfigured = Boolean(
  url && anonKey && !url.includes('SEU_PROJETO') && !anonKey.includes('SUA_ANON_KEY')
);

export const supabase = isSupabaseConfigured
  ? createClient(url!, anonKey!, { auth: { persistSession: false } })
  : null;

/** Chama uma Edge Function. Retorna null se o Supabase não está configurado ou se a chamada falhar. */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke(name, {
      body,
      headers: accessToken ? { 'x-aura-token': accessToken } : undefined
    });
    if (error) {
      console.warn(`[aura] ${name} falhou:`, error.message);
      return null;
    }
    if (data && typeof data === 'object' && 'error' in data && (data as { error?: unknown }).error) {
      console.warn(`[aura] ${name} retornou erro:`, (data as { error: unknown }).error);
      return null;
    }
    return data as T;
  } catch (e) {
    console.warn(`[aura] ${name} indisponível:`, e);
    return null;
  }
}
