# Contrato 102 — Raiz de composição e `dataDir` único
Feature: arquitetura-seguranca · Wave: 7 · Depende de: 100, 90 · Spec/Plan: docs/specs/arquitetura-seguranca/{spec,plan}.md (RASCUNHO, aguardam aprovação)

Microtarefa A10 do plan (R16, R18, T6). Hoje `src/main/index.ts` tem **2.557 linhas** (a spec fala em ~1.500; o
arquivo cresceu): `createAppServices` vai de `:917` a `:1789` (873 linhas), `registerIpc` de `:1899` a `:2337`, a
interface `AppServices` em `:826-891`, os diálogos nativos em `:1792-1898`, e 16 `let` de módulo guardam serviços
(`:145-219`). Este contrato move a montagem para `src/main/composition/`, resolve a pasta de dados num lugar só e
troca toda referência para frente por dependência explícita. **Refatoração pura: nenhum comportamento muda.**

## Pré-condições
- 100 (stores de email, convites e settings no helper) e 90 (IPC com esquema, lotes 2 e 3) commitados; nenhum outro
  contrato tocando `src/main/index.ts` nesta wave (plan: S2, S4, S6, S7 e A10 nunca juntos). Gates verdes antes.
- Ler antes: `src/main/index.ts` inteiro, os contratos 89 e 90 (os esquemas em `src/main/ipc-schemas/`; os handlers continuam em `index.ts`), `src/main/email/service.ts`
  (`:565-575`, `:770`), `src/main/invites/service.ts` (`:60-75`, `:221`, `:232`, `:676`, `:832`).

## Mapa de hoje (ordem de criação em `createAppServices`)
`secrets` → `gateway`, `fileTranscriber`, `mic` → `settings` (+ `readSettings`) → stores de reunião (`meetings`,
`transcripts`, `summaries`, `notes`, `analyses`) → `google`, `microsoft`, `drive` → ACP (`acpAgents`, `openAcp`,
`navegadorMcp`) → `claude` → `mcp` → `whatsapp` → `email` → `macCalendar` → `invites` → `inviteSuggest` →
`whatsappInsights` → `corpus`, `chatStore` → `chat` → `summary`, `analysis`, `aiNotes` → `meetingsService`,
`meetingsIndex`, `files`, `download` → `pluginSave`, `branding`, `updates` → `lock` → `automations` → `calendar` →
`meetingPrompt` → `micWatch` → `meet` → `navegador` → `chatActions`.

Referências para frente (usadas antes de existir) e o destino de cada uma:
| Hoje | Onde é usada antes | Depois |
|---|---|---|
| `mcpRef` (`:1018`, preenchido em `:1086`) | `openAcp.mcp.*` — ciclo real: `openAcp` → `claude` → `mcp.locate` → `claude` | `late<McpService>('mcp')` em `composition/agents.ts`, ligado logo depois do `createMcpService` |
| `lockService` (`:1032`, `:1141-1194`, `:1273`, `:1347`, `:1375-1380`) | `openAcp.locked`, WhatsApp, email, Assistente | o `lock` passa a nascer em `core.ts`, antes de todos (deps: `settings`, store, Touch ID, `onStatus` do shell): some a referência |
| `navegadorServer` (`:1021`, `:1430`) | `navegadorMcp.ponte`, `chat.navegador` | o servidor nasce em `integrations.ts` antes de `agents.ts` (deps: só `onChange` do shell) |
| `calendarService` (`:950`, `:964`) | `google`/`microsoft` `onStatus` → `accountsChanged` | `late<CalendarService>('calendar')` em `integrations.ts` |
| `let invites` (`:1169`) | `email.onInviteReplied` | `late<InviteService>('invites')` em `email.ts` |
| `chatService`, `whatsappService`, `emailService`, `inviteSuggestChannels`, `driveService`, `readSettings`, `meetServer`, `meetingPromptController`, `micWatchService`, `calendarService` | código de janela, bandeja e avisos (`:261-300`, `:486-605`, `:766-780`) | o shell recebe `services` depois de montado (parâmetro, não `let` de módulo) |

