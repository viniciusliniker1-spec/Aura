# Aura OS v4 — Guia de UI/UX (Design System para o Claude)

Use exatamente esta linguagem visual ao condensar e compilar o app React + Capacitor:

- **Fundo atmosférico (`.aura-backdrop`)**: gradiente nebuloso azul-ardósia/cinza (`#5c7093` -> `#6d80a3` -> `#7a88a6` -> névoa quente na base), sem fundo preto chapado.
- **Cartões frosted glass (`.glass-card`)**: `rgba(34, 38, 48, 0.78)`, `backdrop-filter: blur(26px)`, `border: 1px solid rgba(255,255,255,0.08)`, cantos amplos `rounded-[28px]`.
- **Tipografia editorial**: `Newsreader` (serif) para títulos e marca (`aura pessoal`, `aura pode fazer mais`, `projetos,`) + `Inter` (sans) para corpo, botões e cartões.
- **Navegação superior flutuante (sem barra inferior pesada)**: botão circular `+`/`🔍` à esquerda, pílula segmentada central `Início | Chat | Projetos` (aba ativa em branco `#F2F3F5` com texto escuro `#181A20`) e avatar circular azul (`a`) à direita abrindo o menu agrupado (Navegador Universal, Cofre AES-256, Arquivos/Currículo PDF/Word, Painéis, Memória e Autonomia).
- **Composer flutuante em pílula**: na base de `Início` e `Chat`, com `Enviar mensagem para o Aura`, botão `+` (ações rápidas/anexos) e microfone `🎤` (Voz Live).
- **Cartões de link/Handoff no chat**: estilo obsidiana (`rgba(14,16,20,0.94)`, `rounded-[22px]`) com ícone de globo, título e domínio clicável abrindo a Live View do Navegador Universal.
