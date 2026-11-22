# Contrato 126: Reunião › Resumo, E-mail e WhatsApp (+ Tarefa)

Feature `tarefas` · Wave 5 · Depende de: 123 e 125 commitados e mesclados · Spec `../spec.md` (R21 na tela e na fixture, R22, R23, R24, R25; CA8, CA9; CA17 parte) · Plan `../plan.md` (D13, D17, D18; D-5, D-16) · Mockup `../mockups/Tarefas.dc.html` (artboards **10 Reunião › Resumo com Adicionar e o estado da tarefa**, **11 Email › leitura com + Tarefa**, **12 WhatsApp › Detalhes com + Tarefa**; vale a seção "Alinhamento com o mockup" da spec para R22, R24 e R25). **Você não commita.** Worktree `/Users/andrew/Documents/GitHub/meeting-scribe-tarefas-126` (branch `tarefas-126`). Único contrato da wave 5: você é o dono de `src/main/smoke.ts` e `src/main/smoke-fixtures.ts`.

## Pré-condições
- **Os três artboards acima aprovados pelo Andrew.** Sem aprovação, pare e avise. Texto e medidas do artboard prevalecem; regra e `data-*` do contrato prevalecem sobre o artboard.
- Leia na spec R21 a R25, CA8 e CA9; no plan D13, D17, D18, D-5, D-16; os contratos 121 (`SummaryTask.dueIso`, `<data_da_reuniao>`, `casaComResumo`, `slugTexto`), 122 (`adicionarDoResumo`, `criar`, `status`, R9 no serviço) e 123 (`TarefaLinha`, `NovaTarefaInline` e suas props, `tarefasPath`, "Abrir e-mail"/"Abrir conversa" do detalhe).
- No código: `features/meetings/SummaryTab.tsx` (tabela "Tarefas" `:248-275`, "Gerar de novo" `:205`); `features/email/ReadingPane.tsx` ("+ Contato" ao lado do remetente `:147,259-268`); `features/whatsapp/DetailsPanel.tsx` (bloco Contato `:41-85`); `features/funil/ContactLink.tsx` (`contatoLigado`, `useFunilCompartilhado`, para achar o contato do remetente ou da conversa); `test/fixtures/fake-claude.mjs:356-366` e `test/fixtures/fake-acp-agent.mjs:598-606` (as duas tarefas do resumo falso).
- Smoke: `funilTelasExistentesChecks` `smoke.ts:13023` (abre um e-mail do servidor falso de um contato e uma conversa do WhatsApp falso: use os mesmos caminhos), `funilAssistenteChecks` `:13364`, ordem dos blocos `:15082-15087`, `expectedShots` `:15254`; as duas reuniões gravadas no laço por tema (uma por tema, ambas com o resumo falso).

## Superfície

### Reunião › Resumo (R21 a R23)
- `SummaryTab.tsx`, tabela `data-summary-tasks`: coluna de estado de **32 px à esquerda** (vazia sem tarefa; a caixa de feito com tarefa) e coluna de ação à direita. Linha sem tarefa casada (`casaComResumo(tarefa, meetingId, task.task)` sobre `useTarefasView()`) → à direita, `Button` de 28 px "Adicionar" (`data-action="tarefa-resumo-adicionar"`, `data-summary-task-index="<i>"`) que chama `adicionarDoResumo({ meetingId, indices: [i] })`; linha casada → na coluna da esquerda a caixa de feito ligada à tarefa (`data-tarefa-feito`, clique alterna `feita`/`aberta` pelo `status`) e, à direita, o ícone que abre a tarefa (`data-tarefa-link`, `ActionButton` de 28 px) para `tarefasPath(id)`; a linha recebe `data-summary-task-tarefa="<id>"`.
- No título da seção "Tarefas": "Adicionar as minhas" (`data-action="tarefa-resumo-minhas"`) quando existe linha com `owner === 'Você'` ainda não casada → `adicionarDoResumo({ meetingId, indices: 'minhas' })`; sem nenhuma, o botão não aparece. Erro do canal em `Note` abaixo da tabela.
- Prazo: com `dueIso`, a célula mostra a data real "dd/mm" e, ao lado em `--text-muted`, o que foi dito ("sexta-feira"); sem `dueIso`, o `due` como hoje.
- "Gerar de novo" não apaga nada (R23): as linhas novas que casarem pelo texto continuam ligadas.

