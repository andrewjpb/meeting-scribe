---
status: arquivado
arquivado_em: 2026-11-21
feature: funil-vendas
data: 2026-11-20
semana: 2026-W47
base: main dd106ce (versão 0.19.0)
prd: ./prd.md
inventario: ./inventario.md
---

# Spec: Funil de vendas (Contatos, Empresas, Oportunidades)

## Problema e objetivo

O app já captura a matéria-prima de uma venda (participantes, decisões, tarefas, e-mails, WhatsApp) e não
tem a entidade que amarra isso: a **oportunidade**. Esta spec cria o módulo Funil, de uma pessoa só, local,
sem servidor, no mesmo padrão dos demais módulos (arquivo JSON em `userData`, zod, IPC tipado, telas no
design system denso, cartões do Assistente com clique). A IA **propõe**; o usuário **confirma**.

## Não-objetivos

Multiusuário, backend, CRM externo, marketing, relatórios além dos totais, moeda ≠ BRL, campos
personalizados, e-mail novo pelo Assistente, importar do Contatos do Mac, exportação. Lista completa em
"Fora de escopo".

## O que existe hoje

Ver `inventario.md`. Em resumo: nenhum store de contatos; dados de pessoa espalhados em
`Meeting.calendar.attendees`, `EmailMessage.from/to/cc`, `WhatsAppChat {name, phone}` e eventos de agenda;
padrão de store em `src/main/schedules/store.ts:50-62`; cartões do Assistente em `src/shared/assistant.ts` +
`src/main/chat/actions.ts` + `features/chat/ActionCards.tsx`; fontes em `src/main/chat/sources.ts`;
extração pós-reunião em `summary-service.ts` (uma passada, `summaryContentSchema`); sem modal, sem
biblioteca de kanban (DnD nativo HTML5 já usado em Email); `SETTINGS_TABS` esgotado (9 abas).

## Modelo de dados

Arquivo único `userData/funil.json`, `{version: 1, contatos, empresas, oportunidades, etapas, eventos,
ignorados, ultimoAvisoEm: number | null}`, gravado pelo mesmo padrão de `schedules/store.ts` (fila serial + escrita atômica `0o600`;
arquivo inválido vira `.corrupt-<stamp>` e o app parte de vazio). Tipos em `src/shared/funil.ts`, zod em
`src/shared/funil-schema.ts` com checagem `Same<>`.

```ts
type Contato = {
  id: string; nome: string;                     // nome ≤ 200
  emails: string[];                             // normalizados (trim, lowercase), ≤ 10
  telefones: string[];                          // E.164 quando possível ('+5511…'), ≤ 10
  empresaId: string | null; cargo: string | null; notas: string;   // notas ≤ 20 000
  whatsappChatId: string | null;                // '5511…@s.whatsapp.net' quando ligado
  origem: 'manual' | 'importacao' | 'reuniao' | 'email' | 'whatsapp' | 'agenda' | 'assistente';
  criadoEm: number; atualizadoEm: number; arquivado: boolean;
};
type Empresa = { id; nome; dominios: string[]; site: string | null; notas: string; criadoEm; atualizadoEm };
type Etapa = { id: string; nome: string; tipo: 'aberta' | 'ganho' | 'perdido'; ordem: number };
type Oportunidade = {
  id; titulo; empresaId: string | null; contatoIds: string[];
  etapaId: string; ordem: number;               // ordem dentro da coluna
  valor: number | null;                         // centavos de BRL, inteiro ≥ 0
  previsao: string | null;                      // 'AAAA-MM-DD'
  proximoPasso: { texto: string; data: string | null } | null;
  meetingIds: string[]; whatsappChatIds: string[];
  emails: { accountId: string; id: string; assunto: string; de: string; data: number }[];  // o id é o UID na conta; o resumo fica guardado porque o cache de e-mail só mantém 200 por pasta
  origem: 'manual' | 'reuniao' | 'assistente';
  motivoPerda: string | null;
  criadoEm; atualizadoEm; movidoEm: number;     // última mudança de etapa
  fechadoEm: number | null; arquivado: boolean;
};
type EventoFunil = {                            // histórico do funil (não inclui emails/reuniões, que são derivados)
  id; oportunidadeId; at: number;
  tipo: 'criada' | 'etapa' | 'valor' | 'proximo-passo' | 'nota' | 'vinculo' | 'ganho' | 'perdido' | 'reaberta';
  texto: string; de?: string; para?: string;
};
type Ignorado = { chave: string; at: number };  // 'email:<addr>' | 'tel:<e164>' | 'wa:<chatId>' | 'reuniao:<meetingId>'
```

Etapas padrão (criadas na primeira leitura do arquivo vazio): `Contato`, `Descoberta`, `Proposta`,
`Negociação` (tipo `aberta`), `Ganho` (tipo `ganho`), `Perdido` (tipo `perdido`). As duas finais não podem
ser apagadas nem mudar de tipo; podem ser renomeadas.

Limites: 10 000 contatos, 2 000 empresas, 5 000 oportunidades, 50 000 eventos (acima disso o store recusa
com erro `limite` e a tela avisa). Arquivo de importação ≤ 5 MB e ≤ 10 000 linhas.

Proposta de IA por reunião: `userData/meetings/<id>.funil.json`
`{version: 1, meetingId, createdAt, model, status: 'proposed'|'accepted'|'dismissed', proposta: PropostaOportunidade | null, oportunidadeId?: string}`.
`PropostaOportunidade = {acao: 'criar'|'atualizar', oportunidadeId?: string, titulo, empresa: string|null,
contatos: {nome, email: string|null}[], etapaSugerida: string, valor: number|null (centavos de BRL),
previsao: string|null, proximoPasso: {texto, data: string|null}|null, justificativa: string}`. Esse arquivo
segue o padrão de `meetings/summaries.ts` e é apagado junto com a reunião. `Oportunidade.meetingIds`
**mantém** o id da reunião apagada; a linha do tempo mostra a entrada como "Reunião apagada" quando a
reunião não existe mais, e a aba Reuniões permite desvinculá-la.

