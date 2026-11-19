# Contrato 56 — O agente organiza o email: pastas, mover em lote, Desfazer, progresso ao vivo e Parar

Feature: email-organizacao · Wave: 3 · Depende de: 52, 54 (só por arquivo) · Spec: `docs/specs/email-organizacao/spec.md` (R9, R10, R11, R12, N4, N7, F4) · Plan: `docs/specs/email-organizacao/plan.md`

> RASCUNHO (19/11/2026). Falta o ok do Andrew nas decisões marcadas **[decidir]** antes de ir ao implementador.

Pedido do Andrew (19/11/2026 13:00): "organiza meus emails", "separa o que já foi resolvido". Este contrato é o main,
o preload, o IPC, os testes **e o cartão do lote no chat**. O painel "Organizando" da tela de email (telas 07 e 08 do
mockup `mockups/EmailOrganizacao.dc.html`), a faixa "O Assistente moveu N mensagens · Desfazer" no topo da lista e o
esmaecimento das linhas movidas são do contrato 55. Aqui se entregam os **eventos**, o **estado** e o **Desfazer** que
essas telas consomem.

**Como as ferramentas do Assistente funcionam hoje (importante para quem implementa).** O Assistente **não** usa MCP
para as ferramentas do app: é o protocolo do bloco cercado `lap-ferramenta` de `main/chat/tools.ts` (contrato 45, CA7).
O modelo termina a resposta com um JSON, `chat/service.ts` roda a ferramenta (`AssistantTool.run(args, folder)`), grava o
resultado num arquivo da pasta da conversa e pergunta de novo na mesma sessão, até `TOOL_ROUNDS_MAX = 4` rodadas.
`buscar_emails` e `ler_email` estão em `main/email/assistant-tools.ts` (`createEmailTools`), ligadas no `index.ts` por
`assistant.tools(scope)`. O único MCP do app é o do navegador (`navegador/mcp.ts`, só ACP). Este contrato segue o
registro de `assistant-tools.ts`, como o plan pede: funciona no transporte CLI e no ACP. Ver D1.

## Pré-condições
- **O 56 só começa depois do commit do 54** na branch `email-organizacao` (e do 53, se ele já estiver em andamento:
  um implementador por vez). O 54 mexe em `shared/ipc.ts`, `main/email/service.ts`, `main/index.ts` e
  `main/settings/*`, que o 56 também toca. Conferir com `git log --oneline -3` que o commit do 54 está lá e que
  `git status` está limpo.
- Contrato 52 commitado (b624852): `listFolders`, `moveMessages`/`moveQueued`, `createFolder`, `folderEntries`,
  `serverMessageId(mailbox, uidValidity, uid)`, `movedIn`, `EMAIL_MOVE_MAX = 500`, `EmailMoveResult`, `EmailFolderNode`.
- Ler antes: `apps/desktop/src/main/email/{assistant-tools,service,export,imap-client,fake-email,email-store}.ts`,
  `apps/desktop/src/main/chat/{tools,service,actions,sources}.ts`, `apps/desktop/src/shared/{email,assistant,chat,ipc}.ts`,
  `apps/desktop/src/main/schedules/{service,email-send}.ts` (o `readTools()` das tarefas), o trecho do `index.ts` que monta
  `emailTools`, `chat` e `automations`, e os testes `apps/desktop/test/email-{assistant,automations,folders,service}.test.ts`.
- O cartão do lote no chat não está no mockup aprovado: a descrição do CA12 precisa do ok do Andrew (D9).

## Critérios de aceite
- CA1 — Ferramentas separadas das de leitura. `createEmailTools` passa a devolver `{ tools, organizeTools, find }`:
  `tools` continua **só** `buscar_emails` e `ler_email` (o que as tarefas agendadas recebem por `readTools()`);
  `organizeTools` traz `listar_conversas`, `listar_pastas`, `criar_pasta`, `mover_emails` e `informar_progresso`.
  No `index.ts`, `assistant.tools(scope)` dá `[...tools, ...organizeTools]` ao Assistente interativo (mesmas condições de
  hoje: fonte email ligada, conta cadastrada, app desbloqueado; nunca no chat de reunião). As automações continuam com
  `readTools: () => emailTools.tools`. `toolsInstructions` deixa de dizer "só de leitura" quando a lista tem uma
  ferramenta que move: diz que `mover_emails` e `criar_pasta` mudam o email e **só podem ser usadas quando a pessoa
  pediu nesta conversa para organizar ou mover**, e que nenhuma ferramenta apaga email.
