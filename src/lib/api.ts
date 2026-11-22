import { supabase, callFunction } from './supabase';
import type {
  MemoryItem, ProjectItem, PanelItem, AutonomyRule, StoredFile, CredentialItem,
  ProactiveCard, GeneratedPanelSpec, HandoffStatus
} from '../types/aura';

export const remoteEnabled = (): boolean => Boolean(supabase);

/* ------------------------------------------------------------------ */
/* Formatação                                                          */
/* ------------------------------------------------------------------ */
export function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/* ------------------------------------------------------------------ */
/* aura-data: dados persistentes (memórias, projetos, painéis, ...)    */
/* ------------------------------------------------------------------ */
export interface Bootstrap {
  memories: MemoryItem[];
  projects: ProjectItem[];
  panels: PanelItem[];
  autonomy: { category: string; mode: 'auto' | 'ask_approval' }[];
  files: StoredFile[];
  chat: { id: string; role: 'user' | 'assistant'; text: string }[];
  settings: Record<string, unknown>;
}

export const data = {
  bootstrap: () => callFunction<Bootstrap>('aura-data', { action: 'bootstrap' }),
  memoryAdd: (m: MemoryItem) => callFunction('aura-data', { action: 'memory_add', memory: m }),
  memoryDelete: (id: string) => callFunction('aura-data', { action: 'memory_delete', id }),
  projectCreate: (p: { id: string; title: string; desc: string }) =>
    callFunction('aura-data', { action: 'project_create', project: p }),
  projectAddFile: (projectId: string, fileName: string, storagePath: string) =>
    callFunction('aura-data', { action: 'project_add_file', projectId, fileName, storagePath }),
  chatAppend: (text: string) => callFunction('aura-data', { action: 'chat_append', text }),
  panelSave: (p: PanelItem) => callFunction('aura-data', { action: 'panel_save', panel: p }),
  panelDelete: (id: string) => callFunction('aura-data', { action: 'panel_delete', id }),
  autonomySet: (category: string, auto: boolean) =>
    callFunction('aura-data', { action: 'autonomy_set', category, mode: auto ? 'auto' : 'ask_approval' }),
  settingSet: (key: string, value: unknown) =>
    callFunction('aura-data', { action: 'setting_set', key, value })
};

/* ------------------------------------------------------------------ */
/* aura-chat                                                           */
/* ------------------------------------------------------------------ */
export interface ChatResult {
  reply: string;
  memorySaved?: string;
  memoryId?: string;
  timing?: { ctx: number; llm: number; model: string };
  handoff?: { url: string; task: string; fileName?: string | null };
  panel?: GeneratedPanelSpec;
  cvRequest?: { role: string; format: 'pdf' | 'docx' };
}

export interface Probe { status: number; ms: number; msg: string }
export interface DiagResult {
  listModels: number;
  available: string[];
  tests: { model: string; fast: Probe; plain: Probe; json: Probe }[];
  embed: { ok: boolean; dims: number; ms: number };
  configuredModel: string | null;
}

export const chat = {
  send: (message: string, projectId?: string) =>
    callFunction<ChatResult>('aura-chat', { action: 'chat', message, projectId }),
  generatePanel: (prompt: string) =>
    callFunction<{ panel: GeneratedPanelSpec }>('aura-chat', { action: 'generate_panel', prompt }),
  diagnose: () => callFunction<DiagResult>('aura-chat', { action: 'diagnose' }),
  liveToken: () => callFunction<{ token: string | null; model?: string }>('aura-chat', { action: 'live_token' })
};

/* ------------------------------------------------------------------ */
/* vault-credentials                                                   */
/* ------------------------------------------------------------------ */
interface VaultRow { id: string; site_name: string; domain: string; username: string }

