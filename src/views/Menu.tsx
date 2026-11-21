import React from 'react';
import { ChevronRight, Globe, KeyRound, FileText, LayoutGrid, Shield, Brain, Stethoscope } from 'lucide-react';
import { useAura } from '../state/AuraContext';
import type { SubviewId } from '../types/aura';

const GROUP1: { id: SubviewId; label: string; Icon: typeof Globe }[] = [
  { id: 'browser', label: 'Navegador Universal (Qualquer site)', Icon: Globe },
  { id: 'vault', label: 'Cofre de Senhas e Logins (AES-256)', Icon: KeyRound },
  { id: 'files', label: 'Arquivos & Currículo (PDF / Word)', Icon: FileText },
  { id: 'panels', label: 'Meus Painéis (Micro-apps)', Icon: LayoutGrid }
];
const GROUP2: { id: SubviewId; label: string; Icon: typeof Globe }[] = [
  { id: 'autonomy', label: 'Segurança e Autonomia', Icon: Shield },
  { id: 'memory', label: 'Memória & Contexto (pgvector)', Icon: Brain },
  { id: 'diagnostics', label: 'Diagnóstico da IA', Icon: Stethoscope }
];

const Row: React.FC<{ id: SubviewId; label: string; Icon: typeof Globe }> = ({ id, label, Icon }) => {
  const { openSubview } = useAura();
  return (
    <button type="button" onClick={() => openSubview(id)} className="w-full px-5 py-4 flex items-center justify-between text-sm text-white/90 hover:bg-white/5 transition">
      <span className="flex items-center gap-3.5"><Icon className="w-4 h-4 text-white/75" /> {label}</span>
      <ChevronRight className="w-4 h-4 text-white/45" />
    </button>
  );
};

export const MenuView: React.FC = () => {
  const { memories, openSubview, remote } = useAura();
  return (
    <section className="space-y-3.5 animate-in">
      <div className="glass-card rounded-[28px] p-5 space-y-4">
        <div className="flex items-baseline justify-between">
          <div className="font-serif text-[26px] text-white tracking-tight">aura <span className="italic text-white/50">pessoal</span></div>
          <span className={`text-[11px] px-2.5 py-1 rounded-full border ${remote ? 'bg-emerald-400/15 text-emerald-300 border-emerald-400/20' : 'bg-amber-400/15 text-amber-300 border-amber-400/20'}`}>
            {remote ? 'Uso individual' : 'Modo local (demo)'}
          </span>
        </div>
        <button type="button" onClick={() => openSubview('browser')} className="w-full py-3 rounded-2xl btn-light hover:bg-white text-sm font-medium transition">
          Abrir Navegador Universal <span className="font-serif italic">handoff</span>
        </button>
        <button type="button" onClick={() => openSubview('memory')} className="w-full pt-3 border-t border-white/10 flex items-center justify-between text-sm text-white/90 hover:text-white">
          <span>Memória longa ({memories.length} fatos salvos)</span>
          <ChevronRight className="w-4 h-4 text-white/50" />
        </button>
      </div>
      <div className="glass-card rounded-[28px] overflow-hidden divide-y divide-white/10">{GROUP1.map((g) => <Row key={g.id} {...g} />)}</div>
      <div className="glass-card rounded-[28px] overflow-hidden divide-y divide-white/10">{GROUP2.map((g) => <Row key={g.id} {...g} />)}</div>
    </section>
  );
};
