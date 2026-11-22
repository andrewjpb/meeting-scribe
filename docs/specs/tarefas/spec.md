---
status: aprovado
aprovado_em: 2026-11-22
feature: tarefas
tipo: spec
data: 2026-11-22
semana: 2026-W47
base: main 6ce57bd (versão 0.20.1, funil-vendas arquivado; próximo contrato livre: 121)
---

# Spec — Tarefas ligadas a tudo

Decisões do Andrew (2026-11-22): D1 item de raiz **Tarefas** depois de Reuniões; D2 o próximo passo da oportunidade
passa a ser **derivado** da próxima tarefa aberta; D3 os lembretes do Assistente **viram tarefas**; D4 "Tarefas
agendadas" passa a **Agendamentos** e o cartão `tarefa` passa a `agendamento`.

## Problema e objetivo

Cinco "meias-tarefas" desconectadas (tabela do resumo, próximo passo, lembrete, post-it, pendências dos insights)
e nenhum lugar onde "feito" exista. Objetivo: uma lista única, local, que nasce de onde o trabalho acontece e
devolve o contexto com um clique, mantendo o princípio do funil: **nada entra sem clique**.

## Não-objetivos

Subtarefa, projeto, kanban de tarefas, prioridade numérica, recorrência, atribuição com aviso a terceiros,
sincronização externa, criação automática sem clique, bandeira do IMAP.

## O que existe hoje (âncoras)

- `SummaryTask {task, owner, due}` em `shared/meeting-summary.ts:14-18`; schema `shared/meeting-summary-schema.ts:12-16`;
  prompt `main/claude-cli/summary.ts:62`; arquivo `meetings/<id>.summary.json`; tabela só leitura `SummaryTab.tsx:248-275`.
- `ProximoPasso {texto, data}` em `shared/funil.ts:97-101,115`; gravação `main/funil/store.ts:168-174,524-543`;
  edição `OportunidadeScreen.tsx:418-433,738-768`; `passoVencido` `shared/funil-logic.ts:125-127`; alerta diário
  `main/funil/alerts.ts` no tick de `main/schedules/service.ts:128,602`; cartão `KanbanCard.tsx:101-125`; `FUNIL.md`
  `main/funil/markdown.ts:62,73`; cartão do Assistente `oportunidade-proximo-passo`.
- Lembrete = `ScheduledTask.reminder {text, whatsappChatId, email?}` (`shared/automations.ts:159-179`), criado por
  `automations.createReminder` (`main/schedules/service.ts:150,872`), disparado em `:535-556`; cartões `lembrete`,
  `lembrete-editar`, `lembrete-apagar` (`main/chat/actions.ts:157,726`); listado em Automações › Tarefas agendadas.
- Cartão `tarefa` do Assistente abre o formulário das Automações (`shared/assistant.ts:72-89`).
- Post-its `MeetingNote.status` (`shared/meeting-notes.ts:29-73`); análise `toConfirm {text, owner?}`
  (`shared/meeting-analysis.ts:23-87`); insights do WhatsApp `pendencias {minhas, deles}`, `compromissos {texto, quando?}`
  (`shared/whatsapp-insights.ts:33-46`).
- Raiz da barra: Reuniões, Assistente, Email, Funil, Redes*, Automações, WhatsApp*, Configurações (`app/routes.tsx:25-51`);
  badge do Email em `Sidebar.tsx:76`; `RouteId` em `shared/routes.ts:2-31`; fontes do Assistente `shared/chat.ts:128-132`;
  `FunilSettings` em `settings-defaults.ts:292`; store padrão `main/schedules/store.ts` e `main/funil/store.ts`;
  `WHEN_LOCKED` `shared/ipc.ts:1185` (funil `refused` em `:1460`).

## Modelo de dados

Arquivo `userData/tarefas.json` (mesmo padrão de `funil.json`: fila serial, temporário + `rename`, 0600, backup
diário com 7 cópias, `.corrupt` quando inválido):

