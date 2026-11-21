import type {
  MemoryItem, ProjectItem, AutonomyRule, StoredFile, ProactiveCard, ChatItem,
  PanelItem, GeneratedPanelSpec
} from '../types/aura';
import type { ChatResult } from './api';
import { uuid } from './api';

/** Rótulos das regras (a chave é a `category` da tabela autonomy_rules). */
export const AUTONOMY_LABELS: Record<string, string> = {
  login_sites: 'Fazer login automático usando o Cofre',
  save_new_credentials: 'Salvar novos logins/senhas automaticamente',
  tailor_cv: 'Adaptar versão de currículo (PDF/Word)',
  upload_files_forms: 'Anexar arquivos em formulários dos sites',
  send_messages_apply: 'Enviar candidaturas, mensagens e formulários finais',
  payments: 'Aprovar pagamentos ou compras'
};

export const DEFAULT_AUTONOMY: Record<string, boolean> = {
  login_sites: true,
  save_new_credentials: true,
  tailor_cv: true,
  upload_files_forms: false,
  send_messages_apply: false,
  payments: false
};

export const buildAutonomy = (modes: Record<string, boolean>): AutonomyRule[] =>
  Object.keys(AUTONOMY_LABELS).map((k) => ({
    id: k,
    label: AUTONOMY_LABELS[k],
    auto: k in modes ? modes[k] : DEFAULT_AUTONOMY[k]
  }));

export const SEED_MEMORIES: MemoryItem[] = [
  { id: 'm1', tag: 'Rotina', text: 'Blocos de foco profundo entre 8h e 10h sem reuniões.' },
  { id: 'm2', tag: 'Carreira', text: 'Sempre adaptar o currículo sob medida antes de anexar em portais.' },
  { id: 'm3', tag: 'Segurança', text: 'Salvar novos logins no Cofre AES-256 e pedir aprovação antes de enviar.' },
  { id: 'm4', tag: 'Financeiro', text: 'Teto semanal de gastos livres definido em R$ 450.' },
  { id: 'm5', tag: 'Saúde', text: 'Meta diária: 2.000 ml de água e treino de 45 minutos.' }
];

export const SEED_PROJECTS: ProjectItem[] = [
  {
    id: 'p1', title: 'Carreira & Candidaturas',
    desc: 'Atualização de currículo (PDF/Word) e envios via Navegador Universal',
    files: [], messages: [{ role: 'assistant', text: 'Pronto para adaptar seu currículo sob medida antes de cada candidatura.' }]
  },
  {
    id: 'p2', title: 'Aura OS — App Pessoal',
    desc: 'Build Capacitor (sem Expo Go) + Supabase pgvector + Cofre AES-256',
    files: [], messages: [{ role: 'assistant', text: 'Pacote completo pronto para compilar.' }]
  }
];

export const SEED_FILES: StoredFile[] = [
  { id: 'f1', name: 'Curriculo_Principal_2026.pdf', ext: 'pdf', size: '248 KB', version: 3 },
  { id: 'f2', name: 'Curriculo_Editavel_2026.docx', ext: 'docx', size: '112 KB', version: 2 }
];

export const SEED_PROACTIVE: ProactiveCard[] = [
  {
    id: 'pc1', verb: 'Enviar CV', source: 'Gupy',
    text: 'na vaga aberta da Gupy com seu login salvo e Curriculo_Principal_2026.pdf',
    badge: 'GY', badgeBg: 'bg-emerald-500 text-white', url: 'gupy.io/candidatura', file: 'Curriculo_Principal_2026.pdf'
  },
  {
    id: 'pc2', verb: 'Responder', source: 'LinkedIn',
    text: '2 mensagens de recrutadores no LinkedIn (rascunhos prontos para revisar)',
    badge: 'in', badgeBg: 'bg-[#0A66C2] text-white', url: 'linkedin.com/messaging', file: null
  }
];

export const SEED_CHAT: ChatItem[] = [
  {
    id: 'c1', role: 'assistant',
    text: 'Oi! Eu sou o Aura. Posso acessar qualquer site com seus logins do Cofre, atualizar seu currículo em PDF ou Word e montar painéis para a sua rotina. Por onde começamos?'
  }
];

