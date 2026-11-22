import { admin, handle, json, cleanDomain } from '../_shared/common.ts';
import { decryptSecret, encryptSecret } from '../_shared/crypto.ts';
import { bu, ensureProfile, stopBrowser } from '../_shared/browseruse.ts';
import { Cdp } from '../_shared/cdp.ts';
import { agentStep, newSession, type AgentSession } from '../_shared/agent.ts';

// Agente próprio: o Gemini (computer_use) dirige um navegador do Browser Use por CDP, um lote de passos por chamada.
const VIEW = { w: 412, h: 915 };                 // viewport de celular
const BUSY_MS = 45_000;
const TERMINAL = ['done', 'failed', 'cancelled'];
const proxy = (): string | null => { const v = Deno.env.get('BROWSER_USE_PROXY') ?? 'br'; return v === 'none' ? null : v; };

type Db = ReturnType<typeof admin>;

/** O que o app enxerga (nunca a cdp_url). */
const view = (r: any) => ({
  engine: 'agent', status: r.status === 'done' ? 'completed' : r.status, liveUrl: r.live_url ?? null,
  steps: Array.isArray(r.steps) ? r.steps : [], result: r.result ?? null, error: r.error ?? null,
  question: r.question ?? null, loginDomain: r.domain ?? null
});

async function loadCredential(db: Db, run: any): Promise<{ username: string; password: string } | null> {
  if (run.credential_id) {
    const { data: c } = await db.from('credential_vault').select('username, encrypted_password, iv').eq('id', run.credential_id).maybeSingle();
    if (c) {
      await db.from('credential_vault').update({ last_used_at: new Date().toISOString() }).eq('id', run.credential_id);
      return { username: c.username, password: await decryptSecret(c.encrypted_password, c.iv) };
    }
  }
  if (run.temp_cred && run.temp_iv) {
    try { return JSON.parse(await decryptSecret(run.temp_cred, run.temp_iv)); } catch { /* ignora */ }
  }
  return null;
}

async function openCdp(url: string): Promise<Cdp> {
  const cdp = await Cdp.connect(url);
  try { await cdp.attachPage(); await cdp.emulateMobile(VIEW.w, VIEW.h); } catch (e) { cdp.close(); throw e; }
  return cdp;
}