```ts
type TarefasArquivo = { version: 1; tarefas: Tarefa[]; ignorados: SugestaoIgnorada[]; migradoEm: number | null; ultimoAvisoHojeEm: number | null }

type Tarefa = {
  id: string                       // uuid
  titulo: string                   // 1..200, aparado
  detalhe: string                  // 0..2000
  status: 'aberta' | 'feita' | 'cancelada'
  importante: boolean
  prazo: string | null             // 'AAAA-MM-DD'
  lembreteEm: number | null        // epoch ms do aviso; null = sem aviso
  lembreteDisparadoEm: number | null
  responsavel: { tipo: 'eu' } | { tipo: 'contato'; contatoId: string } | { tipo: 'nome'; nome: string }
  origem: { tipo: 'reuniao'; meetingId: string; texto: string }      // texto = a tarefa do resumo, para casar a linha
        | { tipo: 'funil'; oportunidadeId: string }
        | { tipo: 'email'; accountId: string; id: string; assunto: string }
        | { tipo: 'whatsapp'; chatId: string; texto?: string }
        | { tipo: 'assistente' } | { tipo: 'automacao'; agentId: string } | { tipo: 'manual' } | { tipo: 'migracao'; de: 'proximo-passo' | 'lembrete' }
  vinculos: { oportunidadeId: string | null; contatoIds: string[]; empresaId: string | null; meetingId: string | null;
              email: { accountId: string; id: string; assunto: string; mailbox: string | null } | null; whatsappChatId: string | null }
  historico: EventoTarefa[]        // até 50, mais antigo descartado
  criadaEm: number; atualizadaEm: number; feitaEm: number | null
}
type EventoTarefa = { tipo: 'criada' | 'prazo' | 'lembrete' | 'feita' | 'reaberta' | 'cancelada' | 'vinculo' | 'responsavel'; em: number; detalhe?: string }
type SugestaoIgnorada = { chave: string; em: number }   // chave = `${origem}:${ref}:${slug(texto)}`
```

Derivados (nunca gravados): `vencida` = aberta e `prazo < hoje`; `deHoje` = aberta e `prazo === hoje`;
`proximaDaOportunidade(opId)` = tarefa aberta com `vinculos.oportunidadeId === opId`, ordenada por `prazo` (nulo por último) e
depois `criadaEm`. Mudanças no funil (R21–R28): `Oportunidade.proximoPasso` **deixa de ser gravado**; `FunilView` passa a
expor `proximosPassos: Record<oportunidadeId, { texto, data, tarefaId } | null>` derivado; `EventoFunilTipo` ganha `'tarefa'`; `ItemLinhaDoTempo` ganha o tipo
`'tarefa'`. `SummaryTask` ganha `dueIso: string | null` (opcional no schema, para resumos antigos).

## Regras

### Tela Tarefas (D1)
- **R1** Rota `/tarefas/:id?` (`RouteId 'tarefas'`), item **Tarefas** (ícone `CheckSquare`) na raiz da barra lateral **logo
  depois de Reuniões**, sem nível em pilha. Ao lado do nome, o número de **vencidas** (mesma regra visual do não-lido do
  Email; nada quando zero).
- **R2** `PageHeader` "Tarefas" com busca (⌘F; título, detalhe, nome da origem), `Segmented` **Hoje · Próximas · Todas ·
  Feitas · Sugestões N** e botão **Nova tarefa** (32 px). Hoje = vencidas + de hoje, nesta ordem; Próximas = abertas com
  `prazo > hoje`, por prazo; Todas = abertas, por prazo (sem prazo por último) e `criadaEm`; Feitas = `feita`/`cancelada`
  dos últimos 90 dias, por `feitaEm` desc. A visão de abertura é **Hoje**; vazia, mostra `EmptyState` "Nada para hoje" com
  link para Todas.
- **R3** Linha de 44 px: caixa de feito (clique marca `feita`; novo clique reabre), título (truncado), origem (ícone e nome:
  "Reunião: <título>", "Oportunidade: <título>", "E-mail: <assunto>", "WhatsApp: <conversa>", "Assistente", "Manual"),
  prazo à direita ("hoje", "dd/mm", vermelho `text-rec` quando venceu, vazio quando não há), responsável quando não for
  "eu" (nome do contato ou texto), marca **importante** (ícone, sem cor nova). Vencidas também mostram "há N d".
