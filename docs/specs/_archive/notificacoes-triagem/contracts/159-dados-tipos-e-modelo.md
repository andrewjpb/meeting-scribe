# Contrato 159 — Triagem do WhatsApp: tipos, store, gatilho, modelo pronto e interruptor

Feature: notificacoes-triagem  ·  Wave: 1  ·  Depende de: —

Constituição: `~/CLAUDE.md` e `docs/specs/desktop-shell/design.md`. Prevalecem sobre este contrato.

## Pré-condições
- Base `6afc661` (0.23.1), branch `main`, árvore limpa. `pnpm --filter desktop typecheck && pnpm --filter desktop lint && pnpm --filter desktop test` verdes antes de começar.
- Nenhuma tela muda neste contrato. Nenhum canal IPC novo neste contrato (ficam no 161). Nada aqui chama modelo.
- Não tocar `apps/desktop/src/main/email/*`, `features/email/*`, `main/index.ts`, `shared/ipc.ts`, `preload/`.

## Contexto mínimo
Feature nova: um agente das Automações ("Triagem do WhatsApp") etiqueta cada conversa que recebe mensagem (urgente? pessoal ou profissional?). A etiqueta é local, reversível e a escolha do usuário prevalece. Este contrato cria a camada de dados e as regras puras; o motor (chamada ao modelo, debounce, IPC) vem no 161.

Padrões a seguir, sem inventar outro: store JSON como `apps/desktop/src/main/whatsapp/atendimento/store.ts` (fila serial, cache, `tmp` + `rename`, 0o600, ENOENT = vazio, inválido → `.corrupt-<stamp>`, zod em `shared/*-schema.ts`); tipos em `shared/`; funções puras testáveis sem Electron.

## Superfície
- Criar `apps/desktop/src/shared/triagem.ts` (tipos, constantes, funções puras) e `apps/desktop/src/shared/triagem-schema.ts` (zod).
- Criar `apps/desktop/src/main/whatsapp/triagem/store.ts`.
- Alterar `apps/desktop/src/main/whatsapp/install.ts`: `WHATSAPP_PATHS.triagem = 'triagem.json'` (comentário "Contrato 159: as etiquetas da triagem: saem junto com as mensagens").
- Alterar `apps/desktop/src/shared/automations.ts` (+ `automations-schema.ts` se o zod da `Schedule` estiver lá, senão onde estiver): variante de `Schedule`, `SCHEDULE_KINDS`, `RUN_TRIGGERS`, `EXAMPLE_AGENTS`, exports `TRIAGEM_*`.
- Alterar `apps/desktop/src/main/meetings/claude-one-shot.ts`: `purpose` ganha `'whatsapp-triagem'`.
- Alterar `apps/desktop/src/shared/funil-logic.ts`: receber `contatoLigado` e `ContatoAlvo` (hoje em `renderer/src/features/funil/ContactLink.tsx:23`); `ContactLink.tsx` passa a importar de lá (sem mudança de comportamento).
- Alterar settings: `apps/desktop/src/shared/settings-defaults.ts` (interface + padrão `whatsappTriagem: true`), `apps/desktop/src/main/settings/schema.ts` (lenient `.catch(D.whatsappTriagem)` e patch estrito), `apps/desktop/src/shared/settings-index.ts` (entrada "Triagem do WhatsApp por agente", seção Claude › Chat e resumo, descrição da spec R24a).
- Todo `switch` exaustivo ou mapa `Record<ScheduleKind|RunTrigger, …>` que o typecheck apontar ganha o ramo novo com **comportamento neutro** (ver CA6). Lista esperada (confirmar pelo typecheck): `renderer/src/features/schedules/frequency.ts`, `renderer/src/features/schedules/TaskForm.tsx` (só o que o tipo exigir; sem campo novo de UI, que é do 162), `main/schedules/service.ts` (`nextRun`/`due` ignoram a variante), `main/schedules/runner.ts`, `renderer/src/features/schedules/RunsTab.tsx` (rótulo do gatilho), `main/smoke.ts` se houver mapa.
- Criar `apps/desktop/test/triagem-logic.test.ts` e `apps/desktop/test/triagem-store.test.ts`; estender `apps/desktop/test/automations-schedule.test.ts` (parse da variante nova) e o teste de settings existente (padrão e `.catch`).

