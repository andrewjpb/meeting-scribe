# Contrato 163 — Assistente: cartões `triagem-agente` e `triagem-etiqueta`, `abrir` com Notificações e abas, fonte do WhatsApp com etiquetas, seção Triagem em AUTOMACOES.md

Feature: notificacoes-triagem  ·  Wave: 3  ·  Depende de: 160, 161  ·  Gate humano: desenho aprovado (`mockups/png/07-assistente-cartoes-triagem-*`)

Constituição: `~/CLAUDE.md` e `docs/specs/desktop-shell/design.md`. Prevalecem sobre este contrato.

## Pré-condições
- 160 e 161 commitados. Gates rápidos verdes. Não tocar `features/whatsapp/*`, `features/schedules/*`, `features/settings/*`, `features/email/*`, `main/email/*`, `main/smoke.ts`.
- O contrato 153 (cartão que cria agente de atendimento) pode ou não estar implementado: **não dependa dele** e não toque seus kinds; siga o mesmo padrão do cartão `instagram-rascunho`/`tarefa-criar`.

## Contexto mínimo
Cartões: o modelo escreve `lap-acao` com JSON; `main/chat/actions.ts` valida (`proposedSchema`, l.156), resolve dados para exibição (`resolve`, l.729) e grava `proposed`; o clique em `features/chat/ActionCards.tsx` chama `scribe:chat-action-<x>`; `createChatActions` executa idempotente e grava `done|failed|dismissed`. Listas a atualizar: `CHAT_ACTION_KINDS`/interfaces/textos em `shared/assistant.ts`, `chatActionSchema` em `main/chat/store.ts`, o switch exaustivo `actionsHistory`, `INVOKE_CHANNELS` + `WHEN_LOCKED` em `shared/ipc.ts`, handlers/resolvers em `main/index.ts`, a instrução em `main/claude-cli/chat.ts` (`assistantSystemPrompt`, parágrafo "Tipos de bloco" l.200, exemplos e regras). Fonte do WhatsApp: `main/whatsapp/export.ts` (`overviewLine` l.352, cabeçalho l.387, `exportRecentWith` l.372). `AUTOMACOES.md`: `automationsMarkdown` em `main/chat/sources.ts:183` a partir de `AutomationsSnapshot`.

Desenho (mockup 07): cartão "Criar agente de triagem do WhatsApp" mostra nome, modelo, gatilho (espera e grupos) e permissões ("Pode ler o funil"), sem as instruções, botões "Criar agente" e "Descartar"; cartão "Etiquetar conversa <nome> como Urgente · Profissional" com "Aplicar" e "Descartar". Ambos no visual dos cartões existentes (`ActionCards.tsx`).

