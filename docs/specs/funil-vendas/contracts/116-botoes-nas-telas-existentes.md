# Contrato 116: "+ Contato" no Resumo, no Email e no WhatsApp, e o cartão "Oportunidade detectada"

Feature `funil-vendas` · Wave 6 · Depende de: 113, 114 e 119 commitados (e 110, 111, 112) · Spec `../spec.md` (R35 a R37, R39 e R40 na tela; CA15; CA17 parte) · Plan `../plan.md` (D8, D11, D21) · Mockup `../mockups/Funil.dc.html` (artboards `09-reuniao-resumo-oportunidade`, `12a-email-leitura-contato`, `12b-whatsapp-detalhes-contato`; a variante "Atualizar oportunidade" segue o `09`; PNGs em `../mockups/png/`). **Você não commita.** Worktree `/Users/andrew/Documents/GitHub/meeting-scribe-funil-vendas` (branch `funil-vendas`, base dd106ce). Único contrato da wave 6: dono de `smoke.ts` e `smoke-fixtures.ts`.

## Pré-condições
- **Os três artboards acima aprovados pelo Andrew.** Sem aprovação, pare e avise. Onde o artboard `09` e a spec divergem na **ordem dos blocos**, vale a spec (seção "Telas de impacto": cartão da oportunidade **acima** das tarefas e bloco Participantes **abaixo** das tarefas).
- Leia na spec R35 a R40 e CA15; no plan D8 e D21; os contratos 110 (`useFunil`, `saveContato`), 112 (`funilPath`, `SearchPicker`, `parseValor`), 107 (`formatarBRL`), 113 (canais `scribe:funil-proposta-*`, `FunilPropostaView` com `duplicata`, `FunilPropostaCampos`, a nota "Citados na reunião", evento `scribe:funil-proposta-changed`) e 111 (`FunilPropostaArquivo`, agente falso com `[funil:…]`).
- No código: `features/meetings/SummaryTab.tsx` (`SummaryTab` `:90-153`, `SummaryContent` `:163-220` com a linha "Copiar resumo"/"Gerar de novo" `:180-190`, seção "Tarefas" `:221-250`, `SectionTitle` `:154`); `features/meetings/MeetingDetailScreen.tsx:170-180` (onde o `SummaryTab` é montado) e `:251-291` (participantes no cabeçalho); `features/email/ReadingPane.tsx:145,250-262` (`sender`, `data-email-from`); `features/whatsapp/DetailsPanel.tsx:48-120`; `src/shared/assistant.ts:430` (`phoneOfChatId`); `src/main/smoke.ts` (blocos de reunião com resumo, `emailChecks`, `whatsappChecks`, `expectedShots` `:13421`).

## Superfície

### Componentes do funil reaproveitados (`src/renderer/src/features/funil/`)
- `ContactLink.tsx`: `ContactLink({ email?, telefone?, whatsappChatId?, nome, origem })`: procura no `useFunil` um contato não arquivado com esse e-mail (normalizado) ou telefone (E.164) ou chat; achou → link com o nome do contato para `funilPath('contatos', id)` (`data-funil-contato-link`); não achou → `ActionButton` "+ Contato" (`data-action="funil-mais-contato"`) que chama `saveContato({ nome, emails, telefones, whatsappChatId }, origem)` e, com sucesso, vira o link sem sair da tela; erro mostra o texto de `FUNIL_ERRO_TEXTO` em `title` e numa linha curta abaixo.
- `proposalStore.ts`: `useProposta(meetingId)` carrega `scribe:funil-proposta-get`, recarrega em `scribe:funil-proposta-changed` daquela reunião e expõe `detectar()`, `aplicar(campos, vincularA?)`, `descartar()`.

