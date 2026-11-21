import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Upload, ExternalLink, Trash2 } from 'lucide-react';
import { useAura } from '../state/AuraContext';
import { openExternal } from '../lib/native';
import { uuid } from '../lib/api';
import type {
  PanelItem, RoutineState, ExpensesState, PomodoroState, ChecklistState
} from '../types/aura';

const input = 'glass-tile rounded-xl px-3 py-2 text-xs text-white placeholder-white/40 focus:outline-none min-w-0';
const inputL = 'w-full glass-tile rounded-2xl px-3.5 py-2.5 text-xs text-white placeholder-white/40 focus:outline-none';
const btnLight = 'rounded-full btn-light text-xs font-medium';
const brl = (n: number) => `R$ ${n.toFixed(2).replace('.', ',')}`;

/* ============================ NAVEGADOR ============================ */
const BrowserView: React.FC = () => {
  const { handoff: h, startHandoff, approveHandoff, toggleTakeover, closeHandoff, files, remote } = useAura();
  const [url, setUrl] = useState('gupy.io');
  const [task, setTask] = useState('');
  const [file, setFile] = useState('');
  const pct = h ? Math.round(((h.stepIndex + 1) / h.steps.length) * 100) : 0;
  const finished = h && (h.status === 'completed' || h.status === 'failed' || h.status === 'cancelled');

  return (
    <>
      <div className="glass-card rounded-[28px] p-5 space-y-3">
        <h3 className="font-serif text-2xl text-white">navegador universal</h3>
        <p className="text-xs text-white/70">Acesse qualquer site, use logins do Cofre e envie arquivos PDF ou Word.{!remote && ' (Simulação: configure o Supabase e o Browser Use para navegar de verdade.)'}</p>
        <form className="space-y-2.5" onSubmit={(e) => { e.preventDefault(); const u = url.trim() || 'gupy.io'; void startHandoff(u, task.trim() || `Acessar ${u}`, file || null); }}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Qualquer site (gupy.io, linkedin.com, catho...)" className={inputL} />
          <input value={task} onChange={(e) => setTask(e.target.value)} placeholder="O que o Aura deve fazer?" className={inputL} />
          <select value={file} onChange={(e) => setFile(e.target.value)} className={`${inputL} text-white/90`}>
            <option value="">Sem arquivo anexado</option>
            {files.map((f) => <option key={f.id} value={f.name}>📎 {f.name}</option>)}
          </select>
          <button type="submit" className={`w-full py-2.5 ${btnLight}`}>Executar no Navegador</button>
        </form>
      </div>

      {h && (
        <div className="obsidian-card rounded-[26px] p-4 space-y-3 animate-in">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-mono text-white/80 truncate">🌐 https://{h.url}</span>
            {!finished && (
              <button type="button" onClick={() => void toggleTakeover()} className="px-2.5 py-1 rounded-full bg-white/10 text-[10px] text-amber-300 shrink-0">
                {h.status === 'takeover' ? 'Devolver IA' : 'Assumir 2FA'}
              </button>
            )}
          </div>

          {h.liveUrl && (
            <div className="space-y-2">
              <iframe src={h.liveUrl} title="Live View" className="w-full h-64 rounded-2xl bg-black border border-white/10" allow="clipboard-read; clipboard-write" />
              <button type="button" onClick={() => void openExternal(h.liveUrl!)} className="text-[11px] text-white/60 hover:text-white inline-flex items-center gap-1">
                <ExternalLink className="w-3 h-3" /> Abrir Live View em tela cheia
              </button>
            </div>
          )}

          <div className="p-3 rounded-2xl bg-white/5 space-y-1 text-xs">
            <p className="text-white font-medium">{h.task}</p>
            <p className="text-amber-300 text-[11px]">🔐 {h.credUsed}</p>
            {h.fileName && <p className="text-emerald-300 text-[11px]">📎 Upload: {h.fileName}</p>}
          </div>
          <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-white transition-all duration-300" style={{ width: `${h.status === 'completed' ? 100 : pct}%` }} /></div>
          <p className="text-xs text-white/75">
            {h.status === 'takeover' ? '🖐️ Modo manual ativo: resolva 2FA/CAPTCHA na Live View e depois toque em "Devolver IA".'
              : h.status === 'completed' ? '✅ Concluído e cookies salvos no perfil.'
              : h.status === 'failed' ? `⚠️ ${h.error || 'A sessão falhou.'}`
              : h.status === 'cancelled' ? 'Sessão cancelada.'
              : h.steps[h.stepIndex]}
          </p>
          <div className="flex gap-2">
            {h.status === 'awaiting_approval' ? (
              <>
                <button type="button" onClick={() => void approveHandoff()} className={`flex-1 py-2.5 ${btnLight}`}>✓ Aprovar e Enviar</button>
                <button type="button" onClick={() => void closeHandoff()} className="px-4 py-2.5 rounded-full bg-white/10 text-xs text-red-300">Cancelar</button>
              </>
            ) : (
              <button type="button" onClick={() => void closeHandoff()} className="w-full py-2 rounded-full bg-white/10 text-xs text-white/80">
                {finished ? 'Fechar sessão' : 'Cancelar sessão'}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
};

/* ============================== COFRE ============================== */
const VaultView: React.FC = () => {
  const { credentials, addCredential, deleteCredential, remote } = useAura();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [f, setF] = useState({ siteName: '', domain: '', username: '', password: '' });
  return (
    <div className="glass-card rounded-[28px] p-5 space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="font-serif text-2xl text-white">cofre de senhas</h3>
        <span className="text-[11px] text-emerald-300">AES-256-GCM</span>
      </div>
      {!remote && <p className="text-[11px] text-amber-300">Modo local: as senhas ficam só na memória e somem ao fechar o app. Configure o Supabase para o Cofre criptografado.</p>}
      <form className="grid grid-cols-2 gap-2" onSubmit={async (e) => { e.preventDefault(); await addCredential(f); setF({ siteName: '', domain: '', username: '', password: '' }); }}>
        <input required value={f.siteName} onChange={(e) => setF({ ...f, siteName: e.target.value })} placeholder="Site (ex.: Catho)" className={input} />
        <input required value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} placeholder="catho.com.br" className={input} />
        <input required value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder="E-mail / login" className={input} autoComplete="off" />
        <input required type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="Senha" className={input} autoComplete="new-password" />
        <button type="submit" className={`col-span-2 py-2.5 ${btnLight}`}>Salvar no Cofre</button>
      </form>
      <div className="space-y-2 pt-1">
        {credentials.length === 0 && <p className="text-xs text-white/50">Nenhum login salvo ainda.</p>}
        {credentials.map((c) => (
          <div key={c.id} className="glass-tile rounded-2xl p-3 flex items-center justify-between text-xs">
            <div className="min-w-0">
              <p className="font-medium text-white">{c.siteName} <span className="text-white/45">({c.domain})</span></p>
              <p className="text-[11px] text-white/60 truncate">{c.username} · {revealed === c.id && c.pass ? c.pass : '••••••••'}</p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              {c.pass !== undefined && (
                <button type="button" onClick={() => setRevealed(revealed === c.id ? null : c.id)} className="px-2.5 py-1 rounded-full bg-white/10 text-[10px] text-white">{revealed === c.id ? 'Ocultar' : 'Ver'}</button>
              )}
              <button type="button" onClick={() => deleteCredential(c.id)} className="px-2 py-1 text-white/40 hover:text-red-300">✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ============================== ARQUIVOS ============================== */
const FilesView: React.FC = () => {
  const { files, uploadFile, deleteFile, tailorCv, startHandoff, cvBase, setCvBase, remote } = useAura();
  const [role, setRole] = useState('');
  const [ext, setExt] = useState<'pdf' | 'docx'>('pdf');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(cvBase);
  useEffect(() => setDraft(cvBase), [cvBase]);
  return (
    <div className="glass-card rounded-[28px] p-5 space-y-3">
      <h3 className="font-serif text-2xl text-white">arquivos & currículo</h3>
      {remote && (
        <div className="space-y-1.5">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== cvBase && setCvBase(draft)} rows={4}
            placeholder="Cole aqui o texto do seu currículo base. A IA adapta SEM inventar experiências."
            className={`${inputL} resize-none`} />
        </div>
      )}
      <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await tailorCv(role.trim(), ext); setBusy(false); setRole(''); }}>
        <div className="flex gap-2">
          <input required value={role} onChange={(e) => setRole(e.target.value)} placeholder="Adaptar CV para vaga (ex.: Produto)" className={`flex-1 ${input}`} />
          <select value={ext} onChange={(e) => setExt(e.target.value as 'pdf' | 'docx')} className={input}><option value="pdf">.PDF</option><option value="docx">.DOCX</option></select>
        </div>
        <button type="submit" disabled={busy} className={`w-full py-2.5 ${btnLight} disabled:opacity-60`}>{busy ? 'Gerando…' : 'Atualizar Currículo com IA'}</button>
      </form>
      <label className="w-full py-2.5 rounded-full glass-tile hover:bg-white/10 text-xs text-white/90 flex items-center justify-center gap-2 cursor-pointer">
        <Upload className="w-3.5 h-3.5" /> Subir PDF, Word (.docx) ou outro arquivo
        <input type="file" accept=".pdf,.doc,.docx,.txt,.csv,.png,.jpg,.jpeg,.zip" className="hidden"
          onChange={(e) => { const fl = e.target.files?.[0]; if (fl) void uploadFile(fl); e.target.value = ''; }} />
      </label>
      <div className="space-y-2">
        {files.map((f) => (
          <div key={f.id} className="glass-tile rounded-2xl p-3 flex items-center justify-between text-xs">
            <div className="min-w-0"><p className="font-medium text-white truncate">{f.name}</p><p className="text-[10px] text-white/55">{f.ext.toUpperCase()} · {f.size}</p></div>
            <div className="flex gap-1.5 shrink-0">
              <button type="button" onClick={() => void startHandoff('gupy.io/upload', `Anexar arquivo ${f.name}`, f.name)} className="px-2.5 py-1 rounded-full bg-white/15 text-[10px] text-white">Enviar</button>
              <button type="button" onClick={() => deleteFile(f.id)} className="px-1.5 text-white/40 hover:text-red-300">✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ============================== PAINÉIS ============================== */
const fmtSec = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

const PomodoroPanel: React.FC<{ p: PanelItem; onDelete?: () => void }> = ({ p, onDelete }) => {
  const { updatePanel, showToast } = useAura();
  const st = p.state as PomodoroState;
  const [secs, setSecs] = useState(st.minutes * 60);
  const [running, setRunning] = useState(false);
  const ref = useRef<number>();
  useEffect(() => { if (!running) setSecs(st.minutes * 60); }, [st.minutes, running]);
  useEffect(() => {
    if (!running) return;
    ref.current = window.setInterval(() => setSecs((s) => {
      if (s <= 1) { window.clearInterval(ref.current); setRunning(false); showToast('⏰ Pomodoro concluído!'); return st.minutes * 60; }
      return s - 1;
    }), 1000);
    return () => window.clearInterval(ref.current);
  }, [running, st.minutes, showToast]);
  return (
    <div className="glass-tile rounded-2xl p-3.5 space-y-2">
      <div className="flex justify-between text-xs items-center">
        <span className="text-white font-medium">{p.title}</span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-white">{fmtSec(secs)}</span>
          {onDelete && <button type="button" onClick={onDelete} className="text-white/40 hover:text-red-300"><Trash2 className="w-3.5 h-3.5" /></button>}
        </span>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => setRunning((r) => !r)} className={`flex-1 py-1.5 ${btnLight}`}>{running ? 'Pausar' : 'Iniciar'}</button>
        <button type="button" onClick={() => { setRunning(false); setSecs(st.minutes * 60); }} className="px-3.5 py-1.5 rounded-full bg-white/10 text-xs text-white">Resetar</button>
        <select value={st.minutes} disabled={running} onChange={(e) => updatePanel(p.id, { state: { minutes: Number(e.target.value) } })} className="glass-tile rounded-full px-2 text-xs text-white">
          {[15, 25, 45, 50].map((m) => <option key={m} value={m}>{m} min</option>)}
        </select>
      </div>
    </div>
  );
};

const ExpensesPanel: React.FC<{ p: PanelItem }> = ({ p }) => {
  const { updatePanel } = useAura();
  const st = p.state as ExpensesState;
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const total = st.items.reduce((s, x) => s + x.amount, 0);
  return (
    <div className="glass-tile rounded-2xl p-3.5 space-y-2">
      <div className="flex justify-between text-xs"><span className="text-white font-medium">{p.title}</span><span className={total > st.weeklyCap ? 'text-red-300' : 'text-emerald-300'}>{brl(total)} / {brl(st.weeklyCap)}</span></div>
      {st.items.map((ex) => (
        <div key={ex.id} className="flex justify-between items-center text-xs text-white/80">
          <span>{ex.title}</span>
          <span className="flex items-center gap-2">{brl(ex.amount)}<button type="button" onClick={() => updatePanel(p.id, { state: { ...st, items: st.items.filter((x) => x.id !== ex.id) } })} className="text-white/40 hover:text-red-300">✕</button></span>
        </div>
      ))}
      <form className="flex gap-1.5 pt-1" onSubmit={(e) => {
        e.preventDefault();
        const v = parseFloat(amount.replace(',', '.'));
        if (!title.trim() || !isFinite(v)) return;
        updatePanel(p.id, { state: { ...st, items: [...st.items, { id: uuid(), title: title.trim(), amount: v }] } });
        setTitle(''); setAmount('');
      }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Gasto" className={`flex-1 ${input}`} />
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="R$" className={`w-16 ${input}`} />
        <button type="submit" className={`px-3 ${btnLight}`}>+</button>
      </form>
    </div>
  );
};

const RoutinePanel: React.FC<{ p: PanelItem }> = ({ p }) => {
  const { updatePanel } = useAura();
  const st = p.state as RoutineState;
  return (
    <div className="glass-tile rounded-2xl p-3.5 space-y-2">
      <div className="flex justify-between text-xs"><span className="text-white font-medium">{p.title}</span><span className="text-sky-300">{st.waterMl} / {st.waterGoal} ml</span></div>
      <div className="flex gap-2">
        <button type="button" onClick={() => updatePanel(p.id, { state: { ...st, waterMl: Math.max(0, st.waterMl - 250) } })} className="flex-1 py-1.5 rounded-full bg-white/10 text-xs text-white">−250 ml</button>
        <button type="button" onClick={() => updatePanel(p.id, { state: { ...st, waterMl: st.waterMl + 250 } })} className={`flex-1 py-1.5 ${btnLight}`}>+250 ml</button>
      </div>
      {st.habits.map((h) => (
        <button key={h.id} type="button" onClick={() => updatePanel(p.id, { state: { ...st, habits: st.habits.map((x) => (x.id === h.id ? { ...x, done: !x.done } : x)) } })}
          className={`w-full text-left px-3 py-2 rounded-xl text-xs ${h.done ? 'bg-white/10 text-white/60 line-through' : 'bg-white/5 text-white/90'}`}>{h.done ? '✓ ' : '○ '}{h.label}</button>
      ))}
    </div>
  );
};

const ChecklistPanel: React.FC<{ p: PanelItem; onDelete: () => void }> = ({ p, onDelete }) => {
  const { updatePanel } = useAura();
  const st = p.state as ChecklistState;
  const [txt, setTxt] = useState('');
  return (
    <div className="glass-tile rounded-2xl p-3.5 space-y-2">
      <div className="flex justify-between text-xs items-center"><span className="text-white font-medium">✨ {p.title}</span><button type="button" onClick={onDelete} className="text-white/40 hover:text-red-300"><Trash2 className="w-3.5 h-3.5" /></button></div>
      {st.items.map((it) => (
        <button key={it.id} type="button" onClick={() => updatePanel(p.id, { state: { items: st.items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)) } })}
          className={`w-full text-left px-3 py-2 rounded-xl text-xs ${it.done ? 'bg-white/10 text-white/60 line-through' : 'bg-white/5 text-white/90'}`}>{it.done ? '✓ ' : '○ '}{it.label}</button>
      ))}
      <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (!txt.trim()) return; updatePanel(p.id, { state: { items: [...st.items, { id: uuid(), label: txt.trim(), done: false }] } }); setTxt(''); }}>
        <input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Novo item" className={`flex-1 ${input}`} />
        <button type="submit" className={`px-3 ${btnLight}`}>+</button>
      </form>
    </div>
  );
};

const PanelsView: React.FC = () => {
  const { panels, createPanel, deletePanel } = useAura();
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="glass-card rounded-[28px] p-5 space-y-3">
      <h3 className="font-serif text-2xl text-white">meus painéis</h3>
      <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!prompt.trim()) return; setBusy(true); await createPanel(prompt.trim()); setBusy(false); setPrompt(''); }}>
        <input required value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Criar novo painel (ex.: Pomodoro, lista de mercado)" className={`flex-1 ${input}`} />
        <button type="submit" disabled={busy} className={`px-4 py-2 ${btnLight} disabled:opacity-60`}>{busy ? '…' : 'Criar'}</button>
      </form>
      {panels.map((p) => {
        if (p.type === 'routine') return <RoutinePanel key={p.id} p={p} />;
        if (p.type === 'expenses') return <ExpensesPanel key={p.id} p={p} />;
        if (p.type === 'pomodoro') return <PomodoroPanel key={p.id} p={p} onDelete={panels.filter((x) => x.type === 'pomodoro').length > 1 ? () => deletePanel(p.id) : undefined} />;
        return <ChecklistPanel key={p.id} p={p} onDelete={() => deletePanel(p.id)} />;
      })}
    </div>
  );
};

/* ============================== MEMÓRIA ============================== */
const MemoryView: React.FC = () => {
  const { memories, addMemory, deleteMemory, showToast } = useAura();
  const [v, setV] = useState('');
  return (
    <div className="glass-card rounded-[28px] p-5 space-y-3">
      <h3 className="font-serif text-2xl text-white">memória longa</h3>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!v.trim()) return; addMemory(v.trim()); setV(''); showToast('Memória salva'); }}>
        <input required value={v} onChange={(e) => setV(e.target.value)} placeholder="Adicionar fato permanente..." className={`flex-1 ${input}`} />
        <button type="submit" className={`px-4 py-2 ${btnLight}`}>Salvar</button>
      </form>
      <div className="space-y-2">
        {memories.map((m) => (
          <div key={m.id} className="glass-tile rounded-2xl p-3 flex justify-between gap-2 text-xs">
            <div><span className="text-[10px] text-white/50 block">{m.tag}</span><span className="text-white/90">{m.text}</span></div>
            <button type="button" onClick={() => deleteMemory(m.id)} className="text-white/40 hover:text-red-300 shrink-0">✕</button>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ============================== AUTONOMIA ============================== */
const AutonomyView: React.FC = () => {
  const { autonomy, toggleAutonomy } = useAura();
  return (
    <div className="glass-card rounded-[28px] p-5 space-y-3">
      <h3 className="font-serif text-2xl text-white">segurança & autonomia</h3>
      <p className="text-xs text-white/70">Defina o que o Aura executa sozinho e o que exige sua aprovação.</p>
      <div className="space-y-2">
        {autonomy.map((a) => (
          <button key={a.id} type="button" onClick={() => toggleAutonomy(a.id)} className="w-full glass-tile rounded-2xl p-3.5 flex items-center justify-between text-left text-xs">
            <span className="text-white/90 pr-3">{a.label}</span>
            <span className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-medium ${a.auto ? 'bg-emerald-400/20 text-emerald-300' : 'bg-amber-400/20 text-amber-300'}`}>{a.auto ? 'Automático' : 'Pedir aprovação'}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export const SubviewHost: React.FC = () => {
  const { subview, closeSubview } = useAura();
  return (
    <section className="space-y-3.5 animate-in">
      <button type="button" onClick={closeSubview} className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full glass-pill text-xs text-white/90 hover:text-white">
        <ArrowLeft className="w-3.5 h-3.5" /> Voltar
      </button>
      <div className="space-y-3.5">
        {subview === 'browser' && <BrowserView />}
        {subview === 'vault' && <VaultView />}
        {subview === 'files' && <FilesView />}
        {subview === 'panels' && <PanelsView />}
        {subview === 'memory' && <MemoryView />}
        {subview === 'autonomy' && <AutonomyView />}
      </div>
    </section>
  );
};
