import React, { useState, useEffect } from 'react';
import { Plus, Search, Mic, X, Globe, FileUp, KeyRound, Sparkles, ArrowUp } from 'lucide-react';
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
