-- Aura OS v3 — Cofre de Senhas Criptografado (AES-256-GCM), Arquivos (PDF/DOCX/etc.) e Regras de Autonomia

-- 1. Cofre de Senhas e Logins (senhas sempre criptografadas no backend via AES-256-GCM)
create table if not exists public.credential_vault (
  id uuid primary key default gen_random_uuid(),
  site_name text not null,
  domain text not null,
  login_url text not null,
  username text not null,
  encrypted_password text not null,
  iv text not null,
  totp_secret_encrypted text,
  auto_login boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists credential_vault_domain_idx on public.credential_vault (domain);

-- 2. Cofre de Arquivos (PDF, DOCX/.word, imagens, planilhas, etc.) para upload automático no navegador
create table if not exists public.user_files (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_ext text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  category text not null default 'documento', -- curriculo | documento | comprovante | anexo
  storage_path text not null,
  is_default_cv boolean not null default false,
  version int not null default 1,
  notes text,
  updated_at timestamptz not null default now()
);

-- Bucket privado no Supabase Storage para arquivos pessoais
insert into storage.buckets (id, name, public)
values ('aura-files', 'aura-files', false)
on conflict (id) do nothing;

-- 3. Regras de Autonomia do Assistente Pessoal
create table if not exists public.autonomy_rules (
  id uuid primary key default gen_random_uuid(),
  category text unique not null, -- ex.: 'login_sites', 'upload_cv', 'send_message', 'payments'
  mode text not null check (mode in ('auto', 'ask_approval')) default 'ask_approval',
  updated_at timestamptz not null default now()
);

insert into public.autonomy_rules (category, mode) values
  ('login_sites', 'auto'),
  ('save_new_credentials', 'auto'),
  ('tailor_cv', 'auto'),
  ('upload_files_forms', 'ask_approval'),
  ('send_messages_apply', 'ask_approval'),
  ('payments', 'ask_approval')
on conflict (category) do nothing;
