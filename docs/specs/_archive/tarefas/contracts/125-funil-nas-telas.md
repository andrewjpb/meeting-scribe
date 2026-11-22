# Contrato 125: Funil nas telas (kanban, seção Tarefas da oportunidade, fichas, linha do tempo) e smoke da migração

Feature `tarefas` · Wave 4 · Depende de: 123 e 124 commitados e mesclados (e os gates verdes na ponta da `tarefas` depois da mescla da wave 3) · Spec `../spec.md` (R14 "Sem tarefa", R15, R18 tela, R19; CA1 smoke, CA7 smoke; CA17 parte) · Plan `../plan.md` (D9, D10, D17, D18) · Mockup `../mockups/Tarefas.dc.html` (artboards **08 Funil › Oportunidade com a seção Tarefas**, **09 Funil › ficha do contato com Tarefas** e **16 Funil › kanban com a próxima tarefa e "Sem tarefa"**; a ficha da empresa segue a do contato; vale a seção "Alinhamento com o mockup" da spec para R15, R18 e R19). **Você não commita.** Worktree `/Users/andrew/Documents/GitHub/meeting-scribe-tarefas-125` (branch `tarefas-125`). Único contrato da wave 4: você é o dono de `src/main/smoke.ts` e `src/main/smoke-fixtures.ts`.

## Pré-condições
- **Os três artboards acima (08, 09 e 16) aprovados pelo Andrew.** Sem aprovação, pare e avise. Texto e medidas do artboard prevalecem; regra e `data-*` do contrato prevalecem sobre o artboard.
- Leia na spec R14, R15, R18, R19, CA1 e CA7; no plan D9, D10, D17, D18; o contrato 123 (props de `TarefaLinha` e `NovaTarefaInline`, `tarefasPath`, `useTarefas`, `SMOKE_TAREFAS`) e o 124 (`FunilView.proximosPassos`, `ItemLinhaDoTempo` `tarefa`, `registrarTarefa`, migração no boot, `funil.json.bak-tarefas-*`, `schedules.json.bak-tarefas-*`).
- No código: `features/funil/KanbanCard.tsx:101-125`; `features/funil/OportunidadeScreen.tsx` (`Campo` `:31`, passo `:274`, campo "Próximo passo" `:418-433`, `CampoPasso` `:738-768`); `features/funil/Timeline.tsx` (rótulos `:17`); `features/funil/ContatoFicha.tsx` (`TituloBloco` `:51`, `BlocoOportunidades` `:221-252`, blocos da ficha `:415-425`); `features/funil/EmpresasScreen.tsx` (blocos `:240-265`); `features/funil/funilFormat.ts`.
- Smoke: `funilKanbanChecks` `smoke.ts:11931` (check `funilKanban` `:12060`), `funilDetalheChecks` `:12407` (campos `:12488`, print `funil-oportunidade` `:12509`), `funilContatosChecks` `:12636`, `expectedShots` `:15254`; `smoke-fixtures.ts` (`writeSmokeFunil` `:641-722`, `SMOKE_TAREFAS` do 123, `createSmokeFixtures` `:423-452`); o formato de um lembrete em `schedules.json` (`schedules/service.ts:888-905`).

## Superfície

### Kanban (R14)
`KanbanCard.tsx`: com `view.proximosPassos[id]` nulo, o texto do passo é **"Sem tarefa"**; com ele, o título da tarefa e a data curta como hoje (vencido em `--rec`, `data-funil-card-vencido`); `data-funil-card-tarefa="<tarefaId>"` quando há. Arrastar, totais e "esfriou" não mudam.

