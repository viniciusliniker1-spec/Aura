import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  TabId, SubviewId, MemoryItem, ProactiveCard, ChatItem, ProjectItem, CredentialItem,
  StoredFile, AutonomyRule, HandoffState, PanelItem
} from '../types/aura';
import * as api from '../lib/api';
import { uuid, fmtSize } from '../lib/api';
import {
  SEED_MEMORIES, SEED_PROJECTS, SEED_FILES, SEED_PROACTIVE, SEED_CHAT, seedPanels,
  buildAutonomy, DEFAULT_AUTONOMY, localChat, localPanelSpec, panelFromSpec
} from '../lib/local';
import { loadJSON, saveJSON } from '../lib/storage';
import { lastFunctionError, explainError } from '../lib/supabase';
import { tap, success, notifyLocal } from '../lib/native';

const LOCAL_KEY = 'aura.local.v4';
const remote = api.remoteEnabled();

interface LocalSnapshot {
  memories: MemoryItem[]; projects: ProjectItem[]; files: StoredFile[]; panels: PanelItem[];
  autonomy: Record<string, boolean>; chat: ChatItem[]; cvBase: string;
}

export interface AuraCtx {
  remote: boolean;
  ready: boolean;
  tab: TabId;
  subview: SubviewId | null;
  setTab: (t: TabId) => void;
  openSubview: (s: SubviewId) => void;
  closeSubview: () => void;
  toast: string | null;
  showToast: (m: string) => void;

  memories: MemoryItem[];
  addMemory: (text: string, tag?: string) => void;
  deleteMemory: (id: string) => void;

  proactive: ProactiveCard[];
  runProactive: (c: ProactiveCard) => void;
  googleConnected: boolean;
  connectGoogle: () => void;

  chat: ChatItem[];
  sending: boolean;
  sendMessage: (text: string) => Promise<void>;

  projects: ProjectItem[];
  createProject: (title: string, desc: string) => void;
  projectMessage: (id: string, text: string) => Promise<void>;
  linkFileToProject: (projectId: string, file: StoredFile) => void;

  credentials: CredentialItem[];
  addCredential: (c: { siteName: string; domain: string; username: string; password: string }) => Promise<void>;
  deleteCredential: (id: string) => void;

  files: StoredFile[];
  uploadFile: (f: File) => Promise<void>;
  deleteFile: (id: string) => void;
  tailorCv: (role: string, format: 'pdf' | 'docx') => Promise<void>;
  cvBase: string;
  setCvBase: (t: string) => void;

  panels: PanelItem[];
  updatePanel: (id: string, patch: Partial<PanelItem>) => void;
  createPanel: (prompt: string) => Promise<void>;
  deletePanel: (id: string) => void;

  autonomy: AutonomyRule[];
  toggleAutonomy: (id: string) => void;

  handoff: HandoffState | null;
  startHandoff: (url: string, task: string, fileName?: string | null, focus?: boolean, opts?: { loginMode?: boolean }) => Promise<void>;
  finishHandoff: () => Promise<void>;
  approveHandoff: () => Promise<void>;
  toggleTakeover: () => Promise<void>;
  closeHandoff: () => Promise<void>;
  liveFullscreen: boolean;
  setLiveFullscreen: (v: boolean) => void;
}

const Ctx = createContext<AuraCtx | null>(null);
export const useAura = (): AuraCtx => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAura fora do AuraProvider');
  return c;
};

const cleanDomain = (u: string) => u.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();