Deno.serve(handle(async (b) => {
  const db = admin();

  /* ------------------------------ START ------------------------------ */
  if (b.action === 'start') {
    if (b.engine === 'browser-use' || Deno.env.get('BROWSER_ENGINE') === 'browser-use') return json({ engine: 'browser-use' });
    const targetUrl = String(b.targetUrl || '').slice(0, 300);
    const connect = b.connect === true;
    const task = connect
      ? 'Confirme se já está logado neste site (procure conta/perfil). Se estiver, diga isso e termine. Se pedir login, siga a regra de login. Não faça mais nada.'
      : String(b.task || '').slice(0, 800);
    if (!task || !targetUrl) return json({ error: 'task e targetUrl são obrigatórios' }, 400);
    const domain = cleanDomain(targetUrl);
    const requireApproval = connect ? false : b.requireApproval !== false;

    // Login do Cofre para este domínio (respeita a regra de autonomia gravada)
    const { data: rules } = await db.from('autonomy_rules').select('category, mode');
    const mode = (k: string) => rules?.find((r: any) => r.category === k)?.mode ?? 'ask_approval';
    const useVault = b.useVault !== false && (mode('login_sites') === 'auto' || b.useVault === true);
    let credentialId: string | null = null;
    if (useVault && domain) {
      const { data: creds } = await db.from('credential_vault').select('id, domain').eq('auto_login', true);
      const hit = (creds ?? []).find((c: any) => { const d = cleanDomain(c.domain); return domain === d || domain.endsWith(`.${d}`) || d.endsWith(`.${domain}`); });
      credentialId = hit?.id ?? null;
    }

    // Navegador na nuvem com viewport de celular; allowResizing deixa o CDP emular dispositivo móvel
    const profile = await ensureProfile(db);
    const full = { ...(profile.id ? { profileId: profile.id } : {}), browserScreenWidth: VIEW.w, browserScreenHeight: VIEW.h, allowResizing: true, proxyCountryCode: proxy(), timeout: 30 };
    let br: any;
    try { br = await bu('/browsers', { body: full }); }
    catch (e) {
      if (!/ 4(00|22)/.test(e instanceof Error ? e.message : '')) throw e;
      br = await bu('/browsers', { body: { ...(profile.id ? { profileId: profile.id } : {}), allowResizing: true } });
    }
    if (!br?.cdpUrl) { await stopBrowser(br?.id ?? null); return json({ error: 'O Browser Use não devolveu o endereço de controle (cdpUrl).' }, 502); }

    try {
      const cdp = await openCdp(br.cdpUrl);
      try { await cdp.navigate(targetUrl); } finally { cdp.close(); }
    } catch (e) {
      await stopBrowser(br.id);
      return json({ error: `Não consegui controlar o navegador: ${e instanceof Error ? e.message : String(e)}` }, 502);
    }

    const session = newSession({ task, domain, requireApproval, hasCredential: Boolean(credentialId) });
    const { data: row, error } = await db.from('agent_runs').insert({
      task, target_url: targetUrl, domain, status: 'running', state: session, steps: ['Navegador aberto'],
      bu_browser_id: br.id, cdp_url: br.cdpUrl, live_url: br.liveUrl ?? null, credential_id: credentialId, require_approval: requireApproval
    }).select('id').single();
    if (error) { await stopBrowser(br.id); throw error; }
    return json({ engine: 'agent', id: row.id, liveUrl: br.liveUrl ?? null, persistent: Boolean(profile.id), profileWarning: profile.warning ?? null, requireApproval, usedVault: Boolean(credentialId) });
  }

  /* Demais ações operam sobre uma execução existente */
  const { data: run } = await db.from('agent_runs').select('*').eq('id', String(b.id || '')).maybeSingle();
  if (!run) return json({ error: 'Sessão não encontrada' }, 404);
  const patch = async (p: Record<string, unknown>) => { await db.from('agent_runs').update({ ...p, updated_at: new Date().toISOString() }).eq('id', run.id); Object.assign(run, p); };
  const state = (): AgentSession => run.state as AgentSession;

  switch (b.action) {
    case 'status': return json(view(run));

    /* ------------------------------ STEP ------------------------------ */
    case 'step': {
      if (run.status !== 'running') return json(view(run));
      if (run.busy_until && new Date(run.busy_until) > new Date()) return json(view(run)); // outro passo em andamento
      await patch({ busy_until: new Date(Date.now() + BUSY_MS).toISOString() });
      let cdp: Cdp | null = null;
      try {
        cdp = await openCdp(run.cdp_url);
        const apiKey = Deno.env.get('GEMINI_API_KEY');
        if (!apiKey) throw new Error('GEMINI_API_KEY não configurada');
        const out = await agentStep(state(), { cdp, apiKey, credential: () => loadCredential(db, run), budgetMs: 22_000, maxStepsPerCall: 4 });
        const steps = [...(run.steps ?? []), ...out.steps].slice(-12);
        const status = out.status;
        await patch({
          state: out.session, steps, status, busy_until: null,
          result: out.result ?? run.result, question: out.question ?? null, error: out.error ?? null
        });
        if (status === 'done' || status === 'failed') {
          await stopBrowser(run.bu_browser_id); // encerra para o Browser Use gravar o login no perfil
          await patch({ temp_cred: null, temp_iv: null });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // falha na conexão com o navegador ou no modelo: encerra com motivo claro
        await patch({ status: 'failed', error: msg, busy_until: null });
        await stopBrowser(run.bu_browser_id);
      } finally {
        cdp?.close();
      }
      return json(view(run));
    }

    /* ----------------------- respostas do usuário ----------------------- */
    case 'provide_login': {
      if (run.status !== 'needs_login') return json({ error: 'Esta sessão não está pedindo login' }, 409);
      const username = String(b.username || '').slice(0, 200);
      const password = String(b.password || '');
      if (!username || !password) return json({ error: 'Informe usuário e senha' }, 400);
      const dom = cleanDomain(b.domain || run.target_url);
      if (b.remember !== false) {
        const { encrypted, iv } = await encryptSecret(password);
        const { data: cred, error } = await db.from('credential_vault').insert({
          site_name: (dom.split('.')[0] || dom).replace(/^./, (c: string) => c.toUpperCase()), domain: dom, login_url: `https://${dom}`,
          username, encrypted_password: encrypted, iv, auto_login: true
        }).select('id').single();
        if (error) throw error;
        await patch({ credential_id: cred.id });
      } else {
        const t = await encryptSecret(JSON.stringify({ username, password }));
        await patch({ temp_cred: t.encrypted, temp_iv: t.iv, credential_id: null });
      }
      const s = state(); s.hasCredential = true; s.resume = 'login_ready';
      await patch({ state: s, status: 'running', question: null });
      return json({ ok: true });
    }
    case 'approve': {
      if (run.status !== 'awaiting_approval') return json({ error: 'Nada aguardando aprovação' }, 409);
      const s = state(); s.resume = 'approved';
      await patch({ state: s, status: 'running', question: null });
      return json({ ok: true });
    }
    case 'human_done': {
      const s = state(); s.resume = 'human_done';
      await patch({ state: s, status: 'running', question: null });
      return json({ ok: true });
    }

    /* ------------------- tomar controle / devolver ------------------- */
    case 'takeover': {
      // Sem cancelar nada: o app para de pedir passos e você usa a Live View. Instantâneo.
      await patch({ status: 'takeover', busy_until: null });
      return json({ ok: true, liveUrl: run.live_url });
    }
    case 'resume': {
      const s = state();
      s.note = 'O usuário assumiu o navegador e agora devolveu o controle. Observe a tela atual (ela pode ter mudado) e continue a tarefa.';
      if (s.pending?.some((p) => ['need_human', 'request_login'].includes(p.name))) s.resume = 'human_done';
      await patch({ state: s, status: 'running', question: null });
      return json({ ok: true });
    }

    /* ---------------------------- encerrar ---------------------------- */
    case 'finish': {
      await stopBrowser(run.bu_browser_id);
      await patch({ status: 'done', temp_cred: null, temp_iv: null });
      return json({ ok: true });
    }
    case 'cancel': {
      if (!TERMINAL.includes(run.status)) await stopBrowser(run.bu_browser_id);
      await patch({ status: 'cancelled', temp_cred: null, temp_iv: null });
      return json({ ok: true });
    }
    default: return json({ error: 'Ação inválida' }, 400);
  }
}));