## Superfície (caminhos relativos a `apps/desktop/`)
| Arquivo | O que muda |
|---|---|
| `src/main/composition/types.ts` | **novo**: `AppServices` (saída de `index.ts:826-891`, igual), `ShellPorts` (o que a montagem pede ao shell: `broadcast`, `appWindows`, avisos, `applyLockStatus`, `trayRefresh`, diálogos, `openBrowser`) e `CompositionContext` (`dataDir`, `smokeFixtures`, `isPackaged`, `appPath`, `home`, `devLog`) |
| `src/main/composition/data-dir.ts` | **novo**: `resolveDataDir()` — `app.getPath('userData')` (que o smoke já trocou em `prepareSmokeEnvironment`); único `getPath('userData')` do main |
| `src/main/composition/late.ts` | **novo**: `late<T>(name)` → `{ set(value), get() }`; `get` antes do `set` lança `late: <name> sem valor`; `set` duas vezes lança |
| `src/main/composition/core.ts` | **novo**: segredos, gateway, transcrição de arquivo, microfone, settings, bloqueio, marca, atualização, "Salvar plugin" |
| `src/main/composition/meetings.ts` | **novo**: os cinco stores de reunião, `summary`, `analysis`, `aiNotes`, `meetingsService`, `meetingsIndex`, `files`, `download`, `tokenClient`, `translation` |
| `src/main/composition/agents.ts` | **novo**: ACP, `claude`, `mcp`, `navegadorMcp`, `openAcp` |
| `src/main/composition/email.ts` | **novo**: `createEmailStore`, `createInviteStore`, `email`, `macCalendar`, `invites`, `inviteSuggest`, `emailTools`/organizador |
| `src/main/composition/chat.ts` | **novo**: `corpus`, `chatStore`, `chat`, fontes, `chatActions`, `automations` |
| `src/main/composition/integrations.ts` | **novo**: Google, Microsoft, Drive, agendas, WhatsApp (+ insights), Meet, navegador, `micWatch`, `meetingPrompt` |
| `src/main/composition/index.ts` | **novo**: `createAppServices(ctx, shell)`: chama os módulos na ordem, confere que todo `late` foi ligado e devolve `AppServices` |
| `src/main/composition/ipc.ts` | **novo**: `registerIpc(services, shell)` — o corpo de hoje (`index.ts:1899-2337`; o 90 deixa os handlers lá, só troca a leitura do payload) movido sem mudar handler; os esquemas continuam em `src/main/ipc-schemas/` (89) |
| `src/main/shell/{notices,tray,dialogs}.ts` | **novo**: avisos (`:336-555`), instalação da bandeja (`:640-745`) e diálogos nativos (`:1792-1898`), movidos sem mudar |
| `src/main/index.ts` | fica com imports, estado das janelas, `openMainWindow`, menu, `whenReady`, `will-quit` e os `app.on` |
| `src/main/email/service.ts`, `src/main/invites/service.ts` | `store` passa a ser **obrigatório** em `deps`; o `createEmailStore(deps.root)`/`createInviteStore(deps.root, …)` de dentro sai (o `root` do convite fica só para o `.ics` temporário) |
| testes que chamam `createEmailService`/`createInviteService` com `root` | só a troca mecânica para `store: createEmailStore(root)` / `createInviteStore(root)` (CA6) |
| `test/composition.test.ts` | **novo**: CA2, CA3, CA5 |

