-- Aura OS — agente de navegador próprio (Gemini computer-use sobre CDP)
create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  task text not null,
  target_url text,
  domain text,
  status text not null default 'running',     -- running | done | needs_login | needs_manual | awaiting_approval | takeover | failed | cancelled
  state jsonb not null default '{}'::jsonb,   -- sessão do agente (histórico do modelo SEM imagens, passo atual...)
  steps jsonb not null default '[]'::jsonb,   -- últimas intenções, exibidas no app
  result text,
  error text,
  question text,
  bu_browser_id text,
  cdp_url text,                               -- credencial de controle do navegador: só o servidor lê (RLS sem policies)
  live_url text,
  credential_id uuid references public.credential_vault(id) on delete set null,
  temp_cred text,                             -- login "sem lembrar": criptografado (AES-256-GCM), apagado ao fim
  temp_iv text,
  require_approval boolean not null default true,
  busy_until timestamptz,                     -- trava: um passo por vez
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.agent_runs enable row level security;
create index if not exists agent_runs_status_idx on public.agent_runs (status, updated_at desc);
