# Aura OS v4 — Guia de Build (Capacitor, sem Expo Go)

React + Tailwind + Capacitor 6 (Android/iOS) + Supabase (pgvector, Storage, Edge Functions).

## Funcionalidades (nenhuma removida)
1. Chat contínuo + memória longa (pgvector, embedding 768d) — `aura-chat` + `aura-data`
2. Action Buttons proativos (Gmail, Agenda, LinkedIn) — `proactive-sync` + cron (`supabase/scripts/schedule_proactive_sync.sql`)
3. Projects (threads dedicadas, arquivos vinculados, criação) — `aura-data`
4. Panels persistidos na tabela `panels` (Rotina & Água, Gastos, Pomodoro, gerador por prompt)
5. Navegador Universal — `handoff-browser` (Browser Use Cloud API **v4**: `POST /runs`, `secretBindings`, Live View via eventos, trava de aprovação por run de follow-up)
6. Cofre AES-256-GCM — `vault-credentials` (a senha nunca volta ao app; só `handoff-browser` decifra)
7. Cofre de Arquivos + currículo com IA (gera PDF/DOCX reais) — `file-manager` + bucket `aura-files`
8. Regras de autonomia — tabela `autonomy_rules`
9. Voz Live — `src/hooks/useVoiceLive.ts` (Gemini Live via token efêmero → fallback Web Speech API)

## Segurança
- Migration 003 liga RLS em todas as tabelas sem policies: a chave anon não acessa nada direto.
- `AURA_ACCESS_TOKEN` (secret) + `VITE_AURA_ACCESS_TOKEN` (front) = trava extra nas 6 funções. Ele vai embutido no app: dissuade uso casual, não substitui Supabase Auth se o app for distribuído.
- Sem Supabase configurado o app roda em modo local (demo); senhas ficam só em memória.

## Estrutura
- `src/state/AuraContext.tsx` — estado central (remoto + fallback local)
- `src/lib/api.ts` — cliente das Edge Functions · `src/lib/local.ts` — fallback local
- `src/views/*`, `src/components/Shell.tsx` — UI do design v4 (`DESIGN_SYSTEM_UI.md`, `ui-reference-v4.html`)
- `supabase/functions/{aura-chat,aura-data,proactive-sync,handoff-browser,vault-credentials,file-manager}` + `_shared`
- `scripts/patch-native.mjs` — permissões de microfone (Android/iOS)