Valores em BRL são exibidos como `R$ 38.000` quando os centavos são zero e `R$ 1.250,50` quando não são;
um único `formatarBRL()` em `src/shared/funil-logic.ts` é usado por todas as telas e pelo `FUNIL.md`.

## Regras

### Store, normalização e dedupe
- **R1** QUANDO o app grava qualquer alteração do funil O SISTEMA DEVE escrever `funil.json` pela fila serial
  e por arquivo temporário + `rename`, com `mode 0o600`, como `schedules/store.ts:50-62`; na primeira
  gravação de cada dia DEVE antes copiar o arquivo atual para `funil.json.bak-<AAAA-MM-DD>` e manter só as
  7 cópias mais recentes.
- **R2** QUANDO `funil.json` não valida pelo zod O SISTEMA DEVE renomeá-lo para `funil.json.corrupt-<stamp>`,
  partir de um arquivo vazio com as etapas padrão e registrar uma linha de log; nunca sobrescrever o inválido.
- **R3** QUANDO um e-mail é guardado em contato O SISTEMA DEVE normalizar com `trim` e minúsculas; QUANDO um
  telefone é guardado O SISTEMA DEVE normalizar para E.164: remover tudo que não é dígito e o `0` de tronco
  inicial; 10 ou 11 dígitos recebem `+55`; 12 ou 13 dígitos começando com `55` recebem `+`; demais casos
  guardam o texto limpo. Para comparar (R4, R10) dois números brasileiros são iguais com ou sem o nono
  dígito (`+55 11 98765 4321` = `+55 11 8765 4321`).
- **R4** QUANDO se cria ou importa um contato com e-mail ou telefone que já pertence a outro contato O
  SISTEMA DEVE **mesclar** no existente (acrescentar e-mails, telefones, empresa e cargo que faltam; nunca
  sobrescrever nome, notas nem campos já preenchidos; se estava arquivado, desarquivar) em vez de criar
  duplicado.
- **R5** QUANDO um contato recebe um e-mail de domínio que não está na lista de provedores pessoais
  (`gmail.com, googlemail.com, hotmail.com, outlook.com, live.com, msn.com, yahoo.com, yahoo.com.br,
  icloud.com, me.com, uol.com.br, bol.com.br, terra.com.br, protonmail.com, proton.me, globo.com, ig.com.br`) O
  SISTEMA DEVE ligá-lo à empresa que tem esse domínio em `dominios`; se não houver, DEVE sugerir criar a
  empresa com o nome do domínio sem TLD capitalizado (`acme.com.br` → "Acme"). A sugestão só vira empresa no
  clique.
- **R6** QUANDO uma oportunidade muda de etapa O SISTEMA DEVE atualizar `movidoEm`, criar `EventoFunil` tipo
  `etapa` (com `de`/`para`) e, se a etapa destino for `ganho` ou `perdido`, preencher `fechadoEm`; QUANDO
  volta para etapa `aberta` DEVE limpar `fechadoEm` e `motivoPerda` e criar evento `reaberta`.
- **R7** O SISTEMA DEVE calcular a **última interação** de uma oportunidade como o maior entre: `movidoEm`,
  `atualizadoEm`, `startedAt` da reunião ligada mais recente, `date` do e-mail ligado mais recente e `at` da
  última mensagem de um chat do WhatsApp ligado. Oportunidade aberta com última interação há mais de
  `funil.diasEsfriar` dias (padrão 7, mínimo 1, máximo 90) está **esfriada**.

### Ligação automática com reuniões, e-mails e WhatsApp
- **R8** O SISTEMA DEVE considerar uma reunião ligada a um contato quando algum `calendar.attendees[].email`
  é igual a um e-mail do contato, além das reuniões em `Oportunidade.meetingIds`.
- **R9** O SISTEMA DEVE considerar um e-mail ligado a um contato quando `from`, `to` ou `cc` contém um
  e-mail do contato, excluídos os endereços das próprias contas do usuário. A linha do tempo de uma
  oportunidade mostra os e-mails dos seus contatos **a partir de `criadoEm` menos 30 dias**, mais os
  `emails` explícitos (exibidos pelo resumo guardado, com link que só abre se o e-mail ainda estiver no
  cache).
- **R10** O SISTEMA DEVE considerar um chat do WhatsApp ligado a um contato quando `whatsappChatId` está
  preenchido ou quando `chat.phone ?? phoneOfChatId(chat.id)` (precedente `actions.ts:439`, cobre chats
  `@lid`), normalizado por R3, é igual a um telefone do contato.

### Sugestões de contato
- **R11** QUANDO a aba Sugestões é aberta O SISTEMA DEVE listar candidatos vindos de: participantes de
  reuniões (`calendar.attendees`), remetentes e destinatários dos e-mails em cache **com duas ou mais
  mensagens trocadas nos últimos 90 dias**, chats do WhatsApp do tipo `person` com mensagem nos últimos 90
  dias; a agenda **não** é fonte (o cache cobre só 1 h antes a 24 h depois e sem e-mail, e o registro de
  convites `invites/store.ts:42-56` não guarda participantes; o remetente de um convite já entra pelo
  e-mail); excluídos: endereços das contas do usuário,
  o próprio número do WhatsApp, endereços com `noreply|no-reply|nao-responda|newsletter|notification|
  mailer-daemon|bounce` no local-part, grupos, candidatos cuja chave esteja em `ignorados` e candidatos cujo
  e-mail ou telefone já pertença a um contato.
- **R12** Cada sugestão agrupa pelo e-mail (ou telefone, no WhatsApp) e mostra nome, canal(is), número de
  interações e a data da última; as ações são **Adicionar** (cria contato com `origem` da fonte principal) e
  **Ignorar** (grava em `ignorados`). "Adicionar todos" não existe nesta versão.

### Importação
- **R13** QUANDO o usuário clica "Importar…" O SISTEMA DEVE abrir o diálogo nativo de arquivo com filtros
  `csv`, `vcf`, `txt`, aceitar um arquivo por vez até 5 MB, e no smoke trocar o diálogo por fixture como os
  demais (`smokeFixtures`).
