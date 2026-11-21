import React, { useState } from 'react';
import { Eye, EyeOff, ShieldCheck, Hand } from 'lucide-react';

interface Props {
  domain: string;
  onSubmit: (c: { username: string; password: string; remember: boolean; domain: string }) => Promise<boolean>;
  /** Para 2FA/CAPTCHA ou quem prefere entrar sozinho: assume o navegador. */
  onManual?: () => void;
}

/** O "cofre no chat": você informa o login e o servidor digita no site sem a IA ver a senha. */
export const LoginForm: React.FC<Props> = ({ domain, onSubmit, onManual }) => {
  const [d, setD] = useState(domain);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const field = 'w-full glass-tile rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none';

  return (
    <form
      className="space-y-2.5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!username.trim() || !password || busy) return;
        setBusy(true);
        const ok = await onSubmit({ username: username.trim(), password, remember, domain: d.trim() || domain });
        setBusy(false);
        if (ok) setPassword('');
      }}
    >
      <div className="flex items-baseline justify-between">
        <h4 className="font-serif text-xl text-white">cofre</h4>
        <span className="text-[11px] text-emerald-300 inline-flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> AES-256-GCM</span>
      </div>
      <p className="text-xs text-white/75">
        <span className="text-white font-medium">{domain}</span> pede login. Informe abaixo e eu entro por você. A senha é criptografada e <strong className="font-medium">nunca passa pela IA</strong>.
      </p>
      <input className={field} value={d} onChange={(e) => setD(e.target.value)} placeholder="Site" aria-label="Site" />
      <input className={field} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="E-mail ou usuário" autoComplete="off" aria-label="Usuário" />
      <div className="relative">
        <input className={`${field} pr-11`} type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Senha" autoComplete="new-password" aria-label="Senha" />
        <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-white/60">
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      <label className="flex items-center gap-2 text-xs text-white/80">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-white" />
        Lembrar no Cofre para as próximas vezes
      </label>
      <button type="submit" disabled={busy || !username.trim() || !password} className="w-full py-3 rounded-full btn-light text-sm font-medium disabled:opacity-40">
        {busy ? 'Enviando…' : 'Entrar e continuar'}
      </button>
      {onManual && (
        <button type="button" onClick={onManual} className="w-full text-[11px] text-white/60 underline underline-offset-2 inline-flex items-center justify-center gap-1">
          <Hand className="w-3 h-3" /> Prefiro entrar eu mesmo no navegador
        </button>
      )}
    </form>
  );
};