## Superfície
- `shared/assistant.ts`: kinds `'triagem-agente'` e `'triagem-etiqueta'`; interfaces; `OPEN_SCREENS` ganha `'notificacoes'`; pedidos `ChatActionTriagemRequest`.
- `shared/ipc.ts`: `'scribe:chat-action-triagem': { request: ChatActionTriagemRequest; response: ChatActionResult }` em `INVOKE_CHANNELS` e `WHEN_LOCKED` (`refused`); `preload/index.ts` se o padrão exigir.
- `main/chat/actions.ts`: schemas no `proposedSchema`, `resolve` dos dois tipos (resolver `triagem.status()`, `whatsappChat(chatId)` e a etiqueta atual via `triagem.get(chatId)`), execução no `createChatActions` chamando `TriagemService` (`createFromTemplate`, edição/pausa via `automations`, `set`); `main/chat/store.ts` (`chatActionSchema`); `actionsHistory`.
- `main/index.ts`: handler `scribe:chat-action-triagem` e injeção do `triagemService`/`automations` nos resolvers.
- `main/claude-cli/chat.ts`: instrução dos dois tipos e do `abrir` estendido; regra "a triagem só etiqueta; para mandar mensagem continua sendo `whatsapp-resposta`"; orientação para "o que está urgente?" e "o que ficou sem resposta?" (ler `CONVERSAS-WHATSAPP.md`, citar).
- `main/whatsapp/export.ts`: `exportRecentWith(..., etiquetas?: Readonly<Record<string, Etiqueta>>)`; `overviewLine` ganha o campo `etiqueta: <chips unidos por ' · ' | '—'>` antes de `arquivo:`; cabeçalho passa a dizer "Urgentes: N · Pendentes de resposta: M de T" e explica os dois campos. Quem chama (`main/chat/*` ou `index.ts`) passa `await triagemStore.list()`.
- `main/chat/sources.ts` (+ tipo `AutomationsSnapshot`): seção `## Triagem do WhatsApp` com: agente (nome) e estado (`ativo` | `pausado` | `sem agente` | `desligada nas Configurações`), espera e grupos, `triagens hoje: N de 300`, `urgentes agora: N`, e a frase "Para criar ou mudar o agente, proponha `triagem-agente`.". Quem monta o snapshot (`index.ts`) passa `triagem.status()` e a contagem de urgentes.
- `renderer/src/features/chat/ActionCards.tsx`: os dois cartões; `abrir` com `tela: 'notificacoes'` → `navigate(ROUTE_PATHS.notificacoes)`; `tela: 'whatsapp'` com `alvo` em `TRIAGEM_ABAS` (`nao-lidas|urgentes|pessoal|profissional`) → `navigate(ROUTE_PATHS.whatsapp, { state: { aba } })` (sem chatId); `alvo` que não é aba continua sendo chatId.
- Testes: `test/assistant.test.ts` (listas/instrução), novo `test/assistant-triagem.test.ts` (schemas, resolve, execução idempotente, `abrir`), acréscimo em teste de `export.ts` (linha com etiqueta e cabeçalho) e de `sources.ts` (seção Triagem).

### Formato dos blocos
- `{"tipo":"triagem-agente","acao":"criar"|"editar"|"pausar"|"retomar","instrucoes"?:string(≤8000),"esperaSeg"?:5..600,"grupos"?:boolean}`
  - `criar`: `createFromTemplate()`; com `instrucoes`/`esperaSeg`/`grupos`, aplica depois de criar (agente e tarefa). Se já existe, vira `editar` (o cartão avisa "Já existe; vou atualizar").
  - `editar`: exige agente existente; altera só os campos presentes.
  - `pausar`/`retomar`: `enabled` da tarefa `whatsapp-message`.
  - `ChatAction`: `acao`, `agente: { id, nome, modelo } | null`, `tarefa: { id, esperaSeg, grupos, enabled } | null`, `permissoes: string[]` (ex.: `['Pode ler o funil']`), `instrucoesPreview: string` (primeiros 140 caracteres), `avisos: ('ja-existe' | 'sem-agente' | 'desligado')[]`, `status/result/error`. Botão: "Criar agente" | "Salvar" | "Pausar" | "Retomar"; secundário "Descartar". Texto de resultado: "Agente de triagem criado" | "atualizado" | "pausado" | "retomado".
- `{"tipo":"triagem-etiqueta","chatId":string,"urgente"?:boolean,"ambito"?:"pessoal"|"profissional"|"nenhum"}` (ao menos um dos dois)
  - `ChatAction`: `chat: { id, name, kind } | null` (via `resolver.whatsappChat`), `antes: Etiqueta | null`, `depois: { urgente, ambito }` (prévia), `status/result/error`. Conversa inexistente → `avisos: ['conversa-nao-encontrada']` e botão desabilitado. Botão "Aplicar"; resultado "Etiqueta aplicada: Urgente · Profissional" (ou "Etiqueta limpa"). Execução: `triagem.set(chatId, patch)` com `ambito:'nenhum'` → `null`.
- `abrir`: `tela` aceita `notificacoes`; com `tela:"whatsapp"`, `alvo` pode ser uma aba (`nao-lidas`, `urgentes`, `pessoal`, `profissional`) além do id da conversa.