### Seção Tarefas da oportunidade (R15)
- `OportunidadeScreen.tsx`: o campo "Próximo passo" (`'proximo-passo'` em `Campo`, o trecho `:418-433` e `CampoPasso`) sai; entra a seção `data-funil-bloco="tarefas"` (`aria-label="Tarefas"`, título `TituloBloco`, entre a grade de campos e as abas, com a linha "N abertas · a primeira é o próximo passo no quadro") com as abertas da oportunidade em `TarefaLinha` (44 px, ordem de `abertasDaOportunidade`), "Nova tarefa" (`data-action="funil-tarefa-nova"`, em linha de 40 px) que abre `NovaTarefaInline` com `oportunidadeFixa`, `origem { tipo: 'funil', oportunidadeId }` e `vinculosIniciais { oportunidadeId }` (R9 pelo serviço), e "Feitas (N)" recolhidas numa linha de 28 px (`data-funil-tarefas-feitas`, abre e fecha no clique; N = feitas e canceladas da oportunidade). Clicar numa linha → `tarefasPath(id)`.
- O lugar da seção na tela é o do artboard; o resto do detalhe (campos, abas, ações) não muda.

### Fichas (R19)
- `ContatoFicha.tsx`: bloco `data-funil-bloco="tarefas"` antes de "Oportunidades", com as abertas que têm o contato nos vínculos em sublinhas de 32 px (como as Oportunidades da ficha) e "+ Nova tarefa" no estilo do "+ E-mail"; o "+ Nova tarefa" abre `NovaTarefaInline` com `vinculosIniciais { contatoIds: [id] }` e `origem { tipo: 'manual' }` (a oportunidade entra pela R9 no serviço); o campo Notas da ficha continua; sem tarefa → "Nenhuma tarefa aberta.".
- `EmpresasScreen.tsx`: o mesmo bloco com as abertas de `vinculos.empresaId === id` e "Nova tarefa" com `vinculosIniciais { empresaId: id }`.

### Linha do tempo (R18)
`Timeline.tsx` (o 124 deixou só o mínimo): item `tarefa` com ícone de tarefa, rótulo "Tarefa criada" ou "Tarefa concluída", o título, a linha com `origem` resumida e o prazo ("até dd/mm", quando há) e, com `existe`, a ação **"Abrir tarefa"** (`data-funil-timeline-tarefa`, link para `tarefasPath(tarefaId)`); sem `existe`, sem link. Eventos antigos `proximo-passo` continuam com o rótulo de hoje.

### `funilFormat.ts`
`tarefasDaOportunidade(tarefas, opId)` (`{ abertas; fechadas }`), `tarefasDoContato`, `tarefasDaEmpresa`, `textoItemTarefa(item)` (rótulo, linha de origem e prazo); `textoProximoPasso(null).texto` passa a `'Sem tarefa'`.

### Smoke (dono na wave 4)
- **Fixture** (`smoke-fixtures.ts`): em `createSmokeFixtures`, antes dos serviços, grava `<userData>/schedules.json` (0600, `version: 1`, `paused: false`, `pauseReason: null`, `limitReleasedOn: null`, `meetingRuns: []`) com **um** lembrete no formato de `schedules/service.ts:888-905`: `id: 'smoke-lembrete-legado'`, `reminder.text` "Retornar a ligação do fornecedor", `nextRunAt` = agora + 60 dias (longe do relógio que o smoke adianta), sem conversa nem e-mail. A migração do boot (124) converte e tira o item.
- `funilKanbanChecks` (`:11931`): check novo `funilKanbanSemTarefa` (o cartão de `op-integracao` mostra "Sem tarefa"; os de `op-portal`, `op-consultoria`, `op-vistoria` e `op-loja` mostram os textos dos passos da fixture do funil — "Enviar estudo de escopo", "Reunião técnica", "Ligar para o comprador", "Revisar contrato" — com `data-funil-card-tarefa`).
- Check novo `funilMigracao` (CA1), no início de `funilKanbanChecks`: `tarefas.json` com exatamente 4 tarefas `origem.tipo === 'migracao'` e `de === 'proximo-passo'` (ligadas a `op-portal`, `op-consultoria`, `op-vistoria` e `op-loja`) e 1 com `de === 'lembrete'` com `lembreteEm` igual ao `nextRunAt` semeado; `migradoEm` não nulo; nenhuma oportunidade de `funil.json` com a chave `proximoPasso`; nenhuma tarefa com `reminder` em `schedules.json`; `funil.json.bak-tarefas-*` e `schedules.json.bak-tarefas-*` existem com modo 0600.
- `funilDetalheChecks` (`:12407`): a lista de campos (`:12488`) passa a não ter `'proximo-passo'`; check novo `funilTarefasSecao` (CA7) em `op-consultoria`: a seção tem a tarefa migrada ("Reunião técnica", hoje + 4); "Nova tarefa" com "Enviar proposta" e prazo hoje + 2 → `tarefas.json` com `origem funil` e vínculo à oportunidade, e o cartão do kanban passa a mostrar a data de hoje + 2; outra com prazo hoje + 6 → o cartão continua hoje + 2; concluir a de hoje + 2 pela caixa da seção → o cartão volta a hoje + 4 e "Feitas (1)" aparece; a aba Linha do tempo mostra 2 itens `tarefa` novos (criada e concluída) com "Abrir tarefa", e clicar leva a `/tarefas/<id>`; apague as duas tarefas criadas no fim.
- O print `funil-oportunidade` (`:12509`, `op-loja`) é regravado com a seção Tarefas (a migrada "Revisar contrato" e a `t-loja` do 123); mesmo nome.
- `funilContatosChecks` (`:12636`): o check existente `contatosFicha` (`:12735`) passa a esperar `blocos` `['tarefas', 'oportunidades', 'linha-do-tempo']`; check novo `funilContatoTarefas`: a ficha de Marina Rocha tem o bloco Tarefas com `t-vencida` e `t-portal`; "Nova tarefa" "Agendar visita técnica" sem prazo → tarefa com `contatoIds` [Marina] e `oportunidadeId === 'op-portal'` (Marina tem uma só oportunidade aberta); print **`funil-contato-tarefas-light`** (só claro); a ficha da empresa Cliente tem o bloco com pelo menos `t-vencida`; apague a tarefa criada.
- `detail` dos checks novos só com números e booleanos.
- Prints: 1 novo → **`expectedShots = SCREENS.length * THEMES.length + 215`** (de `+ 214`).

