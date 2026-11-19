# Contrato 53 — Regras de email: condições, ações, "Executar agora" e limpeza dos corpos órfãos

> Aprovado pelo Andrew em 19/11/2026, com as decisões D1–D11 como propostas.
Feature: email-organizacao · Wave: 2 · Depende de: 52, 54 · Spec: `docs/specs/email-organizacao/spec.md` (R4, R5, N1, N2, N3, N5, N6, F1, F4, F5) · Plan: `docs/specs/email-organizacao/plan.md`

Pedido do Andrew (19/11/2026 13:00): "regras que agem sozinhas no email que chega". Este contrato é só o main + preload +
IPC + testes. O editor de regras, a lista com "último erro" e o diálogo do "Executar agora" são do contrato 55; aqui NÃO
se mexe no renderer além do mínimo para compilar (tipos novos no `window.scribe`).
Inclui o achado **N2 da revisão delta do 52** (corpos órfãos em `<conta>.bodies/` quando a mensagem sai pelo teto).

## Pré-condições
- **O 53 só começa depois do commit do 54** na branch `email-organizacao`. O 54 mexe nos mesmos arquivos
  (`main/settings/schema.ts`, `main/settings/store.ts`, `shared/ipc.ts`, `main/email/service.ts`); começar antes dá
  conflito. Conferir com `git log --oneline -3` que o commit do 54 está lá e que `git status` está limpo.
- Contrato 52 commitado (b624852): `mailbox` por mensagem, `listFolders`, `moveMessages`/`moveQueued`, `folderEntries`,
  `forgetFolder`, `renameFolder`, `deleteFolder`, `store.updateFolder` com teto de 30 pastas, `bodyKey`.
- Ler antes: `apps/desktop/src/main/email/{service,email-store,imap-client,fake-email,notify,assistant-tools}.ts`,
  `apps/desktop/src/shared/{email,email-signature,ipc}.ts`, `apps/desktop/src/main/settings/{schema,store}.ts` (o desenho
  de `emailSignatures` do 54 é o modelo de `emailRules`), o registro do email em `main/index.ts` (`onMessage` →
  broadcast + `emailNotifier.receive`) e os testes `apps/desktop/test/email-{service,folders,notify,signature}.test.ts`.

## Critérios de aceite
- CA1 — Tipos e esquema. Em `shared/email-rules.ts`:
  `EmailRule = { id: uuid; name: string (1–100, sem CR/LF); enabled: boolean; match: 'all' | 'any';
  conditions: EmailRuleCondition[] (1–10); actions: EmailRuleActions; stopHere: boolean }`;
  `EmailRuleCondition = { field: 'from' | 'to' | 'subject' | 'body'; value: string (1–200, sem CR/LF) } | { field: 'hasAttachment' }`;
  `EmailRuleActions = { moveTo: string | null; markRead: boolean; flag: boolean; delete: boolean; silent: boolean }`.
  Zod `.strict()` em tudo. Recusado (`invalid`): nenhuma ação ligada; `delete` junto com `moveTo`; `moveTo` fora de
  `folderPathSchema` ou igual a `INBOX`; regra sem condição (não existe "todas as mensagens" — ver decisão D3).
  Constante `EMAIL_RULES_MAX = 50` por conta. Padrões de uma regra nova: `enabled: true`, `stopHere: false`, todas as
  ações `false`/`null` (nenhuma regra nasce apagando).
- CA2 — Settings, no desenho do 54: `emailRules: Record<accountId, EmailRule[]>` ao lado de `emailAccounts` e
  `emailSignatures` em `settings.json` (fora de `settings`, só o main grava). `SettingsStore.getEmailRules()` e
  `setEmailRules(accountId, rules)` (lista inteira, na ordem; conta inexistente → `false`; fora do formato lança e nada
  é gravado). Leitura leniente: regra inválida no arquivo sai sozinha sem levar as outras; conta que saiu leva as regras
  junto (`setEmailAccounts` filtra, como faz com as assinaturas). Ids repetidos na lista → `invalid`. Mais de 50 → `invalid`.