export const AuraProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = useState(false);
  const [tab, setTabState] = useState<TabId>('inicio');
  const [subview, setSubview] = useState<SubviewId | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number>();

  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [proactive, setProactive] = useState<ProactiveCard[]>([]);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [sending, setSending] = useState(false);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [credentials, setCredentials] = useState<CredentialItem[]>([]);
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [panels, setPanels] = useState<PanelItem[]>([]);
  const [autonomyMap, setAutonomyMap] = useState<Record<string, boolean>>(DEFAULT_AUTONOMY);
  const [cvBase, setCvBaseState] = useState('');
  const [handoff, setHandoff] = useState<HandoffState | null>(null);
  const [liveFullscreen, setLiveFullscreen] = useState(false);

  const showToast = useCallback((m: string) => {
    setToast(m);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  }, []);

  /* ---------------------------- carga inicial ---------------------------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      if (remote) {
        const [boot, creds, feed] = await Promise.all([api.data.bootstrap(), api.vault.list(), api.proactive.sync()]);
        if (!alive) return;
        if (boot) {
          setMemories(boot.memories);
          setProjects(boot.projects);
          setFiles(boot.files);
          setChat(boot.chat.length ? boot.chat : SEED_CHAT);
          setAutonomyMap(Object.fromEntries(boot.autonomy.map((r) => [r.category, r.mode === 'auto'])));
          setCvBaseState(typeof boot.settings.cv_base_text === 'string' ? boot.settings.cv_base_text : '');
          if (boot.panels.length) setPanels(boot.panels);
          else {
            const seeded = seedPanels();
            setPanels(seeded);
            seeded.forEach((p) => void api.data.panelSave(p));
          }
        } else {
          showToast('Supabase indisponível — usando modo local');
          setChat(SEED_CHAT);
          setPanels(seedPanels());
        }
        if (creds) setCredentials(creds);
        if (feed) setProactive(feed);
        setGoogleConnected(Boolean(feed));
      } else {
        const snap = await loadJSON<LocalSnapshot | null>(LOCAL_KEY, null);
        if (!alive) return;
        setMemories(snap?.memories ?? SEED_MEMORIES);
        setProjects(snap?.projects ?? SEED_PROJECTS);
        setFiles(snap?.files ?? SEED_FILES);
        setPanels(snap?.panels ?? seedPanels());
        setAutonomyMap(snap?.autonomy ?? DEFAULT_AUTONOMY);
        setChat(snap?.chat ?? SEED_CHAT);
        setCvBaseState(snap?.cvBase ?? '');
        setProactive(SEED_PROACTIVE);
      }
      setReady(true);
    })();
    return () => { alive = false; };
  }, [showToast]);

  /* ------------------ persistência local (modo sem Supabase) ------------------ */
  useEffect(() => {
    if (remote || !ready) return;
    const t = window.setTimeout(() => {
      void saveJSON(LOCAL_KEY, {
        memories, projects, files, panels, autonomy: autonomyMap, chat: chat.slice(-80), cvBase
      } satisfies LocalSnapshot);
    }, 400);
    return () => window.clearTimeout(t);
  }, [ready, memories, projects, files, panels, autonomyMap, chat, cvBase]);

  /* ------------------------------ navegação ------------------------------ */
  const setTab = useCallback((t: TabId) => { void tap(); setSubview(null); setTabState(t); }, []);
  const openSubview = useCallback((s: SubviewId) => { void tap(); setSubview(s); }, []);
  const closeSubview = useCallback(() => { setSubview(null); setTabState('menu'); }, []);

  /* -------------------------------- memória -------------------------------- */
  const addMemory = useCallback((text: string, tag = 'Manual') => {
    const m: MemoryItem = { id: uuid(), tag, text };
    setMemories((p) => [m, ...p]);
    if (remote) void api.data.memoryAdd(m);
  }, []);
  const deleteMemory = useCallback((id: string) => {
    setMemories((p) => p.filter((m) => m.id !== id));
    if (remote) void api.data.memoryDelete(id);
  }, []);

  /* ------------------------------- autonomia ------------------------------- */
  const autonomy = useMemo(() => buildAutonomy(autonomyMap), [autonomyMap]);
  const toggleAutonomy = useCallback((id: string) => {
    setAutonomyMap((prev) => {
      const next = !prev[id];
      if (remote) void api.data.autonomySet(id, next);
      return { ...prev, [id]: next };
    });
  }, []);

  /* ---------------------------------- Handoff ---------------------------------- */
  const handoffRef = useRef<HandoffState | null>(null);
  handoffRef.current = handoff;
  const timerRef = useRef<number>();

  const patchHandoff = useCallback((patch: Partial<HandoffState>) => {
    setHandoff((h) => (h ? { ...h, ...patch } : h));
  }, []);

  const startHandoff = useCallback(async (url: string, task: string, fileName?: string | null, focus = true, opts: { loginMode?: boolean } = {}) => {
    window.clearInterval(timerRef.current);
    const domain = cleanDomain(url);
    const cred = credentials.find((c) => domain.includes(c.domain.toLowerCase()) || c.domain.toLowerCase().includes(domain));
    const file = fileName ? files.find((f) => f.name === fileName) ?? null : null;
    const rule = (k: string) => autonomyMap[k] ?? DEFAULT_AUTONOMY[k];

    // Regras de autonomia: o que está em "Pedir aprovação" exige confirmação ANTES de executar.
    const loginMode = Boolean(opts.loginMode);
    let useVault = Boolean(cred) && !loginMode;
    if (cred && !loginMode && !rule('login_sites')) {
      useVault = window.confirm(`Usar o login salvo de ${cred.siteName} (${cred.username}) neste site?`);
    }
    let uploadFiles = Boolean(file) && !loginMode;
    if (file && !loginMode && !rule('upload_files_forms')) {
      uploadFiles = window.confirm(`Anexar "${file.name}" nos formulários deste site?`);
    }
    const requireApproval = loginMode || !(rule('send_messages_apply') && rule('payments'));

    const credUsed = cred && useVault ? `${cred.siteName} (${cred.username})` : 'Sem login do Cofre (usa cookies do perfil)';
    const base: HandoffState = {
      id: uuid(), remote, url: url.replace(/^https?:\/\//i, ''), task,
      fileName: file && uploadFiles ? file.name : null, fileId: file && uploadFiles ? file.id : null,
      credUsed: loginMode ? 'Você fará o login; ele fica guardado no perfil' : credUsed,
      status: 'running', stepIndex: 0, liveUrl: null, requireApproval, loginMode,
      steps: loginMode ? [`Abrindo ${domain} no navegador isolado…`, 'Pronto: toque em "Tomar controle" e faça o seu login.'] : [
        `Abrindo ${domain} no navegador isolado…`,
        useVault ? 'Injetando login do Cofre AES-256 (a senha não passa pela IA)…' : 'Navegando com o perfil persistente…',
        file && uploadFiles ? `Preparando upload de "${file.name}"…` : 'Navegando em ritmo humano…',
        requireApproval ? 'Pausado para sua aprovação final.' : 'Concluindo a tarefa.'
      ]
    };
    setHandoff(base);
    if (focus) setSubview('browser');

    if (remote) {
      const res = await api.handoff.start({
        task, targetUrl: url, fileId: base.fileId, useVault, requireApproval, uploadFiles, loginMode
      });
      if (!res) {
        const why = explainError(lastFunctionError.message) || 'Confira a chave do Browser Use.';
        patchHandoff({ status: 'failed', error: `Não consegui iniciar o navegador na nuvem. ${why}` });
        setChat((p) => [...p, { id: uuid(), role: 'assistant', text: `⚠️ Não consegui abrir o navegador: ${why}` }]);
        return;
      }
      patchHandoff({ id: res.id, liveUrl: res.liveUrl, persistent: res.persistent, profileWarning: res.profileWarning ?? null });
      return;
    }
    // Simulação local (sem Supabase / Browser Use)
    timerRef.current = window.setInterval(() => {
      setHandoff((h) => {
        if (!h || h.status !== 'running') { window.clearInterval(timerRef.current); return h; }
        const next = h.stepIndex + 1;
        if (next >= h.steps.length - 1) {
          window.clearInterval(timerRef.current);
          return { ...h, stepIndex: h.steps.length - 1, status: h.requireApproval ? 'awaiting_approval' : 'completed' };
        }
        return { ...h, stepIndex: next };
      });
    }, 800);
  }, [credentials, files, autonomyMap, patchHandoff]);

  // Polling do backend enquanto a sessão remota está rodando
  const reportedRef = useRef<Set<string>>(new Set());
  const autoTakeRef = useRef<Set<string>>(new Set());
  const takeoverRef = useRef<() => Promise<void>>();
  const hId = handoff?.id;
  const hStatus = handoff?.status;
  const hRemote = handoff?.remote;
  useEffect(() => {
    if (!hRemote || !hId || (hStatus !== 'running' && hStatus !== 'takeover')) return;
    let alive = true;
    const tick = async () => {
      const r = await api.handoff.status(hId);
      if (!alive || !r) return;
      setHandoff((h) => {
        if (!h || h.id !== hId) return h;
        // Em "takeover" o agente está parado de propósito: só atualiza a Live View.
        if (h.status === 'takeover') return { ...h, liveUrl: r.liveUrl || h.liveUrl };
        return {
          ...h, liveUrl: r.liveUrl || h.liveUrl,
          steps: r.steps.length ? r.steps : h.steps,
          stepIndex: r.steps.length ? r.steps.length - 1 : h.stepIndex,
          status: r.status, error: r.error || undefined
        };
      });
      if (handoffRef.current?.loginMode && (r.status === 'awaiting_approval' || r.status === 'completed') && !autoTakeRef.current.has(hId)) {
        // "Guardar login": a IA só abriu o site; agora é você. Entra direto em "Tomar controle" + tela cheia.
        autoTakeRef.current.add(hId);
        void takeoverRef.current?.();
        return;
      }
      if (!handoffRef.current?.loginMode && (r.status === 'awaiting_approval' || r.status === 'completed' || r.status === 'failed')) {
        const k = `${hId}:${r.status}`;
        if (!reportedRef.current.has(k)) {
          reportedRef.current.add(k);
          const dom = (handoffRef.current?.url ?? '').split('/')[0];
          const text = r.status === 'failed'
            ? `⚠️ O navegador não conseguiu concluir em ${dom}: ${r.error || 'erro desconhecido'}`
            : `${r.result?.trim() || `Terminei no navegador (${dom}).`}${r.status === 'awaiting_approval' ? '\n\nParei antes do envio final. Abra a sessão para revisar e aprovar.' : ''}`;
          setChat((p) => [...p, { id: uuid(), role: 'assistant', text }]);
          void api.data.chatAppend(text); // entra no histórico: a IA lembra do resultado nas próximas mensagens
        }
      }
      if (r.status === 'awaiting_approval' && !handoffRef.current?.loginMode) {
        void success();
        void notifyLocal('Aura precisa da sua aprovação', 'O navegador parou antes do envio final.');
      }
    };
    const iv = window.setInterval(tick, 3000);
    void tick();
    return () => { alive = false; window.clearInterval(iv); };
  }, [hId, hStatus, hRemote]);

  const approveHandoff = useCallback(async () => {
    const h = handoffRef.current;
    if (!h) return;
    if (h.remote) {
      const r = await api.handoff.approve(h.id);
      if (!r) { showToast('Não consegui enviar a aprovação'); return; }
      patchHandoff({ status: 'running', steps: [...h.steps, 'Aprovado: executando o envio final…'] });
    } else {
      patchHandoff({ status: 'completed' });
    }
    void success();
    showToast('Ação aprovada!');
  }, [patchHandoff, showToast]);

  const toggleTakeover = useCallback(async () => {
    const h = handoffRef.current;
    if (!h) return;
    const entering = h.status !== 'takeover';
    if (h.remote) {
      const r = entering ? await api.handoff.takeover(h.id) : await api.handoff.resume(h.id);
      if (!r) { showToast('Não consegui trocar o controle'); return; }
      patchHandoff({ status: entering ? 'takeover' : 'running' });
    } else {
      patchHandoff({ status: entering ? 'takeover' : 'awaiting_approval' });
    }
    // Ao tomar o controle, abre a Live View em tela cheia para você agir na hora.
    if (entering) setLiveFullscreen(true);
    void tap();
  }, [patchHandoff, showToast]);

  takeoverRef.current = toggleTakeover;

  const finishHandoff = useCallback(async () => {
    const h = handoffRef.current;
    if (!h) return;
    if (h.remote) {
      const r = await api.handoff.finish(h.id);
      if (!r) { showToast('Não consegui encerrar a sessão'); return; }
    }
    patchHandoff({ status: 'completed' });
    setLiveFullscreen(false);
    showToast(h.persistent === false ? 'Sessão encerrada (sem perfil persistente: login não guardado)' : 'Login guardado no perfil ✔');
    void success();
  }, [patchHandoff, showToast]);

  const closeHandoff = useCallback(async () => {
    const h = handoffRef.current;
    window.clearInterval(timerRef.current);
    if (h?.remote && h.status !== 'completed') await api.handoff.cancel(h.id);
    setLiveFullscreen(false);
    setHandoff(null);
  }, []);

  /* -------------------------------- Proativo -------------------------------- */
  const sendRef = useRef<(t: string) => Promise<void>>();
  const runProactive = useCallback((c: ProactiveCard) => {
    // Cartões sem site (resumos de Gmail/Agenda) viram uma pergunta no chat; os demais abrem o navegador.
    if (c.url) void startHandoff(c.url, `${c.verb}: ${c.text}`, c.file);
    else void sendRef.current?.(`${c.verb}: ${c.text}`);
    setProactive((p) => p.filter((x) => x.id !== c.id));
    if (remote) void api.proactive.setStatus(c.id, 'approved');
  }, [startHandoff]);

  const connectGoogle = useCallback(async () => {
    if (!remote) {
      setGoogleConnected((v) => { showToast(!v ? 'Gmail, Agenda e Cofre conectados (demo local)' : 'Conexão pausada'); return !v; });
      return;
    }
    showToast('Sincronizando Gmail e Agenda…');
    const feed = await api.proactive.sync();
    if (feed) { setProactive(feed); setGoogleConnected(true); showToast('Gmail e Agenda sincronizados'); }
    else showToast('Falha ao sincronizar — confira as chaves do Google');
  }, [showToast]);

  /* --------------------------------- Arquivos --------------------------------- */
  const uploadFile = useCallback(async (f: File) => {
    if (remote) {
      showToast('Enviando arquivo…');
      const saved = await api.files.upload(f);
      if (!saved) { showToast('Falha no upload'); return; }
      setFiles((p) => [saved, ...p]);
    } else {
      setFiles((p) => [{ id: uuid(), name: f.name, ext: f.name.split('.').pop() || 'file', size: fmtSize(f.size), version: 1 }, ...p]);
    }
    showToast(`"${f.name}" salvo!`);
  }, [showToast]);

  const deleteFile = useCallback((id: string) => {
    setFiles((p) => p.filter((x) => x.id !== id));
    if (remote) void api.files.remove(id);
  }, []);

  const setCvBase = useCallback((t: string) => {
    setCvBaseState(t);
    if (remote) void api.data.settingSet('cv_base_text', t);
  }, []);

  const tailorCv = useCallback(async (role: string, format: 'pdf' | 'docx') => {
    if (remote) {
      showToast('Adaptando currículo com IA…');
      const r = await api.files.tailorCv(role, format, cvBase || undefined);
      if (!r) { showToast('Falha ao gerar o currículo (cole o texto base e confira a chave Gemini)'); return; }
      setFiles((p) => [r.file, ...p]);
      showToast(`"${r.file.name}" gerado!`);
    } else {
      const name = `CV_${role.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 18)}_2026.${format}`;
      setFiles((p) => [{ id: uuid(), name, ext: format, size: format === 'pdf' ? '254 KB' : '116 KB', version: p.length + 1 }, ...p]);
      showToast(`"${name}" gerado (demo local)`);
    }
  }, [cvBase, showToast]);

  /* ---------------------------------- Cofre ---------------------------------- */
  const addCredential = useCallback(async (c: { siteName: string; domain: string; username: string; password: string }) => {
    if (remote) {
      const saved = await api.vault.save(c);
      if (!saved) { showToast('Falha ao salvar no Cofre'); return; }
      setCredentials((p) => [saved, ...p]);
    } else {
      // Sem backend a senha fica só em memória (nunca vai para o armazenamento do aparelho).
      setCredentials((p) => [{ id: uuid(), siteName: c.siteName, domain: c.domain, username: c.username, pass: c.password }, ...p]);
    }
    showToast(remote ? 'Login salvo no Cofre AES-256' : 'Login guardado só em memória (modo local)');
  }, [showToast]);

  const deleteCredential = useCallback((id: string) => {
    setCredentials((p) => p.filter((x) => x.id !== id));
    if (remote) void api.vault.remove(id);
  }, []);

  /* --------------------------------- Painéis --------------------------------- */
  const updatePanel = useCallback((id: string, patch: Partial<PanelItem>) => {
    setPanels((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      const next = { ...p, ...patch } as PanelItem;
      if (remote) void api.data.panelSave(next);
      return next;
    }));
  }, []);

  const createPanel = useCallback(async (prompt: string) => {
    let spec = remote ? (await api.chat.generatePanel(prompt))?.panel : undefined;
    if (!spec) spec = localPanelSpec(prompt);
    const panel = panelFromSpec(spec);
    setPanels((p) => [...p, panel]);
    if (remote) void api.data.panelSave(panel);
    showToast(`Painel "${panel.title}" criado!`);
  }, [showToast]);

  const deletePanel = useCallback((id: string) => {
    setPanels((p) => p.filter((x) => x.id !== id));
    if (remote) void api.data.panelDelete(id);
  }, []);

  /* --------------------------------- Projetos --------------------------------- */
  const createProject = useCallback((title: string, desc: string) => {
    const p: ProjectItem = {
      id: uuid(), title, desc, files: [],
      messages: [{ role: 'assistant', text: `Projeto "${title}" iniciado! Anexe arquivos e continue a conversa aqui.` }]
    };
    setProjects((prev) => [p, ...prev]);
    if (remote) void api.data.projectCreate({ id: p.id, title, desc });
    setTab('projetos');
    showToast('Projeto criado!');
  }, [setTab, showToast]);

  const linkFileToProject = useCallback((projectId: string, file: StoredFile) => {
    setProjects((prev) => prev.map((p) => (p.id === projectId && !p.files.includes(file.name) ? { ...p, files: [...p.files, file.name] } : p)));
    if (remote && file.storagePath) void api.data.projectAddFile(projectId, file.name, file.storagePath);
  }, []);

  const projectMessage = useCallback(async (id: string, text: string) => {
    const clean = text.trim();
    if (!clean) return;
    const proj = projects.find((p) => p.id === id);
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, messages: [...p.messages, { role: 'user', text: clean }] } : p)));
    let reply = `Salvo no projeto "${proj?.title ?? ''}" com contexto atualizado.`;
    if (remote) {
      const r = await api.chat.send(clean, id);
      reply = r?.reply ?? `⚠️ Não consegui falar com a IA.\n${explainError(lastFunctionError.message)}`;
    }
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, messages: [...p.messages, { role: 'assistant', text: reply }] } : p)));
  }, [projects]);

  /* ----------------------------------- Chat ----------------------------------- */
  const handleChatResult = useCallback(async (res: api.ChatResult, items: ChatItem[]) => {
    const t = res.timing;
    items.push({
      id: uuid(), role: 'assistant', text: res.reply,
      meta: t ? `${((t.ctx + t.llm) / 1000).toFixed(1)}s · ${t.model || 'IA'}` : undefined
    });
    if (res.memorySaved) {
      setMemories((p) => [{ id: res.memoryId ?? uuid(), tag: 'IA', text: res.memorySaved! }, ...p]);
      // No modo remoto a função aura-chat já gravou a memória (com embedding).
    }
    if (res.panel) {
      const panel = panelFromSpec(res.panel);
      setPanels((p) => [...p, panel]);
      if (remote) void api.data.panelSave(panel);
    }
    if (res.handoff) {
      const dom = cleanDomain(res.handoff.url);
      items.push({
        id: uuid(), role: 'handoff_card', title: `Sessão · ${dom}`, domain: dom,
        task: res.handoff.task, file: res.handoff.fileName ?? null
      });
      // A IA decidiu que a conversa exige o navegador: abre sozinha, sem tirar você do chat.
      // Se já existe uma sessão em andamento, não a atropela: o cartão fica disponível para abrir manualmente.
      const cur = handoffRef.current;
      const busy = cur && ['running', 'awaiting_approval', 'takeover'].includes(cur.status);
      if (!busy) void startHandoff(res.handoff.url, res.handoff.task, res.handoff.fileName ?? null, false);
    }
    if (res.cvRequest) await tailorCv(res.cvRequest.role, res.cvRequest.format);
  }, [tailorCv, startHandoff]);

  const sendMessage = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean || sending) return;
    setTabState('chat');
    setSubview(null);
    setChat((p) => [...p, { id: uuid(), role: 'user', text: clean }]);
    setSending(true);
    try {
      let res: api.ChatResult | null;
      if (remote) {
        res = await api.chat.send(clean);
        if (!res) {
          // Com o backend ligado nunca mascaramos a falha com resposta pronta: mostramos o motivo real.
          setChat((p) => [...p, { id: uuid(), role: 'assistant', text: `⚠️ Não consegui falar com a IA.\n${explainError(lastFunctionError.message)}` }]);
          return;
        }
      } else {
        res = localChat(clean, memories.length, files);
      }
      const items: ChatItem[] = [];
      await handleChatResult(res, items);
      setChat((p) => [...p, ...items]);
    } finally {
      setSending(false);
    }
  }, [sending, memories.length, files, handleChatResult]);

  sendRef.current = sendMessage;

  const value: AuraCtx = {
    remote, ready, tab, subview, setTab, openSubview, closeSubview, toast, showToast,
    memories, addMemory, deleteMemory,
    proactive, runProactive, googleConnected, connectGoogle,
    chat, sending, sendMessage,
    projects, createProject, projectMessage, linkFileToProject,
    credentials, addCredential, deleteCredential,
    files, uploadFile, deleteFile, tailorCv, cvBase, setCvBase,
    panels, updatePanel, createPanel, deletePanel,
    autonomy, toggleAutonomy,
    handoff, startHandoff, finishHandoff, approveHandoff, toggleTakeover, closeHandoff, liveFullscreen, setLiveFullscreen
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};
