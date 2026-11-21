import React, { useEffect, useRef, useState } from 'react';
import { Activity, Plus, Clock, Globe, ChevronRight } from 'lucide-react';
import { useAura } from '../state/AuraContext';
import { AutoTextarea } from '../components/AutoTextarea';
import type { RoutineState } from '../types/aura';

/* ============================== INÍCIO ============================== */
export const InicioView: React.FC = () => {
  const { proactive, runProactive, panels, updatePanel, openSubview, googleConnected, connectGoogle } = useAura();
  const routine = panels.find((p) => p.type === 'routine');
  const rs = routine?.state as RoutineState | undefined;
  const done = rs?.habits.filter((h) => h.done).length ?? 0;

  return (
    <section className="space-y-3.5">
      <div className="glass-card rounded-[28px] p-5 space-y-3.5 shadow-xl shadow-black/15">
        <h2 className="font-serif text-[27px] leading-tight text-white tracking-tight">aura pode fazer mais</h2>
        <p className="text-[14px] leading-relaxed text-white/85">
          Conecte seu e-mail e o Cofre para o Aura agir por você em qualquer site, atualizar seu currículo e antecipar sua rotina.
        </p>
        <button type="button" onClick={connectGoogle}
          className="w-full py-3 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 flex items-center justify-center gap-2.5 text-sm font-medium text-white transition">
          <span className="w-5 h-5 rounded-full bg-white text-[#181A20] font-bold text-xs flex items-center justify-center">G</span>
          {googleConnected ? 'Google & Cofre conectados ✓' : 'Conectar Google & Cofre'}
        </button>
      </div>

      <div className="space-y-3">
        {proactive.map((c) => (
          <button key={c.id} type="button" onClick={() => runProactive(c)}
            className="w-full text-left glass-card hover:bg-[#2a2f3d]/85 rounded-[26px] p-4 shadow-xl shadow-black/15 transition animate-in">
            <div className="flex items-start gap-2.5 leading-snug text-[14px] text-white/95">
              <span className="shrink-0 px-3 py-1 rounded-xl bg-black/35 border border-white/10 text-xs font-medium text-white">{c.verb}</span>
              <span className="flex-1">{c.text}</span>
              <span className={`shrink-0 w-7 h-7 rounded-full ${c.badgeBg} text-[11px] font-bold flex items-center justify-center shadow`}>{c.badge}</span>
            </div>
          </button>
        ))}
      </div>

      {routine && rs && (
        <div className="glass-card rounded-[28px] p-4 space-y-3 shadow-xl shadow-black/15">
          <div className="flex items-center justify-between px-1">
            <span className="text-sm font-medium text-white/95 flex items-center gap-2">
              <Activity className="w-4 h-4 text-white/80" /> Painel · Rotina & Água
            </span>
            <span className="text-xs text-white/60">{done}/{rs.habits.length} feitos</span>
          </div>
          <div className="glass-tile rounded-2xl p-3.5 flex items-center justify-between">
            <div>
              <p className="text-xs text-white/55">Hidratação hoje</p>
              <p className="text-2xl font-medium text-white tracking-tight mt-0.5">{rs.waterMl.toLocaleString('pt-BR')} ml</p>
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => updatePanel(routine.id, { state: { ...rs, waterMl: Math.max(0, rs.waterMl - 250) } })}
                className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/15 text-white text-sm flex items-center justify-center">−</button>
              <button type="button" onClick={() => updatePanel(routine.id, { state: { ...rs, waterMl: rs.waterMl + 250 } })}
                className="w-9 h-9 rounded-full bg-white text-[#16181E] font-semibold text-sm flex items-center justify-center">+</button>
            </div>
          </div>
          <div className="glass-tile rounded-2xl p-3.5 space-y-2">
            <p className="text-xs text-white/55">Hábitos do dia</p>
            <div className="space-y-1.5">
              {rs.habits.map((h) => (
                <button key={h.id} type="button"
                  onClick={() => updatePanel(routine.id, { state: { ...rs, habits: rs.habits.map((x) => (x.id === h.id ? { ...x, done: !x.done } : x)) } })}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs flex items-center justify-between transition ${h.done ? 'bg-white/10 text-white/60 line-through' : 'bg-white/5 hover:bg-white/10 text-white/90'}`}>
                  <span>{h.label}</span>
                  <span className={`w-4 h-4 rounded-full border flex items-center justify-center text-[10px] ${h.done ? 'bg-emerald-400 border-emerald-400 text-[#12141A]' : 'border-white/30'}`}>{h.done ? '✓' : ''}</span>
                </button>
              ))}
            </div>
          </div>
          <button type="button" onClick={() => openSubview('panels')}
            className="w-full py-2.5 rounded-2xl bg-white/15 hover:bg-white/20 text-xs font-medium text-white transition">
            Abrir todos os painéis (Gastos, Pomodoro)
          </button>
        </div>
      )}

      <button type="button" onClick={() => openSubview('panels')}
        className="w-full py-3 rounded-full glass-pill text-xs font-medium text-white/85 hover:text-white flex items-center justify-center gap-1.5 transition">
        <Plus className="w-4 h-4" /> Criar um novo painel
      </button>
    </section>
  );
};

/* ================================ CHAT ================================ */
export const ChatView: React.FC = () => {
  const { chat, sending, startHandoff, handoff, files, openSubview } = useAura();
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [chat.length, sending]);

  const pill = handoff ? `Handoff · ${handoff.url.split('/')[0]}` : 'Gerenciar envio de CV · Gupy';
  return (
    <section className="space-y-3">
      <div className="flex justify-end">
        <button type="button"
          onClick={() => (handoff ? openSubview('browser') : void startHandoff('gupy.io/candidatura', 'Fazer login pelo Cofre e enviar o currículo', files.find((f) => /curr|cv/i.test(f.name))?.name ?? files[0]?.name ?? null))}
          className="px-4 py-2.5 rounded-full bg-[#F2F3F5] hover:bg-white text-[#181A20] text-xs font-medium shadow-lg flex items-center gap-2 transition">
          <Clock className="w-3.5 h-3.5" /> <span>{pill}</span>
        </button>
      </div>
      <div className="space-y-3 pb-2">
        {chat.map((m) => {
          if (m.role === 'divider') return <div key={m.id} className="py-2 text-center text-xs text-white/55">{m.text}</div>;
          if (m.role === 'handoff_card') {
            return (
              <button key={m.id} type="button" onClick={() => void startHandoff(m.domain, m.task, m.file)}
                className="w-[82%] text-left obsidian-card hover:bg-black rounded-[22px] px-4 py-3.5 flex items-center gap-3.5 shadow-xl transition animate-in">
                <Globe className="w-5 h-5 text-white/60 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{m.title}</p>
                  <p className="text-xs text-white/50 truncate">{m.domain}</p>
                </div>
              </button>
            );
          }
          if (m.role === 'user') {
            return <div key={m.id} className="flex justify-end animate-in"><div className="max-w-[82%] px-4 py-3 rounded-[24px] rounded-tr-md bg-[#F2F3F5] text-[#181A20] text-[14px] leading-relaxed shadow-md whitespace-pre-wrap">{m.text}</div></div>;
          }
          return (
            <div key={m.id} className="flex justify-start animate-in">
              <div className="max-w-[86%] px-4 py-3.5 rounded-[24px] rounded-tl-md glass-card text-[14px] leading-relaxed text-white/95 shadow-lg whitespace-pre-wrap">
                {m.text}
                {m.meta && <span className="block mt-1.5 text-[10px] text-white/35">{m.meta}</span>}
              </div>
            </div>
          );
        })}
        {sending && <div className="flex justify-start"><div className="px-4 py-3 rounded-[24px] rounded-tl-md glass-card text-white/70 text-sm">…</div></div>}
        <div ref={endRef} />
      </div>
    </section>
  );
};

/* ============================== PROJETOS ============================== */
export const ProjetosView: React.FC<{ onNew: () => void }> = ({ onNew }) => {
  const { projects, projectMessage, files, linkFileToProject } = useAura();
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const p = projects.find((x) => x.id === selected);

  if (p) {
    return (
      <section className="space-y-3 animate-in">
        <button type="button" onClick={() => setSelected(null)} className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full glass-pill text-xs text-white">← Projetos</button>
        <div className="glass-card rounded-[26px] p-4 space-y-2.5">
          <h3 className="font-serif text-2xl text-white">{p.title}</h3>
          <p className="text-xs text-white/75">{p.desc}</p>
          <div className="flex flex-wrap gap-1.5">
            {p.files.map((f) => <span key={f} className="px-2.5 py-1 rounded-xl glass-tile text-[11px] text-white/85">{f}</span>)}
            {p.files.length === 0 && <span className="text-[11px] text-white/45">Nenhum arquivo vinculado</span>}
          </div>
          {files.length > 0 && (
            <select value="" onChange={(e) => { const f = files.find((x) => x.id === e.target.value); if (f) linkFileToProject(p.id, f); }}
              className="w-full glass-tile rounded-2xl px-3 py-2 text-xs text-white/90 focus:outline-none">
              <option value="">＋ Vincular arquivo do Cofre…</option>
              {files.filter((f) => !p.files.includes(f.name)).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
        </div>
        <div className="space-y-2">
          {p.messages.map((m, i) => (
            <div key={i} className={`px-4 py-3 rounded-[22px] text-xs whitespace-pre-wrap ${m.role === 'user' ? 'bg-[#F2F3F5] text-[#16181E] ml-8' : 'glass-card text-white/90 mr-8'}`}>{m.text}</div>
          ))}
        </div>
        <form onSubmit={async (e) => { e.preventDefault(); if (!text.trim() || busy) return; const v = text; setText(''); setBusy(true); await projectMessage(p.id, v); setBusy(false); }}
          className="glass-pill rounded-[24px] pl-4 pr-2 py-1.5 flex items-end gap-2">
          <AutoTextarea value={text} onValueChange={setText} disabled={busy} maxRows={5} placeholder="Continuar neste projeto..." className="flex-1 min-w-0 bg-transparent text-xs leading-[18px] text-white placeholder-white/50 focus:outline-none py-[7px]" />
          <button type="submit" disabled={busy || !text.trim()} className="px-3.5 py-1.5 mb-0.5 rounded-full btn-light text-xs font-medium disabled:opacity-40 shrink-0">Enviar</button>
        </form>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="pt-10 pb-4 px-2">
        <p className="text-[28px] leading-[1.28] text-white/95 font-normal tracking-tight">
          <span className="font-serif text-[32px]">projetos,</span> são um espaço para organizar suas tarefas e experiências de <span className="text-white/75">longo</span> prazo. Clique em
          <button type="button" onClick={onNew} className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 border border-white/15 text-white align-middle mx-1 transition">
            <Plus className="w-4 h-4" />
          </button>
          para iniciar um novo projeto.
        </p>
      </div>
      <div className="space-y-2.5">
        {projects.map((x) => (
          <button key={x.id} type="button" onClick={() => setSelected(x.id)} className="w-full text-left glass-card hover:bg-[#2a2f3d]/85 rounded-[24px] p-4 space-y-1.5 transition">
            <div className="flex items-center justify-between"><span className="font-medium text-sm text-white">{x.title}</span><ChevronRight className="w-4 h-4 text-white/45" /></div>
            <p className="text-xs text-white/65">{x.desc}</p>
          </button>
        ))}
      </div>
    </section>
  );
};
