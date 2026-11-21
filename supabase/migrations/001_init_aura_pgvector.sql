-- Aura OS — Esquema completo Supabase + pgvector
create extension if not exists vector;

-- 1. Memória Longa com busca semântica (Gemini text-embedding-004 = 768 dims)
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  tag text not null default 'Geral',
  content text not null,
  embedding vector(768),
  created_at timestamptz not null default now()
);

create index if not exists memories_embedding_idx
  on public.memories using ivfflat (embedding vector_cosine_ops) with (lists = 50);

create or replace function public.match_memories(
  query_embedding vector(768),
  match_threshold float default 0.65,
  match_count int default 8
)
returns table (id uuid, tag text, content text, similarity float)
language sql stable as $$
  select m.id, m.tag, m.content, 1 - (m.embedding <=> query_embedding) as similarity
  from public.memories m
  where 1 - (m.embedding <=> query_embedding) > match_threshold
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

-- 2. Projects e Arquivos
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'Ativo',
  created_at timestamptz not null default now()
);

create table if not exists public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

-- 3. Chat Contínuo (project_id null = chat principal "Hoje")
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 4. Action Buttons Proativos (Gmail, Agenda, LinkedIn)
create table if not exists public.proactive_actions (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  summary text not null,
  detail text,
  primary_label text not null,
  action_type text not null,
  payload jsonb default '{}'::jsonb,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

-- 5. Panels (Micro-apps gerados por prompt)
create table if not exists public.panels (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  panel_type text not null,
  state_json jsonb not null default '{}'::jsonb,
  html_bundle text,
  updated_at timestamptz not null default now()
);

-- 6. Perfis Persistentes do Navegador na Nuvem (LinkedIn, etc.)
create table if not exists public.browser_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null,
  provider text not null default 'browser-use',
  external_profile_id text not null,
  proxy_region text not null default 'BR',
  last_synced_at timestamptz default now()
);

-- 7. Sessões Handoff (com trava de aprovação)
create table if not exists public.handoff_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.browser_profiles(id),
  task_prompt text not null,
  target_url text,
  external_session_id text,
  live_url text,
  status text not null default 'running',
  created_at timestamptz not null default now()
);
