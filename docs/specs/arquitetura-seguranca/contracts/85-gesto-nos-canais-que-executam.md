# Contrato 85 — Gesto nos canais que executam programa
Feature: arquitetura-seguranca · Wave: 1 · Depende de: — · Spec/Plan: docs/specs/arquitetura-seguranca/{spec,plan}.md (RASCUNHO, aguardam aprovação)

Microtarefa S2 do plan (R2, decisão T2). Dois canais rodam um programa escolhido pelo renderer sem exigir clique:
`scribe:claude-path-set` (`src/main/index.ts:2023` → `claude.setPath`, que executa `<caminho> --version`) e
`scribe:mcp-test` com `draft` (`index.ts:2085` → `mcp.test`, que sobe o `command` do rascunho). Um renderer
comprometido (por exemplo, por um email) chama os dois com `window.__scribeApi.invoke` e executa o que quiser.
Este contrato aplica a esses canais o mecanismo dos 6 métodos de envio do preload (`src/preload/index.ts:36-90`):
ativação do usuário viva no frame + token de clique de uso único conferido no main.

## Pré-condições
- Main em dia, gates verdes. Este contrato e o 87 mexem em `src/main/index.ts`: o 87 só começa depois do commit deste.
- Ler antes: `src/preload/index.ts` (inteiro), `src/main/email/service.ts:142-180` (`createEmailClickGuard`),
  `src/main/claude-cli/service.ts:64-105` e `locate.ts:55-80`, `src/main/mcp/service.ts:150-180, 476-500`,
  `src/shared/ipc.ts` (`scribe:claude-path-set` 141, `scribe:mcp-test` 254, `WHEN_LOCKED`, `PRELOAD_ONLY_EVENTS` 1188),
  `src/renderer/src/features/settings/{claudeStore.ts,ClaudeCliField.tsx,ConnectionsSection.tsx}` e os passos
  `settings['claudeCli']` (`smoke.ts:3731`) e `mcp['addForm']` (`smoke.ts:7155`).

## Superfície (caminhos relativos a `apps/desktop/`)
| Arquivo | O que muda |
|---|---|
| `src/shared/ipc.ts` | `clickToken` nos pedidos; canal novo `scribe:claude-path-pick`; evento `scribe:exec-click` em `PRELOAD_ONLY_EVENTS`; métodos novos em `ScribeApi`; `WHEN_LOCKED` do canal novo `'refused'` (CA1, CA4) |
| `src/shared/claude-cli.ts` | `refused?: 'click' \| 'file'` na resposta do `claude-path-set`/`-pick` (CA2) |
| `src/shared/mcp.ts` | `MCP_TEST_CLICK_ERROR` (CA5) |
| `src/preload/index.ts` | `claudePathSet`, `claudePathPick`, `mcpTestDraft`, no molde do `emailSend` (CA1) |
| `src/main/claude-cli/locate.ts` | `checkUserExecutable(path)` (CA3) |
| `src/main/claude-cli/service.ts` | `setPath` confere o arquivo antes de executar (CA3) |
| `src/main/index.ts` | guarda próprio (`execGuard`), os três handlers conferem o token antes do serviço; diálogo do `-pick` (CA2, CA4, CA5) |
| `src/main/smoke-fixtures.ts` | `chosenClaudePath: string \| null` (o diálogo nativo nunca abre no smoke) (CA6) |
| `src/renderer/src/features/settings/claudeStore.ts`, `ClaudeCliField.tsx` | `choose` usa `claudePathSet`; botão "Escolher…" chama `claudePathPick` (CA2) |
| `src/renderer/src/features/settings/ConnectionsSection.tsx` | "Testar" do formulário usa `mcpTestDraft` (CA5) |
| `src/main/smoke.ts` | `settings['claudeCli']` estendido; passo novo `mcp['execGesture']` (CA6) |
| `test/claude-cli.test.ts`, `test/mcp.test.ts` | casos novos (CA7) |

## Critérios de aceite
**Token**
- **CA1 — Preload.** `claudePathSet(path)`, `claudePathPick()` e `mcpTestDraft(draft)` devolvem a recusa sem falar com
  o main quando `navigator.userActivation.isActive` é falso; com ativação, geram `crypto.randomUUID()`, mandam
  `scribe:exec-click` com ele e chamam o canal com `clickToken`. `scribe:exec-click` está em `PRELOAD_ONLY_EVENTS`:
  `__scribeApi.send('scribe:exec-click', …)` lança `Canal não permitido`.
- **CA2 — `scribe:claude-path-set` e `scribe:claude-path-pick`.** Pedidos `{ path: string | null; clickToken }` e
  `{ clickToken }`. O handler gasta o token no `execGuard` (instância nova de `createEmailClickGuard`: 10 s, uso único,
  mesma janela, tentativa recusada também gasta) **antes** de qualquer outra coisa. Sem token válido: responde
  `{ result: { ok: false, error: 'not-found' }, settings: <atuais>, refused: 'click' }`, não chama `locateClaude`,
  não grava `settings.json`. O `-pick` abre `dialog.showOpenDialog(mainWindow, { properties: ['openFile'], title:
  'Escolher o programa claude', defaultPath: '~/.local/bin' expandido })`; cancelado → `{ canceled: true }`; escolhido →
  o mesmo caminho do `setPath` (CA3). Na tela, `[data-action="pick-claude-path"]` ("Escolher…") ao lado de `#claude-path`.