- **R14** QUANDO o arquivo é CSV O SISTEMA DEVE detectar o separador (`,` `;` `\t`) e a codificação (UTF-8
  com ou sem BOM; Latin-1 como alternativa), ler a primeira linha como cabeçalho e **mapear automaticamente**
  as colunas por nome (sem acento, minúsculo): `nome|name|contato|full name|first name`+`last name`,
  `email|e-mail|correio`, `telefone|phone|celular|whatsapp|mobile|tel`, `empresa|company|organização|
  organization`, `cargo|title|job title|função`. A tela mostra a prévia das 5 primeiras linhas com um
  `Select` por coluna para corrigir o mapeamento (opções: Nome, E-mail, Telefone, Empresa, Cargo, Ignorar).
- **R15** QUANDO o arquivo é vCard (`.vcf`, versões 2.1, 3.0 e 4.0) O SISTEMA DEVE ler `FN` (ou `N`), `EMAIL`
  (todos), `TEL` (todos), `ORG` e `TITLE`, aceitando vários cartões no mesmo arquivo; a prévia mostra os 5
  primeiros sem mapeamento.
- **R16** QUANDO o usuário confirma a importação O SISTEMA DEVE criar ou mesclar (R4) cada linha que tenha
  nome **e** pelo menos um e-mail ou telefone, pular as demais, e ao fim mostrar na própria tela
  "N criados · M atualizados · K ignorados (sem e-mail nem telefone)". A leitura do arquivo é um módulo
  **puro** em `src/shared/funil-import.ts`, testado com fixtures, sem Electron.

### Telas: navegação
- **R17** O SISTEMA DEVE ter a rota `funil` com `ROUTE_PATHS.funil = '/funil/:secao?/:id?'`,
  `FUNIL_SECTIONS = ['oportunidades','contatos','empresas']` e `funilPath(secao?, id?)`, com item **Funil**
  na raiz da barra lateral (ícone `Funnel` do lucide) **entre Email e Redes**; `/funil` redireciona
  para `/funil/oportunidades`.
- **R18** O SISTEMA DEVE registrar `funil` em `SIDEBAR_SECTIONS` e um `FunilLevel` no segundo nível com três
  linhas de 28 px: Oportunidades, Contatos, Empresas; `sectionOf`, `levelFor`, `activeNavId` e
  `transitionOf` passam a cobrir a seção, com testes em `test/renderer/sidebar-stack.test.ts`.
- **R19** O SISTEMA DEVE ter o marcador `<!-- tela: funil -->` em `resources/assistente/guia-do-app.md`, com
  o texto do guia explicando as três telas, a importação e os cartões.
- **R20** `OPEN_SCREENS` ganha `'funil'`, `'oportunidade'` e `'contato'` e `OpenCard` navega para
  `funilPath('oportunidades')`, `funilPath('oportunidades', id)` e `funilPath('contatos', id)`.

### Tela Oportunidades (kanban)
- **R21** A tela usa `PageHeader` "Oportunidades" com, à direita: `SearchField` (filtra por título, empresa e
  contato), `Segmented` **Abertas · Ganhas · Perdidas · Todas** (padrão Abertas) e `Button primary`
  "Nova oportunidade" (`action="funil-nova"`). Abaixo do header, uma linha de 32 px com os totais
  "N abertas · R$ X em aberto · R$ Y ganho em <mês atual>" à esquerda e o botão secundário "Editar etapas" à
  direita.
- **R22** Cada coluna tem cabeçalho de 44 px (`--panel-head-h`) com nome, contagem e soma de `valor`
  formatada em BRL; a área rola verticalmente por coluna e horizontalmente na tela quando as colunas não
  cabem (largura mínima de coluna 170 px; em 1120 px de janela as quatro abertas cabem sem rolagem). Com o
  filtro **Abertas**, as colunas `ganho` e `perdido` ficam **recolhidas** a uma faixa vertical de 32 px de
  largura no fim, com nome e contagem em texto vertical (a contagem da faixa é o **total** de
  oportunidades não arquivadas da etapa, sem o corte de 90 dias), e expandem no clique. Coluna vazia mostra a área
  tracejada "Arraste uma oportunidade para cá".
- **R23** O cartão (`data-funil-card`) mostra: título (1 linha), empresa (ou "Sem empresa"), valor em BRL (ou
  "—"), próximo passo com data (ou "Sem próximo passo", em `--rec` quando a data venceu), e no rodapé
  "há N d nesta etapa" e o marcador **esfriou** (texto, cor `--rec`) quando R7 vale. Clique abre o detalhe.
  A previsão vencida também aparece em `--rec`. Filtros: **Abertas** expande as etapas `aberta` e recolhe
  `ganho` e `perdido`; **Ganhas** expande só `ganho` (as demais recolhidas); **Perdidas** expande só
  `perdido`; **Todas** expande as seis. Em Ganhas, Perdidas e Todas, as colunas finais mostram por padrão
  só as oportunidades fechadas nos **últimos 90 dias**, com a linha "Mostrar todas (N)" no fim da coluna.
  Oportunidades `arquivado: true` nunca aparecem no kanban. A busca filtra os cartões dentro do filtro
  ativo.
- **R24** QUANDO o usuário arrasta um cartão para outra coluna (DnD nativo HTML5, como
  `EmailNav.tsx:104-234`) O SISTEMA DEVE aplicar R6 ao soltar e reordenar `ordem` dentro da coluna destino;
  QUANDO a coluna destino é `perdido` O SISTEMA DEVE mostrar **no próprio cartão** um campo "Motivo" com
  Salvar/Cancelar e só gravar no Salvar (Cancelar devolve o cartão à coluna de origem); com a coluna
  Perdido recolhida, o formulário aparece no cartão **ainda na coluna de origem**. QUANDO o cartão passa por
  cima de uma faixa recolhida (Ganho ou Perdido) O SISTEMA DEVE destacá-la como alvo de soltar
  (`--accent` na borda) e aceitar o drop sem expandi-la.