export const vault = {
  list: async (): Promise<CredentialItem[] | null> => {
    const r = await callFunction<{ credentials: VaultRow[] }>('vault-credentials', { action: 'list' });
    return r ? r.credentials.map((c) => ({ id: c.id, siteName: c.site_name, domain: c.domain, username: c.username })) : null;
  },
  save: async (c: { siteName: string; domain: string; username: string; password: string }): Promise<CredentialItem | null> => {
    const r = await callFunction<{ saved: VaultRow }>('vault-credentials', {
      action: 'save',
      siteName: c.siteName,
      domain: c.domain,
      loginUrl: c.domain.startsWith('http') ? c.domain : `https://${c.domain}`,
      username: c.username,
      password: c.password
    });
    return r ? { id: r.saved.id, siteName: r.saved.site_name, domain: r.saved.domain, username: r.saved.username } : null;
  },
  remove: (id: string) => callFunction('vault-credentials', { action: 'delete', id })
};

/* ------------------------------------------------------------------ */
/* file-manager                                                        */
/* ------------------------------------------------------------------ */
interface FileRow {
  id: string; file_name: string; file_ext: string; size_bytes: number;
  version: number; storage_path: string; category: string;
}
export const rowToFile = (f: FileRow): StoredFile => ({
  id: f.id, name: f.file_name, ext: f.file_ext, size: fmtSize(f.size_bytes),
  version: f.version, storagePath: f.storage_path, category: f.category
});

export const files = {
  upload: async (file: File): Promise<StoredFile | null> => {
    if (!supabase) return null;
    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
    const up = await callFunction<{ path: string; token: string }>('file-manager', {
      action: 'upload_url', fileName: file.name
    });
    if (!up) return null;
    const { error } = await supabase.storage.from('aura-files').uploadToSignedUrl(up.path, up.token, file, {
      contentType: file.type || 'application/octet-stream'
    });
    if (error) { console.warn('[aura] upload falhou', error.message); return null; }
    const reg = await callFunction<{ file: FileRow }>('file-manager', {
      action: 'register', fileName: file.name, path: up.path, size: file.size,
      mime: file.type || 'application/octet-stream', ext
    });
    return reg ? rowToFile(reg.file) : null;
  },
  tailorCv: async (targetRole: string, format: 'pdf' | 'docx', baseText?: string) => {
    const r = await callFunction<{ file: FileRow; preview: string }>('file-manager', {
      action: 'tailor_cv', targetRole, format, currentCvText: baseText
    });
    return r ? { file: rowToFile(r.file), preview: r.preview } : null;
  },
  remove: (id: string) => callFunction('file-manager', { action: 'delete', id }),
  signedUrl: (storagePath: string) =>
    callFunction<{ signedUrl: string }>('file-manager', { action: 'signed_url', storagePath })
};

/* ------------------------------------------------------------------ */
/* handoff-browser (Navegador Universal)                               */
/* ------------------------------------------------------------------ */
export interface HandoffStart { id: string; liveUrl: string | null; usedVault: boolean; requireApproval: boolean; persistent?: boolean; profileWarning?: string | null }
export interface HandoffStatusResult {
  status: HandoffStatus;
  liveUrl: string | null;
  steps: string[];
  result?: string | null;
  error?: string | null;
  loginDomain?: string | null;
  question?: string | null;
}

export const handoff = {
  start: (p: { task: string; targetUrl: string; fileId?: string | null; useVault: boolean; requireApproval: boolean; uploadFiles: boolean; connect?: boolean }) =>
    callFunction<HandoffStart>('handoff-browser', { action: 'start', ...p }),
  status: (id: string) => callFunction<HandoffStatusResult>('handoff-browser', { action: 'status', id }),
  approve: (id: string) => callFunction<{ ok: boolean }>('handoff-browser', { action: 'approve', id }),
  takeover: (id: string) => callFunction<{ ok: boolean; liveUrl: string | null }>('handoff-browser', { action: 'takeover', id }),
  resume: (id: string) => callFunction<{ ok: boolean }>('handoff-browser', { action: 'resume', id }),
  provideLogin: (p: { id: string; username: string; password: string; remember: boolean; domain: string }) =>
    callFunction<{ ok: boolean }>('handoff-browser', { action: 'provide_login', ...p }),
  finish: (id: string) => callFunction<{ ok: boolean }>('handoff-browser', { action: 'finish', id }),
  cancel: (id: string) => callFunction<{ ok: boolean }>('handoff-browser', { action: 'cancel', id })
};

