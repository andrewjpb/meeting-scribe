# Plan — desktop-shell

## Decisões técnicas

- Monorepo pnpm com `apps/desktop` (`@meeting-scribe/desktop`): é a estrutura da spec de produto; o backend entra depois em `apps/api`.
- `electron-vite` para compilar main, preload e renderer: um comando para os três alvos e HMR no renderer.
- Electron `45.3.1` exato (Chromium 156): versão provada na fase 0.
- React + TypeScript estrito + Tailwind (só como utilitário, com as variáveis de `design.md`): pilha da spec de produto.
- Estado do renderer com `zustand`; roteamento em memória (`react-router` com `MemoryRouter` ou equivalente): app de janela única, sem URL visível.
- Persistência local em JSON no `userData` com escrita atômica (arquivo temporário + `rename`) e validação com `zod`: até existir backend. O acesso fica atrás de interfaces (`SettingsStore`, `MeetingsStore`, `LlmCatalog`) para trocar pela API sem tocar na interface.
- Origem `scribe://app` por esquema privilegiado em produção e servidor do Vite em desenvolvimento: fecha o teste 11 da fase 0 e é o que a spec de produto pede.
- Captura portada de `prova/renderer/app.js` e `prova/main.js` (já revisados e testados na máquina): mesma chamada, mesmo handler.
- Smoke automatizado que abre cada tela nos dois temas, grava PNG e um `report.json`: é o check visual que o implementador consegue rodar e olhar sozinho.
- Testes com `vitest` nas funções puras; lógica de decisão sempre extraída para função pura testável.
- AssemblyAI direto do app (adendo v1.3): o main guarda a chave com `safeStorage` e emite token temporário; o renderer abre o WebSocket de streaming com o token, porque o áudio já está nele e a chave nunca precisa sair do main.
- Teste de integração com a AssemblyAI real fora dos gates (`test:aai`), porque exige chave e rede; os gates continuam determinísticos, com sessão gravada como fixture.
- Versões das demais dependências: a estável mais recente compatível; registrar no relatório.

## Grafo de tarefas

| # | Microtarefa | Arquivos que toca | Depende de | Wave |
|---|---|---|---|---|
| 01 | Esqueleto, segurança, sistema de design, navegação, smoke e gates | raiz do monorepo, `apps/desktop/**` (criação) | — | 1 |
| 02 | Captura, gravação ao vivo, reuniões locais | `apps/desktop/src/**` (áudio, live, meetings, IPC, preload, rotas) | 01 | 2 |
| 02b | Identidade visual da LAP (troca de tokens, tipografia, marca, ícone) | `apps/desktop/src/renderer/src/design/**`, barra lateral, telas (só visual), `resources/brand/` | 02 | 2b |
| 03 | Configurações, chave da AssemblyAI, modelo de tradução, permissões | `apps/desktop/src/**` (settings, secrets, assemblyai, permissions, IPC, preload, rotas) | 02 | 3 |
| 04 | Transcrição e tradução ao vivo pela AssemblyAI | `apps/desktop/src/**` (assemblyai, transcription, live, meetings, CSP) | 03 | 4 |

Waves sequenciais na árvore normal: 02, 02b, 03 e 04 tocam os mesmos arquivos de IPC, preload e rotas.

## Gates desta feature

`apps/desktop/scripts/gates.sh`, que encadeia e falha no primeiro erro:

1. `pnpm --filter @meeting-scribe/desktop typecheck`
2. `pnpm --filter @meeting-scribe/desktop lint`
3. `pnpm --filter @meeting-scribe/desktop test`
4. `pnpm --filter @meeting-scribe/desktop build`
5. `pnpm --filter @meeting-scribe/desktop smoke`
6. Checagem de cor: nenhum literal de cor (`#rgb`, `rgb(`, `hsl(`) em `apps/desktop/src/renderer/src` fora de `design/tokens.css`.

## Constituição

`docs/specs/meeting-scribe/spec-meeting-scribe-v1.2.md` com o adendo `adendo-v1.3-assemblyai-direto.md` (spec de produto), `docs/fase0.md` (provas), `docs/specs/desktop-shell/design.md` (linguagem visual). Prevalecem sobre qualquer contrato. Nada em `prova/` é alterado. Ninguém commita.
