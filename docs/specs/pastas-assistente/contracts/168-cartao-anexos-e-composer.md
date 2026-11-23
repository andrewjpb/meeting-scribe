# Contrato 168 — Resposta de e-mail com anexos das pastas: cartão `email-resposta` estendido, "Abrir no Composer" e regra de e-mail que pede documentos

Feature: pastas-assistente  ·  Wave: 3  ·  Depende de: 166 (e 167 commitado, para a árvore estar íntegra)  ·  Gate humano: mockups 05–07 aprovados pelo Andrew

Constituição: `~/CLAUDE.md` e `docs/specs/desktop-shell/design.md`. Prevalecem sobre este contrato.

## Pré-condições
- Worktree `~/Documents/GitHub/meeting-scribe-pastas-assistente`, branch `pastas-assistente`, 165–167 commitados; gates rápidos verdes.
- Não tocar `features/email/Composer.tsx` (o Composer já mostra `draft.attachments`; nada muda nele), `main/email/service.ts` (envio e `sendSchema` inalterados), `preload/`.
- Desenho de referência: `mockups/png/05-cartao-anexos.png`, `06-composer-anexos.png`, `07-cartao-aberto.png`.

## Contexto mínimo
Hoje o cartão `email-resposta` (`shared/assistant.ts:219`, `main/chat/actions.ts:163, :786`, `ActionCards.tsx:493-602`) tem texto editável e botão Enviar que chama `emailSend` com token de clique. Este contrato: (1) o modelo pode indicar **ids** de arquivos do índice (165) como anexos e itens pedidos que não achou; (2) o main resolve os ids, aplica os limites do app (20 MB, 10 arquivos) e mostra no cartão o que vai, o que falta e o total; (3) com anexos, o cartão não envia: abre o Composer já montado (destinatário, assunto, texto, em resposta a, anexos lidos pelo main) e o envio continua pelo botão Enviar do Composer com token de clique; (4) a instrução de sistema ganha a regra de e-mail que pede documentos.

Moldes: contrato 163 (`docs/specs/notificacoes-triagem/contracts/163-assistente-cartoes-e-fonte.md`) para estender cartões (schema, resolve, history, canal `scribe:chat-action-*`, `createChatActions` idempotente, `data-chat-action-kind`); `readEmailAttachments` (`main/email/attach.ts`) para ler bytes com limite; `EmailReplyCard` para o visual; `useEmail.openDraft` (`emailStore.ts:458`) e `EmailNavigationState.compose` (`shared/routes.ts:101`, `EmailScreen.tsx:413-422`) para abrir o Composer.

## Superfície
- Alterar `shared/assistant.ts`: `EmailReplyAttachment { id: string; name: string; relPath: string; folderLabel: string; bytes: number; requested: string | null }`; `EmailReplyAction` ganha `attachments: EmailReplyAttachment[]` e `missing: string[]`; constantes `EMAIL_REPLY_ATTACHMENTS_MAX = 10` (= `EMAIL_ATTACH_MAX_FILES`), `EMAIL_REPLY_MISSING_MAX = 10`, `EMAIL_REPLY_MISSING_TEXT_MAX = 120`, `EMAIL_REPLY_REQUESTED_MAX = 80`; estado de ação ganha `'opened'` (rótulo "Aberto no Composer").
- Alterar `main/chat/actions.ts`: `proposedSchema` de `email-resposta` ganha `anexos: z.array(z.object({ id: /^[0-9a-f]{16}$/, pedido: z.string().max(80).optional() })).max(10).optional()` e `faltando: z.array(z.string().max(120)).max(10).optional()`; `resolve()` recebe `folderIndex` (ou uma função `resolveFolderFile(chatId, id)`) nas deps e monta `attachments`/`missing` conforme "Resolução" abaixo; `actionsHistory` e `chatActionSchema` (`main/chat/store.ts`) com `.default([])` nos dois campos e `'opened'` no estado.
- Alterar `shared/ipc.ts`: `scribe:chat-action-email-compose` (`{ chatId: string; messageId: string; actionId: string }` → `EmailComposeFromAction`), `WHEN_LOCKED: 'refused'`.
  ```ts
  export interface EmailComposeFromAction { ok: true; accountId: string; mailbox: string | null; to: string[]; subject: string; text: string; inReplyTo: string | null; attachments: EmailOutgoingAttachment[]; skipped: string[] } | { ok: false; error: 'nao-encontrado' | 'estado' | 'anexos' }
  ```
