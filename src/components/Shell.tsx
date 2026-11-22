import React, { useState, useEffect } from 'react';
import { Plus, Search, Mic, X, Globe, FileUp, KeyRound, Sparkles, ArrowUp, Minimize2, Hand, Check, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { LoginForm } from './LoginForm';
import { AutoTextarea } from './AutoTextarea';
import { useAura } from '../state/AuraContext';
import type { TabId, SubviewId } from '../types/aura';

const TABS: { id: TabId; label: string }[] = [
  { id: 'inicio', label: 'Início' },
  { id: 'chat', label: 'Chat' },
  { id: 'projetos', label: 'Projetos' }
];

export const TopBar: React.FC<{ onQuick: () => void; onNewProject: () => void }> = ({ onQuick, onNewProject }) => {
  const { tab, subview, setTab } = useAura();
  const inMenu = tab === 'menu' || subview !== null;
  return (
    <header className="shrink-0 px-4 pb-2.5 flex items-center justify-between gap-2 z-30" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
      <button
        type="button" title="Ação rápida"
        onClick={() => (tab === 'projetos' && !subview ? onNewProject() : onQuick())}
        className="w-11 h-11 rounded-full glass-pill flex items-center justify-center text-white/90 hover:bg-black/40 transition shrink-0"
      >
        {tab === 'chat' && !subview ? <Search className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
      </button>

      <nav className="glass-pill rounded-full p-1 flex items-center gap-0.5 shadow-lg shadow-black/20">
        {TABS.map((t) => {
          const active = !inMenu && tab === t.id;
          return (
            <button
              key={t.id} type="button" onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-full text-[13px] font-medium transition ${active ? 'bg-[#F2F3F5] text-[#181A20]' : 'text-white/70 hover:text-white'}`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      <button
        type="button" title="Menu, Cofre e Navegador"
        onClick={() => setTab(tab === 'menu' && !subview ? 'inicio' : 'menu')}
        className="w-11 h-11 rounded-full bg-[#0A57A3] hover:bg-[#0C66BE] border border-white/20 flex items-center justify-center text-white text-lg font-medium shadow-md transition shrink-0"
      >
        a
      </button>
    </header>
  );
};

export const Composer: React.FC<{ onQuick: () => void; onVoice: () => void }> = ({ onQuick, onVoice }) => {
  const { sendMessage, sending } = useAura();
  const [text, setText] = useState('');
  const canSend = text.trim().length > 0 && !sending;
  const submit = () => {
    if (!canSend) return;
    const v = text;
    setText('');
    void sendMessage(v);
  };
  return (
    <div className="absolute left-4 right-4 z-30" style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      <form
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        className="glass-pill rounded-[28px] pl-5 pr-2 py-1.5 flex items-end gap-1.5 shadow-2xl shadow-black/40"
      >
        <AutoTextarea
          value={text}
          onValueChange={setText}
          maxRows={5}
          placeholder={sending ? 'Aura está pensando…' : 'Enviar mensagem para o Aura'}
          className="flex-1 min-w-0 bg-transparent text-[14px] leading-[20px] text-white placeholder-white/50 focus:outline-none py-[10px]"
        />
        <button type="button" title="Anexar arquivo ou abrir navegador" onClick={onQuick}
          className="w-9 h-9 mb-0.5 rounded-full hover:bg-white/10 flex items-center justify-center text-white/80 hover:text-white transition shrink-0">
          <Plus className="w-5 h-5" />
        </button>
        <button type="button" title="Falar com o Aura" onClick={onVoice}
          className="w-9 h-9 mb-0.5 rounded-full hover:bg-white/10 flex items-center justify-center text-white/85 hover:text-white transition shrink-0">
          <Mic className="w-5 h-5" />
        </button>
        <button type="submit" title="Enviar mensagem" aria-label="Enviar mensagem" disabled={!canSend}
          className={`w-9 h-9 mb-0.5 rounded-full flex items-center justify-center transition shrink-0 ${canSend ? 'bg-[#F2F3F5] text-[#16181E]' : 'bg-white/10 text-white/35'}`}>
          <ArrowUp className="w-5 h-5" />
        </button>
      </form>
    </div>
  );
};

export const QuickSheet: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { openSubview } = useAura();
  if (!open) return null;
  const items: { id: SubviewId; label: string; Icon: typeof Globe; color: string }[] = [
    { id: 'browser', label: 'Acessar qualquer site (Navegador Handoff)', Icon: Globe, color: 'text-sky-300' },
    { id: 'files', label: 'Atualizar currículo / Enviar PDF ou Word', Icon: FileUp, color: 'text-emerald-300' },
    { id: 'vault', label: 'Abrir Cofre de Senhas (AES-256)', Icon: KeyRound, color: 'text-amber-300' },
    { id: 'panels', label: 'Criar novo Painel (micro-app)', Icon: Sparkles, color: 'text-purple-300' }
  ];
  return (
    <div className="absolute inset-0 bg-black/45 backdrop-blur-sm z-40 flex flex-col justify-end p-4" onClick={onClose}>
      <div className="glass-card rounded-[28px] p-4 space-y-2 animate-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="text-xs font-medium text-white/70">Ações rápidas do Aura</span>
          <button type="button" onClick={onClose} className="text-white/60 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        {items.map(({ id, label, Icon, color }) => (
          <button key={id} type="button" onClick={() => { onClose(); openSubview(id); }}
            className="w-full px-4 py-3 rounded-2xl glass-tile hover:bg-white/10 text-left text-sm text-white flex items-center gap-3">
            <Icon className={`w-4 h-4 ${color}`} /> {label}
          </button>
        ))}
      </div>
    </div>
  );
};

export const ProjectModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { createProject } = useAura();
  if (!open) return null;
  return (
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-5" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          createProject(String(f.get('title')).trim(), String(f.get('desc')).trim());
          onClose();
        }}
        className="w-full glass-card rounded-[28px] p-5 space-y-3 animate-in"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-xl text-white">Novo projeto</h3>
          <button type="button" onClick={onClose} className="text-white/60 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <input name="title" required placeholder="Nome do projeto" className="w-full glass-tile rounded-2xl px-3.5 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none" />
        <input name="desc" required placeholder="Objetivo de longo prazo" className="w-full glass-tile rounded-2xl px-3.5 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none" />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-full glass-tile text-xs text-white/80">Cancelar</button>
          <button type="submit" className="px-5 py-2 rounded-full btn-light text-xs font-medium">Criar</button>
        </div>
      </form>
    </div>
  );
};

const VOICE_SAMPLES = [
  'Acesse a Gupy com meu login salvo e envie meu currículo em PDF',
  'Atualize meu currículo em Word para uma vaga de Produto',
  'Cheque minhas mensagens novas no LinkedIn'
];

export const VoiceOverlay: React.FC<{ open: boolean; onClose: () => void; voice: ReturnType<typeof import('../hooks/useVoiceLive').useVoiceLive> }> = ({ open, onClose, voice }) => {
  const { sendMessage } = useAura();
  useEffect(() => { if (open) void voice.start(); else voice.stop(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  if (!open) return null;
  const modeLabel = voice.mode === 'gemini-live' ? 'Gemini Live' : voice.mode === 'web-speech' ? 'Voz do dispositivo' : 'Comandos rápidos';
  return (
    <div className="absolute inset-0 aura-backdrop z-50 flex flex-col justify-between p-6 animate-in" style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}>
      <div className="flex items-center justify-between">
        <span className="px-3.5 py-1.5 rounded-full glass-pill text-xs text-white/90">Voz Live · {modeLabel}</span>
        <button type="button" onClick={onClose} className="w-10 h-10 rounded-full glass-pill flex items-center justify-center text-white"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex flex-col items-center text-center space-y-6 my-auto">
        <button type="button" onClick={() => (voice.isListening ? voice.commit() : void voice.start())}
          className="w-24 h-24 rounded-full bg-[#F2F3F5] text-[#16181E] flex items-center justify-center shadow-2xl">
          <Mic className="w-9 h-9" />
        </button>
        <div className="flex items-center justify-center gap-1.5 h-10">
          {[0, 0.15, 0.3, 0.45].map((d, i) => (
            <span key={d} className={`w-1.5 rounded-full ${i % 2 ? 'bg-white/75' : 'bg-white/90'} ${voice.isListening ? 'wave-bar' : ''}`} style={{ animationDelay: `${d}s`, height: voice.isListening ? undefined : 10 }} />
          ))}
        </div>
        <p className="font-serif text-2xl text-white">{voice.isListening ? 'Estou ouvindo...' : 'Toque para falar'}</p>
        <p className="text-xs text-white/80 min-h-[1rem]">{voice.transcript || voice.status}</p>
        <div className="w-full space-y-2">
          {VOICE_SAMPLES.map((s) => (
            <button key={s} type="button" onClick={() => { voice.stop(); onClose(); void sendMessage(s); }}
              className="w-full text-left px-4 py-3 rounded-2xl glass-card text-xs text-white/90">“{s}”</button>
          ))}
        </div>
      </div>
      <button type="button" onClick={onClose} className="w-full py-3 rounded-full glass-pill text-xs font-medium text-white">Voltar</button>
    </div>
  );
};

export const Toast: React.FC = () => {
  const { toast } = useAura();
  return (
    <div className={`pointer-events-none transition-opacity duration-200 absolute top-20 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-full obsidian-card text-xs text-white shadow-2xl whitespace-nowrap max-w-[92%] overflow-hidden text-ellipsis ${toast ? 'opacity-100' : 'opacity-0'}`}>
      {toast}
    </div>
  );
};

/** Live View em tela cheia, com "Tomar controle" / "Devolver à IA" sempre à mão. */
export const LiveViewOverlay: React.FC = () => {
  const { handoff: h, liveFullscreen, setLiveFullscreen, approveHandoff, toggleTakeover, closeHandoff, requestFinish, openVaultSheet, submitLogin } = useAura();
  const [busy, setBusy] = useState(false);
  if (!liveFullscreen || !h) return null;

  const mine = h.status === 'takeover';
  const finished = h.status === 'completed' || h.status === 'failed' || h.status === 'cancelled';
  const chip =
    mine ? { t: '✋ Você está no controle', c: 'bg-amber-400/20 text-amber-200 border-amber-300/30' }
    : h.status === 'needs_login' ? { t: '🔐 Precisa do seu login', c: 'bg-amber-400/20 text-amber-200 border-amber-300/30' }
    : h.status === 'needs_manual' ? { t: '✋ Precisa de verificação manual', c: 'bg-amber-400/20 text-amber-200 border-amber-300/30' }
    : h.status === 'awaiting_approval' ? { t: '⏸ Aguardando sua aprovação', c: 'bg-sky-400/20 text-sky-200 border-sky-300/30' }
    : h.status === 'completed' ? { t: '✅ Concluído', c: 'bg-emerald-400/20 text-emerald-200 border-emerald-300/30' }
    : h.status === 'failed' ? { t: '⚠️ Falhou', c: 'bg-red-400/20 text-red-200 border-red-300/30' }
    : h.status === 'cancelled' ? { t: 'Cancelado', c: 'bg-white/10 text-white/70 border-white/10' }
    : { t: '🤖 A IA está navegando', c: 'bg-white/10 text-white/85 border-white/15' };
  const swap = async () => { setBusy(true); await toggleTakeover(); setBusy(false); };

  return (
    <div className="absolute inset-0 z-[55] bg-black flex flex-col animate-in">
      <div className="shrink-0 flex items-center gap-3 px-3 pb-2 bg-[#0E1014]" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <button type="button" onClick={() => setLiveFullscreen(false)} aria-label="Reduzir" title="Reduzir"
          className="w-10 h-10 rounded-full glass-pill flex items-center justify-center text-white shrink-0">
          <Minimize2 className="w-4 h-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-mono text-white/80 truncate">{h.url}</p>
          <span className={`inline-block mt-0.5 px-2 py-0.5 rounded-full border text-[10px] ${chip.c}`}>{chip.t}</span>
        </div>
        <button type="button" onClick={() => openVaultSheet('manual')} aria-label="Abrir o Cofre" title="Cofre"
          className="h-10 px-3 rounded-full glass-pill text-xs text-white inline-flex items-center gap-1.5 shrink-0">
          <KeyRound className="w-4 h-4 text-amber-300" /> Cofre
        </button>
      </div>

      <div className="flex-1 relative bg-black min-h-0">
        {h.liveUrl ? (
          <iframe src={h.liveUrl} title="Live View em tela cheia" className="absolute inset-0 w-full h-full bg-black border-0" allow="clipboard-read; clipboard-write" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-white/60">
            {h.liveUrl === null && !finished ? 'Carregando a Live View…' : 'Sem Live View nesta sessão.'}
          </div>
        )}
        {mine && <div className="absolute inset-x-0 top-0 h-1 bg-amber-300" />}
      </div>

      <div className="shrink-0 px-3 pt-2.5 bg-[#0E1014] space-y-2" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        {mine && (
          <button type="button" onClick={() => requestFinish()} className="w-full text-[11px] text-white/70 underline underline-offset-2">Guardar este login e encerrar a sessão</button>
        )}
        {h.status === 'awaiting_approval' && h.question && <p className="text-xs text-sky-100 text-center whitespace-pre-wrap">{h.question}</p>}
        {mine && (
          <p className="text-[11px] text-amber-200/90 text-center">
            A IA está pausada. Faça a verificação (2FA, CAPTCHA) e toque em "Devolver à IA".
          </p>
        )}
        {h.status === 'needs_login' && (
          <div className="max-h-[60vh] overflow-y-auto no-scrollbar">
            <LoginForm domain={h.loginDomain || h.url.split('/')[0]} onSubmit={(c) => submitLogin(h.id, c)} onManual={() => void swap()} />
          </div>
        )}
        <div className={`flex gap-2 ${h.status === 'needs_login' ? 'hidden' : ''}`}>
          {finished ? (
            <button type="button" onClick={() => void closeHandoff()} className="flex-1 py-3 rounded-full btn-light text-sm font-medium">Fechar sessão</button>
          ) : mine ? (
            <>
              <button type="button" disabled={busy} onClick={() => void swap()} className="flex-1 py-3 rounded-full btn-light text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-60">
                <Check className="w-4 h-4" /> Devolver à IA
              </button>
              <button type="button" onClick={() => void closeHandoff()} className="px-4 rounded-full bg-white/10 text-sm text-red-300">Cancelar</button>
            </>
          ) : h.status === 'awaiting_approval' ? (
            <>
              <button type="button" onClick={() => void approveHandoff()} className="flex-1 py-3 rounded-full btn-light text-sm font-medium">✓ Aprovar e enviar</button>
              <button type="button" disabled={busy} onClick={() => void swap()} className="px-4 rounded-full bg-white/10 text-sm text-white inline-flex items-center gap-1.5 disabled:opacity-60"><Hand className="w-4 h-4" /> Tomar controle</button>
              <button type="button" onClick={() => void closeHandoff()} aria-label="Cancelar" className="w-12 rounded-full bg-white/10 text-red-300 flex items-center justify-center"><X className="w-4 h-4" /></button>
            </>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={() => void swap()} className="flex-1 py-3 rounded-full btn-light text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-60">
                <Hand className="w-4 h-4" /> Tomar controle
              </button>
              <button type="button" onClick={() => void closeHandoff()} className="px-4 rounded-full bg-white/10 text-sm text-red-300">Cancelar</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/** Cofre aberto por cima da Live View: guarda usuário/senha (AES-256 no servidor; nunca passam pela IA). */
export const VaultSheet: React.FC = () => {
  const { vaultSheet, closeVaultSheet, handoff: h, credentials, addCredential, deleteCredential, finishHandoff, setLiveFullscreen, openSubview, remote } = useAura();
  const domain = h ? h.url.replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./i, '') : '';
  const [f, setF] = useState({ siteName: '', domain: '', username: '', password: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!vaultSheet) return;
    const base = domain.split('.')[0] || '';
    setF({ siteName: base.charAt(0).toUpperCase() + base.slice(1), domain, username: '', password: '' });
    setShow(false);
  }, [vaultSheet, domain]);

  if (!vaultSheet) return null;
  const finishing = vaultSheet === 'finish';
  const matches = credentials.filter((c) => domain && (domain.includes(c.domain.toLowerCase()) || c.domain.toLowerCase().includes(domain)));
  const field = 'w-full glass-tile rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none';

  const save = async () => {
    if (!f.siteName.trim() || !f.domain.trim() || !f.username.trim() || !f.password) return;
    setBusy(true);
    const ok = await addCredential({ ...f, siteName: f.siteName.trim(), domain: f.domain.trim(), username: f.username.trim() });
    setBusy(false);
    if (!ok) return;
    setF((p) => ({ ...p, username: '', password: '' }));
    if (finishing) { closeVaultSheet(); await finishHandoff(); }
  };

  return (
    <div className="absolute inset-0 z-[58] bg-black/60 flex items-end animate-in" onClick={() => !finishing && closeVaultSheet()}>
      <div className="w-full glass-card bg-[#171a21] rounded-t-[28px] p-5 space-y-3 max-h-[88%] overflow-y-auto no-scrollbar" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline justify-between">
          <h3 className="font-serif text-2xl text-white">cofre</h3>
          <span className="text-[11px] text-emerald-300 inline-flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> AES-256-GCM</span>
        </div>
        <p className="text-xs text-white/75">
          {finishing
            ? 'Quer guardar também o usuário e a senha? Assim o Aura entra sozinho se a sessão expirar. A senha é criptografada e nunca passa pela IA.'
            : 'Guarde aqui o login deste site. O Aura usa automaticamente nas próximas tarefas, sem mostrar a senha para a IA.'}
        </p>
        {!remote && <p className="text-[11px] text-amber-300">Modo local: a senha fica só na memória e some ao fechar o app.</p>}

        {matches.length > 0 && (
          <div className="space-y-1.5">
            {matches.map((c) => (
              <div key={c.id} className="glass-tile rounded-2xl px-3 py-2.5 flex items-center justify-between text-xs">
                <span className="text-emerald-300 min-w-0 truncate">✔ {c.siteName} · {c.username}</span>
                <button type="button" onClick={() => deleteCredential(c.id)} className="text-white/40 hover:text-red-300 px-1">✕</button>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <input className={field} value={f.siteName} onChange={(e) => setF({ ...f, siteName: e.target.value })} placeholder="Site" />
          <input className={field} value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} placeholder="dominio.com" />
        </div>
        <input className={field} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder="E-mail ou usuário" autoComplete="off" />
        <div className="relative">
          <input className={`${field} pr-11`} type={show ? 'text' : 'password'} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="Senha" autoComplete="new-password" />
          <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-white/60">
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        <div className="flex gap-2 pt-1">
          <button type="button" disabled={busy || !f.username.trim() || !f.password} onClick={() => void save()} className="flex-1 py-3 rounded-full btn-light text-sm font-medium disabled:opacity-40">
            {busy ? 'Salvando…' : finishing ? 'Salvar e concluir' : 'Salvar no Cofre'}
          </button>
          {finishing ? (
            <button type="button" onClick={() => { closeVaultSheet(); void finishHandoff(); }} className="px-4 rounded-full bg-white/10 text-sm text-white/85">Agora não</button>
          ) : (
            <button type="button" onClick={closeVaultSheet} className="px-4 rounded-full bg-white/10 text-sm text-white/85">Fechar</button>
          )}
        </div>
        {finishing ? (
          <button type="button" onClick={closeVaultSheet} className="w-full text-[11px] text-white/50 underline underline-offset-2">Voltar para o navegador</button>
        ) : (
          <button type="button" onClick={() => { closeVaultSheet(); setLiveFullscreen(false); openSubview('vault'); }} className="w-full text-[11px] text-white/50 underline underline-offset-2">Abrir o Cofre completo</button>
        )}
      </div>
    </div>
  );
};
