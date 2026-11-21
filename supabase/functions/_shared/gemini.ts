const BASE = 'https://generativelanguage.googleapis.com';

const key = () => {
  const k = Deno.env.get('GEMINI_API_KEY');
  if (!k) throw new Error('GEMINI_API_KEY não configurada (supabase secrets set GEMINI_API_KEY=...)');
  return k;
};
export const GEN_MODEL = () => Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
export const EMBED_MODEL = () => Deno.env.get('GEMINI_EMBED_MODEL') || 'gemini-embedding-001';

/** Embedding de 768 dimensões (casa com a coluna vector(768) das memórias). */
export async function embed(text: string, taskType = 'RETRIEVAL_QUERY'): Promise<number[] | null> {
  try {
    const res = await fetch(`${BASE}/v1beta/models/${EMBED_MODEL()}:embedContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key() },
      body: JSON.stringify({
        model: `models/${EMBED_MODEL()}`,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: 768
      })
    });
    if (!res.ok) { console.warn('embed falhou', res.status, await res.text()); return null; }
    const j = await res.json();
    return j?.embedding?.values ?? null;
  } catch (e) {
    console.warn('embed indisponível', e);
    return null;
  }
}

export interface GenOpts {
  system?: string;
  contents: { role: 'user' | 'model'; parts: { text: string }[] }[];
  schema?: Record<string, unknown>;
}

export async function generate({ system, contents, schema }: GenOpts): Promise<string> {
  const k = key();
  const body = JSON.stringify({
    ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}),
    contents,
    ...(schema ? { generationConfig: { responseMimeType: 'application/json', responseSchema: schema } } : {})
  });
  let res = await fetch(`${BASE}/v1beta/models/${GEN_MODEL()}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': k }, body
  });
  if (!res.ok && k.startsWith('AQ.')) {
    // Chaves "AQ." são do Vertex AI (modo express): tenta o endpoint do Vertex antes de desistir.
    const first = (await res.text()).slice(0, 160);
    const vx = await fetch(`https://aiplatform.googleapis.com/v1/publishers/google/models/${GEN_MODEL()}:generateContent?key=${encodeURIComponent(k)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body
    });
    if (!vx.ok) throw new Error(`Gemini recusou a chave. AI Studio ${res.status}: ${first} | Vertex ${vx.status}: ${(await vx.text()).slice(0, 160)}`);
    res = vx;
  }
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
}

export async function generateJSON<T>(opts: GenOpts): Promise<T> {
  const txt = await generate(opts);
  return JSON.parse(txt) as T;
}

/** Token efêmero para o app abrir a Gemini Live API sem expor a chave real. */
export async function mintLiveToken(): Promise<string | null> {
  try {
    const now = Date.now();
    const res = await fetch(`${BASE}/v1alpha/auth_tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key() },
      body: JSON.stringify({
        uses: 1,
        expireTime: new Date(now + 20 * 60_000).toISOString(),
        newSessionExpireTime: new Date(now + 2 * 60_000).toISOString()
      })
    });
    if (!res.ok) { console.warn('live token falhou', res.status, await res.text()); return null; }
    const j = await res.json();
    return j?.name ?? null;
  } catch (e) {
    console.warn('live token indisponível', e);
    return null;
  }
}