### Email › leitura (R24)
- `ReadingPane.tsx`: "+ Tarefa" (`data-action="email-tarefa"`, `aria-pressed` e o estado pressionado enquanto o formulário está aberto) no cabeçalho, à direita, ao lado da data (também quando o remetente já é contato); abre numa caixa entre o cabeçalho e o corpo do e-mail um `NovaTarefaInline` com `tituloInicial` = assunto (até 200), prazo vazio, `origem { tipo: 'email', accountId, id, assunto }`, `vinculosIniciais { email: { accountId, id, assunto, mailbox } , contatoIds: [contato do remetente] quando existe }` (a oportunidade entra pela R9 no serviço), com a frase do vínculo acima dos campos ("Ligada a <contato> · <oportunidade>", calculada com a view do funil já carregada no renderer pela mesma regra R9; sem contato, "Ligada a este e-mail"); "Criar"/"Cancelar". Criada, o formulário fecha e o botão mostra por 3 s "Tarefa criada" com o link para `tarefasPath(id)` (`data-email-tarefa-criada`).
- Mensagem de uma das contas do usuário: o botão aparece (diferente do "+ Contato").

### WhatsApp › Detalhes (R25)
- `DetailsPanel.tsx`, bloco Contato: só "+ Tarefa" (`data-action="whatsapp-tarefa"`; o texto "N abertas com ele" do mockup não entra) nas duas variantes (com e sem contato ligado), abrindo `NovaTarefaInline` com título vazio, `origem { tipo: 'whatsapp', chatId }`, `vinculosIniciais { whatsappChatId: chat.id, contatoIds: [contato ligado] quando existe }`; "Criar"/"Cancelar"; criada, o mesmo aviso de 3 s com link.

### Fixtures do resumo falso (R21)
`test/fixtures/fake-claude.mjs` e o resumo de `test/fixtures/fake-acp-agent.mjs`: a tarefa "Revisar a transcrição da reunião" (due "sexta-feira") ganha `dueIso` = a próxima sexta-feira **depois** da data de `<data_da_reuniao>` do pedido (sem o bloco, `null`); a outra, `dueIso: null`.