- CA2 — `listar_conversas` (leitura). Campos: `conta` (endereço, opcional), `pasta` (path, padrão `INBOX`), `limite`
  (1–200, padrão 200). Lê a pasta pelo cache (INBOX) ou por `openFolder` (outra pasta), agrupa em **conversas** (pelo
  `References`/`In-Reply-To` e, sem eles, pelo assunto sem `Re:`/`Fwd:`/`Enc:` + participantes) e junta, em cada
  conversa, as respostas que estão em Enviados. Grava `CONVERSAS-EMAIL.md` com uma linha por conversa: assunto,
  participantes, quantos recebidos/enviados, data da última e de quem é, e as referências `em-…` de cada mensagem
  (as recebidas marcadas como "movível", as de Enviados como "só leitura"). No topo: quantas mensagens a pasta tem,
  quantas entraram e quantas ficaram de fora pelo limite de 200 (N7). POP3: só INBOX e Enviados do app.
- CA3 — `ler_email` aceita também `emails: string[]` (1–20 referências) além do `email` de hoje, e grava **um** arquivo
  com todas (a forma de hoje fica igual). Serve para ler o fio inteiro numa rodada (D2).
- CA4 — `listar_pastas` (leitura): `conta` opcional. Grava `PASTAS-EMAIL.md` com a árvore de `listFolders`: path, nome,
  pasta especial, não lidas/total, e se pode ser destino (CA6). POP3: diz que a conta não tem pastas e não move.
- CA5 — `criar_pasta`: `conta`, `nome`, `dentro_de` (path, opcional). Chama `createFolder` do 52 (pasta que já existe
  devolve o path sem erro). Só cria; nunca renomeia nem apaga pasta. Até 10 pastas criadas por conversa.
- CA6 — `mover_emails`: `conta`, `destino` (path que já existe no `LIST`; **não cria** sozinho), e `assuntos`: lista de
  1–20 `{ emails: string[] (refs, 1–50), assunto, veredito: 'resolvido' | 'pendente' | 'outra', motivo (≤ 200),
  evidencia (≤ 200) }`. Regras, conferidas no main com o estado de agora:
  - Origem: a mensagem da referência (`find(ref)`): cache (INBOX) ou achada no servidor (pasta + UIDVALIDITY + UID, de
    `serverMessageId`). Não move de `\Sent`, `\Drafts`, `\All`, `\Flagged`, `\Important` nem de pasta `\Noselect`
    (essas referências voltam como `nao-movivel` e as outras seguem).
  - Destino recusado (`destino-proibido`): `\Trash`, `\Junk`, `\Sent`, `\Drafts`, `\All`, `\Flagged`, `\Noselect`, ou o
    próprio path de origem. **O agente nunca apaga email**: não há ferramenta de apagar, e mover para a Lixeira ou o
    Spam é recusado aqui (N4, F4).
  - Destino que não está no `LIST` → `folder-missing` (o `LIST` guardado é relido uma vez antes), e nada se move; a
    resposta ao agente diz para chamar `criar_pasta` antes (R9: `Resolvidos`/`Pendentes` criadas se faltarem).
  - Teto por pedido (N7): 200 mensagens movidas por conversa do chat em todo o turno; o que passar volta como
    `limite`. Mensagens de uma chamada são agrupadas por pasta de origem e vão em `MOVE` de até `EMAIL_MOVE_MAX`.
  - Sem confirmação extra por tamanho: o pedido no chat é a autorização e o Desfazer cobre o resto (D5 **[decidir]**).
  - O agente é avisado (na instrução) que, na dúvida, deixa em `Pendentes` (N7) e que "resolvido" não é só "respondido".
  - POP3 → `pop3`. App bloqueado → a mensagem de bloqueado de hoje, nada se move.
  O resultado (`MOVER-EMAILS.md`) traz, por assunto, quantas foram, quantas ficaram e o porquê (sem corpo de email).