- **R4** Select **Agrupar por** no cabeçalho: Prazo (padrão: Vencidas · Hoje · Esta semana · Depois · Sem prazo),
  Oportunidade, Reunião, Contato. Grupo tem cabeçalho de 28 px com contagem.
- **R5** Clique na linha abre o **detalhe ao lado** (painel à direita, como a ficha do contato), sem modal: `EditableTitle`;
  campos Prazo (`<input type=date>`), Lembrete (Select: "Sem aviso" · "No prazo às HH:MM" (padrão) · "Em…" com data e
  hora), Responsável (Select: Eu · Contato… (`SearchPicker` de contatos) · Outra pessoa… (texto)), Importante (Switch),
  Detalhe (textarea), **Vínculos** (Oportunidade via `SearchPicker`; Contatos; Reunião via "Vincular reunião" já existente
  no funil; e-mail e conversa só exibidos, com **Abrir**), **Histórico** (eventos, mais recente primeiro) e ações
  **Concluir**/**Reabrir**, **Cancelar** e **Apagar** (confirmação em linha, como no funil). Cada campo grava ao sair.
- **R6** **Nova tarefa**: formulário em linha no topo da lista (título, prazo, vínculo opcional com oportunidade), **Criar**
  com Enter; ⌘⇧T abre a tela e foca o título (atalho livre; confirmar no contrato). Título vazio não cria.
- **R7** Busca e filtros são locais ao renderer sobre a `TarefasView` carregada; a lista recarrega a cada
  `scribe:tarefas-changed` (padrão do `funilStore`).

### Criação, edição e estados
- **R8** Título aparado, 1–200; detalhe até 2000; `prazo` válido ou nulo. `feita` grava `feitaEm` e o evento; reabrir zera
  `feitaEm`. `cancelada` é terminal exceto por **Reabrir**. Apagar remove sem lixeira (confirmação em linha).
- **R9** Ao criar ligada a uma oportunidade, os `contatoIds` e a `empresaId` da oportunidade entram nos vínculos; ao
  criar a partir de um contato, a oportunidade **só** entra se o contato tiver exatamente uma oportunidade aberta.
- **R10** Toda criação/conclusão/mudança de prazo de tarefa ligada a uma oportunidade grava um `EventoFunil` `tarefa`
  (`detalhe` = título) e conta como **interação** para "esfriou" (`ultimaInteracaoEm`).

### Lembretes (D3)
- **R11** `lembreteEm` nasce de `prazo` + `tarefas.horaLembrete` quando `tarefas.lembrarNoPrazo` está ligado; o usuário
  pode trocar ou tirar. Mudar o prazo recalcula o lembrete padrão (não o personalizado).
- **R12** O tick de 30 s das Automações chama `tarefas.dispararLembretes(agora)`: toda tarefa `aberta` com
  `lembreteEm <= agora` e `lembreteDisparadoEm === null` gera a notificação **"Tarefa"** com o título e o botão **Abrir**
  (`/tarefas/<id>`), grava `lembreteDisparadoEm`. Com o app bloqueado, a notificação diz só "Você tem uma tarefa com
  lembrete" e Abrir leva à tela de desbloqueio e depois à tarefa: o **main** guarda o destino pendente e o reemite após o
  desbloqueio (o renderer só monta a navegação depois de desbloquear). Na virada do dia (primeiro tick com data nova), o
  serviço reemite `scribe:tarefas-changed` para o badge e a visão Hoje não ficarem com a data velha.
- **R13** O cartão `lembrete` do Assistente passa a criar **tarefa** `origem assistente`, `lembreteEm` = quando, vínculos
  `whatsappChatId`/`email` quando vierem; o texto do cartão e o `done` ("Lembrete criado · …") não mudam. `lembrete-editar`
  e `lembrete-apagar` passam a operar sobre tarefas com `lembreteEm` (id de tarefa); "não existe mais" quando a tarefa foi
  feita ou apagada. `ScheduledTask.reminder` deixa de ser criado (R35 migra os existentes). O `ESTADO.md` do Assistente **continua** trazendo a seção
  "Lembretes" (agora derivada das tarefas com `lembreteEm`: id curto, quando, título), para `lembrete-editar`/`-apagar`
  funcionarem mesmo com a fonte Tarefas desligada; o `AUTOMACOES.md` deixa de listar lembretes; o botão "abrir tarefas" dos
  cartões de lembrete passa a abrir `/tarefas`.

### Funil (D2)
- **R14** `Oportunidade.proximoPasso` não é mais gravado; `FunilView` entrega `proximoPasso: { texto, data, tarefaId } | null`
  derivado de `proximaDaOportunidade`. `KanbanCard` mostra como hoje (ícone, data curta, vermelho se venceu); sem tarefa,
  "Sem tarefa". Arrastar e os totais não mudam.
- **R15** Na tela da oportunidade, o campo "Próximo passo" é substituído pela seção **Tarefas**: linhas de 44 px com caixa de
  feito, título, prazo, responsável; **Nova tarefa** em linha (cria `origem funil`, vínculo à oportunidade, R9); **Feitas**
  recolhidas com contagem. Clicar na linha abre `/tarefas/<id>`.
- **R16** `FUNIL.md`: a linha "Próximo passo" vira "Tarefas abertas" (até 5 por oportunidade, "título (até dd/mm)"), só nas
  abertas. A fonte Funil não muda de nome.
- **R17** O cartão `oportunidade-proximo-passo` do Assistente mantém o nome e o schema (`{oportunidade, passo, data?}`) e
  passa a **criar tarefa** ligada à oportunidade; `done` = "Tarefa criada: <título>". Com oportunidade fechada → `failed`
  "A oportunidade está fechada".
- **R18** Linha do tempo da oportunidade e do contato ganham itens `tarefa` (criada/feita) com link para a tarefa.
- **R19** `ContatoFicha` e `EmpresasScreen` ganham a seção **Tarefas** (abertas, com **Nova tarefa**; R9 para a oportunidade).
- **R20** `passoVencido`, `esfriada` e o aviso diário passam a usar as tarefas (R10, R26).

### Reunião › Resumo
- **R21** `SummaryTask.dueIso` (opcional): o prompt do resumo pede a data em `AAAA-MM-DD` calculada a partir da data da
  reunião quando o prazo dito for inequívoco ("sexta", "dia 30", "amanhã"); senão `null`. Resumos antigos seguem válidos.
- **R22** A tabela "Tarefas" ganha, por linha, a ação **Adicionar** (28 px); criada, a linha mostra a caixa de feito ligada
  à tarefa (clique marca feita) e o ícone de link para `/tarefas/<id>`. Casamento linha ↔ tarefa por
  `origem.meetingId + slug(texto)`. **Adicionar as minhas** no cabeçalho da seção cria todas com `owner === 'Você'` ainda
  não adicionadas. Responsável: `Você` → `eu`; outro → `{tipo:'nome'}` (ou `contato` se o nome casar com um participante
  que é contato). Prazo = `dueIso`. Vínculos: `meetingId`; se a reunião está em alguma oportunidade (`meetingIds`), a
  oportunidade e seus contatos (R9).
- **R23** "Gerar de novo" não apaga tarefas já criadas; linhas novas que casem pelo texto continuam ligadas.

### Email e WhatsApp
- **R24** Na leitura do e-mail, no cabeçalho à direita (ao lado da data; vale também quando o remetente já é contato), a ação
  **+ Tarefa** abre um formulário em linha (título = assunto,
  prazo vazio) com **Criar**/**Cancelar**; cria `origem email` com `vinculos.email`, o contato do remetente se existir e a
  oportunidade pela R9. O detalhe da tarefa tem **Abrir e-mail** (mesmo caminho que a linha do tempo da oportunidade usa).
