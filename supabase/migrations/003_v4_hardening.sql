-- Aura OS v4 — endurecimento de segurança + colunas usadas pelas Edge Functions

-- 1. RLS ligado em TODAS as tabelas, sem policies: a chave anon embutida no app NÃO lê nem grava nada
--    direto. Todo acesso passa pelas Edge Functions (service role ignora RLS).
alter table public.memories          enable row level security;
alter table public.projects          enable row level security;
alter table public.project_files     enable row level security;
alter table public.messages          enable row level security;
alter table public.proactive_actions enable row level security;
alter table public.panels            enable row level security;
alter table public.browser_profiles  enable row level security;
alter table public.handoff_sessions  enable row level security;
alter table public.credential_vault  enable row level security;
alter table public.user_files        enable row level security;
alter table public.autonomy_rules    enable row level security;

-- 2. Configurações do app (ex.: texto base do currículo)
create table if not exists public.app_settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;

-- 3. Sessões Handoff: dados da API v4 do Browser Use e da trava de aprovação
alter table public.handoff_sessions
  add column if not exists bu_session_id text,
  add column if not exists phase text not null default 'prepare',        -- prepare | final
  add column if not exists require_approval boolean not null default true,
  add column if not exists credential_id uuid references public.credential_vault(id) on delete set null;

-- 4. Um arquivo por nome em cada projeto
create unique index if not exists project_files_unique_name on public.project_files (project_id, file_name);

-- 5. Índice vetorial: ivfflat com tabela vazia tem recall ruim; HNSW funciona bem desde o primeiro registro
drop index if exists public.memories_embedding_idx;
create index if not exists memories_embedding_hnsw_idx
  on public.memories using hnsw (embedding vector_cosine_ops);