export function seedPanels(): PanelItem[] {
  return [
    {
      id: uuid(), title: 'Rotina & Água', type: 'routine',
      state: {
        waterMl: 1250, waterGoal: 2000,
        habits: [
          { id: 'h1', label: 'Foco profundo (8h–10h)', done: true },
          { id: 'h2', label: 'Treino 45 min', done: false },
          { id: 'h3', label: 'Leitura 20 min', done: false }
        ]
      }
    },
    {
      id: uuid(), title: 'Gastos da Semana', type: 'expenses',
      state: {
        weeklyCap: 450,
        items: [
          { id: 'e1', title: 'Café + pão de queijo', amount: 24.5 },
          { id: 'e2', title: 'Mercado semanal', amount: 148.9 }
        ]
      }
    },
    { id: uuid(), title: 'Timer Pomodoro', type: 'pomodoro', state: { minutes: 25 } }
  ];
}

export function panelFromSpec(spec: GeneratedPanelSpec): PanelItem {
  if (spec.type === 'pomodoro') {
    return { id: uuid(), title: spec.title, type: 'pomodoro', state: { minutes: spec.minutes || 25 } };
  }
  return {
    id: uuid(), title: spec.title, type: 'checklist',
    state: { items: (spec.items?.length ? spec.items : ['Primeiro passo', 'Segundo passo']).map((label) => ({ id: uuid(), label, done: false })) }
  };
}

export function localPanelSpec(prompt: string): GeneratedPanelSpec {
  const p = prompt.toLowerCase();
  if (p.includes('pomodoro') || p.includes('timer') || p.includes('foco')) {
    return { title: 'Timer Pomodoro', type: 'pomodoro', minutes: 25 };
  }
  const title = prompt.replace(/^(criar|crie|novo|nova)?\s*(um|uma)?\s*(painel|panel)\s*(de|para|do|da)?\s*/i, '').trim() || 'Checklist rápido';
  return { title: title.charAt(0).toUpperCase() + title.slice(1), type: 'checklist', items: ['Passo 1', 'Passo 2', 'Passo 3'] };
}

/** Fallback local do chat (sem Supabase): mesma lógica de intenção do protótipo v4. */
export function localChat(text: string, memCount: number, files: StoredFile[]): ChatResult {
  const lower = text.toLowerCase();

  if (/(lembr|prefiro|guarde|anote)/.test(lower) && !/(acess|site)/.test(lower)) {
    const fact = text.replace(/^(lembre|lembrar|guarde|anote)( que)?\s*/i, '').trim();
    return { reply: `Guardei na memória longa: “${fact}”.`, memorySaved: fact };
  }
  if (lower.includes('atualiz') && (lower.includes('curr') || lower.includes('cv'))) {
    const format = lower.includes('word') || lower.includes('docx') ? 'docx' : 'pdf';
    const m = text.match(/vaga (?:de|para|em)\s+(.+)$/i);
    return {
      reply: `Vou adaptar seu currículo (${format.toUpperCase()}) e salvar no Cofre de Arquivos. Depois posso anexar em alguma vaga.`,
      cvRequest: { role: m ? m[1].trim() : 'vaga alvo', format }
    };
  }
  if (/(gupy|linkedin|site|acess|catho|banco|reserv)/.test(lower)) {
    const domain = lower.includes('linkedin') ? 'linkedin.com' : lower.includes('catho') ? 'catho.com.br' : 'gupy.io';
    const wantsFile = /(pdf|cv|curr[ií]culo)/.test(lower);
    return {
      reply: `Preparei ${domain} no Navegador Universal com seu login do Cofre. Toque no cartão abaixo para acompanhar ao vivo — eu paro antes de qualquer envio final para você aprovar.`,
      handoff: { url: domain, task: text, fileName: wantsFile ? files.find((f) => /curr|cv/i.test(f.name))?.name ?? files[0]?.name ?? null : null }
    };
  }
  if (/(painel|panel|pomodoro)/.test(lower)) {
    const spec = localPanelSpec(text);
    return { reply: `Criei o painel “${spec.title}”. Ele já está em Meus Painéis.`, panel: spec };
  }
  return {
    reply: `Perfeito! Considerei suas ${memCount} memórias salvas. Se quiser, posso executar isso em qualquer site pelo Navegador, atualizar seu currículo ou criar um novo painel.`
  };
}