- **R25** No painel de detalhes do WhatsApp, bloco Contato, **+ Tarefa** idem (título vazio; `whatsappChatId`); **Abrir
  conversa** no detalhe da tarefa.

### Sugestões
- **R26** Aba **Sugestões** da tela Tarefas, calculada sob demanda no main (`scribe:tarefas-sugestoes`), fontes:
  (a) `SummaryTask` com `owner === 'Você'` de reuniões dos últimos 30 dias ainda sem tarefa casada; (b) `toConfirm` da
  análise com `owner` "Você"/vazio; (c) `pendencias.minhas` e `compromissos` dos insights de conversas com atividade nos
  últimos 30 dias (se `tarefas.sugerirDasReunioes` desligado, só (c)). Linha de 44 px: texto, origem, data; **Adicionar**
  (cria com prazo quando houver `dueIso`/`quando`) e **Ignorar** (grava em `ignorados`; não volta). Ordem: mais recente
  primeiro; máximo 100.

### Assistente
- **R27** Fonte nova `tarefas` em `CHAT_SOURCE_KINDS` (**primeira da lista** no painel Contexto; **ligada por padrão**: não entra em
  `CHAT_SOURCES_OFF_BY_DEFAULT`, porque os lembretes já chegam ao modelo pelo `ESTADO.md` hoje; o Andrew pode desligar),
  arquivo `TAREFAS.md`: "Vencidas", "Hoje", "Próximas" e "Sem prazo" (abertas, até 200), cada linha com id curto, título,
  prazo, responsável e vínculos (oportunidade, contato, reunião), mais a seção "Lembretes" (tarefas com `lembreteEm`: id curto,
  data e hora do aviso). Citação `[Tarefa · <título>]`.