- **R25** QUANDO o usuário clica "Nova oportunidade" O SISTEMA DEVE inserir **no topo da primeira coluna
  aberta** um cartão em edição com Título (obrigatório), Empresa (`SearchPicker` + "Nova empresa…"),
  Contatos (`SearchPicker` que adiciona chips), Valor (R$) e Previsão (data), com Criar/Cancelar; nenhum
  modal. `SearchPicker` é um componente novo em `features/funil/SearchPicker.tsx`, usado para Empresa e
  Contatos em todas as telas do funil: um `TextField` que, com foco e texto, mostra abaixo uma lista de até
  8 resultados (linhas de 32 px, navegáveis por setas e Enter) e uma última linha "Criar «texto»" quando
  permitido; não existe hoje "Select com busca" no design system. QUANDO a empresa escolhida já tem
  oportunidade aberta O SISTEMA DEVE mostrar no formulário o aviso "Já existe «<título>» aberta para esta
  empresa" com link, sem impedir a criação.
- **R26** QUANDO o usuário clica "Editar etapas" O SISTEMA DEVE trocar os cabeçalhos das colunas por campos
  editáveis com alça de arrastar para reordenar, botão "×" para apagar (só etapa `aberta` **vazia**) e um
  botão "+ Etapa" ao fim; "Concluir" volta ao normal. Ganho e Perdido só renomeiam.

### Tela Oportunidade (detalhe)
- **R27** Cabeçalho com `EditableTitle`, `Select` de etapa à direita do título e `DeleteAction` que confirma
  na própria linha, como `MeetingDetailScreen`. Abaixo, uma faixa de campos em duas colunas: Empresa,
  Contatos (chips com "×" e "+ Contato"), Valor, Previsão, Próximo passo (texto + data), Origem (texto),
  e, quando etapa `perdido`, Motivo. Edição inline; cada campo salva no blur ou Enter. Oportunidade em etapa
  `ganho` ou `perdido` tem a ação **Arquivar** (confirma na linha; some do kanban e do `FUNIL.md`, continua
  na ficha do contato e da empresa).
- **R28** Ações no cabeçalho (`ActionButton`): **Escrever e-mail** (abre `/email` com o Composer aberto e
  `to` = e-mails dos contatos; exige `EmailNavigationState.compose?: {to: string[]; subject?: string}` novo e o
  Composer aceitando pré-preenchimento pelo `newMessage(to)` já existente em `EmailScreen.tsx:~394`, que
  põe a assinatura), **Abrir WhatsApp** (visível só quando algum contato tem chat ligado; navega para
  `/whatsapp` com `WhatsAppNavigationState {chatId}`, pois `scribe:open-whatsapp` é evento do main para o
  renderer), **Vincular reunião** (abre lista inline das reuniões dos últimos 90
  dias com busca; clique adiciona a `meetingIds`), **Marcar como ganha** / **Marcar como perdida** (aplica
  R6/R24).
- **R29** Abas `Tabs` **Linha do tempo · Reuniões · Notas**. Linha do tempo: lista única ordenada por data
  decrescente com reuniões (título, data, 1 linha do `overview`, link para `/reunioes/:id`), e-mails (assunto,
  de/para, data, link que abre o e-mail), WhatsApp (nome do chat, última mensagem, link) e `EventoFunil`
  (texto). Reuniões: só as reuniões, com "Desvincular" na linha. Notas: campo de texto que cria
  `EventoFunil` tipo `nota` no Salvar, listadas abaixo.

### Tela Contatos
- **R30** Layout lista + ficha como `EmailScreen` (lista 340 px). `PageHeader` "Contatos" com `SearchField`
  (nome, e-mail, telefone, empresa), `Button secondary` "Importar…" (`action="funil-importar"`) e
  `Button primary` "Novo contato" (`action="funil-novo-contato"`). Sob o header, `Segmented` **Contatos ·
  Sugestões (N)**. A lista ordena por `atualizadoEm` decrescente; cada linha (44 px) tem nome, empresa,
  e-mail principal e um `label` de origem.
- **R31** A ficha mostra Nome (`EditableTitle`), Empresa (`Select` com "Nova empresa…"), Cargo, E-mails (lista
  com "+" e "×"), Telefones (idem), Notas (textarea), e os blocos **Oportunidades** (linhas com etapa e valor,
  link) e **Linha do tempo** (R8–R10, mesma apresentação de R29). Ações no cabeçalho da ficha: **Escrever
  e-mail**, **Abrir WhatsApp** (quando ligado), **Nova oportunidade** (cria em edição no kanban já com o
  contato), **Arquivar** (confirma na linha).
- **R32** "Novo contato" abre a ficha vazia à direita em modo criação (Nome obrigatório + ao menos um e-mail
  ou telefone) com Criar/Cancelar. "Importar…" troca a área da ficha pela tela de importação (R13–R16):
  nome do arquivo, prévia, mapeamento, botão "Importar N contatos", resultado.
- **R33** A aba Sugestões lista R11/R12 em linhas de 44 px: nome, canal (ícones Mail/Smartphone/
  NotebookText/Calendar), "N interações · última em <data>", botões `ActionButton` **Adicionar** e **Ignorar**.
  Vazia: `EmptyState` "Nenhuma sugestão. Reuniões, e-mails e conversas novas aparecem aqui."

### Tela Empresas
- **R34** Lista + ficha como R30 (sem Sugestões, sem Importar): `PageHeader` "Empresas" com `SearchField` e
  "Nova empresa". Ficha: Nome, Domínios (chips), Site, Notas, blocos **Contatos** e **Oportunidades** com
  links, e ação **Nova oportunidade**. Apagar empresa só quando sem contatos e sem oportunidades; caso
  contrário o botão fica desabilitado com a razão em `title`.

