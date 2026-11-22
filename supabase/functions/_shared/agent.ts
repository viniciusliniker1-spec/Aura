// Agente de navegador do Aura: o Gemini (ferramenta nativa "computer_use") olha a tela e devolve ações;
// aqui elas são executadas no navegador remoto via CDP. Cada chamada de `agentStep` faz alguns passos e devolve
// o progresso, então o app acompanha em tempo real e pode pausar/assumir a qualquer instante.
import { Cdp } from './cdp.ts';

const BASE = 'https://generativelanguage.googleapis.com';

/** Modelos medidos com a chave do projeto: só estes aceitam computer_use (3.1-flash-lite não; 4.x/2.5 sem cota). */
export const AGENT_MODELS = (escalated = false): string[] => {
  const custom = Deno.env.get('GEMINI_AGENT_MODEL');
  const order = escalated
    ? ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite']
    : ['gemini-3.5-flash-lite', 'gemini-3-flash-preview', 'gemini-3.5-flash'];
  return [...new Set([...(custom && !escalated ? [custom] : []), ...order])];
};

export interface AgentSession {
  task: string;
  domain: string;
  history: any[];                 // turnos já trocados com o modelo (sem imagens)
  pending: PendingCall[] | null;  // chamadas do modelo ainda sem resposta (respondidas no próximo passo, com a tela nova)
  step: number;
  requireApproval: boolean;
  hasCredential: boolean;
  approved: boolean;              // o usuário já aprovou o envio final
  recent?: string[];              // assinaturas das últimas ações (detecção de repetição)
  nudge?: boolean;                // avisar o modelo que ele está repetindo a mesma ação
  escalated?: boolean;            // usar um modelo mais forte nas próximas decisões
  resume?: 'login_ready' | 'approved' | 'human_done'; // resposta do usuário a uma pausa, consumida no próximo passo
  note?: string;                  // aviso único ao modelo (ex.: o usuário devolveu o controle)
}
interface PendingCall { name: string; id?: string; extra?: Record<string, unknown>; predefined: boolean; replay?: { name: string; args: Record<string, any> } }

export type AgentStatus = 'running' | 'done' | 'needs_login' | 'needs_manual' | 'awaiting_approval' | 'failed';
export interface StepResult {
  status: AgentStatus;
  steps: string[];          // intenções executadas neste lote ("Clicando no campo de e-mail")
  result?: string;          // resposta final (status done)
  question?: string;        // motivo do pedido (login/aprovação/ajuda)
  error?: string;
}

const CUSTOM_TOOLS = [{
  functionDeclarations: [
    { name: 'type_credential', description: 'Digita o usuário ou a senha SALVOS do usuário no campo que está focado. Clique no campo antes. Use SEMPRE em vez de digitar credenciais.',
      parameters: { type: 'OBJECT', properties: { field: { type: 'STRING', enum: ['username', 'password'] }, press_enter: { type: 'BOOLEAN' } }, required: ['field'] } },
    { name: 'request_login', description: 'Chame quando o site exige login e NÃO há credenciais salvas (ou o login falhou). O usuário informará o login e você continuará.',
      parameters: { type: 'OBJECT', properties: { reason: { type: 'STRING' } }, required: ['reason'] } },
    { name: 'need_human', description: 'Chame quando aparecer 2FA, código por SMS/e-mail, CAPTCHA ou verificação humana que só o usuário resolve.',
      parameters: { type: 'OBJECT', properties: { reason: { type: 'STRING' } }, required: ['reason'] } },
    { name: 'request_approval', description: 'Chame ANTES do clique final que envia candidatura, mensagem, formulário ou pagamento, descrevendo exatamente o que será enviado. Só clique depois da aprovação.',
      parameters: { type: 'OBJECT', properties: { summary: { type: 'STRING' } }, required: ['summary'] } }
  ]
}];

const systemPrompt = (s: AgentSession) => `Você é o Aura, assistente pessoal que opera um navegador no celular do usuário. Responda sempre em português do Brasil.
Tarefa do usuário: ${s.task}
Faça apenas o necessário, em poucos passos. Prefira navegar direto para a URL certa em vez de clicar muito. Feche banners de cookies sem pensar.
${s.hasCredential ? `Há login salvo para ${s.domain}: se o site pedir login, clique no campo e use type_credential (username e depois password). NUNCA digite credenciais você mesmo.` : `Não há login salvo para ${s.domain}: se o site exigir login, chame request_login. Nunca invente nem peça senhas no texto.`}
Se aparecer 2FA, código ou CAPTCHA, chame need_human.
${s.requireApproval ? 'ANTES de enviar candidatura, mensagem, formulário ou pagamento, chame request_approval com o resumo do que será enviado e só então clique.' : 'Você pode concluir o envio final se tudo estiver correto.'}
Quando terminar, responda SEM chamar ferramenta: um resumo curto e útil do resultado (por exemplo, a lista do que encontrou).`;

