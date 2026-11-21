# Contrato 113: Detecção de oportunidade (canais, aplicar e disparo pós-resumo)

Feature `funil-vendas` · Wave 3 · Depende de: 110 e 111 commitados · Spec `../spec.md` (R38 disparo fora do smoke e evento, R39 e R40 no main, R47 canais `scribe:funil-proposta-*`; "Modelo de dados" reunião apagada) · Plan `../plan.md` (D4, D7, D8, D20) · Mockup: nenhum (sem tela; o cartão e o botão são do 116). **Você não commita.** Worktree `/Users/andrew/Documents/GitHub/meeting-scribe-funil-113` (branch `funil-113`, a partir da ponta da `funil-vendas`). Roda em paralelo com 112: você **não** edita `src/shared/routes.ts`, nada em `src/renderer/`, `resources/`, `smoke.ts` nem `smoke-fixtures.ts`.

## Pré-condições
- Leia os contratos 110 (`registerFunilIpc`, `FunilActionResult`, `FUNIL_ERRO_TEXTO`, store e serviço) e 111 (`FunilPropostaArquivo`, `createFunilProposalStore`, `createFunnelExtractService`, `detect`, `running`); na spec R38 a R40, R47 e o trecho de "Modelo de dados" sobre a proposta e a reunião apagada; no plan D8.
- No código: `src/main/index.ts` (`createSummaryService` `:1524-1550` com o `onStatus` e o ramo `status.state === 'ready'` `:1540-1545`; `handle('scribe:meetings-delete', …)` `:2068-2074`; `services.summary.dispose()` `:2609` e `:2702`; a linha `registerFunilIpc` do 110); `src/main/funil/ipc.ts` (do 110); `src/shared/ipc.ts` (`InvokeChannels`, `INVOKE`, `WHEN_LOCKED`, `MainEvents`, `MAIN_EVENTS`); `src/main/invites/suggest.ts` (como o serviço recebe `locate`, `openAcp`, `spawn` em `index.ts`).

## Superfície

### Tipos (`src/shared/funil-proposta.ts`, acréscimos)
- `FunilPropostaView { arquivo: FunilPropostaArquivo | null; detectando: boolean; duplicata: { id: string; titulo: string } | null }` (`duplicata`: com `acao: 'criar'`, a primeira oportunidade aberta não arquivada da empresa da proposta, achada por nome sem acento e sem caixa; senão `null`).
- `FunilPropostaCampos { titulo: string; empresa: string | null; contatos: { nome: string; email: string | null }[]; etapaId: string; valor: number | null /* centavos */; previsao: string | null; proximoPasso: { texto: string; data: string | null } | null }`.
- `FunilPropostaAplicarRequest { meetingId: string; campos: FunilPropostaCampos; vincularA?: string }` e `FunilPropostaAplicarResult = { ok: true; oportunidadeId: string } | { ok: false; erro: FunilErro; mensagem: string }`.

### Fluxo (`src/main/funil/apply-proposal.ts`, novo)
- `applyProposal(deps, request)` com `deps = { store: FunilStore; proposals: FunilProposalStore; meetings: Pick<MeetingsStore, 'get'>; now? }`:
  1. Exige `meetings/<id>.funil.json` com `status: 'proposed'`; senão `{ ok: false, erro: 'invalido', mensagem: 'Essa proposta já foi decidida.' }` (ou `nao-encontrado` sem arquivo).
  2. Para cada contato de `campos.contatos` com e-mail (o que veio da proposta ou o que a pessoa preencheu no cartão): `store.saveContato({ nome, emails: [email], telefones: [] }, 'reuniao')` (cria ou mescla, R4) e guarda o id. Contato sem e-mail não é criado e não entra em `contatoIds`; os nomes deles viram, depois do passo 6 de criar ou atualizar, um `EventoFunil` `nota` com o texto "Citados na reunião: <nome>, <nome>" (R39).
  3. Com `vincularA`: a oportunidade precisa existir e estar em etapa `aberta` (`nao-encontrado` senão); acrescenta `meetingId` a `meetingIds` e os contatos novos a `contatoIds`, nada mais.
  4. Com `proposta.acao === 'atualizar'` e `oportunidadeId`: etapa diferente → `moverOportunidade` (R6); `proximoPasso` substituído; `valor` substituído só se não for `null`; `meetingId` e contatos acrescentados.
  5. Senão (`criar`): `saveOportunidade({ titulo, empresaNome: empresa, contatoIds, etapaId, valor, previsao, proximoPasso, meetingIds: [meetingId], origem: 'reuniao' })` (D20 para a empresa).
  6. Grava o arquivo com `status: 'accepted'` e `oportunidadeId`; devolve `{ ok: true, oportunidadeId }`. Erro do store em qualquer passo devolve o erro com `FUNIL_ERRO_TEXTO` e deixa o arquivo `proposed`.