- **R28** Cartões novos, pelo canal único `scribe:chat-action-tarefa` (`{chatId, index, actionId}`; `refused` bloqueado):
  `tarefa-criar {titulo, prazo?, lembrete?, oportunidade?, contato?}` (resolve oportunidade/contato por nome como o funil;
  ambíguo → cartão pede escolha no `SearchPicker`), `tarefa-concluir {id}`, `tarefa-adiar {id, prazo}`. Cartão mostra o
  que vai mudar; `done`/`failed` com texto; id inexistente ou tarefa fechada → `failed` "Essa tarefa não existe mais".
- **R29** O cartão `tarefa` (abre o formulário das Automações) passa a chamar-se `agendamento`; o `proposedSchema` aceita
  só o nome novo; cartões antigos persistidos continuam renderizando.
- **R30** `abrir` aceita `tarefas` e `tarefa` (`/tarefas/<id>`).

### Automações e o aviso "Hoje"
- **R31** `Agent.tarefas` (Switch **Pode ler as tarefas**, abaixo de "Pode ler o funil"): o runner grava `TAREFAS.md`
  (0600) na pasta da execução e soma a instrução; o modelo de agente "Minhas tarefas" passa a usar o arquivo.
- **R32** O aviso diário (hoje em `main/funil/alerts.ts`) vira **"Hoje"**, uma notificação por dia a partir de
  `tarefas.horaLembrete`: "N vencida(s) · M para hoje" (se `tarefas.avisoDiario`) e "· Funil: X esfriada(s)" (se
  `funil.avisarEsfriadas`); Abrir → `/tarefas`. Sem nada a dizer, não notifica. `ultimoAvisoHojeEm` em `tarefas.json`
  substitui `ultimoAvisoEm` do funil para esse aviso.
- **R33** Textos "Tarefas agendadas" → **Agendamentos** na tela Automações, no guia do app, no `AUTOMACOES.md` e nos
  textos do smoke; `ScheduledTask` continua no código. A lista de Agendamentos não mostra lembretes (viraram tarefas).

### Configurações
- **R34** `TarefasSettings { horaLembrete: 'HH:MM' (padrão '09:00'), lembrarNoPrazo: true, avisoDiario: true,
  sugerirDasReunioes: true }` em `settings-defaults`/`schema`; seção **Tarefas** na aba Geral, abaixo de Funil de vendas.

### Migração (uma vez, com backup)
- **R35** Na primeira abertura sem `tarefas.json`: (a) cada oportunidade **aberta** com `proximoPasso` vira tarefa
  `origem migracao/proximo-passo`, vínculo à oportunidade (R9), prazo = data; `funil.json` ganha backup e perde o campo;
  (b) cada `ScheduledTask` com `reminder` e `nextRunAt` futuro vira tarefa `origem migracao/lembrete` com `lembreteEm`;
  os já disparados são **removidos** sem virar tarefa; `schedules.json` ganha backup e perde esses itens (remoção sempre por
  lista de ids; se `schedules.json` estiver inválido, a parte das Automações é pulada e nada é regravado). `migradoEm` gravado. Falha em qualquer
  passo: nada é gravado e o app segue com a lista vazia e um aviso no log. Tarefa migrada de próximo passo nasce **sem
  lembrete** (senão os passos já vencidos disparariam aviso na primeira abertura); a de lembrete mantém o `lembreteEm`.