interface Deps {
  cdp: Cdp;
  apiKey: string;
  credential: (() => Promise<{ username: string; password: string } | null>) | null;
  /** Tempo máximo (ms) de uma chamada de `agentStep`. */
  budgetMs?: number;
  maxStepsPerCall?: number;
  /** Teto de passos da tarefa inteira. */
  maxTotalSteps?: number;
}

const norm = (v: unknown, size: number) => Math.max(0, Math.min(size - 1, Math.round((Number(v) / 1000) * size)));
const short = (t: string, n = 140) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

/** Nível de raciocínio do modelo (secret AGENT_THINKING: default | low | minimal). thinkingBudget:0 foi descartado:
 *  nos testes a resposta final degenerava em uma sequência de números. */
function thinkingCfg(): Record<string, unknown> {
  const v = Deno.env.get('AGENT_THINKING');
  return v === 'low' || v === 'minimal' || v === 'high' ? { thinkingConfig: { thinkingLevel: v } } : {};
}

const HEDGE_MS = 8_000;
const MODEL_TOTAL_MS = 45_000;

/**
 * Chama o modelo com "hedge": se não respondeu em HEDGE_MS, dispara o próximo em paralelo e fica com quem
 * responder primeiro (uma chamada lenta não trava o passo). Só erro de chave é fatal.
 */