## Critérios de aceite
- **CA1** (R14, R15, R19) `test/renderer/funil-format.test.ts`: `textoProximoPasso(null).texto === 'Sem tarefa'`; `tarefasDaOportunidade` separa abertas (na ordem de prazo, nulo por último) e fechadas; `tarefasDoContato` só as abertas com o contato; `textoItemTarefa` para `criada` e `feita`, com a origem e o prazo.
- **CA2** (CA1 da spec) `funilMigracao` passa.
- **CA3** (R14) `funilKanbanSemTarefa` passa e `funilKanban` (5 cartões, 1 vencido em `op-vistoria`) continua passando.
- **CA4** (CA7 da spec, R15, R18) `funilTarefasSecao` passa; os campos do detalhe sem `'proximo-passo'`.
- **CA5** (R19) `funilContatoTarefas` e `contatosFicha` (com o bloco `tarefas`) passam; `funil-contato-tarefas-light.png` existe.
- **CA6** (CA17 da spec, parte) `expectedShots = SCREENS.length * THEMES.length + 215` e o número de PNGs bate; `funil-oportunidade-light/-dark` mostram a seção Tarefas.

## Invariantes
- Kanban (arrastar, filtros, totais, "esfriou", editar etapas), contatos, empresas, sugestões e importação funcionam como hoje; checks existentes do funil continuam (só a lista de campos do detalhe muda).
- Nenhum arquivo do main fora de `smoke.ts`/`smoke-fixtures.ts`; nenhum canal novo.
- Nenhum literal de cor fora de `tokens.css`; sem sombra, sem pílula, raio até 6 px; nenhum modal.

## Fora de escopo desta tarefa
Botões no Resumo, no Email e no WhatsApp (126); cartões do Assistente (127); a lógica do derivado e dos eventos (124, já pronta).

## Gates
`cd /Users/andrew/Documents/GitHub/meeting-scribe-tarefas-125 && SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde. Testes: CA1 em `test/renderer/funil-format.test.ts`; smoke com `funilMigracao`, `funilKanbanSemTarefa`, `funilTarefasSecao`, `funilContatoTarefas`.

## Relatório final (formato)
Arquivos; gates (contagens, `expectedShots` novo); `data-*` criados; diferenças em relação aos artboards e por quê; o que o revisor deve olhar em `funil-oportunidade-*` e `funil-contato-tarefas-light`.