- CA3 — Módulo puro `main/email/rules.ts`, sem IMAP, sem disco, sem relógio:
  - `matchRule(message: EmailRuleInput, rule): boolean` — `EmailRuleInput = { from, to, cc, subject, body: string | null,
    hasAttachment: boolean | null }`. "Contém" é sem diferenciar maiúsculas, com `normalize('NFC')` dos dois lados.
    `from` olha nome e endereço do remetente; `to` olha nome e endereço de To **e** Cc; `body` olha o texto (ou o HTML
    reduzido a texto); `match: 'all'` exige todas, `'any'` basta uma. Condição de corpo/anexo com `body`/`hasAttachment`
    `null` (não deu para ler) **não casa**. Regra `enabled: false` nunca casa.
  - `planActions(message, rules): EmailRulePlan` → `{ ruleIds: string[]; markRead; flag; moveTo: string | null;
    delete: boolean; silent: boolean }`, percorrendo as regras **na ordem**: as marcas (`markRead`, `flag`, `silent`) se
    somam; a primeira regra que casa com `moveTo` ou `delete` decide o destino e **encerra** (a mensagem saiu da INBOX);
    `stopHere` encerra também. Nenhuma regra casou → plano vazio (`ruleIds: []`).
  - `needsBody(rules): boolean` — alguma regra ligada tem condição `body` ou `hasAttachment`.
- CA4 — Aplicação na chegada (R4), em `service.ts`. As regras rodam **exatamente** nas mensagens que hoje viram
  `onMessage`: IMAP em `fetchNew` (fora as que entraram por "Mover", `movedIn`), POP3 no `announceAdded` (fora o primeiro
  poll). **Não** rodam no `syncInbox` da conexão/reconexão nem em pastas que não a INBOX (N1: email que chegou com o app
  fechado não é tocado; o "Executar agora" cobre isso). Ordem por mensagem: (1) se `needsBody`, baixa o corpo (IMAP
  `session.source`, limite `EMAIL_RAW_MAX_BYTES`, guardado com `store.setBody` como o `body()` já faz; grande demais ou
  ilegível → `body`/`hasAttachment` `null`); (2) `planActions`; (3) `markRead` → `setSeen`; `flag` → `setFlagged` (novo
  em `ImapSession`: `UID STORE +FLAGS (\Flagged)`); (4) `moveTo` → o mover interno; `delete` → mover para a pasta
  `\Trash` do `LIST` (N3: nunca `\Deleted` + `EXPUNGE`); (5) só então `onMessage`.
  **Atenção ao deadlock**: `fetchNew` já roda dentro de `enqueue(rt, …)`; a regra chama `moveQueued` (o corpo do mover,
  já na fila), nunca `moveMessages` (que enfileira de novo e travaria a conta). Mensagens de um mesmo lote com o mesmo
  destino vão num `MOVE` só (até `EMAIL_MOVE_MAX`).
- CA5 — Aviso. `EmailServiceDeps.onMessage(message, options: { notify: boolean })`. `notify: false` quando o plano tem
  `silent` **ou** `delete`; nos outros casos `true` (mover e marcar lida ainda avisam — decisão D5). O `index.ts` segue
  fazendo o broadcast `scribe:email-message` sempre e só chama `emailNotifier.receive` com `notify: true`. A mensagem
  entregue ao `onMessage` é a do estado final: movida → `mailbox` do destino e o UID novo quando o `COPYUID` veio
  (sem ele, `uid: null` e o id da origem; abrir a partir do aviso é do 55).
- CA6 — Falha não some com o email (N6). Cada etapa que falha deixa a mensagem onde está (INBOX) e grava o "último erro"
  da regra responsável; as etapas que já deram certo ficam (ex.: marcou lida, o mover falhou → lida na INBOX). Códigos:
  `folder-missing` (o `moveTo` não está no `LIST` ou é `\Noselect`; nem tenta o `MOVE`), `no-trash` (apagar sem pasta
  `\Trash`; nem tenta), `unavailable` (sem conexão / `LIST` não veio e o `MOVE` falhou por conexão), `server` (o servidor
  recusou), `pop3` (ação que o POP3 não tem — só por arquivo antigo/editado à mão). Uma falha de regra nunca impede o
  `onMessage` da mensagem nem as regras das outras mensagens, e nunca derruba a conta (o erro de uma regra não vira
  `state: 'error'`). Nada do conteúdo do email (assunto, remetente, corpo) vai ao log nem ao "último erro".