## Critérios de aceite
- CA1: `proposedSchema` aceita os três exemplos acima e recusa `triagem-etiqueta` sem `urgente` nem `ambito`, `esperaSeg: 4`, `acao: 'apagar'`.
- CA2: `resolve('triagem-agente' criar)` com agente já existente → `avisos: ['ja-existe']` e botão "Salvar"; sem agente → botão "Criar agente", `permissoes` contém "Pode ler o funil", `instrucoesPreview` com 140 caracteres + "…". Com o interruptor desligado → `avisos` inclui `'desligado'` (o cartão mostra "A triagem está desligada em Configurações" mas permite criar).
- CA3: Clique em `scribe:chat-action-triagem` para `criar` chama `createFromTemplate` **uma** vez mesmo com dois cliques (idempotente pelo id do cartão); grava `done` com `result: 'Agente de triagem criado'`. `pausar` deixa `tarefa.enabled === false` e `retomar` volta a `true`. `editar` com `esperaSeg: 45` grava 45 na tarefa.
- CA4: `triagem-etiqueta` com `{ urgente: true, ambito: 'profissional' }` chama `triagem.set(chatId, { urgente: true, ambito: 'profissional' })` e grava `result: 'Etiqueta aplicada: Urgente · Profissional'`; com `{ ambito: 'nenhum' }` chama `set(chatId, { ambito: null })` e `result: 'Etiqueta limpa'` quando o resultado não tem chips. `chatId` inexistente → `failed` com erro legível, `set` não chamado.
- CA5: `actionsHistory` descreve os dois tipos (switch exaustivo compila); `chatActionSchema` aceita os dois `ChatAction` e recusa `kind` desconhecido como antes.
- CA6: `overviewLine` com etiqueta urgente profissional contém `· etiqueta: Urgente · Profissional ·`; sem etiqueta, `· etiqueta: — ·`; o cabeçalho de `CONVERSAS-WHATSAPP.md` contém `Urgentes: 1 · Pendentes de resposta: M de T` e a explicação dos campos. Sem `etiquetas` (parâmetro ausente), saída idêntica à atual mais `etiqueta: —` (teste existente ajustado só nisso).
- CA7: `automationsMarkdown` com `triagem: { status: {ativo:true, agenteNome:'Triagem do WhatsApp', hoje: 12, teto: 300, …}, urgentes: 2, esperaSeg: 30, grupos: false }` produz a seção `## Triagem do WhatsApp` com as linhas exigidas; com `motivo:'sem-agente'` diz "sem agente" e a frase de como criar.
- CA8: `assistantSystemPrompt` contém `"triagem-agente"`, `"triagem-etiqueta"`, `notificacoes` entre as telas do `abrir`, as abas como `alvo` do WhatsApp, e a regra "só etiqueta" (teste em `assistant.test.ts` por `includes`).
- CA9: `ActionCards`: `abrir` com `tela:'notificacoes'` navega para `/notificacoes`; `tela:'whatsapp'`, `alvo:'urgentes'` navega para `/whatsapp` com `state.aba === 'urgentes'`; `alvo:'5511…@s.whatsapp.net'` continua com `state.chatId`. Cartões renderizam os botões com os rótulos acima e `data-chat-action-kind="triagem-agente|triagem-etiqueta"`.
- CA10: `scribe:chat-action-triagem` em `INVOKE_CHANNELS` e `WHEN_LOCKED` (`refused`); gates rápidos verdes.

## Invariantes
- Nenhum caminho novo chega a `scribe:whatsapp-send`/`agentSend`; o cartão de triagem nunca envia mensagem.
- Cartões existentes e seus testes inalterados; `main/agents|schedules|tray` continuam sem importar `main/whatsapp/*`.
- Sem conteúdo de mensagem em devLog.
- `git diff --stat` sem `features/whatsapp`, `features/schedules`, `features/settings`, `features/email`, `main/email`, `main/smoke.ts`.

## Fora de escopo desta tarefa
- Telas do WhatsApp/Automações/Configurações (162); smoke, prints e docs (164); o cartão de atendimento (153).

## Gates
- `pnpm --filter desktop typecheck && pnpm --filter desktop lint && pnpm --filter desktop test` (da raiz). Gate completo ao fim da wave 3, pelo coordenador.

## Relatório esperado
≤ 35 linhas: arquivos, contagem de testes, como injetou `triagem` nos resolvers/`index.ts`, formato final do cartão, cláusulas não cumpridas.