### Botões nas telas existentes
- **R35** `SummaryTab` (Reunião › Resumo) ganha um bloco **Participantes** (hoje inexistente), abaixo das
  tarefas, listando `calendar.attendees` da reunião (nome e e-mail). Para cada participante com e-mail: o
  nome do contato ligado como link para `/funil/contatos/:id`, ou o `ActionButton` **"+ Contato"** que cria o
  contato (`origem: 'reuniao'`) na hora, sem sair da tela. Reunião sem `calendar` não mostra o bloco.
- **R36** Em `ReadingPane` (Email), ao lado do remetente: link para a ficha quando o endereço pertence a um
  contato; senão `ActionButton` **"+ Contato"** (`origem: 'email'`), que usa o `name` do `EmailAddress` ou o
  local-part como nome. Mensagens das próprias contas não mostram o botão.
- **R37** Em `DetailsPanel` (WhatsApp, chats `person`), bloco **Contato** no topo: ficha ligada (nome,
  empresa, oportunidades com etapa) ou **"+ Contato"** (`origem: 'whatsapp'`, `whatsappChatId` = chat,
  telefone = `phoneOfChatId`).

### IA: detecção de oportunidade na reunião
- **R38** QUANDO o resumo de uma reunião termina com sucesso E `funil.detectarNasReunioes` está ligado O
  SISTEMA DEVE rodar uma passada separada (`purpose: 'funnel-extract'` nas duas uniões, `ACP_FUNNEL_DIR`,
  prompt em `src/main/claude-cli/funnel.ts`, saída validada por `src/shared/funil-proposta-schema.ts`) com
  modelo Haiku por padrão, recebendo: `overview`, `decisions`, `tasks`, `<participantes>`, e a lista das
  oportunidades **abertas** (id, título, empresa, contatos, etapa) para que o modelo escolha entre `criar` e
  `atualizar`. Resposta `{proposta: null}` quando não há venda. Falha de formato grava
  `status: 'dismissed'` com `erro` e nunca bloqueia o resumo. No smoke (`smokeFixtures` presente) a
  detecção automática **não roda**; o cenário do smoke usa "Detectar oportunidade" (R40) na reunião de
  teste, para que os prints existentes não mudem. `acao: 'atualizar'` com `oportunidadeId` que
  não existe ou não está aberta é rebaixada para `criar`; `etapaSugerida` que não bate com nenhuma etapa
  `aberta` (comparação sem acento e sem maiúscula) vira a primeira etapa aberta; os dois casos acrescentam
  uma linha à `justificativa`. Ao gravar o arquivo o main emite `MainEvents` `scribe:funil-proposta-changed
  {meetingId}` para a aba Resumo recarregar.
- **R39** QUANDO existe `<id>.funil.json` com `status: 'proposed'` O SISTEMA DEVE mostrar em `SummaryTab`,
  acima das tarefas, o cartão **"Oportunidade detectada"** (ou **"Atualizar oportunidade: <título>"**) com
  os campos editáveis (título, empresa, contatos, etapa, valor, previsão, próximo passo), a justificativa em
  `label`, e os botões **Criar** (ou **Atualizar**), **Vincular a existente…** (`Select` das abertas) e
  **Ignorar**. Criar: cria contatos que faltam (R4) com `origem: 'reuniao'` **somente os que têm e-mail**
  (contato citado sem e-mail entra como texto na nota da oportunidade "Citados na reunião: …", a menos que o
  usuário preencha o e-mail no cartão), cria/atualiza a oportunidade com `origem: 'reuniao'` e
  `meetingIds += id`, e grava `status: 'accepted'`. Ignorar grava `dismissed`. Nada acontece sem clique.
  Com `acao: 'criar'` e já existindo oportunidade aberta da mesma empresa, o cartão mostra o aviso de R25 e
  sugere "Vincular a existente…" como ação secundária em destaque.
- **R40** A aba Resumo ganha, na linha de ações "Copiar resumo / Gerar de novo" (`SummaryTab.tsx:~180`), a
  ação **"Detectar oportunidade"** (`Button secondary` de 32 px, alinhado aos vizinhos) que roda R38 sob demanda (também quando o
  interruptor geral está desligado). Enquanto roda, o botão fica desabilitado com o texto "Detectando…".

### Assistente
- **R41** `CHAT_SOURCE_KINDS` ganha `'funil'` (**desligado por padrão**, como Redes: o `FUNIL.md` leva
  nomes, e-mails e telefones ao modelo; a pessoa liga no painel Contexto), `SOURCE_FILES.funil = 'FUNIL.md'` e
  `writeSources` grava `FUNIL.md` com: etapas; oportunidades abertas (id, título, empresa, contatos com
  e-mail, etapa, valor, previsão, próximo passo, última interação, "esfriada" quando R7, reuniões ligadas por
  id e título); ganhas e perdidas dos últimos 90 dias; contatos (id, nome, empresa, e-mails, telefones) até
  **500**, e acima disso a nota "lista truncada; peça pelo nome". `SourcesSection` ganha a linha **Funil**.
- **R42** `assistantSystemPrompt` descreve `FUNIL.md`, a citação `[Funil · <título da oportunidade>]` /
  `[Funil · Contato <nome>]` e os quatro cartões novos: `oportunidade-criar {titulo, empresa, contatos:[{nome,
  email}], etapa, valor, previsao, proximoPasso}`, `oportunidade-mover {oportunidadeId, etapa, nota}`,
  `oportunidade-proximo-passo {oportunidadeId, texto, data}`, `contato-criar {nome, email, telefone,
  empresa, cargo}`. `proposedSchema`, `resolve` (resolve ids e nomes **pelo app**: oportunidade e etapa
  precisam existir, senão o cartão vem `failed` com a razão; `contato-criar` sem e-mail nem telefone vem
  `failed` com "Informe um e-mail ou telefone"; `oportunidade-mover` para etapa `perdido` usa `nota`
  como `motivoPerda`), `actionsHistory`, `ChatAction`, `chat/store.ts` e `ActionCards` cobrem os quatro
  tipos. Um canal novo `scribe:chat-action-funil` (`refused` quando bloqueado)
  executa no clique, com `busy` e exigindo `proposed`; `assistant.test.ts` atualiza a lista de canais.