- CA7 — Estado das regras (fora do settings, para não regravar `settings.json` a cada email): arquivo
  `userData/email/<conta>.rules-state.json` (0600, gravação atômica, na fila da conta do `email-store`):
  `{ version: 1, rules: Record<ruleId, { lastError: { at, code } | null; lastRunAt: number | null; hits: number }> }`.
  Sucesso da regra limpa o `lastError` dela. Regra apagada sai do estado no próximo `setEmailRules`. `store.remove`
  (conta saiu) apaga o arquivo. Arquivo ausente ou inválido vale como vazio.
- CA8 — Pasta destino que some ou muda (spec N6):
  - **Renomeada pelo app** (`renameFolder` com sucesso): toda regra da conta com `moveTo` igual ao path antigo, ou dentro
    dele (prefixo `path + delimitador`), passa a apontar para o path novo, na mesma gravação; `lastError` dela limpo.
  - **Apagada pelo app** (`deleteFolder` com sucesso): as regras que apontavam para ela (ou para uma de dentro) **não**
    são apagadas nem desligadas; ficam com `lastError: folder-missing` na hora, e a próxima chegada que casar fica na INBOX.
  - **Sumiu por fora** (renomeada/apagada no webmail): descoberto na hora de aplicar, pelo `LIST` (CA6 `folder-missing`).
    O `LIST` guardado é relido uma vez antes de dar o erro (a pasta pode ter acabado de ser criada).
  - Nenhum caminho do app apaga, desliga ou reescreve uma regra sozinho, fora o rename acima (decisão D6).
- CA9 — Ao gravar (`setEmailRules`) com a conta conectada e o `LIST` disponível: `moveTo` que não existe → `folder-missing`;
  `delete` sem `\Trash` no servidor → `no-trash` (N3: "sem Lixeira, a ação fica desligada"); conta POP3 com `moveTo`,
  `flag` ou `delete` → `pop3` (N2 da spec: no POP3 só `markRead` e `silent`). Sem o `LIST` (offline), grava e a checagem
  fica para a hora de aplicar (CA6).
- CA10 — "Executar agora" (R5), em dois passos, no caminho interno `previewRule(accountId, ruleId)` e
  `runRule(accountId, ruleId, token)`:
  - `previewRule` aplica **só aquela regra** (ignora `stopHere`, `silent` e as outras) às mensagens da INBOX guardada
    (as até 200 do store), baixando o corpo das que faltam quando a regra precisa (sequencial, cada uma no limite de
    `EMAIL_RAW_MAX_BYTES`, guardado). Devolve `{ ok: true, count, actions: { markRead, flag, moveTo, delete }, token }`.
    Nada muda no servidor nem no store (fora os corpos baixados).
  - `runRule` só executa com o `token` do preview: uso único, vale 2 min, preso ao `accountId`, ao `ruleId`, à regra
    **como estava** (hash do JSON) e à lista exata de ids do preview. Regra mudou, token vencido/gasto/de outra conta →
    `stale` e nada acontece. Executa só nas mensagens do preview que ainda estão na INBOX, em lote (marcas por UID,
    `MOVE` único por destino), e devolve `{ ok: true, done, skipped }`. Falha grava o `lastError` (CA6).
  - Regra desligada também pode ser executada à mão. POP3: só `markRead` (local, como o "Marcar lida" de hoje).
