const BASE = 'https://generativelanguage.googleapis.com';

const key = () => {
  const k = Deno.env.get('GEMINI_API_KEY');
  if (!k) throw new Error('GEMINI_API_KEY não configurada (supabase secrets set GEMINI_API_KEY=...)');
  return k;
};
// gemini-2.5-flash está depreciado (desligamento previsto em 01/12/2026). Tenta, em ordem, o modelo do secret
// GEMINI_MODEL (se houver) e depois alternativas estáveis, até uma funcionar para a sua chave.
const MODEL_FALLBACKS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];
export const GEN_MODELS = (): string[] => {
  const custom = Deno.env.get('GEMINI_MODEL');
  return [...new Set([...(custom ? [custom] : []), ...MODEL_FALLBACKS])];
};
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
  const errors: string[] = [];
  for (const model of GEN_MODELS()) {
    const res = await fetch(`${BASE}/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': k }, body
    });
    if (res.ok) {
      const j = await res.json();
      return j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
    }
    const txt = (await res.text()).slice(0, 220);
    errors.push(`${model} → ${res.status}: ${txt}`);
    // Só troca de modelo quando o problema é o modelo (inexistente/sem acesso). Chave inválida ou cota não adiantam.
    const modelProblem = res.status === 404 || (res.status === 400 && /model/i.test(txt)) || (res.status === 403 && /model|not.*(allowed|available)|access/i.test(txt));
    if (!modelProblem) break;
  }
  throw new Error(`Gemini falhou. ${errors.join(' | ')}`);
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
