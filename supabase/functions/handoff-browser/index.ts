import { admin, handle, json, cleanDomain } from '../_shared/common.ts';
import { decryptSecret, encryptSecret } from '../_shared/crypto.ts';
import { bu, ensureProfile, stopBrowser } from '../_shared/browseruse.ts';

const KEEP_ALIVE = 1800;

// Velocidade: bu-ultrafast é o modelo mais rápido do Browser Use. O padrão dos projetos novos é bu-4.0 com
// raciocínio "alto" (bem mais lento). Troque com o secret BROWSER_USE_MODEL ('default' = padrão do projeto).
const MODEL = Deno.env.get('BROWSER_USE_MODEL') || 'bu-ultrafast';
// Janela do navegador na nuvem (LxA). Formato de tablet em pé: legível na Live View do celular.
const VIEWPORT = (Deno.env.get('BROWSER_USE_VIEWPORT') || '820x1180').match(/^(\d{3,4})x(\d{3,4})$/);

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

/** secretBindings com valores informados na hora (quando o usuário não quer guardar no Cofre). */
function inlineBindings(username: string, password: string, domain: string) {
  const allowedDomains = [cleanDomain(domain)];
  return [
    { alias: 'site-username', source: { type: 'inline', value: username }, allowedDomains },
    { alias: 'site-password', source: { type: 'inline', value: password }, allowedDomains }
  ];
}

const SAFETY = `REGRAS: navegue em ritmo humano; salve a sessão no perfil após login; NUNCA peça nem escreva senhas no chat; se aparecer 2FA/CAPTCHA/verificação humana, PARE e termine a resposta com exatamente [[AJUDA_MANUAL]] seguido de uma frase dizendo o que aparece.`;