- CA11 — Corpos órfãos (achado **N2** da revisão delta do 52). Hoje o corpo (`<hash>.json`) e a mensagem inteira
  (`<hash>.eml`) em `<conta>.bodies/` ficam no disco quando a mensagem sai da lista pelo teto: `capInbox` no
  `syncInbox`/`fetchNew`/`moveQueued`/POP3, o `slice` dos enviados, e a pasta que sai do teto de 30 em
  `store.updateFolder` (o arquivo da pasta sai, os corpos não). Correção:
  - `EmailStore.pruneBodies(accountId, keep: Iterable<string>)`: na fila da conta, apaga de `<conta>.bodies/` todo
    `.json`/`.eml` cujo nome não é o hash de uma chave de `keep`; arquivo `.tmp-*` com mais de 10 min também sai;
    pasta ausente não é erro. Devolve quantos apagou.
  - O serviço calcula `keep` = `bodyKey` de toda mensagem da INBOX, dos enviados e de toda pasta guardada
    (`folderPaths` + `folder`), e chama `pruneBodies`: depois de cada `syncInbox`, depois de `fetchNew`/poll POP3 que
    tirou alguém pelo teto, depois de `updateFolder` que tirou pasta pelo teto, e uma vez no `init()` por conta
    (limpa o que a 0.15.0 e o 52 já deixaram).
  - Nunca apaga o corpo ou o `.eml` de mensagem que ainda está em alguma lista (em especial os `.eml` dos enviados e do
    POP3, que são a única cópia). Um `setBody` em andamento para uma mensagem que já saiu da lista pode sobrar até a
    próxima limpeza; isso é aceito.
- CA12 — IPC no padrão do `service.ts` (zod `.strict()`, `accountId` validado, erros tipados
  `missing | pop3 | invalid | folder-missing | no-trash | stale | unavailable | server`):
  `scribe:email-rules-get { accountId }` → `{ ok: true, rules, state }`;
  `scribe:email-rules-set { accountId, rules }` → `{ ok: true, rules }`;
  `scribe:email-rules-preview { accountId, ruleId }`; `scribe:email-rules-run { accountId, ruleId, token }`.
  Os quatro entram no mapa de canais e, no mapa do bloqueio, como `'refused'` (igual ao resto do email). Nenhum envia
  email; não usam token de clique. Nenhum deles é exposto ao Assistente: `assistant-tools.ts` e o MCP do agente não
  ganham nada de regra (spec N4/F4), com teste estático.
- CA13 — `fake-email.ts` ganha `STORE \Flagged`, pasta `\Trash` (e um modo sem ela) e o que faltar para os testes e o smoke.
- CA14 — Testes de unidade (`test/email-rules.test.ts` e acréscimos em `email-service.test.ts`/`email-folders.test.ts`):
  - `matchRule`: cada campo; maiúsculas/minúsculas; NFC; `all` × `any`; `to` acha no Cc; corpo `null` não casa; desligada.
  - `planActions`: ordem; marcas somadas; primeiro mover vence e encerra; `stopHere`; apagar encerra; nada casou.
  - Esquema: ações vazias, apagar + mover, `moveTo: INBOX`, sem condição, 51 regras, id repetido, CR/LF → `invalid`.
  - Chegada no IMAP falso: regra move (sai da INBOX, entra no destino, uma conexão de `MOVE` por destino); marca lida;
    estrela; apagar vai para a Lixeira (e o servidor não recebeu `EXPUNGE` na INBOX fora o do próprio `MOVE`); sem Lixeira
    → fica, `no-trash`; `silent` e `delete` → `onMessage` com `notify: false`; mover → `notify: true`.
  - Sem deadlock: chegada com regra de mover termina (timeout de teste curto) e o próximo IDLE é processado.
  - Destino sumiu por fora → fica na INBOX, `folder-missing`, `onMessage` chamado; rename pelo app atualiza a regra (e as
    de subpasta); apagar pelo app deixa a regra com `folder-missing` sem apagá-la.
  - Não roda no `syncInbox`, no primeiro poll POP3, nem no que entrou por "Mover".
  - POP3: `markRead` e `silent` funcionam; gravar `moveTo` → `pop3`.
  - "Executar agora": preview conta certo sem mudar nada; `runRule` com token ok; token gasto, vencido, de outra conta e
    com a regra editada no meio → `stale` sem efeito; mensagem que saiu da INBOX entre os dois passos → `skipped`.
  - Estado: `lastError` grava e limpa no sucesso; conta removida apaga `rules-state.json`; nenhum assunto/remetente no
    arquivo nem no log.
  - Órfãos: 205 mensagens com corpo → depois do teto sobram 200 corpos; 31ª pasta aberta → corpos da pasta que saiu
    apagados; `.eml` dos enviados e do POP3 ainda listados ficam; `init()` limpa sobra antiga; `.tmp-*` velho sai.
  - Settings: leitura leniente; conta removida leva as regras.