### Reunião › Resumo (`SummaryTab.tsx`, `MeetingDetailScreen.tsx`, `features/meetings/OpportunityCard.tsx` novo)
- `MeetingDetailScreen` passa a `SummaryTab` a reunião (ou `calendar` dela) e mais nada muda no cabeçalho (os participantes do cabeçalho continuam como estão).
- **Detectar oportunidade (R40)**: `Button secondary` de 32 px "Detectar oportunidade" (ícone `Funnel`, `action="funil-detectar"`) na linha de ações do Resumo, depois de "Gerar de novo" (`SummaryTab.tsx:180-190`), visível quando há resumo; chama `detectar()`; enquanto `detectando`, desabilitado com o texto "Detectando…"; funciona com `funil.detectarNasReunioes` desligado.
- **Cartão (R39, `OpportunityCard.tsx`, `data-funil-proposta`)**: com o arquivo em `status: 'proposed'`, **acima da seção Tarefas**: ícone `Funnel`, título "Oportunidade detectada" (ou "Atualizar oportunidade: <título da existente>" com `acao: 'atualizar'`), à direita "<modelo> · <hora>", linha "Por quê: <justificativa>" em `label`; campos editáveis Título, Etapa (`Select` das abertas, pré-escolhida pela `etapaSugerida`), Empresa (`SearchPicker`; nome que ainda não existe aparece como "<nome> (nova)"), Valor (R$, `parseValor`), Contatos (chips do `SearchPicker`; contato ainda não criado com fundo `--hl`; contato **sem e-mail** mostra no chip um campo "e-mail" (`data-funil-proposta-email="<i>"`) que, preenchido, faz o contato ser criado; vazio, o nome vai para a nota "Citados na reunião: …", R39), Previsão (data), Próximo passo (texto + data); botões `Button primary` "Criar" ou "Atualizar" (`action="funil-proposta-aplicar"`), `Button secondary` "Vincular a existente…" (`action="funil-proposta-vincular"`, abre um `Select` das oportunidades abertas e um "Vincular"), "Ignorar" (`action="funil-proposta-ignorar"`); à direita, o resumo do efeito ("Cria os 2 contatos novos e a empresa"; com contato sem e-mail, acrescenta "Carlos Dias fica só citado na nota"). Com `duplicata` no `FunilPropostaView` (R39, R25): aviso "Já existe «<título>» aberta para esta empresa" com link (`data-funil-aviso-duplicata`) e o botão "Vincular a existente…" em destaque de ação secundária, já com a duplicata escolhida no `Select`; "Criar" continua habilitado. Depois de Criar/Atualizar/Vincular, o cartão vira uma linha "Oportunidade criada: <título>" (ou "atualizada"/"vinculada") com link para `funilPath('oportunidades', id)`; depois de Ignorar, some. Erro do canal: `Note` no cartão, que continua aberto. Nada é gravado sem um desses cliques.
- **Participantes (R35)**: com `meeting.calendar` presente e ao menos um participante, bloco `SectionTitle` "Participantes" **abaixo da seção Tarefas** (`data-summary-participantes`), uma linha por participante (nome e e-mail); com e-mail, `ContactLink` (`origem: 'reuniao'`) à direita; sem e-mail, só o nome. Reunião sem `calendar` não mostra o bloco.

### Email › leitura (`ReadingPane.tsx`, R36)
Ao lado de `[data-email-from]`, `ContactLink` (`origem: 'email'`, nome = `sender.name` ou o local-part do endereço). Sem o botão quando o remetente é o endereço de uma das contas do usuário.

### WhatsApp › Detalhes (`DetailsPanel.tsx`, R37)
Só em chat `kind: 'person'`: bloco "Contato" no topo do painel (`data-whatsapp-contato`): com contato ligado (chat ou telefone), nome (link para a ficha), empresa e as oportunidades dele em linhas "título · etapa"; sem contato, o nome do chat e `ContactLink` (`origem: 'whatsapp'`, `whatsappChatId = chat.id`, telefone = `phoneOfChatId(chat.id)`). Grupo: sem bloco.

### Smoke (`src/main/smoke.ts`, bloco novo `funilTelasExistentesChecks` depois de `funilContatosChecks`; checks obrigatórios `resumoParticipantes`, `resumoMaisContato`, `resumoDetectar`, `resumoCartao`, `resumoDuplicata`, `resumoCriar`, `resumoIgnorar`, `emailMaisContato`, `whatsappContato`)
- Reunião: use uma reunião do smoke com `calendar.attendees` e resumo (ou gere o resumo pelo fluxo existente com o agente falso). **A detecção automática não roda no smoke** (113): o cenário é sempre disparado por "Detectar oportunidade". A resposta padrão do agente falso (111) traz `empresa: 'Cliente'` e um contato com e-mail; para o caso de contato sem e-mail, o agente falso responde pelo marcador do 111 ou o check edita o cartão apagando o e-mail de um chip.
- `resumoParticipantes`: `[data-summary-participantes]` abaixo de `[data-summary-tasks]` (ou do texto sem tarefas) no DOM, uma linha por participante; numa reunião sem `calendar`, o bloco não existe.
- `resumoMaisContato`: "+ Contato" de um participante → o contato existe pelo canal com `origem: 'reuniao'` e a linha mostra `[data-funil-contato-link]`.
- `resumoDetectar`: clicar `[data-action="funil-detectar"]` → o botão fica desabilitado com "Detectando…" e depois volta; aparece `[data-funil-proposta]` (resposta padrão do agente falso, `acao: 'criar'`).
- `resumoCartao` (CA15): cartão acima das Tarefas com os três botões; print `detalhe-resumo-oportunidade`.
- `resumoDuplicata` (R39): a proposta padrão é da empresa "Cliente", que já tem `op-portal` aberta → `[data-funil-aviso-duplicata]` cita "Portal do associado".
- `resumoCriar`: num contato do cartão, apagar o e-mail; editar o Valor para `120.000,00` e Criar → no funil existe a oportunidade com `valor: 12000000`, `origem: 'reuniao'`, `meetingIds` com a reunião, um `EventoFunil` `nota` que começa com "Citados na reunião: " e o contato sem e-mail não foi criado; o `.funil.json` está `accepted`.
- `resumoIgnorar`: detectar de novo, Ignorar → o cartão some e o arquivo fica `dismissed`; nenhuma oportunidade nova.
- `emailMaisContato` (CA15): abrir no email falso uma mensagem de remetente que ainda não é contato → `ActionButton` "+ Contato" ao lado do remetente; print `email-leitura-contato`; clicar → link com o nome; numa mensagem enviada pela própria conta, sem botão.
- `whatsappContato` (CA15): abrir os detalhes de uma conversa `person` do WhatsApp falso → `[data-whatsapp-contato]` com "+ Contato"; print `whatsapp-detalhes-contato`; clicar → bloco mostra a ficha ligada; numa conversa de grupo, sem bloco.
- Prints novos: 3 nomes × 2 temas: **`expectedShots += 6`** (de `+ 197` para `+ 203`).