- CA7 — Mover de pasta que não está no store. Hoje `moveQueued` devolve `invalid` quando a pasta de origem nunca foi
  aberta (sem UIDVALIDITY guardado). `moveMessages(accountId, fromPath, uids, toPath, options?)` ganha
  `options: { uidValidity?: string; messageIds?: string[] }`: com `uidValidity` (o da referência do servidor), move
  conferindo esse valor; com `messageIds`, marca cada um em `movedIn` quando o destino é a INBOX, mesmo sem a mensagem
  no store (para o Desfazer não gerar aviso de "email novo"). Sem `options`, o comportamento do 52 fica igual.
- CA8 — Lote (R11), gravado **antes** do `MOVE` e completado depois. Arquivo `userData/email/batches.json` (0600,
  gravação atômica, fila própria): `{ version: 1, batches: EmailBatch[] }`, com
  `EmailBatch = { id: uuid; accountId; chatId; startedAt; endedAt: number | null; state: 'running' | 'stopped' | 'done'
  | 'undone' | 'partial-undo'; request: string (o pedido, ≤ 200); totals: { read; total; outOfLimit };
  topics: { assunto, veredito, destino, motivo, evidencia, from, count }[];
  items: { messageId: string | null; fromPath; fromUid; fromUidValidity; toPath; toUid: number | null;
  toUidValidity: string | null; status: 'pending' | 'moved' | 'failed' | 'undone' | 'undo-failed'; undoError?: code }[] }`.
  Fluxo: cada chamada de `mover_emails` grava os itens como `pending` (com o Message-ID), faz o `MOVE`, e grava
  `moved` com o UID novo do `COPYUID` (ou `null`) e o UIDVALIDITY do destino; falha → `failed`. Um lote por turno do
  chat (as chamadas do mesmo turno somam no mesmo lote). Guardados os 20 lotes mais recentes e no máximo 7 dias (D4);
  conta removida leva os lotes dela. Nada de corpo de email no arquivo: o assunto e o remetente da conversa sim (é o
  que o cartão e o painel mostram), nunca no log.
- CA9 — Desfazer (R11), caminho interno `undoBatch(batchId)` e IPC `scribe:email-batch-undo { batchId }`. Funciona depois
  de reiniciar o app (só depende do `batches.json` e do servidor). Para cada item `moved` (e `pending`, que pode ter
  movido antes de o app cair):
  - acha a mensagem no destino: pelo `toUid` se o UIDVALIDITY do destino é o mesmo; senão (ou `toUid` nulo, ou
    `pending`) por `UID SEARCH HEADER Message-ID` no destino (novo em `ImapReader`/`ImapSession`); sem Message-ID e sem
    UID → `undo-failed: not-found`;
  - move de volta para `fromPath` com `moveMessages(..., { uidValidity, messageIds })` (CA7), em lote por destino;
  - **pasta sumida**: destino que saiu do `LIST` (apagada ou renomeada fora) → itens `undo-failed: folder-missing`;
    origem que saiu → `undo-failed: origin-missing` (a mensagem fica onde está; o app **não** recria a pasta, D6);
    mensagem que a pessoa já tirou do destino → `not-found`. Uma falha não impede os outros itens.
  - Estado final `undone` (todos voltaram) ou `partial-undo` (sobrou falha); "Desfazer" de novo tenta só os que
    falharam. Lote `running` não se desfaz (`busy`): primeiro Parar. Devolve `{ ok: true, undone, failed: { code, count }[] }`.
  - Nada é apagado no servidor pelo Desfazer, fora o `EXPUNGE` do mover sem `MOVE` (como no 52).