- CA15 — Smoke: o servidor falso recebe um email que casa com uma regra "mover para Arquivo"; o smoke confere que ele
  está em `Arquivo` e não na INBOX (sem tela nova; o print da aba Email é do 55).

## Invariantes
- Nenhuma regra apaga sem a ação explícita da pessoa: não há regra padrão, `delete` nasce `false`, só o IPC
  `scribe:email-rules-set` (o renderer, pelo editor do 55) grava regras, e o "Executar agora" só age com o token do
  preview que mostrou a contagem. Apagar por regra é sempre mover para a Lixeira (N3), nunca `EXPUNGE`.
- O Assistente não cria, edita, roda nem lê regras (N4/F4). Tarefa agendada também não.
- Regra não dispara no envio (F5) nem fora da INBOX.
- Caixa de Entrada, Enviados, IDLE, notificações (fora o `notify: false` pedido pela regra), envio, assinatura (54),
  `buscar_emails`, `ler_email`, contrato 51 e contrato 52: tudo igual. Sem regra gravada, o comportamento é o da 0.15.0 + 52.
- Nenhum segredo novo; regras e estado ficam só no disco local (N5), nunca no servidor (F1).

## Fora de escopo
- Editor de regras, lista com "último erro", diálogo do "Executar agora", aviso "só com o app aberto" (N1), bloqueio
  visual das ações no POP3 e sem Lixeira: contrato 55.
- Regras no servidor (Sieve, Gmail, Exchange) — F1. Regra no envio — F5. Assistente com regra — F4.
- Condições por data, tamanho, cabeçalho livre ou expressão regular; ação "copiar", "encaminhar", "responder".
- Reordenar por arrastar (o 55 manda a lista inteira na ordem nova pelo `rules-set`).

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.

## Telas de impacto no usuário
- Nenhuma tela nova neste contrato (as telas são do 55). O que muda para quem usa, já aqui: email que chega e casa com
  uma regra é movido/marcado/levado à Lixeira sozinho, e o aviso some quando a regra pede "não avisar".

## Decisões que a spec deixou em aberto (confirmar com o Andrew)
- D1 — "Último erro" e contadores ficam em `userData/email/<conta>.rules-state.json`, não no `settings.json` (evita
  regravar o settings a cada email).
- D2 — "Contém" sem diferenciar maiúsculas; **com** diferença de acento ("relatorio" não acha "relatório").
- D3 — Regra exige ao menos uma condição (não há "aplicar a todas as mensagens"), para nenhuma regra de apagar pegar tudo.
- D4 — Primeira regra com mover/apagar encerra a lista (a mensagem saiu da INBOX); marcas de regras anteriores valem.
- D5 — Mover e marcar lida ainda avisam; só "não avisar" e "apagar" calam a notificação.
- D6 — Pasta destino apagada não apaga nem desliga a regra: ela fica com "último erro" até a pessoa trocar o destino.
  Rename feito pelo app atualiza a regra sozinho; rename feito no webmail aparece como `folder-missing`.
- D7 — Email que chegou com o app fechado (pego no `syncInbox`) não passa pelas regras; só pelo "Executar agora".
- D8 — Corpo grande demais ou ilegível: condição de corpo/anexo não casa (conservador).
- D9 — "Executar agora" baixa os corpos que faltam quando a regra olha corpo/anexo (pode levar alguns segundos com 200).
- D10 — Token do "Executar agora" vale 2 min e só para a lista exata mostrada no preview.
- D11 — Limpeza de órfãos roda no `init()` de cada conta, além de depois de cada corte pelo teto.
