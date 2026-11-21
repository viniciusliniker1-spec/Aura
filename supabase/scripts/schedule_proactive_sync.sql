-- Rode UMA vez no SQL Editor do Supabase (depois do `supabase db push`).
-- Agenda a sincronização proativa (Gmail + Agenda) a cada 30 minutos.
-- Substitua SEU_PROJECT_REF e SUA_SERVICE_ROLE_KEY (Settings > API). A chave fica no Vault, não no cron.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('SUA_SERVICE_ROLE_KEY', 'aura_service_role_key')
where not exists (select 1 from vault.secrets where name = 'aura_service_role_key');

select cron.unschedule('aura-proactive-sync')
where exists (select 1 from cron.job where jobname = 'aura-proactive-sync');

select cron.schedule(
  'aura-proactive-sync',
  '*/30 * * * *',
  $$
  select net.http_post(
    url     := 'https://SEU_PROJECT_REF.supabase.co/functions/v1/proactive-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'aura_service_role_key')
    ),
    body    := jsonb_build_object('action', 'sync')
  );
  $$
);