## Critérios de aceite
- **CA1** (CA15 da spec) Os prints `detalhe-resumo-oportunidade`, `email-leitura-contato` e `whatsapp-detalhes-contato` existem nos dois temas e os checks `resumoCartao`, `emailMaisContato` e `whatsappContato` passam.
- **CA8** (R39) `resumoDuplicata` passa; o e-mail preenchido no chip de um contato sem e-mail faz esse contato ser criado (check ou teste do fluxo).
- **CA2** (R39) Dado o cartão proposto, quando nenhum botão é clicado, então o `funil.json` não muda (contagem de oportunidades e contatos igual antes e depois de abrir a aba); quando Criar com valor editado, então `resumoCriar` passa.
- **CA3** (R40) Dado `funil.detectarNasReunioes: false`, quando "Detectar oportunidade", então o cartão aparece mesmo assim; durante a execução o botão tem `disabled` e o texto "Detectando…".
- **CA4** (R35) Dada uma reunião sem `calendar`, então `[data-summary-participantes]` não existe; dada uma com 3 participantes, 2 deles com e-mail, então há 3 linhas e 2 `ContactLink`.
- **CA5** (R36) Dado um email cujo remetente já é contato, então aparece o link com o nome do contato e não o botão; dado um email da própria conta, nenhum dos dois.
- **CA6** (R37) Dado um chat `person` cujo telefone é de um contato (sem `whatsappChatId`), então o bloco mostra a ficha ligada; dado um grupo, o bloco não existe.
- **CA7** (CA17 da spec, parte) `expectedShots` = `SCREENS.length * THEMES.length + 203` e o número de PNGs bate.

## Invariantes
- Resumo, Copiar resumo, Gerar de novo, Perguntas em aberto e tarefas funcionam como hoje (checks existentes de `detail*` verdes). O print existente `detalhe-resumo` **não ganha cartão** (a detecção automática não roda no smoke e o cenário desta tarefa usa outra reunião ou roda depois desse print); ele só pode mudar pelo botão "Detectar oportunidade" e, se a reunião dele tiver `calendar`, pelo bloco Participantes; diga no relatório se mudou e por quê.
- Leitura de email, envio, mover, apagar e o painel de detalhes do WhatsApp (gráficos, risco) continuam como hoje; checks existentes verdes.
- `summaryContentSchema` não muda; nenhum canal novo; nenhum arquivo do main fora de `smoke.ts` e `smoke-fixtures.ts`.
- Nenhum literal de cor fora de `tokens.css` (o fundo de contato novo usa `--hl`); sem sombra, sem pílula, raio até 6 px; nenhum texto técnico.

## Fora de escopo desta tarefa
Detecção em email e WhatsApp; mudar o cabeçalho da reunião; Assistente (117).

## Gates
`cd /Users/andrew/Documents/GitHub/meeting-scribe-funil-vendas && SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde. Smoke com os 9 checks; nenhum teste vitest novo obrigatório (lógica pura nova, se houver, vai para `test/renderer/funil-format.test.ts`).

## Relatório final (formato)
Arquivos; gates (contagens, `expectedShots` novo); qual reunião, email e conversa do smoke foram usados; diferenças em relação aos artboards (inclusive a ordem dos blocos da seção "Telas de impacto" da spec) e por quê; o que o revisor deve olhar em cada um dos 3 prints.