- Alterar `main/index.ts` (ou o módulo `createChatActions` se o handler viver lá): handler do canal → busca a ação por `(chatId, messageId, actionId)`; exige `status === 'proposed' || 'opened'`; para cada `attachments[i]`: `folderIndex.resolve(chatId, id)` + `folderOf` + `realpath` dentro da pasta + `lstat` não symlink + `stat.size` igual ao gravado (se mudou, recusa o item → `skipped`); monta `paths` e chama `readEmailAttachments(paths)` (que já aplica 20 MB/10 arquivos e devolve `{attachments, skipped}`); marca `setActionState(ref, 'opened')` (idempotente); devolve o rascunho. Falha total (nenhum anexo lido quando havia) → ainda devolve `ok: true` com `attachments: []` e `skipped` cheio: o usuário decide no Composer. `error: 'estado'` quando a ação já está `sent`/`discarded`.
- Alterar `main/claude-cli/chat.ts` (regras de e-mail, `~:223`): texto da seção "Instrução" abaixo + exemplo do bloco.
- Alterar `renderer/src/features/chat/ActionCards.tsx` (`EmailReplyCard`): seção **Anexos** quando `attachments.length + missing.length > 0`; botão **Abrir no Composer** (primário) → `invoke('scribe:chat-action-email-compose', …)` → `useEmail.getState().openDraft({ accountId, to, cc: [], subject, text: <texto editado no cartão>, inReplyTo, attachments, skippedAttachments: skipped })` (campos conforme `ComposeDraft` real em `features/email/format.ts:169-183`) → `navigate(emailPath(accountId, mailbox ?? 'inbox'))`; estado `opened` desenha como `sent` desenha hoje (botões desabilitados, rótulo "Aberto no Composer", mockup 07). **Sem anexos e sem faltantes: cartão idêntico ao atual** (Enviar continua).
- Alterar `renderer/src/features/email/emailStore.ts` **só se** `openDraft` não aceitar `attachments`/`skippedAttachments` (campo já existe em `ComposeDraft`; provavelmente nada muda). Se `EmailScreen` abrir o Composer só via `location.state.compose`, então acrescentar a `EmailNavigationState.compose` um campo `fromDraft: true` que faça `EmailScreen` chamar `openDraft` com o rascunho já posto no store **antes** de navegar (nunca bytes em `history.state`).
- Testes: `apps/desktop/test/assistant-actions.test.ts` (ou onde `extractActions`/`resolve` de `email-resposta` é testado) e `chat-actions-handler` (handler do canal com `folderIndex` e `readEmailAttachments` falsos); acréscimo em `assistant.test.ts` (instrução contém a regra); teste de parse do histórico com cartão antigo sem os campos.

### Resolução (`resolve()` de `email-resposta`)
1. `anexos` ausente → `attachments: []`; `faltando` ausente → `missing: []`.
2. Para cada `{id, pedido}` em ordem: `entry = resolveFolderFile(chatId, id)`; `null` → `missing.push((pedido ?? id) + ' (arquivo não está no índice)')`; duplicado (mesmo id) → ignorado.
3. Soma acumulada: se `soma + entry.size > EMAIL_ATTACH_MAX_BYTES` **ou** `attachments.length === EMAIL_ATTACH_MAX_FILES` → `missing.push((pedido ?? entry.name) + ' (não coube no limite de 20 MB)')`; senão `attachments.push({ id, name: entry.name, relPath: entry.relPath, folderLabel: <label da pasta>, bytes: entry.size, requested: pedido ?? null })`.
4. `faltando` entra em `missing` depois dos derivados, cada item cortado em 120 caracteres, total ≤ 10 (excedente descartado).
5. O cartão sempre renderiza; o texto nunca é alterado pelo resolver.

### Cartão (visual, mockup 05/07)
- Cabeçalho como hoje. Seção "Anexos": linha por `attachments[i]`: `requested → name · tamanho` (seta só quando `requested`); depois `missing` como "Não encontrado: <item>" em tom de aviso; rodapé "Total: X de 20 MB" (X = soma formatada). Textarea como hoje. Botões: **Abrir no Composer** (primário), **Abrir o email**, **Descartar**. Enviar **não** aparece quando há anexos ou faltantes (R3 da spec). `data-chat-action-kind="email-resposta"`, `data-email-reply-attachments="<n>"`, `data-email-reply-missing="<n>"`, `data-email-reply-open-composer` no botão.