### Tipos (em `shared/triagem.ts`)
```ts
export type TriagemAmbito = 'pessoal' | 'profissional'
export interface Etiqueta {
  urgente: boolean
  ambito: TriagemAmbito | null
  /** Âmbito escolhido à mão: o agente não altera. "Nenhum" à mão limpa o âmbito e este flag. */
  ambitoFixo: boolean
  /** Urgente marcado ou desmarcado à mão depois da última mensagem recebida: o agente não altera até chegar mensagem nova. */
  urgenteFixo: boolean
  origem: 'agente' | 'manual'
  /** id da última mensagem recebida (não `fromMe`) considerada; `null` quando só houve ação manual. */
  lastMessageId: string | null
  motivo: string | null   // ≤ TRIAGEM_MOTIVO_MAX, só vem do agente
  at: number              // ms
}
export type EtiquetaPatch = { urgente?: boolean; ambito?: TriagemAmbito | null }
export interface TriagemResultado { urgente: boolean; ambito: TriagemAmbito | 'indefinido'; motivo: string }
export type TriagemAba = 'todas' | 'nao-lidas' | 'urgentes' | 'pessoal' | 'profissional'
export const TRIAGEM_ABAS: readonly TriagemAba[]
export interface TriagemFile { version: 1; etiquetas: Record<string, Etiqueta> }   // chave = chatId
```
Constantes exportadas: `TRIAGEM_AGENT_NAME = 'Triagem do WhatsApp'`, `TRIAGEM_MENSAGENS_MAX = 12`, `TRIAGEM_CHARS_MAX = 4000`, `TRIAGEM_TIMEOUT_MS = 30_000`, `TRIAGEM_TETO_DIARIO = 300`, `TRIAGEM_MAX_AGE_MS = 5 * 60_000`, `TRIAGEM_SIMULTANEAS = 2`, `TRIAGEM_MOTIVO_MAX = 160`, `TRIAGEM_ESPERA_SEG = { min: 5, max: 600, padrao: 30 }`, `TRIAGEM_ETIQUETAS_MAX = 2000`.

Funções puras (todas sem efeito colateral, retornam objeto novo):
- `etiquetaVazia(now): Etiqueta` → `{urgente:false, ambito:null, ambitoFixo:false, urgenteFixo:false, origem:'manual', lastMessageId:null, motivo:null, at:now}`.
- `aplicarManual(atual: Etiqueta | null, patch: EtiquetaPatch, now): Etiqueta` → `urgente` do patch define `urgenteFixo: true`; `ambito` do patch define `ambitoFixo: ambito !== null`; `origem:'manual'`, `motivo` mantido, `at: now`.
- `aplicarAgente(atual: Etiqueta | null, r: TriagemResultado, lastMessageId: string, now): Etiqueta` → `urgente = atual?.urgenteFixo ? atual.urgente : r.urgente`; `ambito = atual?.ambitoFixo ? atual.ambito : (r.ambito === 'indefinido' ? null : r.ambito)`; `origem:'agente'`, `motivo: r.motivo.slice(0, TRIAGEM_MOTIVO_MAX)`, `lastMessageId`, `at: now`, flags `*Fixo` mantidos.
- `mensagemRecebida(atual: Etiqueta | null): Etiqueta | null` → se `atual` existe, devolve cópia com `urgenteFixo: false` (a próxima mensagem libera o agente a reavaliar urgência); `null` continua `null`.
- `respostaDoDono(atual: Etiqueta | null, now): Etiqueta | null` → `urgente: false, urgenteFixo: false, at: now`; `null` continua `null`.
- `precisaTriar(atual: Etiqueta | null, messageId: string): boolean` → `atual?.lastMessageId !== messageId`.
- `naAba(chat: { unread: number }, etiqueta: Etiqueta | null, aba: TriagemAba): boolean` → `todas` sempre; `nao-lidas` = `unread > 0`; `urgentes` = `etiqueta?.urgente === true`; `pessoal`/`profissional` = `etiqueta?.ambito === aba`.
- `contagensAbas(chats, etiquetas: Record<string, Etiqueta>): { naoLidas: number; urgentes: number }`.
- `chipsDe(etiqueta: Etiqueta | null): string[]` → `['Urgente']` primeiro quando `urgente`, depois `'Pessoal'`/`'Profissional'` quando houver âmbito; máximo 2.
- `podarEtiquetas(etiquetas, max = TRIAGEM_ETIQUETAS_MAX)` → mantém as `max` mais recentes por `at`.

