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

/** Último erro de uma Edge Function (para mostrar ao usuário em vez de mascarar a falha). */
export const lastFunctionError = { message: '' };

/** Traduz o erro técnico numa dica do que conferir. */
export function explainError(msg: string): string {
  if (/model|404|not found/i.test(msg) && /gemini/i.test(msg))
    return `${msg}\n\nO modelo do Gemini pode ter mudado. Defina o secret GEMINI_MODEL no GitHub com um modelo atual (veja aistudio.google.com/docs/models) e rode "Deploy Supabase".`;
  if (/api key|API_KEY|generativelanguage|gemini/i.test(msg))
    return `${msg}\n\nConfira o secret GEMINI_API_KEY no GitHub e rode o workflow "Deploy Supabase" de novo.`;
  if (/acesso negado|401|403/i.test(msg))
    return `${msg}\n\nO VITE_AURA_ACCESS_TOKEN do app precisa ser igual ao secret AURA_ACCESS_TOKEN.`;
  return msg || 'Sem resposta do servidor. Veja os logs em Supabase → Edge Functions.';
}

/** Chama uma Edge Function. Retorna null se o Supabase não está configurado ou se a chamada falhar. */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T | null> {
  if (!supabase) return null;
  lastFunctionError.message = '';
  try {
    const { data, error } = await supabase.functions.invoke(name, {
      body,
      headers: accessToken ? { 'x-aura-token': accessToken } : undefined
    });
    if (error) {
      // Em respostas não-2xx o motivo real vem no corpo da resposta.
      let detail = error.message;
      const ctx = (error as { context?: unknown }).context;
      if (ctx instanceof Response) {
        try {
          const j = await ctx.clone().json();
          if (j?.error) detail = String(j.error);
        } catch { /* corpo não-JSON */ }
      }
      lastFunctionError.message = detail;
      console.warn(`[aura] ${name} falhou:`, detail);
      return null;
    }
    if (data && typeof data === 'object' && 'error' in data && (data as { error?: unknown }).error) {
      lastFunctionError.message = String((data as { error: unknown }).error);
      console.warn(`[aura] ${name} retornou erro:`, lastFunctionError.message);
      return null;
    }
    return data as T;
  } catch (e) {
    lastFunctionError.message = e instanceof Error ? e.message : String(e);
    console.warn(`[aura] ${name} indisponível:`, e);
    return null;
  }
}