- CA10 — Progresso ao vivo (R12). `informar_progresso`: `etapa: 'lendo' | 'decidindo' | 'movendo'`, `lidos`, `total`,
  e `decisoes` (0–20, no formato de `assuntos` do CA6, sem mover nada). Ela e `mover_emails` atualizam o lote e emitem o
  evento main → renderer `scribe:email-organize` com `{ batchId, chatId, accountId, state, etapa, read, total,
  outOfLimit, moved, byFolder: { path, count }[], topics: { assunto, from, count, veredito, destino, motivo, evidencia,
  status: 'decidindo' | 'decidido' | 'movido', open: { accountId, mailbox, id } | null }[] }` (o estado inteiro a cada
  vez, não o delta). `open` é a mensagem mais recente da conversa **onde ela está agora** (no destino, depois de mover;
  com o id do `serverMessageId` quando o UID novo veio), para o "clicar na linha abre o email" do 55. No chat, o passo
  da ferramenta vira um passo só, de mesmo id, com o rótulo "Organizando: 64 de 200 lidos, 18 movidos".
  Também `scribe:email-organize-state` (invoke) → o lote `running` mais recente e os lotes de hoje, para o painel e a
  faixa abrirem no meio ou depois de reiniciar. Bloqueado: o evento não sai (como os outros do email) e o invoke é recusado.
- CA11 — Rodadas e Parar. O turno que chama uma ferramenta de `organizeTools` passa a ter até
  `EMAIL_ORGANIZE_ROUNDS_MAX = 40` rodadas (os outros turnos seguem com 4) (D3). **Parar** é o `scribe:chat-stop` de hoje:
  além de `session.claude.stop()`, marca o turno como parado e aborta a ferramenta em curso (`AssistantTool.run` ganha
  um terceiro argumento `{ chatId, signal: AbortSignal }`). `mover_emails` abortada termina o `MOVE` que já foi ao
  servidor, grava os itens e não começa o próximo; o lote vai para `stopped` com `endedAt`, e o que já foi movido fica
  (com Desfazer). `chat.stop` devolve `true` também quando só havia ferramenta rodando. Turno que termina sem Parar →
  `done`. App que cai no meio → no próximo `init`, lote `running` vira `stopped` (itens `pending` ficam para o Desfazer
  conferir pelo Message-ID).
- CA12 — Cartão do lote no chat (R11, tela 6 da spec). `ChatAction` ganha `kind: 'email-lote'` (`EmailBatchAction`:
  `batchId`, `accountId`, `account`), anexado à resposta pelo main (nunca pelo texto do modelo: `ToolResult` ganha
  `actions?: ChatAction[]` e o loop do chat junta no fim, como os cartões das rodadas). O cartão lê o lote por
  `scribe:email-batch-get { batchId }` e mostra: "12 em Resolvidos, 5 em Pendentes, 1 em Clientes › ABF", uma linha por
  assunto (veredito, assunto, remetente, quantos, motivo) e o botão **Desfazer as N**; depois de desfeito, o estado
  ("Desfeito às 14:40" ou "Desfeito em parte: 2 não voltaram, a pasta de origem sumiu") e o botão some (`status: 'done'`,
  gravado em todas as conversas que têm o cartão). Usa só os componentes de cartão que o chat já tem (o do `emails`).
- CA13 — Bloqueio em tarefa agendada (N4, F4). Nenhuma execução de tarefa recebe `organizeTools`: nem a comum, nem a com
  "Pode enviar email" (`schedules/service.ts` monta `[...readTools(), send.tool]`). Teste estático: os nomes
  `mover_emails`, `criar_pasta`, `listar_pastas`, `listar_conversas` e `informar_progresso` não aparecem em
  `main/schedules/**`, e o teste de `email-automations` confere a lista de ferramentas de uma execução. Proteção também
  em tempo de execução: `mover_emails` e `criar_pasta` recusam (`agendada`) sem `chatId` de uma conversa do Assistente
  no contexto (CA11).
- CA14 — IPC no padrão do `service.ts` (zod `.strict()`, erros tipados `missing | pop3 | invalid | busy | unavailable |
  server`): `scribe:email-organize-state`, `scribe:email-batch-get { batchId }`, `scribe:email-batch-undo { batchId }`;
  evento `scribe:email-organize`. Os três invoke entram no mapa de canais e no `WHEN_LOCKED` como `'refused'`; o evento
  em `RENDERER_EVENTS` do jeito dos outros do email. Nenhum envia email; o Desfazer não usa token de clique (não envia
  nada e só devolve o que o agente moveu).