### Store (`main/whatsapp/triagem/store.ts`)
`createTriagemStore({ dir, devLog? })` com `dir = join(userData, 'whatsapp')`, arquivo `WHATSAPP_PATHS.triagem`:
`list(): Promise<Record<string, Etiqueta>>`, `get(chatId)`, `set(chatId, etiqueta)` (aplica `podarEtiquetas` antes de gravar), `remove(chatId)`, `clear()`. Sem Electron.

### Automações (`shared/automations.ts`)
- `Schedule` ganha `| { kind: 'whatsapp-message'; esperaSeg: number; grupos: boolean }`; `SCHEDULE_KINDS` ganha `'whatsapp-message'`; zod: `esperaSeg` inteiro em `[5, 600]`, `grupos` boolean.
- `RUN_TRIGGERS` ganha `'whatsapp'`. **Não** entra em `AUTOMATIC_TRIGGERS` (não conta no limite diário de 50).
- `export const TRIAGEM_TEMPLATE: Omit<AgentInput, 'id'>` com `name: TRIAGEM_AGENT_NAME`, `description: 'Classifica cada conversa que recebe mensagem: urgente ou não; pessoal ou profissional.'`, `model: 'haiku'`, `thinkMore: false`, `web: false`, `funil: true`, `tarefas: false`, `mcpServers: []`, `output: { kind: 'notification' }` (ou o `kind` mais neutro que o tipo tiver), ícone/cor válidos no `AgentForm`, e `instructions` = o texto da tabela "O agente de triagem" do `prd.md` (copiar literalmente). `EXAMPLE_AGENTS` passa a incluir `TRIAGEM_TEMPLATE` (último).
- `export const TRIAGEM_SCHEDULE_DEFAULTS: Schedule = { kind: 'whatsapp-message', esperaSeg: 30, grupos: false }`.