## Critérios de aceite
- **CA1 — Tamanho.** `wc -l src/main/index.ts` **≤ 700**; nenhum arquivo de `composition/` acima de 450 linhas.
- **CA2 — Sem `let` de serviço.** Nenhum `let` de módulo em `src/main/index.ts` guarda serviço, store ou servidor
  (os 16 da tabela somem; ficam só os de estado de janela: `mainWindow`, `windowLifecycle`, `trayController`,
  `brandName`, `dockLogo`, `quitAfterRecording`, `leaveAsked`, `navegadorAtivo`, `lastLockStatus`,
  `recordingStartedAt`, `trayHiddenNoticeShown`, `loginItemApplied`, `onRecordingFinished`). `mcpRef` não existe.
  *Teste estático* em `composition.test.ts`: lê `index.ts`, procura `^let \w+: (\w+Service|\w+Server|\w+Store|\w+Controller|\w+Channels)`
  e espera zero; `grep -rn "mcpRef" src/main` vazio.
- **CA3 — `late` explícito.** `late('x').get()` antes do `set` lança com o nome; `createAppServices` termina chamando
  `assertBound()` dos `late` que criou (lista fixa: `mcp`, `calendar`, `invites`). *Teste:* unitário do `late.ts`.
- **CA4 — Nenhum serviço resolve caminho.** `grep -rn "getPath(" src/main --include='*.ts'` só em
  `composition/data-dir.ts`, `composition/core.ts` (`home`, `appData`, `downloads` repassados por `ctx`) e no smoke;
  nenhum serviço fora de `composition/` cria o próprio store de email ou convites (`grep -n "createEmailStore\|createInviteStore"
  src/main/email/service.ts src/main/invites/service.ts` vazio).
- **CA5 — Ordem preservada onde importa.** `createAppServices` cria `settings` antes de `lock`, `lock` antes de qualquer
  serviço que leia `locked()`, e nenhum serviço é iniciado (`init`, `start`) dentro de `composition/`: os `init`/`start`
  continuam em `whenReady` na mesma ordem de hoje (`index.ts:2391-2420`: `lock.init` → `registerIpc` → WhatsApp →
  email → Meet → micWatch → navegador → marca → Drive → arquivos → acervo). *Teste:* `composition.test.ts` confere a
  ordem das chamadas no texto de `whenReady` (lista esperada escrita no teste).
- **CA6 — Comportamento idêntico.** O smoke inteiro verde **sem nenhuma linha alterada** em `src/main/smoke.ts` e
  `src/main/smoke-fixtures.ts`; `pnpm test` verde com a única mudança de teste sendo a do CA4 (`root` → `store`),
  listada arquivo por arquivo no relatório.
- **CA7 — Mesmo IPC.** A lista de canais registrados é igual antes e depois (o teste de allowlist do 89 cobre);
  nenhum handler muda de texto (`git diff` dos handlers é só movimento, conferível com `git diff --color-moved`).

## Invariantes
- Nada muda para o usuário: mesmas telas, mesmos canais, mesma ordem de inicialização (N3).
- Nenhum serviço conhece caminho de arquivo além do que recebe (R18): a pasta sai só de `resolveDataDir`.
- `composition/` não registra IPC nem abre janela; o shell (`index.ts`, `shell/*`) não cria store nem serviço.

## Fora de escopo
- Mudar handlers, esquemas de IPC (89/90) ou o formato de qualquer arquivo. Dividir `smoke.ts`. F1–F7 da spec.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde.
- `git diff --stat` só com a Superfície. Sem commit pelo implementador.

## Dúvidas para o coordenador
- **N = 700** só fecha movendo também avisos, bandeja e diálogos para `src/main/shell/` (fora do `composition/*` do
  plan). Sem isso, o mínimo realista é ~1.050 linhas. Confirmar a pasta `shell/` ou subir o N para 1.100.
- **`store` obrigatório** em `createEmailService`/`createInviteService` muda ~20 chamadas em testes (troca mecânica).
  Contradiz "testes sem alteração" só no sentido literal; a alternativa (manter o `root` como plano B) mantém o store
  criado por dentro, contra R16.
- **`registerIpc` inteiro num arquivo** (~440 linhas) fica no limite do CA1; dividir por área (como os esquemas do 89)
  é natural, mas aumenta o diff de movimento. Proposta: um arquivo agora, dividir quando alguém mexer.