- **CA3 — Caminho digitado só se for executável do usuário.** `checkUserExecutable(path)`: caminho absoluto;
  `realpath` resolvido; `stat` de arquivo regular (não pasta, não FIFO, não dispositivo); `access(X_OK)`;
  `stat.uid === process.getuid()`. Falhou qualquer um: `{ ok: false }` e o `setPath` devolve `refused: 'file'` sem
  executar nada. Vale também para o caminho que veio do diálogo. `path: null` (voltar a procurar sozinho) não passa
  pelo `checkUserExecutable`, mas passa pelo token.
- **CA4 — Bloqueio.** `WHEN_LOCKED['scribe:claude-path-pick'] === 'refused'`, como os outros dois.
- **CA5 — `scribe:mcp-test` com `draft`.** Pedido `{ draft, clickToken }`. Sem token válido: `{ ok: false, error:
  MCP_TEST_CLICK_ERROR }` (`'Clique em "Testar" para testar este servidor.'`), nada é executado, nenhuma conexão HTTP
  sai e o rascunho **não** entra na lista `tested` (o `scribe:mcp-save` dele continua recusado por "testar antes").
  `{ key }` (servidor já salvo, `ConnectionsSection.tsx:189`) não muda.

**Smoke e testes**
- **CA6 — Smoke.** Em `settings['claudeCli']` (`claudeChecks`), além do que já confere: (a) `evaluate` com
  `__scribeApi.invoke('scribe:claude-path-set', { path: <fake claude>, clickToken: crypto.randomUUID() })` → `refused:
  'click'`, `claudePath` do `settings.json` igual ao de antes e `fixtures.claudeSpawns.length` sem mudança; (b) o mesmo
  sem `clickToken` → idem; (c) o `/tmp/nao-existe/claude` digitado e "Usar" continua dando
  `[data-claude-path-rejected]`; (d) `fixtures.chosenClaudePath = null` + clique em "Escolher…" → nada muda;
  `chosenClaudePath = <arquivo 0644 do smoke>` → recusado. Passo novo **`mcp['execGesture']`** em `mcpChecks`:
  `invoke('scribe:mcp-test', { draft: <o do addForm com nome novo, 'calc-forjado'>, clickToken: crypto.randomUUID() })`
  → `error === MCP_TEST_CLICK_ERROR`; em seguida `invoke('scribe:mcp-save', <o mesmo draft>)` → `ok: false` com
  "Teste a conexão antes de salvar." (nome novo porque o `addForm` já pôs o dele em `tested`); o `mcp['addForm']`
  (pelo botão, com clique) continua verde.
- **CA7 — vitest.** `test/claude-cli.test.ts`: `checkUserExecutable` aceita um arquivo 0755 do usuário num tmp e um
  link para ele; recusa 0644, pasta, caminho relativo, inexistente e `/bin/sh` se o dono não for o usuário (pular o
  caso de dono com `it.skipIf(process.getuid() === 0)`); `setPath` com arquivo recusado não chama o `exec` falso.
  `test/mcp.test.ts`: o rascunho recusado por clique não entra em `tested` (o `save` seguinte falha).

## Invariantes
- Os 6 métodos de envio do preload, `whatsapp/send-guard.ts` e `createEmailClickGuard` sem diff de comportamento; o
  `execGuard` é instância própria (token do email não executa programa, e vice-versa).
- `scribe:claude-locate` e o `start` do Claude seguem iguais (lista fixa de `locate.ts:55` + caminho já gravado).
- `handle` e `onEvent` de `src/main/ipc.ts` sem diff (o token é conferido no handler, T2).
- Mensagens de log não levam o caminho digitado nem o token.

## Fora de escopo
- Validação zod central do IPC (R3, contratos 89 e 90).
- Outros canais que sobem o Claude com prompt do app (`scribe:agents-test`, `scribe:tasks-run-now`, `scribe:runs-rerun`,
  `scribe:automations-ask`): não escolhem o executável; ficam como estão.
- `{ key }` de servidor `cli:` (definição vinda do `~/.claude.json`, fora do app). F1–F7.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde.
- Casos novos em `test/claude-cli.test.ts` e `test/mcp.test.ts`; `settings['claudeCli']` estendido e `mcp['execGesture']`.
- `git diff --stat` só com a Superfície. Sem commit.

## Dúvidas para o coordenador
1. **Dono do arquivo.** A spec diz "do próprio usuário". `claude` instalado com `sudo npm -g` em `/usr/local/bin` é do
   `root` e passa a ser recusado (o automático, sem caminho, continua achando). Aceitar `uid 0` também?
2. **Botão "Escolher…"** é mudança de tela (Configurações › Claude). Pela regra do checklist, mostrar desenho antes;
   é um botão secundário ao lado do campo, no padrão de "Escolher pasta…". Dispensar o mockup?