### Bloqueio, privacidade e segurança
- **R36** Canais `scribe:tarefas-*` e `scribe:chat-action-tarefa` são `refused` com o app bloqueado; `tarefas.json` 0600;
  nenhum título de tarefa em log; `TAREFAS.md` só na pasta da execução/fonte, apagado como o `FUNIL.md`.
- **R37** Canais: `scribe:tarefas-get` (view), `-criar`, `-salvar` (campos parciais), `-status`, `-apagar`, `-sugestoes`,
  `-ignorar`, `-adicionar-do-resumo` ({meetingId, indices|'minhas'}), evento `scribe:tarefas-changed` (view inteira).

## Telas de impacto no usuário

Ver tabela do PRD. Resumo: barra lateral (item e badge), Tarefas (nova), Funil › Oportunidade (seção Tarefas no lugar do
próximo passo), kanban ("Sem tarefa"), Contatos/Empresas (seção Tarefas), Reunião › Resumo (Adicionar, estado, data real),
Email › leitura (+ Tarefa), WhatsApp › Detalhes (+ Tarefa), Assistente (fonte e cartões; `agendamento`), Automações
(Agendamentos; Pode ler as tarefas), Configurações › Geral (seção Tarefas).

## Alinhamento com o mockup (`mockups/Tarefas.dc.html`, 15 artboards, 2026-11-22)

Escolhas de layout do mockup que passam a valer como regra:
- **R3**: linha de 44 px com caixa, título, origem (~236 px), responsável (~112 px), estrela de importante (14 px, `--title`, sem
  cor nova) e prazo (~92 px) à direita; vencida "dd/mm · há N d" em `--rec` peso 500, "hoje" em `--text` peso 500. Com o
  detalhe aberto ao lado, a lista estreita (340 px) mostra duas linhas: título e "origem · prazo".
- **R4**: "Agrupar por" é um Select de 28 px alinhado ao Segmented; some em Sugestões e com o detalhe aberto. Grupos por
  oportunidade ordenados pelo prazo mais próximo do grupo, cabeçalho "nome · etapa · N"; "Sem oportunidade" por último.
- **R5**: Concluir, Cancelar e Apagar logo abaixo do título (como na ficha do contato); ao lado do Lembrete, o texto do aviso
  efetivo ("hoje, 09:00 · já avisou"); Reunião nos vínculos como "+ Vincular reunião".
- **R6**: o vínculo opcional é um campo com o ícone do funil e ×; abaixo, "Enter cria · Esc cancela".
- **R15**: a seção Tarefas fica entre a grade de campos e as abas, com "N abertas · a primeira é o próximo passo no quadro";
  Nova tarefa em linha de 40 px; Feitas recolhida em 28 px.
- **R19**: na ficha do contato, sublinhas de 32 px (como as Oportunidades da ficha) e "+ Nova tarefa" no estilo do "+ E-mail";
  o campo Notas da ficha **continua** (o mockup o omitiu só por espaço).
- **R22**: coluna de estado de 32 px à esquerda; Prazo mostra "dd/mm" e, em cinza, o que foi dito ("sexta"); à direita,
  Adicionar ou o ícone que abre a tarefa; "Adicionar as minhas" no título da seção.
- **R24**: o formulário fica numa caixa entre o cabeçalho e o corpo do e-mail, com a frase do vínculo; "+ Tarefa" fica
  pressionado enquanto aberto.
- **R25**: só "+ Tarefa"; o texto "N abertas com ele" do mockup **não** entra.
- **R28**: o cartão `tarefa-criar` mostra pares rótulo/valor (Prazo, Lembrete, Oportunidade, Contato); **Editar** troca os
  valores por campos no próprio cartão (como os cartões do funil).
