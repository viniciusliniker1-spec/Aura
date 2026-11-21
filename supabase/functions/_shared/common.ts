import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-aura-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

export const admin = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false }
  });

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Trava de acesso opcional. Se o secret AURA_ACCESS_TOKEN estiver definido, a chamada precisa enviar o
 * mesmo valor em `x-aura-token` (o app envia VITE_AURA_ACCESS_TOKEN) ou usar a service role (cron).
 * Retorna uma Response de erro quando negado, ou null quando liberado.
 */
export function guard(req: Request): Response | null {
  const expected = Deno.env.get('AURA_ACCESS_TOKEN');
  if (!expected) return null;
  const token = req.headers.get('x-aura-token') ?? '';
  if (safeEqual(token, expected)) return null;
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (service && safeEqual(bearer, service)) return null;
  return json({ error: 'Acesso negado' }, 401);
}

/** Envolve um handler com CORS, guard e tratamento de erro padronizado. */
export function handle(fn: (body: Record<string, any>, req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    const denied = guard(req);
    if (denied) return denied;
    try {
      const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
      return await fn(body, req);
    } catch (err) {
      console.error(err);
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  };
}

export const cleanDomain = (u: string) =>
  String(u || '').toLowerCase().replace(/^https?:\/\//, '').split('/')[0].split(':')[0].replace(/[^a-z0-9.-]/g, '');

export function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const fileRowToClient = (f: any) => ({
  id: f.id, name: f.file_name, ext: f.file_ext, size: fmtSize(f.size_bytes ?? 0),
  version: f.version, storagePath: f.storage_path, category: f.category
});
