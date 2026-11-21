import { admin, handle, json, cleanDomain } from '../_shared/common.ts';
import { decryptSecret } from '../_shared/crypto.ts';

// Browser Use Cloud — API v4 (https://docs.browser-use.com/cloud/api-v4-overview)
const BU = 'https://api.browser-use.com/api/v4';
const KEEP_ALIVE = 1800;

// Velocidade: bu-ultrafast é o modelo mais rápido do Browser Use. O padrão dos projetos novos é bu-4.0 com
// raciocínio "alto" (bem mais lento). Troque com o secret BROWSER_USE_MODEL ('default' = padrão do projeto).
const MODEL = Deno.env.get('BROWSER_USE_MODEL') || 'bu-ultrafast';
// Janela do navegador na nuvem (LxA). Formato de tablet em pé: legível na Live View do celular.
const VIEWPORT = (Deno.env.get('BROWSER_USE_VIEWPORT') || '820x1180').match(/^(\d{3,4})x(\d{3,4})$/);

async function bu(path: string, init: { method?: string; body?: unknown } = {}) {
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
async function ensureProfile(db: ReturnType<typeof admin>): Promise<{ id: string | null; warning?: string }> {
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
async function stopBrowser(sessionId: string | null) {
  if (sessionId) await bu(`/browsers/${sessionId}`, { method: 'PATCH', body: { action: 'stop' } }).catch(() => null);
}

/** Cria a run; se o Browser Use recusar algum parâmetro opcional (modelo/janela), repete só com o básico. */
async function createRun(full: Record<string, unknown>, minimal: Record<string, unknown>) {
  try {
    return await bu('/runs', { body: full });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/ 4(00|22)/.test(msg)) throw e;
    console.warn('createRun: parâmetros opcionais recusados, repetindo no modo básico:', msg);
    return await bu('/runs', { body: minimal });
  }
}

/** Credencial do Cofre -> secretBindings (a IA só vê os apelidos; o valor é digitado no site permitido). */
async function secretBindingsFor(db: ReturnType<typeof admin>, credentialId: string | null) {
  if (!credentialId) return { bindings: [] as unknown[], label: null as string | null };
  const { data: cred } = await db.from('credential_vault').select('*').eq('id', credentialId).maybeSingle();
  if (!cred) return { bindings: [], label: null };
  const password = await decryptSecret(cred.encrypted_password, cred.iv);
  const allowedDomains = [cleanDomain(cred.domain)];
  await db.from('credential_vault').update({ last_used_at: new Date().toISOString() }).eq('id', cred.id);
  return {
    label: cred.site_name as string,
    bindings: [
      { alias: 'site-username', source: { type: 'inline', value: cred.username }, allowedDomains },
      { alias: 'site-password', source: { type: 'inline', value: password }, allowedDomains }
    ]
  };
}

const SAFETY = `REGRAS: navegue em ritmo humano; salve a sessão no perfil após login; NUNCA peça nem escreva senhas no chat; se aparecer 2FA/CAPTCHA, pare e descreva o que falta para o usuário assumir o controle.`;

function buildTask(o: { task: string; targetUrl: string; hasLogin: boolean; files: { fileName: string; signedUrl: string }[]; requireApproval: boolean }) {
  const login = o.hasLogin
    ? 'Se o site pedir login, use os segredos "site-username" e "site-password" (digite-os pelos apelidos).'
    : 'Use os cookies já salvos no perfil persistente; se pedir login, pare e avise.';
  const files = o.files.length
    ? `Arquivos autorizados (baixe e anexe no formulário quando solicitado): ${o.files.map((f) => `${f.fileName} -> ${f.signedUrl}`).join(' ; ')}.`
    : '';
  const gate = o.requireApproval
    ? 'TRAVA DE APROVAÇÃO: prepare tudo (login, preenchimento, anexos) mas PARE ANTES de clicar no botão final de enviar candidatura/mensagem/formulário ou de pagar/confirmar compra. Termine descrevendo exatamente o que será enviado.'
    : 'Você pode concluir o envio final se tudo estiver correto.';
  return `Acesse ${o.targetUrl} e execute: ${o.task}\n${login}\n${files}\n${gate}\n${SAFETY}`;
}

/** Extrai texto de passos dos eventos (o formato exato de `data` varia: lemos só campos de texto conhecidos). */
function stepsFrom(events: any[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    const d = e?.data ?? {};
    const t = [d.message, d.text, d.summary, d.next_goal, d.nextGoal, d.goal].find((x) => typeof x === 'string' && x.trim());
    if (t) out.push(String(t).slice(0, 220));
  }
  return out.slice(-8);
}

async function liveUrlFrom(events: any[]): Promise<string | null> {
  for (const e of events) {
    if (e?.type === 'browser.ready' || e?.type === 'browser.reattached') {
      const u = e?.data?.live_view_url ?? e?.data?.liveViewUrl ?? e?.data?.liveUrl;
      if (typeof u === 'string' && u.startsWith('http')) return u;
    }
  }
  return null;
}

Deno.serve(handle(async (b) => {
  const db = admin();

  /* ------------------------------ START ------------------------------ */
  if (b.action === 'start') {
    const targetUrl = String(b.targetUrl || '').slice(0, 300);
    const loginMode = b.loginMode === true;
    // loginMode: só abre o site e para na tela de login; quem entra é você (Tomar controle) e o login fica no perfil.
    const task = loginMode
      ? `Abra ${targetUrl} e pare na tela de login (ou na página inicial). NÃO faça login nem preencha nada. Termine agora.`
      : String(b.task || '').slice(0, 800);
    if (!task || !targetUrl) return json({ error: 'task e targetUrl são obrigatórios' }, 400);
    const domain = cleanDomain(targetUrl);
    const requireApproval = loginMode ? true : b.requireApproval !== false;

    // Regras de autonomia gravadas no banco prevalecem sobre o que o app mandou.
    const { data: rules } = await db.from('autonomy_rules').select('category, mode');
    const mode = (k: string) => rules?.find((r: any) => r.category === k)?.mode ?? 'ask_approval';
    const useVault = b.useVault !== false && (mode('login_sites') === 'auto' || b.useVault === true);
    const uploadFiles = b.uploadFiles !== false && (mode('upload_files_forms') === 'auto' || b.uploadFiles === true);

    // Credencial do domínio alvo (comparada em código; nada de ilike com entrada do usuário)
    let credentialId: string | null = null;
    if (useVault && domain) {
      const { data: creds } = await db.from('credential_vault').select('id, domain').eq('auto_login', true);
      const hit = (creds ?? []).find((c: any) => { const d = cleanDomain(c.domain); return domain === d || domain.endsWith(`.${d}`) || d.endsWith(`.${domain}`); });
      credentialId = hit?.id ?? null;
    }
    const { bindings, label } = await secretBindingsFor(db, credentialId);

    // URLs assinadas temporárias para os arquivos que o agente pode anexar
    const attached: { fileName: string; signedUrl: string }[] = [];
    if (uploadFiles && b.fileId) {
      const { data: f } = await db.from('user_files').select('file_name, storage_path').eq('id', String(b.fileId)).maybeSingle();
      if (f) {
        const { data: signed } = await db.storage.from('aura-files').createSignedUrl(f.storage_path, 900);
        if (signed?.signedUrl) attached.push({ fileName: f.file_name, signedUrl: signed.signedUrl });
      }
    }

    const profile = await ensureProfile(db);
    const taskText = loginMode ? task : buildTask({ task, targetUrl, hasLogin: bindings.length > 0, files: attached, requireApproval });
    const common = {
      task: taskText,
      ...(bindings.length ? { secretBindings: bindings } : {}),
      keepAlive: KEEP_ALIVE
    };
    const run = await createRun(
      {
        ...common,
        ...(MODEL !== 'default' ? { model: MODEL } : {}),
        browserSettings: {
          ...(profile.id ? { profileId: profile.id } : {}),
          ...(VIEWPORT ? { screenWidth: Number(VIEWPORT[1]), screenHeight: Number(VIEWPORT[2]) } : {})
        }
      },
      { ...common, ...(profile.id ? { browserSettings: { profileId: profile.id } } : {}) }
    );

    const { data: row, error } = await db.from('handoff_sessions').insert({
      task_prompt: task, target_url: targetUrl, external_session_id: run.id, bu_session_id: run.sessionId,
      status: 'running', phase: 'prepare', require_approval: requireApproval, credential_id: credentialId
    }).select('id').single();
    if (error) throw error;

    return json({ id: row.id, liveUrl: null, usedVault: Boolean(label), requireApproval, persistent: Boolean(profile.id), profileWarning: profile.warning ?? null });
  }

  /* Demais ações operam sobre uma sessão existente */
  const { data: s } = await db.from('handoff_sessions').select('*').eq('id', String(b.id || '')).maybeSingle();
  if (!s) return json({ error: 'Sessão não encontrada' }, 404);

  const followUp = async (task: string, phase: 'prepare' | 'final') => {
    const { bindings } = await secretBindingsFor(db, s.credential_id);
    const run = await bu('/runs', {
      body: {
        task: `${task}\n${bindings.length ? 'Se pedir login, use os segredos "site-username" e "site-password".' : ''}\n${SAFETY}`,
        sessionId: s.bu_session_id,
        ...(bindings.length ? { secretBindings: bindings } : {}),
        keepAlive: KEEP_ALIVE
      }
    });
    await db.from('handoff_sessions').update({ external_session_id: run.id, phase, status: 'running' }).eq('id', s.id);
  };

  /* ------------------------------ STATUS ------------------------------ */
  if (b.action === 'status') {
    if (['takeover', 'cancelled', 'completed', 'failed'].includes(s.status)) {
      return json({ status: s.status, liveUrl: s.live_url, steps: [] });
    }
    const { status } = await bu(`/runs/${s.external_session_id}/status`);
    const ev = await bu(`/runs/${s.external_session_id}/events?after=0&limit=200`).catch(() => ({ events: [] }));
    const events: any[] = ev?.events ?? [];
    const liveUrl = s.live_url ?? (await liveUrlFrom(events));
    let mapped: string = 'running';
    let result: string | null = null, error: string | null = null;

    if (status === 'completed') {
      mapped = s.phase === 'final' || !s.require_approval ? 'completed' : 'awaiting_approval';
      result = (await bu(`/runs/${s.external_session_id}`).catch(() => null))?.result ?? null;
    } else if (status === 'failed') {
      mapped = 'failed';
      error = (await bu(`/runs/${s.external_session_id}`).catch(() => null))?.error ?? 'A sessão falhou.';
    } else if (status === 'cancelled') {
      mapped = 'cancelled';
    }
    await db.from('handoff_sessions').update({ status: mapped, live_url: liveUrl }).eq('id', s.id);
    // Fim da tarefa (sem aprovação pendente): encerra o navegador para o Browser Use gravar o login no perfil.
    if (mapped === 'completed' || mapped === 'failed') await stopBrowser(s.bu_session_id);
    return json({ status: mapped, liveUrl, steps: stepsFrom(events), result, error });
  }

  /* ------------------------------ APPROVE ------------------------------ */
  if (b.action === 'approve') {
    if (s.status !== 'awaiting_approval') return json({ error: 'Nada aguardando aprovação' }, 409);
    await followUp('O usuário APROVOU. Na página atual, clique agora no botão final de envio/confirmação, confirme que deu certo e descreva o resultado.', 'final');
    return json({ ok: true });
  }

  /* ------------------------- TAKEOVER / RESUME ------------------------- */
  if (b.action === 'takeover') {
    // Sem endpoint de pausa na v4: cancela a run (o navegador segue aberto por `keepAlive`) e o usuário assume pela Live View.
    await bu(`/runs/${s.external_session_id}/cancel`, { method: 'POST' }).catch(() => null);
    await db.from('handoff_sessions').update({ status: 'takeover' }).eq('id', s.id);
    return json({ ok: true, liveUrl: s.live_url });
  }
  if (b.action === 'resume') {
    await followUp(`O usuário resolveu a etapa manual (2FA/CAPTCHA). Continue de onde a página está agora e conclua a tarefa original: ${s.task_prompt}`, 'prepare');
    return json({ ok: true });
  }

  /* ------------------------------ FINISH ------------------------------ */
  if (b.action === 'finish') {
    // "Guardar login e encerrar": para o navegador (o Browser Use grava cookies/login no perfil) e fecha a sessão.
    await bu(`/runs/${s.external_session_id}/cancel`, { method: 'POST' }).catch(() => null);
    await stopBrowser(s.bu_session_id);
    await db.from('handoff_sessions').update({ status: 'completed' }).eq('id', s.id);
    return json({ ok: true });
  }

  /* ------------------------------ CANCEL ------------------------------ */
  if (b.action === 'cancel') {
    await bu(`/runs/${s.external_session_id}/cancel`, { method: 'POST' }).catch(() => null);
    if (s.bu_session_id) await bu(`/browsers/${s.bu_session_id}`, { method: 'PATCH', body: { action: 'stop' } }).catch(() => null);
    await db.from('handoff_sessions').update({ status: 'cancelled' }).eq('id', s.id);
    return json({ ok: true });
  }

  return json({ error: 'Ação inválida' }, 400);
}));