- **R33**: botão "Pausar todas as tarefas" → "Pausar todos os agendamentos".
- **R32/R34**: rótulo em Configurações "Incluir oportunidades esfriadas no aviso Hoje" (substitui "Avisar oportunidades
  esfriadas e passos vencidos"; mesmo valor `funil.avisarEsfriadas`); a descrição de "esfriada" passa a citar tarefa concluída
  como interação. Dono: contrato das Configurações.
- **R18**: o item `tarefa` da linha do tempo carrega `tarefaId`, `titulo`, `prazo`, `origem` resumida ("criada por você na
  conversa com …" / "da reunião …") e o tipo do evento (criada/feita), com **Abrir tarefa**.
- **R33**: todo o vocabulário das Automações acompanha: "Nova tarefa" → "Novo agendamento", "Tarefas pausadas" →
  "Agendamentos pausados", "Pausar todas as tarefas" → "Pausar todos os agendamentos", notificação "Um agendamento
  terminou.", menu da bandeja e textos do smoke.

## Critérios de aceite

- **CA1** App sem `tarefas.json`, com 2 oportunidades abertas com próximo passo e 1 lembrete futuro: ao abrir, `tarefas.json`
  tem 3 tarefas (2 `migracao/proximo-passo`, 1 `migracao/lembrete`), `funil.json` sem `proximoPasso`, `schedules.json` sem
  `reminder`, backups criados; kanban mostra os mesmos passos de antes.
- **CA2** Barra lateral: Tarefas entre Reuniões e Assistente; com 2 vencidas, badge "2"; zero, sem badge.
- **CA3** Tela: Hoje lista vencidas (vermelho, "há N d") antes das de hoje; Próximas/Todas/Feitas nas ordens da R2; vazia →
  `EmptyState`. Linhas 44 px; caixa marca feita e a linha some de Hoje e aparece em Feitas.
- **CA4** Nova tarefa em linha com título e prazo cria `origem manual`; Enter cria; vazio não; ⌘⇧T foca o título.
- **CA5** Detalhe: mudar prazo recalcula o lembrete padrão para `prazo` às `horaLembrete`; lembrete "Em…" personalizado não
  é recalculado; Responsável → contato grava `contatoId`; Apagar pede confirmação em linha.
- **CA6** Lembrete: tarefa com `lembreteEm` 1 min no passado e sem disparo → no tick, notificação "Tarefa" com o título e
  `lembreteDisparadoEm` gravado; não repete; bloqueado → texto genérico.
- **CA7** Oportunidade: seção Tarefas com Nova em linha; criar 2 (prazos 25/11 e 23/11) → kanban mostra "23/11";
  concluir a de 23/11 → kanban mostra "25/11"; `FUNIL.md` lista as duas e depois uma; evento `tarefa` na linha do tempo.
- **CA8** Resumo com `dueIso`: Adicionar numa linha cria tarefa com prazo e vínculo à reunião (e à oportunidade quando
  existir); a linha passa a mostrar a caixa; Adicionar as minhas cria só as de "Você"; Gerar de novo mantém as criadas.
- **CA9** Email: + Tarefa cria com `vinculos.email` e o contato do remetente; Abrir e-mail no detalhe leva ao e-mail.
  WhatsApp: + Tarefa cria com `whatsappChatId`; Abrir conversa leva ao chat.
- **CA10** Sugestões: com 1 tarefa de resumo "Você", 1 `toConfirm` e 1 pendência do WhatsApp → 3 linhas e "Sugestões 3";
  Adicionar cria; Ignorar some e não volta após recarregar.
- **CA11** Assistente: fonte Tarefas ligada por padrão; "o que tenho para hoje?" cita `[Tarefa · …]`; "crie a tarefa X
  para sexta ligada à Loja virtual" → cartão `tarefa-criar` com oportunidade resolvida; clicar cria; `tarefa-concluir` com
  id inexistente → `failed`; o cartão `lembrete` cria tarefa com `lembreteEm`; `lembrete-apagar` remove a tarefa.
- **CA12** `agendamento` substitui `tarefa` no `proposedSchema`; cartão antigo persistido ainda renderiza.
- **CA13** Automações: Switch Pode ler as tarefas; execução com ele ligado tem `TAREFAS.md` 0600 na pasta e o apaga ao
  fim; desligado, não; texto "Agendamentos" na tela e no `AUTOMACOES.md`; lembretes não aparecem na lista.
- **CA14** Aviso Hoje: com 1 vencida, 1 de hoje e 1 esfriada → uma notificação com título "Hoje" e corpo "1 vencida · 1 para
  hoje · Funil: 1 esfriada" (só as partes diferentes de zero), uma vez por dia; tudo zerado → nenhuma.
- **CA15** Configurações › Geral › Tarefas: 4 campos gravam e recarregam; hora inválida é recusada.
- **CA16** Bloqueado: todos os canais `scribe:tarefas-*` e `scribe:chat-action-tarefa` respondem `refused`.
- **CA17** `pnpm gates` verde, `expectedShots` ajustado, nenhum e-mail/título no `report.json`, nenhum literal de cor.

## Prints exigidos (claro e escuro, salvo indicação)

`tarefas-hoje`, `tarefas-todas-agrupadas` (por Oportunidade), `tarefas-detalhe`, `tarefas-nova`, `tarefas-sugestoes`,
`tarefas-vazia` (claro), `funil-oportunidade` (com a seção Tarefas; substitui o atual), `funil-contato-tarefas` (claro),
`detalhe-resumo-tarefas` (Adicionar + estado), `email-leitura-tarefa` (formulário em linha), `whatsapp-detalhes-tarefa`
(claro), `assistente-tarefas` (cartão `tarefa-criar` e citação), `automacoes-agendamentos` (claro; substitui o nome),
`configuracoes-geral` (rolada até Tarefas; substitui), `sidebar-raiz` (com Tarefas e badge; substitui).

## Riscos

Mexer no `summaryContentSchema` (campo opcional, compatível); migração (um passo, backup, coberta por CA1 no smoke);
raiz com 9 itens; sugestões em excesso (30 dias, só "Você", máximo 100); renomear `tarefa`→`agendamento` quebra prompts
antigos do modelo (o prompt de sistema é atualizado junto).

## Fora de escopo

1. Sincronização externa (Lembretes/Calendário do Mac, Todoist, Notion, Google Tasks). 2. Subtarefa, projeto, kanban,
prioridade numérica, estimativa, tempo. 3. Atribuir com aviso a terceiros. 4. Recorrência. 5. `flagged` do IMAP.
6. Criação automática sem clique. 7. Lixeira/desfazer de tarefa apagada. 8. Tarefas em oportunidades fechadas pelo
Assistente.

## Gaps identificados

(Preenchido pela revisão do pacote e pela auditoria dos prints.)

## Verificação end-to-end

1. Abrir o app com `funil.json` com próximo passo e um lembrete pendente: Tarefas na barra; a lista tem as migradas; o
   kanban mostra os mesmos passos.
2. Nova tarefa "Mandar proposta" para amanhã ligada à "Loja virtual": aparece em Próximas e no cartão do kanban.
3. Abrir a oportunidade: seção Tarefas com ela; criar outra para hoje; o cartão passa a mostrar a de hoje; concluir →
   volta a mostrar a de amanhã; linha do tempo com os eventos.
4. Reunião com resumo: Adicionar as minhas → tarefas em Hoje/Próximas ligadas à reunião; marcar feita na própria tabela.
5. E-mail de um contato: + Tarefa com o assunto; no detalhe, Abrir e-mail volta ao e-mail.
6. WhatsApp: + Tarefa; Sugestões mostra a pendência dos insights; Ignorar uma.
7. Assistente: "o que tenho para hoje?" cita as tarefas; "conclua a Mandar proposta" → cartão → feita; "me lembra de
   ligar para o Paulo amanhã 10h" → tarefa com lembrete; mudar o relógio → notificação "Tarefa".
8. Automações: agente com Pode ler as tarefas, Pedir agora → resposta usa `TAREFAS.md`; tela mostra "Agendamentos".
9. Configurações: hora do lembrete 08:00 → tarefa nova com prazo recebe lembrete às 08:00.
10. Bloquear: Tarefas inacessível; notificação de lembrete genérica.
11. `pnpm gates` verde; prints de "Prints exigidos" gerados.