## Critérios de aceite
- CA1: Dado `aplicarManual(null, { ambito: 'pessoal' }, 10)`, então o resultado tem `ambito:'pessoal', ambitoFixo:true, urgente:false, urgenteFixo:false, origem:'manual', at:10`; dado em seguida `aplicarManual(x, { ambito: null }, 11)`, então `ambito:null, ambitoFixo:false`.
- CA2: Dado `e = aplicarManual(null, { ambito: 'pessoal' }, 1)` e `aplicarAgente(e, { urgente: true, ambito: 'profissional', motivo: 'm' }, 'msg-9', 2)`, então `urgente:true`, `ambito:'pessoal'` (fixo respeitado), `origem:'agente'`, `lastMessageId:'msg-9'`, `motivo:'m'`.
- CA3: Dado `e = aplicarManual(null, { urgente: false }, 1)` (urgenteFixo true), então `aplicarAgente(e, {urgente:true,…}, 'm1', 2).urgente === false`; e `aplicarAgente(mensagemRecebida(e), {urgente:true,…}, 'm2', 3).urgente === true`.
- CA4: `respostaDoDono(e, 5)` zera `urgente` e `urgenteFixo` e mantém `ambito`/`ambitoFixo`; `respostaDoDono(null, 5) === null`. `precisaTriar(null,'a') === true`; `precisaTriar({…lastMessageId:'a'},'a') === false`.
- CA5: `naAba` e `contagensAbas` conforme definidos (teste com 4 chats: um `unread:2` urgente profissional, um `unread:0` pessoal, um sem etiqueta `unread:1`, um `unread:0` sem etiqueta → `naoLidas:2`, `urgentes:1`; `urgentes` lista 1; `profissional` lista 1; `pessoal` lista 1; `todas` 4). `chipsDe` do primeiro → `['Urgente','Profissional']`. `aplicarAgente` com `ambito:'indefinido'` e sem fixo → `ambito:null`. `motivo` com 300 caracteres é cortado em 160.
- CA6: Comportamento neutro da variante nova: `nextRun`/próxima execução de uma tarefa `whatsapp-message` é `null` (nunca dispara pelo relógio, nem como `missed`); `frequency.ts` descreve como `"Quando chega mensagem do WhatsApp"`; o gatilho `'whatsapp'` aparece em `RunsTab` como `"WhatsApp"`; `AUTOMATIC_TRIGGERS` não contém `'whatsapp'`. Teste: `automations-schedule.test.ts` faz parse de `{kind:'whatsapp-message', esperaSeg:30, grupos:false}` com sucesso e recusa `esperaSeg: 4` e `esperaSeg: 601`.
- CA7: Store: `set` → `list` devolve a etiqueta; arquivo em `dir/triagem.json` com modo `0o600`, `{version:1, etiquetas:{…}}`; arquivo inválido é renomeado para `triagem.json.corrupt-*` e `list()` devolve `{}`; `clear()` deixa `{}`; com 2.001 etiquetas, `set` mantém 2.000 (a mais antiga por `at` sai).
- CA8: `(await settings.get()).whatsappTriagem === true` por padrão; `settings.json` sem o campo → `true` (`.catch`); patch estrito aceita `false`; `settings-index` tem a entrada (o teste existente que valida o índice continua verde).
- CA9: `contatoLigado` em `shared/funil-logic.ts` com a mesma assinatura e os testes do funil que a cobrem (ou um teste novo com os 3 casos: por chatId, por e-mail, por telefone) verdes; `ContactLink.tsx` continua funcionando (typecheck).
- CA10: `EXAMPLE_AGENTS` contém um agente com `name === 'Triagem do WhatsApp'`, `funil: true`, `web: false`, `model: 'haiku'`; o schema de `AgentInput` aceita `TRIAGEM_TEMPLATE`.

## Invariantes
- Nenhum arquivo fora da Superfície muda; `git diff --stat` não mostra `main/email`, `features/email`, `main/index.ts`, `shared/ipc.ts`, `preload`.
- Comportamento das schedules existentes inalterado (`automations-schedule.test.ts` e `automations-service.test.ts` verdes sem edição além do acréscimo).
- Nenhuma string de mensagem do WhatsApp em `devLog`.
- Nada é semeado em `agents.json` já existentes (a semente só roda na primeira criação, como hoje).

## Fora de escopo desta tarefa
- Chamada ao modelo, debounce, fila, runs, IPC, `index.ts`, limpeza no logout (161). Telas (160, 162). Cartões (163). Smoke (164).

## Gates
- `pnpm --filter desktop typecheck && pnpm --filter desktop lint && pnpm --filter desktop test` (da raiz). Smoke não é exigido neste contrato.
- Testes novos: `triagem-logic.test.ts` (CA1–CA5), `triagem-store.test.ts` (CA7), acréscimos em `automations-schedule.test.ts` (CA6) e no teste de settings (CA8), teste de `contatoLigado` (CA9).

## Relatório esperado do implementador
≤ 40 linhas: arquivos criados/alterados, saída resumida dos gates (contagem de testes), onde o typecheck exigiu ramo novo (lista exata), dúvidas que resolveu sozinho.