- CA15 — `fake-email.ts` ganha `SEARCH HEADER Message-ID` e o que faltar (UIDVALIDITY trocado no destino, pasta apagada
  por fora no meio do teste).
- CA16 — Testes (`test/email-organize.test.ts` e acréscimos em `email-assistant.test.ts`, `email-automations.test.ts`,
  `email-folders.test.ts`, `chat-*.test.ts`), no IMAP falso e com um "Claude" falso que pede as ferramentas:
  - Fluxo do R9: `listar_conversas` → `ler_email` com várias → `criar_pasta` Resolvidos/Pendentes → `mover_emails` →
    lote `done` com os itens, os tópicos e os totais certos; o evento sai a cada chamada com o estado inteiro.
  - `listar_conversas`: agrupa pelo `References` e pelo assunto; junta a resposta de Enviados; 231 na pasta → 200 e
    "31 de fora".
  - Recusas: destino Lixeira/Spam/Enviados/`\All` → `destino-proibido`, nada move; destino inexistente →
    `folder-missing`; origem Enviados → `nao-movivel`; 201ª mensagem no turno → `limite`; POP3 → `pop3`; bloqueado.
  - Mover de pasta do servidor que nunca foi aberta (pela referência da busca) funciona com o UIDVALIDITY dela.
  - Desfazer: com `COPYUID`; sem `COPYUID` (pelo Message-ID); **depois de recriar o serviço** (app reiniciado) só com o
    `batches.json`; item `pending` de app que caiu; destino apagado → `folder-missing`; origem apagada →
    `origin-missing` sem recriar; mensagem já tirada do destino → `not-found`; segundo Desfazer tenta só as que falharam;
    a volta à INBOX não chama o aviso de email novo (`movedIn`).
  - Parar: no meio de um `mover_emails` com 3 lotes de `MOVE`, o primeiro termina e os outros não começam; lote
    `stopped`; o Desfazer devolve só o que foi movido; `chat.stop` devolve `true` com ferramenta rodando.
  - Rodadas: turno com `mover_emails` aceita mais de 4 rodadas e para em 40; turno sem ferramenta de organizar segue em 4.
  - Agendada: execução de tarefa (com e sem "Pode enviar email") não tem as ferramentas novas; chamada sem `chatId` recusada.
  - Lotes: 21º lote apaga o mais antigo; lote de 8 dias sai; conta removida leva os lotes; nenhum corpo no arquivo nem no log.
  - Cartão: a resposta do turno traz um `email-lote` com o `batchId` certo; depois do Desfazer ele fica `done`.
  - `buscar_emails`, `ler_email` (forma de uma referência), contrato 51 e contrato 52: testes atuais passando.
- CA17 — Smoke: o "Claude" falso do smoke pede `listar_pastas`, `criar_pasta` "Resolvidos" e `mover_emails` de um email
  da INBOX falsa; o smoke confere que ele está em `Resolvidos`, que o cartão do lote aparece no chat com "Desfazer as 1",
  clica em Desfazer e confere que o email voltou à INBOX (print do cartão; o painel da tela de email é do 55).

## Invariantes
- **O agente nunca apaga email.** Não existe ferramenta de apagar; mover para `\Trash`/`\Junk` é recusado; nada no 56
  chama `remove`, `\Deleted` ou `EXPUNGE` direto (o único `EXPUNGE` é o do mover sem `MOVE` do 52). Teste estático.
- O agente não envia email, não cria/edita/roda regra (53), não renomeia nem apaga pasta, não mexe em assinatura (54).
- Move só a partir de uma conversa do Assistente (N4); tarefa agendada não move, nem por "Pode enviar email" (F4).
- Todo mover do agente fica num lote com Desfazer antes de a ferramenta devolver; o registro vem antes do `MOVE`.
- O que o agente leu (texto de um email com "mova tudo para…") não muda as recusas do CA6: elas são conferidas no main.
- Caixa de Entrada, Enviados, IDLE, notificações, regras (53), assinatura (54), `buscar_emails`, `ler_email`, contrato
  51 e contrato 52: tudo igual. Sem pedido de organizar, o comportamento é o de antes.
