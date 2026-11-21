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
      }),
      signal: AbortSignal.timeout(4000)
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

/** Diagnóstico da última geração (modelo usado e tempo), devolvido ao app. */
export const lastCall = { model: '', ms: 0 };

// A função precisa responder ANTES do limite da plataforma (um corte da plataforma chega ao app como
// "Failed to send a request"). Prazo total + prazo por tentativa + "hedge": se o modelo não respondeu em
// HEDGE_MS, dispara o próximo em paralelo e fica com quem responder primeiro.
const TOTAL_BUDGET_MS = 40_000;
const PER_CALL_MS = 20_000;
const HEDGE_MS = 6_000;

type Attempt = { ok: true; text: string } | { ok: false; msg: string; fatal: boolean };

export async function generate({ system, contents, schema }: GenOpts): Promise<string> {
  const k = key();
  const started = Date.now();
  const base = { ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}), contents };
  // Velocidade: sem "pensamento" interno e resposta limitada. Se o modelo rejeitar o parâmetro de pensamento,
  // repete a chamada sem ele.
  const out = schema ? { responseMimeType: 'application/json', responseSchema: schema } : {};
  const cfgFast = { ...out, thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 2048 };
  const cfgPlain = { ...out, maxOutputTokens: 2048 };

  const brief = async (r: Response) => {
    const raw = await r.text();
    try { return String(JSON.parse(raw)?.error?.message ?? raw).replace(/\s+/g, ' ').slice(0, 200); } catch { return raw.slice(0, 200); }
  };

  const attempt = async (model: string, abort: AbortSignal): Promise<Attempt> => {
    const signal = AbortSignal.any([abort, AbortSignal.timeout(PER_CALL_MS)]);
    const call = (cfg: Record<string, unknown>) => fetch(`${BASE}/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': k },
      body: JSON.stringify({ ...base, generationConfig: cfg }), signal
    });
    try {
      let res = await call(cfgFast);
      let txt = '';
      if (!res.ok) {
        txt = await brief(res);
        // Qualquer 400 na config "rápida" (ex.: modelo que não aceita thinkingConfig): repete sem ela.
        if (res.status === 400) { res = await call(cfgPlain); txt = res.ok ? '' : await brief(res); }
      }
      if (res.ok) {
        const j = await res.json();
        return { ok: true, text: j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '' };
      }
      // Só problema de CHAVE é fatal (trocar de modelo não resolve). Qualquer outro erro (modelo inexistente,
      // sobrecarregado, argumento não suportado por ESTE modelo...) deixa os demais modelos seguirem.
      const fatal = res.status === 401 || ([400, 403].includes(res.status) && /api key|API_KEY|unauthenticated|permission denied/i.test(txt));
      return { ok: false, msg: `${model} → ${res.status}: ${txt}`, fatal };
    } catch (e) {
      return { ok: false, msg: `${model} → sem resposta (${e instanceof Error ? e.name : 'erro'})`, fatal: false };
    }
  };

  const models = GEN_MODELS();
  return await new Promise<string>((resolve, reject) => {
    const controllers: AbortController[] = [];
    const errors: string[] = [];
    let next = 0, pending = 0, done = false;
    let hedge: ReturnType<typeof setInterval> | undefined, total: ReturnType<typeof setTimeout> | undefined;

    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearInterval(hedge); clearTimeout(total);
      controllers.forEach((c) => c.abort());
      fn();
    };
    const launch = (): boolean => {
      if (done || next >= models.length) return false;
      const model = models[next++];
      const ac = new AbortController();
      controllers.push(ac);
      pending++;
      attempt(model, ac.signal).then((r) => {
        pending--;
        if (done) return;
        if (r.ok) {
          lastCall.model = model; lastCall.ms = Date.now() - started;
          return finish(() => resolve(r.text));
        }
        errors.push(r.msg);
        if (r.fatal) return finish(() => reject(new Error(`Gemini falhou. ${errors.join(' | ')}`)));
        if (!launch() && pending === 0) finish(() => reject(new Error(`Gemini falhou. ${errors.join(' | ')}`)));
      });
      return true;
    };
    hedge = setInterval(() => { launch(); }, HEDGE_MS);
    total = setTimeout(() => finish(() => reject(new Error(`Gemini falhou (tempo esgotado). ${errors.join(' | ') || 'sem resposta de nenhum modelo'}`))), TOTAL_BUDGET_MS);
    launch();
  });
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


/** Diagnóstico: testa cada modelo (config rápida, simples e com JSON) + embedding + lista de modelos da chave. */
export async function diagnose() {
  const k = key();
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': k };
  const brief = async (r: Response) => {
    const raw = await r.text();
    try { return String(JSON.parse(raw)?.error?.message ?? raw).replace(/\s+/g, ' ').slice(0, 160); } catch { return raw.slice(0, 160); }
  };
  const probe = async (url: string, init: RequestInit) => {
    const t = Date.now();
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
      return { status: r.status, ms: Date.now() - t, msg: r.ok ? '' : await brief(r) };
    } catch (e) {
      return { status: 0, ms: Date.now() - t, msg: e instanceof Error ? e.name : 'erro' };
    }
  };
  const body = (cfg: Record<string, unknown>) => JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: 'Responda apenas: oi' }] }], generationConfig: { maxOutputTokens: 256, ...cfg }
  });
  const schema = { type: 'OBJECT', properties: { reply: { type: 'STRING' } }, required: ['reply'] };

  const list = await probe(`${BASE}/v1beta/models?pageSize=200`, { headers });
  let available: string[] = [];
  try {
    const r = await fetch(`${BASE}/v1beta/models?pageSize=200`, { headers, signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    available = (j?.models ?? []).map((m: any) => String(m.name).replace('models/', '')).filter((n: string) => /flash|live|embedding/.test(n)).slice(0, 40);
  } catch { /* lista indisponível */ }

  const tests = await Promise.all(GEN_MODELS().map(async (model) => {
    const url = `${BASE}/v1beta/models/${model}:generateContent`;
    const [fast, plain, json] = await Promise.all([
      probe(url, { method: 'POST', headers, body: body({ thinkingConfig: { thinkingBudget: 0 } }) }),
      probe(url, { method: 'POST', headers, body: body({}) }),
      probe(url, { method: 'POST', headers, body: body({ responseMimeType: 'application/json', responseSchema: schema }) })
    ]);
    return { model, fast, plain, json };
  }));

  const t0 = Date.now();
  const v = await embed('teste', 'RETRIEVAL_QUERY');
  return { listModels: list.status, available, tests, embed: { ok: Boolean(v), dims: v?.length ?? 0, ms: Date.now() - t0 }, configuredModel: Deno.env.get('GEMINI_MODEL') || null };
}