function buildTask(o: { task: string; targetUrl: string; hasLogin: boolean; files: { fileName: string; signedUrl: string }[]; requireApproval: boolean }) {
  const login = o.hasLogin
    ? 'Se o site pedir login, use os segredos "site-username" e "site-password" (digite-os pelos apelidos).'
    : 'Use os cookies já salvos no perfil persistente. Se o site pedir login e você NÃO tem segredos: PARE ali e termine a resposta com exatamente [[LOGIN_NECESSARIO: dominio.com]] (o domínio real do site). Nunca invente credenciais nem peça a senha no texto.';
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
    // connect: só abre o site para conferir o login. Se pedir login, o app mostra o cofre no chat.
    const connect = b.connect === true;
    const task = connect
      ? 'Confirme se já está logado neste site. Se estiver, diga isso e termine. Se pedir login, siga a regra de login. Não faça mais nada.'
      : String(b.task || '').slice(0, 800);
    if (!task || !targetUrl) return json({ error: 'task e targetUrl são obrigatórios' }, 400);
    const domain = cleanDomain(targetUrl);
    const requireApproval = connect ? false : b.requireApproval !== false;

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
    const taskText = buildTask({ task, targetUrl, hasLogin: bindings.length > 0, files: attached, requireApproval });
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

  const followUp = async (task: string, phase: 'prepare' | 'final', override?: unknown[]) => {
    const bindings = override ?? (await secretBindingsFor(db, s.credential_id)).bindings;
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
    if (['takeover', 'cancelled', 'completed', 'failed', 'needs_login', 'needs_manual'].includes(s.status)) {
      return json({ status: s.status, liveUrl: s.live_url, steps: [], loginDomain: cleanDomain(s.target_url) });
    }
    const { status } = await bu(`/runs/${s.external_session_id}/status`);
    const ev = await bu(`/runs/${s.external_session_id}/events?after=0&limit=200`).catch(() => ({ events: [] }));
    const events: any[] = ev?.events ?? [];
    const liveUrl = s.live_url ?? (await liveUrlFrom(events));
    let mapped: string = 'running';
    let result: string | null = null, error: string | null = null;

    let loginDomain: string | null = null;
    if (status === 'completed') {
      mapped = s.phase === 'final' || !s.require_approval ? 'completed' : 'awaiting_approval';
      const raw: string = (await bu(`/runs/${s.external_session_id}`).catch(() => null))?.result ?? '';
      // A IA sinaliza com marcadores quando precisa do usuário; o app mostra o cofre (login) ou o "tomar controle" (2FA).
      const login = raw.match(/\[\[LOGIN_NECESSARIO:?\s*([^\]]*)\]\]/i);
      // Rede de segurança: se o agente não usou o marcador mas descreveu claramente que o site exige login
      // (e a sessão não tinha login do Cofre), trata como pedido de login.
      const saysLogin = !s.credential_id && /(pede|exige|requer|precisa d[eo]|necess[aá]ri[oa]|solicit\w*)\W+(\w+\W+){0,4}(login|senha|credenciais|e-mail e senha)|fa[cç]a (o )?login|tela de login|sign in|log in|not logged in|n[aã]o est[aá] logad/i.test(raw);
      if (login || (saysLogin && !/\[\[AJUDA_MANUAL\]\]/i.test(raw))) { mapped = 'needs_login'; loginDomain = cleanDomain(login?.[1] ?? '') || cleanDomain(s.target_url); }
      else if (/\[\[AJUDA_MANUAL\]\]/i.test(raw)) mapped = 'needs_manual';
      result = raw.replace(/\[\[[^\]]*\]\]/g, '').trim() || null;
    } else if (status === 'failed') {
      mapped = 'failed';
      error = (await bu(`/runs/${s.external_session_id}`).catch(() => null))?.error ?? 'A sessão falhou.';
    } else if (status === 'cancelled') {
      mapped = 'cancelled';
    }
    await db.from('handoff_sessions').update({ status: mapped, live_url: liveUrl }).eq('id', s.id);
    // Fim da tarefa (sem aprovação pendente): encerra o navegador para o Browser Use gravar o login no perfil.
    if (mapped === 'completed' || mapped === 'failed') await stopBrowser(s.bu_session_id);
    return json({ status: mapped, liveUrl, steps: stepsFrom(events), result, error, loginDomain });
  }

  /* ------------------------------ APPROVE ------------------------------ */
  if (b.action === 'approve') {
    if (s.status !== 'awaiting_approval') return json({ error: 'Nada aguardando aprovação' }, 409);
    await followUp('O usuário APROVOU. Na página atual, clique agora no botão final de envio/confirmação, confirme que deu certo e descreva o resultado.', 'final');
    return json({ ok: true });
  }

  /* ---------------------------- PROVIDE_LOGIN ---------------------------- */
  if (b.action === 'provide_login') {
    // O usuário preencheu o cofre no chat. A senha vai direto ao navegador (secretBindings); a IA só vê os apelidos.
    if (s.status !== 'needs_login') return json({ error: 'Esta sessão não está pedindo login' }, 409);
    const username = String(b.username || '').slice(0, 200);
    const password = String(b.password || '');
    if (!username || !password) return json({ error: 'Informe usuário e senha' }, 400);
    const domain = cleanDomain(b.domain || s.target_url);
    let bindings: unknown[];
    if (b.remember !== false) {
      const { encrypted, iv } = await encryptSecret(password);
      const { data: cred, error } = await db.from('credential_vault').insert({
        site_name: (domain.split('.')[0] || domain).replace(/^./, (c: string) => c.toUpperCase()), domain, login_url: `https://${domain}`,
        username, encrypted_password: encrypted, iv, auto_login: true
      }).select('id').single();
      if (error) throw error;
      s.credential_id = cred.id;
      await db.from('handoff_sessions').update({ credential_id: cred.id }).eq('id', s.id);
      bindings = (await secretBindingsFor(db, cred.id)).bindings;
    } else {
      bindings = inlineBindings(username, password, domain);
    }
    await followUp(`O usuário informou o login. Entre no site usando os segredos "site-username" e "site-password" e depois continue a tarefa original: ${s.task_prompt}`, 'prepare', bindings);
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
