# Contrato 01 — Esqueleto, segurança, sistema de design, navegação, smoke e gates
Feature: desktop-shell  ·  Wave: 1  ·  Depende de: —

## Pré-condições
- Repositório sem código de produto. `prova/` existe e não é tocado.
- Node 22, pnpm 11, macOS 26, Apple Silicon. Sem variáveis de ambiente obrigatórias.
- Direção visual definida em `docs/specs/desktop-shell/design.md`.

## Superfície
- Criar na raiz: `package.json` (privado, scripts que delegam), `pnpm-workspace.yaml` (`apps/*`). Ajustar `.gitignore` (`out/`, `dist/`, `node_modules/`).
- Criar `apps/desktop/`: `package.json` (`@meeting-scribe/desktop`), `electron.vite.config.ts`, `tsconfig*.json`, configuração de lint, `scripts/gates.sh`.
- `apps/desktop/src/main/`: `index.ts`, `window.ts`, `protocol.ts` (esquema `scribe`), `security.ts` (funções puras de decisão + ligação na sessão), `smoke.ts`.
- `apps/desktop/src/preload/index.ts` (expõe `window.__scribeApi`).
- `apps/desktop/src/shared/` (nomes de canal IPC e tipos).
- `apps/desktop/src/renderer/`: `index.html`, `src/main.tsx`, `src/design/tokens.css`, `src/design/` (componentes base), `src/app/` (shell, barra lateral, rotas), telas `Reuniões` (estado vazio), `Gravação` e `Configurações`.

## Critérios de aceite
- CA1: Dado o repositório limpo, quando rodo `pnpm install` na raiz e `apps/desktop/scripts/gates.sh`, então o script termina com código 0.
- CA2: Dado `apps/desktop/package.json`, então `electron` está em `45.3.1` exato, sem `^` nem `~`.
- CA3: Dado o app em smoke, então `out/smoke/report.json` traz `webPreferences` com `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, lidos de `webContents.getLastWebPreferences()`.
- CA4: Dado o build de produção, quando o smoke carrega a janela, então `report.json` traz `origin: "scribe://app"`, `opfs: true` (um arquivo foi escrito e lido por `navigator.storage.getDirectory()`) e `workletAddModule: true` (um `AudioWorkletProcessor` mínimo carregou por URL da própria origem).
- CA5: Dado o smoke, então `report.json` traz `consoleErrors: []`, `cspViolations: []` e `externalRequests: []` (nenhuma requisição a host fora da própria origem; fontes embutidas).
- CA6: Dada `security.ts`, quando chamo `decidePermission({permission, origin, mediaTypes}, appOrigin)`, então devolve `true` só para `media` com apenas `audio` e para `display-capture`, ambos com `origin === appOrigin`; qualquer outra combinação devolve `false`. Coberto por teste unitário com pelo menos 6 casos.
- CA7: Dada a janela, quando a página tenta navegar para outra origem ou abrir janela nova, então a navegação é bloqueada (`will-navigate` com `preventDefault`, `setWindowOpenHandler` devolvendo `deny`). Coberto por teste unitário da função de decisão.
- CA8: Dado o smoke, então existem 6 PNGs em `apps/desktop/out/smoke/` (`reunioes`, `gravacao`, `configuracoes` × `light`, `dark`), cada um com pelo menos 1120×740 px lógicos e `distinctColors > 50` no `report.json`.
- CA9: Dado `tokens.css`, então define todas as variáveis da tabela de `design.md` nos dois temas, e um teste unitário calcula o contraste WCAG de cada par exigido em `design.md` e passa.
- CA10: Dada a barra lateral, quando clico em "Reuniões" ou "Configurações" (ou uso Tab e Enter), então a rota muda e o item ativo recebe `aria-current="page"`. O menu do app tem "Configurações…" com `⌘,` que abre a rota de configurações.
- CA11: Dada a configuração de tema `system`, quando o macOS troca entre claro e escuro, então `<html data-theme>` troca sem recarregar. Em smoke o tema é forçado por parâmetro.
- CA12: Dada a tela Reuniões sem dados, então mostra o estado vazio de `design.md` (ilustração em SVG, título "Nenhuma reunião ainda", botão "Nova gravação" com a dica `⌘N`). O botão leva à rota de gravação.
- CA13: Dadas as rotas de gravação e de configurações nesta tarefa, então mostram o cabeçalho da tela e um estado vazio honesto no padrão visual, sem controle que não funcione.
- CA14: Dado `prefers-reduced-motion: reduce`, então nenhuma animação CSS roda (regra global em `tokens.css` ou equivalente).
- CA15: O implementador abriu os 6 PNGs, comparou com `design.md` e listou no relatório os defeitos visuais que encontrou e corrigiu.

## Invariantes
- Nada em `prova/` nem em `docs/` muda.
- Nenhuma chamada de rede em tempo de execução nesta tarefa.
- O smoke usa um `userData` temporário e nunca o diretório real do usuário.

## Fora de escopo desta tarefa
- Captura de áudio, cronômetro, fita, lista real de reuniões, persistência, catálogo de modelos, controles de configuração.

## Gates
- `apps/desktop/scripts/gates.sh` com os 6 passos de `plan.md`.
- Testes novos: decisão de permissão, decisão de navegação, contraste dos tokens, resolução de tema.