- `dismissProposal(deps, meetingId)`: `proposed` → `dismissed` (sem `erro`); outro estado → `{ ok: false, erro: 'invalido' }`.
- `autoDetect(deps, meetingId)` com `deps = { settings: () => Promise<{ funil: FunilSettings }>; proposals; extract; smoke: boolean }`: roda `extract.detect` só se `smoke` é falso (R38: no smoke a detecção automática não roda), `funil.detectarNasReunioes` está ligado, não existe arquivo da reunião e `extract.running(meetingId)` é falso (D8); devolve se disparou.

### Canais (`src/shared/ipc.ts`) e handlers (`src/main/funil/ipc.ts`)
- `scribe:funil-proposta-get` (`{ meetingId }` → `FunilPropostaView`), `scribe:funil-proposta-aplicar` (`FunilPropostaAplicarRequest` → `FunilPropostaAplicarResult`), `scribe:funil-proposta-descartar` (`{ meetingId }` → `{ ok: boolean }`), `scribe:funil-proposta-detectar` (`{ meetingId }` → `FunilPropostaView` na hora, com `detectando: true`; o resultado chega pelo evento). Todos em `INVOKE` e `WHEN_LOCKED` com **`'refused'`** (R47). Pedido fora do formato → resposta de recusa tipada, sem lançar.
- Evento `MainEvents['scribe:funil-proposta-changed']: { meetingId: string }` em `MAIN_EVENTS` (R38, R47), emitido pelo `onChange` do serviço de extração e depois de aplicar ou descartar.
- `registerFunilIpc` passa a receber `funnel` (o serviço do 111), `proposals` e as funções acima; o detectar manual chama `extract.detect` mesmo com `detectarNasReunioes` desligado (R40) e mesmo com arquivo já existente (substitui).

### `src/main/index.ts` (ligações de uma linha cada)
- Em `createAppServices`: `createFunilProposalStore` e `createFunnelExtractService` com as mesmas `locate`/`openAcp`/`spawn`/`userData`/`baseEnv` do resumo, `onChange` → `broadcast(appWindows(), 'scribe:funil-proposta-changed', { meetingId })`; campo `funnel` em `AppServices`.
- No `onStatus` do resumo, dentro do ramo `status.state === 'ready'`: `void autoDetect({ …, smoke: smokeFixtures !== null }, meetingId).catch(() => undefined)` (o resumo nunca espera a detecção).
- Em `scribe:meetings-delete`, com `deleted`: `await proposals.remove(id).catch(() => undefined)`. `Oportunidade.meetingIds` **não** muda: o id fica e a linha do tempo mostra "Reunião apagada" (modelo de dados; contratos 110 e 119).
- Ao sair, ao lado de `services.summary.dispose()` (`:2609`, `:2702`): `services.funnel.dispose()`.