/* ------------------------------------------------------------------ */
/* aura-agent: agente próprio (Gemini computer-use dirigindo o navegador) */
/* ------------------------------------------------------------------ */
export type Engine = 'agent' | 'browser-use';
export type EnginePref = 'auto' | 'agent' | 'browser-use';
export interface AgentStart extends HandoffStart { engine: 'agent' | 'browser-use' }

export const agent = {
  start: (p: { task: string; targetUrl: string; useVault: boolean; requireApproval: boolean; connect?: boolean; engine?: EnginePref }) =>
    callFunction<AgentStart>('aura-agent', { action: 'start', ...p }),
  step: (id: string) => callFunction<HandoffStatusResult>('aura-agent', { action: 'step', id }),
  status: (id: string) => callFunction<HandoffStatusResult>('aura-agent', { action: 'status', id }),
  approve: (id: string) => callFunction<{ ok: boolean }>('aura-agent', { action: 'approve', id }),
  takeover: (id: string) => callFunction<{ ok: boolean; liveUrl: string | null }>('aura-agent', { action: 'takeover', id }),
  resume: (id: string) => callFunction<{ ok: boolean }>('aura-agent', { action: 'resume', id }),
  provideLogin: (p: { id: string; username: string; password: string; remember: boolean; domain: string }) =>
    callFunction<{ ok: boolean }>('aura-agent', { action: 'provide_login', ...p }),
  finish: (id: string) => callFunction<{ ok: boolean }>('aura-agent', { action: 'finish', id }),
  cancel: (id: string) => callFunction<{ ok: boolean }>('aura-agent', { action: 'cancel', id })
};

/** Mesmas operações nos dois motores: o resto do app não precisa saber qual está em uso. */
export const engineApi = (e: Engine) => e === 'agent'
  ? {
    // No agente, "running" avança a tarefa (um lote de passos por chamada); fora disso só consulta.
    poll: (id: string, running: boolean) => (running ? agent.step(id) : agent.status(id)),
    approve: agent.approve, takeover: agent.takeover, resume: agent.resume,
    provideLogin: agent.provideLogin, finish: agent.finish, cancel: agent.cancel
  }
  : {
    poll: (id: string, _running: boolean) => handoff.status(id),
    approve: handoff.approve, takeover: handoff.takeover, resume: handoff.resume,
    provideLogin: handoff.provideLogin, finish: handoff.finish, cancel: handoff.cancel
  };

/* ------------------------------------------------------------------ */
/* proactive-sync                                                      */
/* ------------------------------------------------------------------ */
interface ProactiveRow {
  id: string; source: string; summary: string; primary_label: string;
  payload: { url?: string; file?: string } | null;
}

const BADGES: Record<string, { badge: string; bg: string }> = {
  Gmail: { badge: 'M', bg: 'bg-[#D93025] text-white' },
  Agenda: { badge: '31', bg: 'bg-[#1A73E8] text-white' },
  LinkedIn: { badge: 'in', bg: 'bg-[#0A66C2] text-white' },
  Gupy: { badge: 'GY', bg: 'bg-emerald-500 text-white' },
  Proativo: { badge: 'a', bg: 'bg-[#0A57A3] text-white' }
};

export const proactive = {
  sync: async (): Promise<ProactiveCard[] | null> => {
    const r = await callFunction<{ actions: ProactiveRow[] }>('proactive-sync', { action: 'sync' });
    if (!r || !Array.isArray(r.actions)) return null;
    return r.actions.map((a) => {
      const b = BADGES[a.source] || BADGES.Proativo;
      return {
        id: a.id, verb: a.primary_label, text: a.summary, badge: b.badge, badgeBg: b.bg,
        url: a.payload?.url || '', file: a.payload?.file || null, source: a.source
      };
    });
  },
  setStatus: (id: string, status: 'approved' | 'dismissed') =>
    callFunction('proactive-sync', { action: 'update', id, status })
};