- **R43** Os cartões de funil no renderer mostram o que vai acontecer em texto ("Mover **ABF · Portal** de
  Proposta para Negociação") e, no `oportunidade-criar`, os campos editáveis antes do clique, como `EventCard`.

### Alertas e Automações
- **R44** QUANDO `funil.avisarEsfriadas` está ligado O SISTEMA DEVE, no tick existente de `schedules/service.ts`,
  uma vez por dia (primeiro tick após 09:00 local, registrado em `funil.json` como `ultimoAvisoEm`), emitir
  **uma** notificação do macOS agrupada: "Funil: N oportunidades esfriaram, M com próximo passo vencido" cujo
  clique abre `/funil/oportunidades`. Sem oportunidades nessas condições, nenhuma notificação.
- **R45** QUANDO uma tarefa agendada ou "Pedir agora" roda com um agente que tem a fonte Funil ligada O
  SISTEMA DEVE gravar `FUNIL.md` (mesmo conteúdo de R41) na pasta da execução. O `AgentForm` ganha o
  interruptor **"Pode ler o funil"** (desligado por padrão), persistido em `agents.json`.

### Configurações
- **R46** `DEFAULT_SETTINGS.funil = {detectarNasReunioes: true, diasEsfriar: 7, avisarEsfriadas: true}`,
  esquema em `main/settings/schema.ts`, linhas em `settingsIndex()`, e uma `Section` **Funil de vendas** na
  aba **Geral** (`panel('geral', …)`) com `Switch` "Detectar oportunidades nas reuniões", `TextField` numérico
  "Considerar esfriada após (dias)" (1–90; valor fora do intervalo ou vazio volta ao último válido no blur,
  sem gravar) e `Switch` "Avisar oportunidades esfriadas e passos vencidos".

### IPC
- **R47** Canais em `shared/ipc.ts`, todos em `INVOKE` e `WHEN_LOCKED` como `refused` quando bloqueado
  (`session` só vale para os canais de fim de gravação, `ipc.ts:~1073`): `scribe:funil-get` (estado completo), `scribe:funil-contato-save|archive`,
  `scribe:funil-empresa-save|delete`, `scribe:funil-oportunidade-save|move|delete|archive`,
  `scribe:funil-etapas-save`, `scribe:funil-evento-add`, `scribe:funil-sugestoes` (R11),
  `scribe:funil-ignorar`, `scribe:funil-importar-abrir` (diálogo + leitura + prévia),
  `scribe:funil-importar-confirmar`, `scribe:funil-timeline` (R8–R10 para contato ou oportunidade),
  `scribe:funil-proposta-get|aplicar|descartar|detectar` (R38–R40). Eventos `MainEvents`
  `scribe:funil-changed` após toda gravação de `funil.json` e `scribe:funil-proposta-changed {meetingId}`
  após gravar `<id>.funil.json`; o renderer mantém um `funilStore` zustand que recarrega no primeiro.

## Telas de impacto no usuário

Ver tabela do PRD. Posição dos botões, por tela:

| Tela | Onde | Botão/ação |
|---|---|---|
| Barra lateral raiz | entre Email e Redes | **Funil** (ícone `Funnel`) |
| Barra lateral nível Funil | 3 linhas de 28 px | Oportunidades · Contatos · Empresas |
| Oportunidades | `PageHeader.actions` | Busca · Segmented Abertas/Ganhas/Perdidas/Todas · **Nova oportunidade** (primary) |
| Oportunidades | linha de totais (32 px) | totais à esquerda · **Editar etapas** (secondary) à direita |
| Oportunidades | cartão | clique abre detalhe; arrastar move; coluna Perdido pede motivo no cartão |
| Oportunidade | cabeçalho | título editável · Select de etapa · Escrever e-mail · Abrir WhatsApp · Vincular reunião · Marcar ganha/perdida · Apagar (confirma na linha) |
| Oportunidade | abas | Linha do tempo · Reuniões · Notas |
| Contatos | `PageHeader.actions` | Busca · **Importar…** (secondary) · **Novo contato** (primary) |
| Contatos | sob o header | Segmented Contatos · Sugestões (N) |
| Contatos › Sugestões | cada linha | Adicionar · Ignorar |
| Contatos › ficha | cabeçalho | Escrever e-mail · Abrir WhatsApp · Nova oportunidade · Arquivar |
| Empresas | `PageHeader.actions` | Busca · **Nova empresa** (primary) |
| Reunião › Resumo | acima das tarefas | cartão Oportunidade detectada: **Criar/Atualizar** · Vincular a existente… · Ignorar |
| Reunião › Resumo | linha de ações Copiar resumo / Gerar de novo | **Detectar oportunidade** |
| Reunião › Resumo | bloco Participantes (novo, abaixo das tarefas) | **+ Contato** ou nome com link |
| Email › leitura | ao lado do remetente | **+ Contato** ou nome com link |
| WhatsApp › Detalhes | topo do painel | bloco Contato: **+ Contato** ou ficha ligada |
| Assistente › Contexto | Fontes | linha **Funil** com Switch |
| Assistente › conversa | cartões | oportunidade-criar · oportunidade-mover · oportunidade-proximo-passo · contato-criar |
| Automações › Agente | formulário | Switch **Pode ler o funil** |
| Configurações › Geral | Section | **Funil de vendas**: 2 Switch + 1 campo numérico |

Mockups a aprovar antes dos contratos de UI: `mockups/Funil.dc.html` (16 artboards, PNGs em
`mockups/png/` claro e escuro): barra raiz e nível Funil, Oportunidades (kanban), motivo da perda, nova
oportunidade, editar etapas, Oportunidade (detalhe), Contatos (lista + ficha), Sugestões, Importar,
Empresas, Reunião › Resumo com cartão de oportunidade, Assistente com cartões, Configurações › Geral ›
Funil, Email › leitura com "+ Contato", WhatsApp › Detalhes com bloco Contato.

Escolhas de desenho já incorporadas a esta spec (R22, R24, R35, R40): coluna mínima de 170 px; Ganho e
Perdido recolhidos como faixas verticais de 32 px; com Perdido recolhido, o motivo da perda é pedido no
cartão ainda na coluna de origem; "+ Etapa" como faixa tracejada e Ganho/Perdido renomeiam pelo lápis;
ações do detalhe e das fichas numa linha própria abaixo do título; chips retangulares de raio 4, contato
ainda não criado com fundo `--hl`. Divergências do desenho que **não** valem: o artboard 04 mostra
"R$ 186.000,00" (vale `formatarBRL`, sem centavos zerados) e o artboard 09 põe Participantes acima do
cartão (vale R35, abaixo das tarefas). Não desenhados (ficam para o contrato, seguindo o padrão dos
artboards vizinhos): cartões `oportunidade-proximo-passo` e `contato-criar`, variante "Atualizar
oportunidade", ficha Novo contato, prévia de vCard, Switch "Pode ler o funil", notificação.

## Critérios de aceite

Store e lógica pura (vitest):
- **CA1** `funil-store.test.ts`: criar contato com e-mail `Ana@ACME.com.br ` grava `ana@acme.com.br`; segundo
  contato com o mesmo e-mail mescla (R4) e o total continua 1; telefone `(11) 98765-4321` grava `+5511987654321`.
- **CA2** `funil-store.test.ts`: arquivo com JSON inválido → renomeado `.corrupt-*`, estado vazio com 6
  etapas padrão; apagar `Ganho` lança `etapa-fixa`; apagar etapa aberta com oportunidade lança `etapa-em-uso`.
- **CA3** `funil-store.test.ts`: mover para `Perdido` sem motivo é aceito pelo store (o motivo é regra de
  tela); `fechadoEm` preenchido; mover de volta para `Proposta` limpa `fechadoEm` e cria evento `reaberta`.
- **CA4** `funil-logic.test.ts`: `ultimaInteracao()` escolhe o maior entre as cinco fontes de R7;
  `esfriada()` com 7 dias é verdadeiro para 8 dias e falso para 6.
- **CA5** `funil-import.test.ts`: CSV com `;` e BOM, cabeçalho `Nome;E-mail;Telefone;Empresa` → 3 linhas
  mapeadas, 1 pulada sem e-mail/telefone; CSV com `First name,Last name,Email` junta o nome; vCard 3.0 com 2
  cartões e 2 `EMAIL` cada → 2 contatos com 2 e-mails; arquivo de 5 MB + 1 byte recusa com `arquivo-grande`.
- **CA6** `funil-sugestoes.test.ts`: remetente com 1 mensagem não entra, com 2 em 90 dias entra;
  `noreply@` não entra; e-mail já em contato não entra; chave em `ignorados` não entra; conta do usuário não
  entra.
- **CA7** `test/renderer/sidebar-stack.test.ts`: `sectionOf('/funil/contatos/abc')` = `'funil'`;
  `activeNavId` = `'funil'`; transição raiz→funil é `push`.
- **CA8** `assistant.test.ts`: lista de canais inclui `scribe:chat-action-funil`; bloco `lap-acao` tipo
  `oportunidade-mover` com `oportunidadeId` inexistente vira cartão `failed` com razão "oportunidade não
  encontrada"; `FUNIL.md` gerado por `writeSources` contém "esfriada" para oportunidade parada há 8 dias; guia
  tem `<!-- tela: funil -->`.
- **CA9** `funnel-extract.test.ts`: resposta do falso agente `{"proposta": null}` grava `dismissed`;
  resposta com `acao: 'atualizar'` e `oportunidadeId` de aberta grava `proposed`; JSON quebrado grava
  `dismissed` com `erro: 'format'` e o resumo continua salvo.
- **CA10** `settings` testes existentes: `settingsIndex()` contém as três linhas de Funil; `diasEsfriar: 0`
  e `91` são recusados pelo esquema estrito.

Smoke (prints em `out/smoke/`, cada um em light e dark):
- **CA11** `funil-oportunidades`: kanban semeado com 6 etapas, 5 oportunidades (uma esfriada com marcador,
  uma com passo vencido), totais na linha de 32 px, colunas Ganho/Perdido recolhidas. Check: 4 colunas
  abertas visíveis, `[data-funil-card]` = 5, texto "esfriou" presente 1 vez.
- **CA12** `funil-oportunidades-nova`: após clicar `[data-action="funil-nova"]`, cartão em edição no topo da
  primeira coluna com Título focado; `funil-oportunidades-editar-etapas`: após "Editar etapas", cabeçalhos
  editáveis e a faixa "+ Etapa" visível.
- **CA13** `funil-oportunidade`: detalhe com campos, 3 abas, linha do tempo com 1 reunião, 1 e-mail e 1
  evento de etapa (fixtures). Check: `[role=tab]` = 3.
- **CA14** `funil-contatos`: lista com 4 contatos e ficha do primeiro; `funil-contatos-novo`: ficha vazia em
  modo criação com Nome focado; `funil-contatos-sugestoes`: 3 sugestões (reunião, e-mail, WhatsApp);
  `funil-contatos-importar`: prévia de CSV fixture com 5 linhas e Selects de mapeamento; `funil-empresas`:
  lista com 2 empresas e ficha.
- **CA15** `detalhe-resumo-oportunidade`: aba Resumo com o cartão "Oportunidade detectada" e os três botões;
  `email-leitura-contato`: `+ Contato` ao lado do remetente; `whatsapp-detalhes-contato`: bloco Contato.
- **CA16** `assistente-funil`: cartão `oportunidade-mover` proposto pelo falso agente; `configuracoes-geral`
  existente passa a conter a Section Funil (check de texto "Funil de vendas").
- **CA17** `expectedShots` ajustado para o número exato de prints novos; `pnpm gates` verde (typecheck, lint,
  vitest, build, smoke, cores, shapes, pytest).

## Prints exigidos

`funil-oportunidades`, `funil-oportunidades-nova`, `funil-oportunidades-editar-etapas`, `funil-oportunidade`,
`funil-contatos`, `funil-contatos-sugestoes`, `funil-contatos-importar`, `funil-contatos-novo`,
`funil-empresas`, `detalhe-resumo-oportunidade`, `email-leitura-contato`, `whatsapp-detalhes-contato`,
`assistente-funil`, em light e dark.

## Riscos

Ver PRD. Acrescenta-se: `smoke.ts` é tocado por quase todo contrato de tela; para respeitar "zero
sobreposição de arquivo na mesma wave", **só um contrato por wave edita `smoke.ts`**, e os demais entregam
testes vitest. O `main/index.ts` (2 736 linhas na 0.19.0) recebe apenas o `registerIpc` do funil, num bloco único.

## Fora de escopo

1. Backend, multiusuário, sincronização.
2. CRM externo (MCP depois).
3. Importar do Contatos do macOS (helper Swift; ver Gaps).
4. E-mail novo redigido pelo Assistente (cartão `email-novo`).
5. Exportar CSV/vCard.
6. Mesclar contatos à mão; desfazer.
7. Produtos, itens de proposta, moeda ≠ BRL, campos personalizados, anexos.
8. Relatórios além dos totais do cabeçalho.
9. Detecção de oportunidade em e-mail e WhatsApp (só reunião nesta versão; ver Gaps).
10. Atalhos de teclado novos (⌘1–⌘9 esgotados; nenhum atalho global para o Funil).
11. Reorganizar a raiz da barra lateral (8 itens com Redes e 9 com Funil); fica como está.

## Gaps identificados

Da revisão cega da documentação em 20/11/2026. Os seis primeiros **entraram nesta spec** por serem baratos
e de impacto direto no uso diário; os demais ficam para a versão seguinte.

Incorporados (já refletidos nas regras acima):
1. Telefone brasileiro com DDI, 0 de tronco e nono dígito (R3): sem isso a deduplicação falha em CSV real.
2. Arquivar oportunidade fechada e limitar Ganhas/Perdidas a 90 dias por padrão (R23, R27): o kanban não
   acumula lixo com o tempo.
3. Backup diário de `funil.json` com 7 cópias (R1): hoje nada desfaz uma exclusão.
4. Fonte Funil do Assistente desligada por padrão (R41): privacidade de contatos e telefones.
5. Aviso de duplicata ao criar oportunidade para empresa que já tem uma aberta (R25, R39).
6. Previsão vencida marcada no cartão (R23).

Versão seguinte:
7. Importar do **Contatos do macOS** (helper Swift novo + permissão, como o `lap-calendar`).
8. Detecção de oportunidade em **e-mail e WhatsApp**, não só em reunião.
9. **Lembrete a partir do próximo passo** (um clique cria o `ScheduledTask` com `reminder`).
10. Campo **fonte do lead** (indicação, site, evento, prospecção) e relatório por fonte.
11. **Exportar** contatos e oportunidades em CSV.
12. **Busca global** (reuniões, e-mails, contatos e oportunidades numa caixa só).
13. **Desfazer** e **mesclar contatos à mão**.
14. Previsão de vendas ponderada por etapa (probabilidade por coluna).
15. E-mail novo redigido pelo Assistente (cartão `email-novo`), hoje só resposta.

Limitações conhecidas desta rodada (fechamento, contrato 118, 21/11/2026):
16. O smoke do funil não restaura `funil.json` inteiro entre os blocos: cada bloco deixa eventos extras na linha
    do tempo para os blocos seguintes (os prints e os checks contam com isso).
17. A detecção automática de oportunidade fica desligada no smoke (R38); o cenário usa "Detectar oportunidade"
    (R40), e a passada que roda sozinha depois do resumo só é exercitada pelos testes vitest e pelo teste navegado.
18. "Ganho em <mês>" na linha de totais soma também as ganhas arquivadas do mês (decisão do contrato 107):
    arquivar tira a oportunidade do quadro, não do total.
19. A fonte Funil do Assistente vem desligada por padrão (R41): quem não ligar no painel Contexto não tem respostas
    com os dados do funil nem citações `[Funil · …]`, e o teste navegado (passo 8) precisa ligá-la antes.

## Verificação end-to-end

1. Abrir o app com `funil.json` ausente: item Funil na barra lateral; Oportunidades mostra 6 colunas vazias
   com Ganho/Perdido recolhidos e `EmptyState`.
2. Contatos › Importar… escolher um CSV com `;` e cabeçalho em português com 20 linhas, 2 sem e-mail e 2
   repetidas: prévia correta, "16 criados · 2 atualizados · 2 ignorados".
3. Contatos › Sugestões: aparecem os participantes das reuniões gravadas e os remetentes com 2+ e-mails;
   Adicionar um, Ignorar outro; o ignorado não volta após recarregar.
4. Abrir um e-mail de um contato novo: "+ Contato" cria; a ficha aparece com a linha do tempo contendo esse
   e-mail; o domínio sugere a empresa; aceitar.
5. Gravar (ou abrir) uma reunião com esse participante e gerar o resumo: cartão "Oportunidade detectada";
   editar o valor; Criar. A oportunidade aparece em Descoberta com a reunião na linha do tempo.
6. Arrastar para Proposta; definir próximo passo com data de ontem: cartão mostra o passo em vermelho.
7. Mudar `diasEsfriar` para 1 em Configurações; voltar ao kanban: marcador "esfriou" após a janela.
8. Assistente, fonte Funil ligada: "o que está esfriando?" cita `[Funil · <título>]`; "mova para
   Negociação" propõe cartão; clicar move e a linha do tempo registra o evento.
9. Arrastar para Perdido: pedir motivo no cartão; Cancelar devolve; repetir e Salvar; filtro Perdidas mostra.
10. Agente com "Pode ler o funil" ligado: "Pedir agora" responde com dados do `FUNIL.md`.
11. `pnpm gates` verde; prints de "Prints exigidos" gerados.