function callModel(contents: any[], system: string, apiKey: string, escalated = false): Promise<{ content: any; model: string }> {
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: system }] },
    contents,
    // Banners de cookies não precisam de confirmação humana; pagamento, comunicação e criação de conta continuam protegidos.
    tools: [{ computer_use: { environment: 'ENVIRONMENT_BROWSER', disabled_safety_policies: ['USER_CONSENT_MANAGEMENT'] } }, ...CUSTOM_TOOLS],
    generationConfig: { maxOutputTokens: 1024, ...thinkingCfg() }
  });
  type R = { ok: true; content: any; model: string } | { ok: false; msg: string; fatal: boolean };
  const attempt = async (model: string, abort: AbortSignal): Promise<R> => {
    try {
      const res = await fetch(`${BASE}/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body,
        signal: AbortSignal.any([abort, AbortSignal.timeout(30_000)])
      });
      if (res.ok) {
        const cand = (await res.json())?.candidates?.[0];
        return cand?.content?.parts?.length ? { ok: true, content: cand.content, model } : { ok: false, msg: `${model} → resposta vazia`, fatal: false };
      }
      const raw = await res.text();
      let msg = raw;
      try { msg = JSON.parse(raw)?.error?.message ?? raw; } catch { /* texto puro */ }
      const fatal = res.status === 401 || (res.status === 400 && /api key/i.test(String(msg)));
      return { ok: false, msg: `${model} → ${res.status}: ${String(msg).replace(/\s+/g, ' ').slice(0, 140)}`, fatal };
    } catch (e) {
      return { ok: false, msg: `${model} → sem resposta (${e instanceof Error ? e.name : 'erro'})`, fatal: false };
    }
  };

  const models = AGENT_MODELS(escalated);
  return new Promise((resolve, reject) => {
    const controllers: AbortController[] = [];
    const errors: string[] = [];
    let next = 0, pending = 0, done = false;
    let hedge: ReturnType<typeof setInterval> | undefined, total: ReturnType<typeof setTimeout> | undefined;
    const finish = (fn: () => void) => { if (done) return; done = true; clearInterval(hedge); clearTimeout(total); controllers.forEach((c) => c.abort()); fn(); };
    const fail = () => finish(() => reject(new Error(`Gemini falhou. ${errors.join(' | ') || 'sem resposta'}`)));
    const launch = (): boolean => {
      if (done || next >= models.length) return false;
      const ac = new AbortController();
      controllers.push(ac);
      pending++;
      attempt(models[next++], ac.signal).then((r) => {
        pending--;
        if (done) return;
        if (r.ok) return finish(() => resolve({ content: r.content, model: r.model }));
        errors.push(r.msg);
        if (r.fatal) return fail();
        if (!launch() && pending === 0) fail();
      });
      return true;
    };
    hedge = setInterval(() => { launch(); }, HEDGE_MS);
    total = setTimeout(fail, MODEL_TOTAL_MS);
    launch();
  });
}

/** Executa UMA ação do modelo no navegador e devolve a descrição curta (para mostrar ao usuário). */
async function execute(cdp: Cdp, name: string, a: Record<string, any>, vp: { w: number; h: number }): Promise<{ label: string; ok: boolean; note?: string }> {
  const X = (v: unknown) => norm(v, vp.w);
  const Y = (v: unknown) => norm(v, vp.h);
  const label = (fallback: string) => short(String(a.intent || fallback));
  switch (name) {
    case 'open_web_browser': case 'take_screenshot': return { label: label('Olhando a tela'), ok: true };
    case 'click': case 'click_at': await cdp.click(X(a.x), Y(a.y)); return { label: label('Clicando'), ok: true };
    case 'double_click': await cdp.click(X(a.x), Y(a.y), { count: 2 }); return { label: label('Clique duplo'), ok: true };
    case 'triple_click': await cdp.click(X(a.x), Y(a.y), { count: 3 }); return { label: label('Selecionando texto'), ok: true };
    case 'right_click': await cdp.click(X(a.x), Y(a.y), { button: 'right' }); return { label: label('Clique direito'), ok: true };
    case 'middle_click': await cdp.click(X(a.x), Y(a.y), { button: 'middle' }); return { label: label('Clique do meio'), ok: true };
    case 'move': case 'hover_at': await cdp.hover(X(a.x), Y(a.y)); return { label: label('Passando o mouse'), ok: true };
    case 'type': {
      await cdp.typeText(String(a.text ?? ''));
      if (a.press_enter) await cdp.press('Enter');
      return { label: label('Digitando'), ok: true };
    }
    case 'type_text_at': {
      await cdp.click(X(a.x), Y(a.y));
      if (a.clear_before_typing !== false) { await cdp.press('Control+A'); await cdp.press('Backspace'); }
      await cdp.typeText(String(a.text ?? ''));
      if (a.press_enter) await cdp.press('Enter');
      return { label: label('Digitando'), ok: true };
    }
    case 'press_key': await cdp.press(String(a.key ?? '')); return { label: label(`Tecla ${a.key}`), ok: true };
    case 'key_combination': await cdp.press(String(a.keys ?? '')); return { label: label(`Atalho ${a.keys}`), ok: true };
    case 'hotkey': await cdp.press(Array.isArray(a.keys) ? a.keys.join('+') : String(a.keys ?? '')); return { label: label('Atalho de teclado'), ok: true };
    case 'scroll': case 'scroll_at': {
      const mag = Number(a.magnitude_in_pixels ?? a.magnitude ?? 400) || 400;
      await cdp.scroll(a.x !== undefined ? X(a.x) : Math.floor(vp.w / 2), a.y !== undefined ? Y(a.y) : Math.floor(vp.h / 2), a.direction ?? 'down', mag);
      return { label: label('Rolando a página'), ok: true };
    }
    case 'scroll_document': await cdp.scroll(Math.floor(vp.w / 2), Math.floor(vp.h / 2), a.direction ?? 'down', 600); return { label: label('Rolando a página'), ok: true };
    case 'navigate': await cdp.navigate(String(a.url ?? '')); return { label: label(`Abrindo ${a.url}`), ok: true };
    case 'search': await cdp.navigate(`https://www.google.com/search?q=${encodeURIComponent(String(a.query ?? a.text ?? ''))}`); return { label: label('Pesquisando'), ok: true };
    case 'go_back': await cdp.history(-1); return { label: label('Voltando'), ok: true };
    case 'go_forward': await cdp.history(1); return { label: label('Avançando'), ok: true };
    case 'wait': case 'wait_5_seconds': await new Promise((r) => setTimeout(r, Math.min(5, Number(a.seconds ?? 2)) * 1000)); return { label: label('Aguardando a página'), ok: true };
    case 'drag_and_drop': await cdp.drag(X(a.start_x ?? a.x), Y(a.start_y ?? a.y), X(a.end_x ?? a.destination_x), Y(a.end_y ?? a.destination_y)); return { label: label('Arrastando'), ok: true };
    default: return { label: `Ação não suportada: ${name}`, ok: false, note: 'unsupported action' };
  }
}

/**
 * Executa alguns passos. O estado (`session`) é devolvido atualizado para o chamador gravar.
 * `answer` (opcional) retoma uma pausa: resposta do pedido de login/aprovação/ajuda.
 */
export async function agentStep(session: AgentSession, deps: Deps, resume?: { kind: 'login_ready' | 'approved' | 'human_done' }): Promise<StepResult & { session: AgentSession; model?: string }> {
  const { cdp } = deps;
  const budget = deps.budgetMs ?? 20_000;
  const maxCall = deps.maxStepsPerCall ?? 4;
  const maxTotal = deps.maxTotalSteps ?? 30;
  const started = Date.now();
  const steps: string[] = [];
  let model: string | undefined;
  const s = session;

  // Retoma uma pausa: responde ao pedido pendente do modelo.
  if (!resume && s.resume) resume = { kind: s.resume };
  s.resume = undefined;
  if (resume && s.pending) {
    const vp0 = await cdp.viewport();
    for (const p of s.pending) {
      if (resume.kind === 'approved' && p.replay) {
        // O usuário confirmou uma ação que a Google marcou como sensível: executa agora e confirma ao modelo.
        try { await execute(cdp, p.replay.name, p.replay.args, vp0); p.extra = { safety_acknowledgement: 'true' }; }
        catch (e) { p.extra = { erro: e instanceof Error ? e.message : String(e) }; }
        p.replay = undefined;
        continue;
      }
      if (resume.kind === 'login_ready' && p.name === 'request_login') p.extra = { resultado: 'O usuário informou o login. Use type_credential nos campos.' };
      if (resume.kind === 'approved' && p.name === 'request_approval') { p.extra = { resultado: 'O usuário APROVOU. Pode clicar no botão final agora.' }; s.approved = true; }
      if (resume.kind === 'human_done' && p.name === 'need_human') p.extra = { resultado: 'O usuário resolveu a verificação. Continue.' };
    }
  }

  while (Date.now() - started < budget && steps.length < maxCall) {
    if (s.step >= maxTotal) return { status: 'failed', steps, error: `Parei após ${maxTotal} passos sem concluir.`, session: s, model };

    // 1) tela atual
    const shot = await cdp.screenshot();
    const vp = { w: shot.w, h: shot.h };
    const image = { inlineData: { mimeType: 'image/jpeg', data: shot.b64 } };

    // 2) turno do usuário: tarefa (1º passo) ou respostas às chamadas anteriores, com a tela nova
    const turn: any = s.pending?.length
      ? {
        role: 'user',
        parts: [
          ...s.pending.map((p) => ({ functionResponse: { name: p.name, response: { url: shot.url, ...(p.extra ?? {}) } } })),
          image
        ]
      }
      : { role: 'user', parts: [{ text: `Comece. Esta é a tela atual (${vp.w}x${vp.h}).` }, image] };

    if (s.note) { turn.parts.push({ text: s.note }); s.note = undefined; }
    if (s.nudge) {
      turn.parts.push({ text: 'ATENÇÃO: você repetiu a mesma ação várias vezes e a tela não mudou. Mude de estratégia: role a página, clique em OUTRO elemento (por exemplo um botão visível), use outra navegação ou diga que não é possível.' });
      s.nudge = false;
    }
    const contents = [...s.history, turn];
    const out = await callModel(contents, systemPrompt(s), deps.apiKey, Boolean(s.escalated));
    model = out.model;

    // guarda o turno sem a imagem (a tela antiga não precisa ficar no histórico)
    s.history.push({ ...turn, parts: turn.parts.filter((p: any) => !p.inlineData) });
    s.history.push(out.content);
    s.pending = null;
    s.step++;

    const calls = (out.content.parts as any[]).filter((p) => p.functionCall).map((p) => p.functionCall);
    const text = (out.content.parts as any[]).filter((p) => typeof p.text === 'string').map((p) => p.text).join(' ').trim();

    // sem ferramenta = resposta final
    if (!calls.length) return { status: 'done', steps, result: text || 'Pronto.', session: s, model };

    // 3) executa as chamadas
    const pending: PendingCall[] = [];
    let pause: { status: AgentStatus; question: string } | null = null;
    for (const c of calls) {
      const a = c.args ?? {};
      const name: string = c.name;
      const sd = a.safety_decision;
      const sdText = `${sd?.explanation ?? ''} ${a.intent ?? ''}`;
      const needsConfirm = sd && String(sd.decision ?? sd).toLowerCase().includes('confirm') && !s.approved;
      // Entrar numa conta é justamente o que o usuário pediu (e as credenciais são dele): não precisa de segunda confirmação.
      const isLogin = /\b(log ?in|sign ?in|entrar|login|fazer login|acessar (a )?(sua )?conta)\b/i.test(sdText) && !/pag|compr|cart[aã]o|transfer|financ|purchase|payment|buy/i.test(sdText);
      if (needsConfirm && isLogin) {
        try { const r = await execute(cdp, name, a, vp); pending.push({ name, id: c.id, predefined: true, extra: { safety_acknowledgement: 'true' } }); steps.push(r.label); }
        catch (e) { pending.push({ name, id: c.id, predefined: true, extra: { erro: e instanceof Error ? e.message : String(e) } }); steps.push(`Falhou: ${name}`); }
        continue;
      }
      if (needsConfirm) {
        // a própria Google pede confirmação humana para esta ação
        pending.push({ name, id: c.id, predefined: true, replay: { name, args: a } });
        pause = { status: 'awaiting_approval', question: String(sd.explanation ?? a.intent ?? 'Confirmar esta ação?') };
        break;
      }
      if (name === 'request_login') { pending.push({ name, id: c.id, predefined: false }); pause = { status: 'needs_login', question: String(a.reason ?? 'O site pede login.') }; break; }
      if (name === 'need_human') { pending.push({ name, id: c.id, predefined: false }); pause = { status: 'needs_manual', question: String(a.reason ?? 'Verificação manual necessária.') }; break; }
      if (name === 'request_approval' && deps.apiKey && !s.approved) { pending.push({ name, id: c.id, predefined: false }); pause = { status: 'awaiting_approval', question: String(a.summary ?? 'Aprovar o envio?') }; break; }
      if (name === 'request_approval') { pending.push({ name, id: c.id, predefined: false, extra: { resultado: 'Aprovado.' } }); continue; }
      if (name === 'type_credential') {
        const cred = deps.credential ? await deps.credential() : null;
        if (!cred) { pending.push({ name, id: c.id, predefined: false, extra: { erro: 'Sem credenciais salvas. Chame request_login.' } }); steps.push('Sem login salvo'); continue; }
        await cdp.typeText(a.field === 'password' ? cred.password : cred.username);
        if (a.press_enter) await cdp.press('Enter');
        pending.push({ name, id: c.id, predefined: false, extra: { resultado: a.field === 'password' ? 'Senha digitada.' : 'Usuário digitado.' } });
        steps.push(a.field === 'password' ? 'Digitando a senha do Cofre' : 'Digitando o usuário do Cofre');
        continue;
      }
      try {
        const r = await execute(cdp, name, a, vp);
        pending.push({ name, id: c.id, predefined: true, extra: r.ok ? {} : { erro: r.note } });
        steps.push(r.label);
      } catch (e) {
        pending.push({ name, id: c.id, predefined: true, extra: { erro: e instanceof Error ? e.message : String(e) } });
        steps.push(`Falhou: ${name}`);
      }
    }
    s.pending = pending;
    // Detecção de repetição: mesma ação (e mesmos alvos) 3 vezes seguidas = preso.
    const sig = calls.map((c: any) => `${c.name}:${c.args?.x ?? ''},${c.args?.y ?? ''}:${c.args?.text ?? c.args?.url ?? ''}`).join('|');
    s.recent = [...(s.recent ?? []), sig].slice(-8);
    const n = s.recent.length;
    const stuck = n >= 3 && s.recent[n - 1] === s.recent[n - 2] && s.recent[n - 2] === s.recent[n - 3];
    if (stuck && !pause) {
      if (s.escalated && s.recent.length >= 6 && s.recent.slice(-6).every((x) => x === sig)) {
        return { status: 'failed', steps, error: 'Fiquei preso repetindo a mesma ação. Toque em "Tomar controle" para continuar você mesmo.', session: s, model };
      }
      s.nudge = true;
      s.escalated = true;
      steps.push('Mudando de estratégia…');
    }
    if (pause) return { status: pause.status, steps, question: pause.question, session: s, model };
    // dá um instante para a página reagir antes da próxima captura
    await new Promise((r) => setTimeout(r, 400));
  }
  return { status: 'running', steps, session: s, model };
}

export const newSession = (o: { task: string; domain: string; requireApproval: boolean; hasCredential: boolean }): AgentSession => ({
  task: o.task, domain: o.domain, history: [], pending: null, step: 0,
  requireApproval: o.requireApproval, hasCredential: o.hasCredential, approved: false
});