### Instrução (texto a inserir nas regras de e-mail)
"Quando um e-mail pede documentos e a fonte Pastas está ligada: para cada item pedido, procure em PASTAS.md o arquivo que corresponde (pelo nome e pela pasta). Proponha um cartão `email-resposta` com `anexos` (um por item encontrado: `id` de PASTAS.md e `pedido` com as palavras do remetente) e `faltando` (os itens que não encontrou, com as palavras do remetente). Some os tamanhos: no máximo 20 MB e 10 arquivos; se não couber, deixe o maior de fora e diga no texto. No `texto`, diga o que vai anexo e o que ficará para depois. Nunca invente arquivo: só ids que estão em PASTAS.md. O e-mail é enviado só quando o usuário clicar em Enviar no Composer." + exemplo:
```lap-acao
{"tipo":"email-resposta","email":{"conta":"…","id":"…"},"texto":"Olá, Michel. Seguem o contrato assinado e a proposta comercial. O comprovante de inscrição estadual eu envio amanhã.","anexos":[{"id":"3f9a0c1e8b2d4a6f","pedido":"contrato assinado"},{"id":"9b1d2e3f4a5b6c7d","pedido":"proposta comercial"}],"faltando":["comprovante de inscrição estadual"]}
```

## Critérios de aceite
- CA1: Bloco com 2 `anexos` válidos (ids no índice da conversa, 1,2 MB e 240 KB) e 1 `faltando` → `attachments` com 2 itens em ordem (`requested` preenchido, `bytes` do índice, `folderLabel`), `missing` com 1; cartão antigo gravado sem os campos → parse com `[]` nos dois.
- CA2: id fora do índice → vai para `missing` com "(arquivo não está no índice)"; id repetido → uma vez; 11 ids válidos → 10 anexos e o 11º em `missing` "(não coube…)"; 3 arquivos de 9 MB → 2 anexos e o 3º em `missing` "(não coube no limite de 20 MB)"; `faltando` com 12 itens de 200 caracteres → `missing` com ≤ 10 itens de ≤ 120 caracteres (contando os derivados).
- CA3: Handler do canal: ação `proposed` com 2 anexos → `readEmailAttachments` chamado com os 2 caminhos reais, resposta `ok:true` com 2 `attachments` (`name`, `bytes` Uint8Array) e estado `opened`; segunda chamada → mesmo resultado e estado continua `opened`; arquivo cujo `stat.size` difere do índice → vai para `skipped` e não é lido; ação `sent` → `{ok:false, error:'estado'}`; `(chatId, messageId, actionId)` inexistente → `'nao-encontrado'`; `WHEN_LOCKED` do canal é `'refused'`. **Nenhuma chamada a `emailSend`/SMTP** no handler (asserção de que o serviço de e-mail falso não recebeu `send`).
- CA4: Renderer: cartão com anexos não renderiza o botão Enviar e renderiza Abrir no Composer, 2 linhas de anexo, 1 "Não encontrado", "Total: 1,4 MB de 20 MB" (mockup 05); cartão sem anexos/faltantes renderiza exatamente como antes (snapshot ou asserções dos botões); depois do clique, estado `opened` com rótulo "Aberto no Composer" e botões desabilitados (mockup 07). Se não houver teste de renderer para `ActionCards`, cobrir por função pura (`emailReplyHasAttachments`, formatação do total) e deixar o visual para o smoke do 169 — dizer isso no relatório.
- CA5: Fluxo Abrir no Composer: `openDraft` recebe `text` igual ao textarea (edição do usuário preservada), `attachments` do canal e `skippedAttachments: skipped`; navegação para `emailPath(accountId, mailbox ?? 'inbox')`; nenhum byte em `history.state` (grep no diff por `state:` em `navigate(` com `attachments`).
- CA6: Instrução de sistema contém "pede documentos", "`anexos`", "`faltando`", "20 MB", "Nunca invente arquivo" e o exemplo; só entra quando a fonte `pastas` está ligada **e** há conta de e-mail (seguir como as regras de e-mail entram hoje).
- CA7: `label`/`devLog`/erros do handler sem conteúdo de arquivo, sem caminho absoluto e sem corpo de e-mail.

## Invariantes
- `sendSchema`, `createEmailClickGuard`, `emailSend` e `Composer.tsx` intocados; o único caminho de envio continua o botão Enviar do Composer com token de clique.
- Nenhum byte de anexo sai do main por outro canal além de `scribe:chat-action-email-compose` (e os já existentes).
- Cartões de outros tipos e `email-lote` inalterados (testes existentes verdes).
- Nada fora da Superfície: `git diff --stat` não mostra `Composer.tsx`, `main/email/service.ts`, `preload/`, `SettingsScreen.tsx`, `SourcesSection.tsx`.

## Fora de escopo desta tarefa
- Anexos no `email-lote`; anexar a partir do WhatsApp; limite por conta; smoke e docs (169).

## Gates
- `pnpm --filter desktop typecheck && pnpm --filter desktop lint && pnpm --filter desktop test` da raiz do worktree. Smoke no 169.

## Relatório esperado do implementador
≤ 40 linhas: arquivos alterados/criados, contagem de testes, como o Composer foi aberto (`openDraft` direto ou `compose.fromDraft`), se havia teste de renderer para o cartão, dúvidas resolvidas sozinho.