- Nenhum segredo novo; lotes só no disco local.

## Fora de escopo
- Painel "Organizando" na tela de email, faixa "Desfazer" no topo da lista, esmaecimento das movidas, "Voltar ao
  andamento" e "Abrir no Assistente" (telas 07 e 08): contrato 55.
- Assistente apagando email, criando regra, movendo por tarefa agendada (F4); renomear/apagar pasta pelo agente.
- Organizar mais de 200 mensagens por pedido (N7); organizar várias contas num lote só (um lote é de uma conta; pedido
  com duas contas vira dois lotes).
- MCP próprio do email para o agente (D1).

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.

## Telas de impacto no usuário
- **Chat do Assistente**: o passo "Organizando: X de Y lidos, Z movidos" atualiza ao vivo, e a resposta termina com o
  cartão do lote ("12 em Resolvidos, 5 em Pendentes", uma linha por assunto, **Desfazer as N**). Parar interrompe e
  mantém o que já foi movido. O desenho do cartão não está no mockup aprovado (D9).
- **Email**: as mensagens movidas saem da lista (pelo `scribe:email-changed` que o 52 já emite). O painel e a faixa
  chegam no 55.

## Decisões que a spec deixou em aberto (confirmar com o Andrew)
- D1 — **[decidir]** Ferramentas pelo registro `lap-ferramenta` de `assistant-tools.ts` (o que o plan diz e o que já
  existe), e não por um servidor MCP do app como o do navegador. Vantagem: funciona no CLI e no ACP, e o bloqueio da
  tarefa agendada é só não passar a lista. Custo: cada ferramenta é uma rodada inteira do modelo (por isso D2 e D3).
- D2 — **[decidir]** Duas ferramentas além das três da spec: `listar_conversas` (o `EMAILS.md` só tem 150 por conta e 30
  dias, e não agrupa o fio) e `informar_progresso` (já no plan); e `ler_email` com até 20 referências. Sem isso, as 200
  mensagens não cabem nas rodadas.
- D3 — **[decidir]** 40 rodadas no turno de organizar (contra 4 no resto). Com 20 conversas por leitura e 20 assuntos por
  mover, 200 mensagens cabem com folga. Custo maior de tokens nesse pedido.
- D4 — Desfazer vale por 7 dias e sobrevive ao reinício (20 lotes guardados). A faixa da tela de email mostra só os lotes
  de hoje (D7 do mockup); o cartão no chat mostra o Desfazer enquanto o lote existir.
- D5 — **[decidir]** Sem confirmação para lote grande: a spec não pede, o pedido no chat já autoriza e o teto é 200 por
  pedido com Desfazer. Alternativa: cartão "Mover 120 mensagens?" acima de 50.
- D6 — Desfazer com a pasta de origem sumida não recria a pasta: a mensagem fica onde está e o cartão diz quantas e por
  quê. (A INBOX nunca some, então o caso comum, organizar a Caixa de Entrada, sempre volta.)
- D7 — `mover_emails` não cria pasta sozinha: destino inexistente volta como erro e o agente chama `criar_pasta`. Assim
  um nome errado do modelo não vira pasta nova no servidor.
- D8 — Destinos proibidos: Lixeira, Spam, Enviados, Rascunhos e as virtuais do Gmail (`\All`, `\Flagged`,
  `\Important`). Arquivo (`\Archive`) pode.
- D9 — **[decidir]** O cartão do lote fica no 56 (como o plan), montado com os componentes de cartão que o chat já tem,
  conforme o CA12, sem mockup próprio. Alternativa: desenhar o cartão no mockup e passá-lo para o 55.
- D10 — Um lote por turno do chat; pedir de novo na mesma conversa abre outro lote (outro cartão, outro Desfazer).
