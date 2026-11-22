import { admin } from './common.ts';

// Browser Use Cloud — API v4 (https://docs.browser-use.com/cloud/api-v4-overview)
export const BU = 'https://api.browser-use.com/api/v4';

export async function bu(path: string, init: { method?: string; body?: unknown } = {}) {
  const key = Deno.env.get('BROWSER_USE_API_KEY');
  if (!key) throw new Error('BROWSER_USE_API_KEY não configurada (supabase secrets set BROWSER_USE_API_KEY=...)');
  const res = await fetch(`${BU}${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { 'X-Browser-Use-API-Key': key, 'Content-Type': 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* corpo não-JSON */ }
  if (!res.ok) throw new Error(`Browser Use ${res.status}: ${(data?.detail ? JSON.stringify(data.detail) : text).slice(0, 300)}`);
  return data;
}

/**
 * Perfil persistente = onde o Browser Use guarda cookies/logins entre sessões. Ordem: secret
 * BROWSER_USE_DEFAULT_PROFILE_ID > perfil já criado (app_settings) > cria um novo agora.
 */
export async function ensureProfile(db: ReturnType<typeof admin>): Promise<{ id: string | null; warning?: string }> {
  const fromEnv = Deno.env.get('BROWSER_USE_DEFAULT_PROFILE_ID');
  if (fromEnv) return { id: fromEnv };
  const { data: row } = await db.from('app_settings').select('value').eq('key', 'browser_profile_id').maybeSingle();
  if (typeof row?.value === 'string' && row.value) return { id: row.value };
  try {
    const p = await bu('/profiles', { body: { name: 'Aura' } });
    if (p?.id) {
      await db.from('app_settings').upsert({ key: 'browser_profile_id', value: p.id, updated_at: new Date().toISOString() });
      return { id: p.id };
    }
    return { id: null, warning: 'O Browser Use não devolveu o ID do perfil.' };
  } catch (e) {
    return { id: null, warning: `Sem perfil persistente: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Encerra o navegador da sessão: é quando o Browser Use grava os cookies/login no perfil. */
export async function stopBrowser(sessionId: string | null) {
  if (sessionId) await bu(`/browsers/${sessionId}`, { method: 'PATCH', body: { action: 'stop' } }).catch(() => null);
}