### Smoke (dono na wave 5)
Bloco novo `tarefasTelasExistentesChecks` logo depois de `funilTelasExistentesChecks` (`:15082`) e antes de `funilAssistenteChecks`, com os mesmos e-mail e WhatsApp falsos conectados. Checks (medem por id; nenhum título no `detail`):
- `resumoTarefas` (CA8, R22): das duas reuniões gravadas, use a que não tem nenhuma linha casada (o 123 pode ter adicionado no máximo uma sugestão de uma delas); na aba Resumo, a linha 0 mostra "Adicionar" e a célula de prazo com a data real; print **`detalhe-resumo-tarefas`** (claro e escuro, com a tabela antes de adicionar); "Adicionar" na linha 1 (dono = participante) → tarefa com `origem reuniao` daquele `meetingId`, `responsavel` `nome` (ou `contato` se o nome casar, D-16) e a linha passa a ter `data-summary-task-tarefa`; "Adicionar as minhas" → cria só a linha 0 (`owner 'Você'`), com `prazo === dueIso`; clicar a caixa da linha 0 → `status: 'feita'` em `tarefas.json`; o botão "Adicionar as minhas" some.
- `resumoGerarDeNovo` (R23): "Gerar de novo" na mesma reunião, esperar o resumo pronto → as duas tarefas continuam em `tarefas.json` e as duas linhas continuam com `data-summary-task-tarefa` (mesmos ids).
- `emailTarefa` (CA9, R24): ler o e-mail do contato usado pelo 116; "+ Tarefa" → formulário com o assunto no título; print **`email-leitura-tarefa`** (claro e escuro, formulário aberto); "Criar" → tarefa com `vinculos.email.accountId/id/assunto` da mensagem e o contato do remetente em `contatoIds`; abrir a tarefa em `/tarefas/<id>` → "Abrir e-mail" leva à tela Email com a mensagem aberta.
- `whatsappTarefa` (CA9, R25): conversa de uma pessoa nos Detalhes; "+ Tarefa", título "Ligar de volta" → print **`whatsapp-detalhes-tarefa-light`** (só claro, formulário aberto) → "Criar" → tarefa com `vinculos.whatsappChatId` da conversa; no detalhe da tarefa, "Abrir conversa" leva a `/whatsapp` com a conversa aberta.
- Apague no fim as tarefas criadas por `emailTarefa` e `whatsappTarefa` (as do resumo ficam).
- Prints: 5 novos → **`expectedShots = SCREENS.length * THEMES.length + 220`** (de `+ 215`).

## Critérios de aceite
- **CA1** (R22, R24) `test/renderer/tarefas-format.test.ts` (casos novos): função pura `linhasDoResumo(tasks, meetingId, tarefas)` → para cada linha `{ indice, tarefaId | null }`, casando por `slugTexto`; `pendentesMinhas` conta só as de "Você" sem tarefa; `textoPrazoResumo({ due: 'sexta-feira', dueIso: '2026-11-27' })` → `{ data: '27/11', dito: 'sexta-feira' }` e sem `dueIso` → `{ data: null, dito: 'sexta-feira' }`; `fraseVinculo(view do funil, { email do remetente })` → "Ligada a Marina Rocha · Portal do associado" quando o contato tem uma oportunidade aberta só.
- **CA2** (CA8 da spec) `resumoTarefas` e `resumoGerarDeNovo` passam.
- **CA3** (CA9 da spec) `emailTarefa` e `whatsappTarefa` passam.
- **CA4** (R21) Na reunião gravada, `meetings/<id>.summary.json` tem `dueIso` na tarefa de "Você" (a sexta seguinte à data da reunião) e `null` na outra.
- **CA5** (CA17 da spec, parte) `expectedShots = SCREENS.length * THEMES.length + 220`; existem `detalhe-resumo-tarefas-light/-dark`, `email-leitura-tarefa-light/-dark` e `whatsapp-detalhes-tarefa-light`.

## Invariantes
- "+ Contato", o cartão "Oportunidade detectada", "Detectar oportunidade" e o bloco Participantes continuam como estão (checks do 116 verdes); o print `detalhe-resumo` da `SCREENS` só ganha a coluna nova.
- Nenhuma tarefa nasce sem clique (o resumo pronto não cria nada).
- Nenhum arquivo do main fora de `smoke.ts`/`smoke-fixtures.ts`; nenhum canal novo.
- Nenhum literal de cor fora de `tokens.css`; sem sombra, sem pílula, raio até 6 px; nenhum modal.

## Fora de escopo desta tarefa
Sugestões vindas dos insights (já no 121/122 e na aba do 123); cartões do Assistente (127); mudar o "+ Contato".

## Gates
`cd /Users/andrew/Documents/GitHub/meeting-scribe-tarefas-126 && SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde. Testes: CA1 em `test/renderer/tarefas-format.test.ts`; smoke com os 4 checks.

## Relatório final (formato)
Arquivos; gates (contagens, `expectedShots` novo); `data-*` criados; diferenças em relação aos artboards e por quê; o que o revisor deve olhar em cada um dos 3 prints.