## Critérios de aceite
- **CA1** `test/funil-proposta.test.ts`: dado um arquivo `proposed` com `acao: 'criar'`, contatos `[{ nome: 'Marina Rocha', email: 'marina.rocha@cliente.example' }, { nome: 'Sem Email', email: null }]` e um contato já existente com `marina.rocha@cliente.example`, quando `applyProposal`, então nenhum contato novo é criado (mescla), a oportunidade nova tem `origem: 'reuniao'`, `meetingIds: [id]`, `contatoIds` com 1 id, a empresa "Cliente" existe, e o arquivo fica `accepted` com o `oportunidadeId`.
- **CA2** Dado um arquivo `proposed` com `acao: 'atualizar'` para uma oportunidade em Descoberta e `campos.etapaId` de Proposta, quando `applyProposal`, então a oportunidade está em Proposta com um evento `etapa` (`de: 'Descoberta'`, `para: 'Proposta'`), `proximoPasso` novo e `meetingIds` contendo a reunião; com `campos.valor: null`, o valor antigo fica.
- **CA3** Dado `vincularA` de uma oportunidade em `ganho`, quando `applyProposal`, então `{ ok: false, erro: 'nao-encontrado' }` e o arquivo continua `proposed`; com `vincularA` de uma aberta, só `meetingIds` e `contatoIds` mudam.
- **CA4** Dado um arquivo `accepted`, quando `applyProposal` de novo, então recusa com "Essa proposta já foi decidida." e o `funil.json` não muda; `dismissProposal` num `proposed` grava `dismissed`.
- **CA5** `autoDetect`: com `smoke: true` não chama `detect` (mesmo com tudo ligado); com `detectarNasReunioes: false` não chama; com `true` e sem arquivo chama uma vez; com arquivo `dismissed` já existente não chama; com `running` verdadeiro não chama.
- **CA9** (R39) Dado um arquivo `proposed` com contatos `[{ nome: 'Marina Rocha', email: 'marina.rocha@cliente.example' }, { nome: 'Carlos Dias', email: null }, { nome: 'Bia Souza', email: null }]` e `campos.contatos` em que a pessoa preencheu `bia@cliente.example` para Bia, quando `applyProposal`, então são criados ou mesclados os contatos de Marina e Bia (com `origem: 'reuniao'`), Carlos não é criado, e a oportunidade tem um `EventoFunil` `nota` com o texto exato "Citados na reunião: Carlos Dias".
- **CA10** (R39) `scribe:funil-proposta-get` de uma proposta `criar` com empresa "Cliente", existindo `op-x` aberta da empresa Cliente, devolve `duplicata: { id: 'op-x', titulo }`; sem oportunidade aberta da empresa, ou com `acao: 'atualizar'`, devolve `duplicata: null`.
- **CA11** (modelo) Dada uma reunião ligada a uma oportunidade, quando `scribe:meetings-delete` apaga a reunião, então `meetings/<id>.funil.json` some e o id continua em `meetingIds`.
- **CA6** `test/lock-ipc.test.ts` verde com os quatro canais novos recusados quando bloqueado.
- **CA7** (R38: "nunca bloqueia o resumo") Dado o `onStatus` do resumo, a chamada de `autoDetect` não tem `await` no caminho que faz o `broadcast` de `scribe:summary-state` (leitura do diff de `index.ts`), e uma rejeição de `autoDetect` não lança (`.catch`).
- **CA8** Dado o handler de `scribe:meetings-delete` com `deleted === true`, então `proposals.remove(id)` é chamado (teste do fluxo ou leitura do diff; diga qual no relatório).

## Invariantes
- O `onStatus` do resumo continua fazendo o que faz hoje (acervo, Drive, `scribe:summary-state`), na mesma ordem.
- Os canais e políticas de bloqueio existentes não mudam; os 15 canais do 110 continuam iguais.
- Nada no renderer muda; `smoke.ts` não muda; prints e `expectedShots` iguais.
- Nada entra no funil sem um pedido `aplicar` (nenhum caminho automático chama `applyProposal`).

## Fora de escopo desta tarefa
Cartão "Oportunidade detectada", botão "Detectar oportunidade" e o store do renderer (116); prompt e serviço de extração (111, já prontos).

## Gates
`cd /Users/andrew/Documents/GitHub/meeting-scribe-funil-113 && SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde. Teste novo `test/funil-proposta.test.ts` (CA1 a CA5, CA9 a CA11, com store em diretório temporário e extração falsa); `test/lock-ipc.test.ts` verde.

## Relatório final (formato)
Arquivos; gates (contagens); os quatro canais e o evento com tipos; linhas mexidas em `index.ts` (números e uma frase cada); diferenças em relação ao contrato e por quê.
