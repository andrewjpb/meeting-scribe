# Contrato 119: Tela Oportunidade (detalhe, linha do tempo, Escrever e-mail, Arquivar)

Feature `funil-vendas` · Wave 4 · Depende de: 112 commitado (e 107, 110) · Spec `../spec.md` (R6 na tela, R27 a R29, "Modelo de dados" reunião apagada e `emails`; CA13; CA17 parte) · Plan `../plan.md` (D5, D11, D12, D14, D21, D22) · Mockup `../mockups/Funil.dc.html` (artboard `04-oportunidade-detalhe`; vale `formatarBRL` no Valor, sem centavos zerados; PNGs em `../mockups/png/`). **Você não commita.** Worktree `/Users/andrew/Documents/GitHub/meeting-scribe-funil-119` (branch `funil-119`, a partir da ponta da `funil-vendas`). Roda em paralelo com 115: você **não** edita nada em `src/main/` além de `smoke.ts` e `smoke-fixtures.ts`, nem `src/shared/**`, nem `features/agents/**`; **você é o único da wave 4 que edita `smoke.ts` e `smoke-fixtures.ts`**.

## Pré-condições
- **Artboard `04-oportunidade-detalhe` aprovado pelo Andrew.** Sem aprovação, pare e avise. Texto e medidas do artboard prevalecem sobre exemplos de texto deste contrato; regra e gancho do contrato prevalecem sobre o artboard.
- Leia na spec R27 a R29 e o trecho de "Modelo de dados" sobre reunião apagada e `Oportunidade.emails`; no plan D12, D14, D21, D22; os contratos 110 (`ItemLinhaDoTempo` com `apagada` e `noCache`, `scribe:funil-timeline`, `archiveOportunidade`) e 112 (`FunilScreen`, `SearchPicker`, `funilFormat.ts`, `parseValor`, `FunilNavigationState`, `EmailNavigationState.compose`, a fixture `op-loja` e os ids fixos).
- No código: `features/meetings/MeetingDetailScreen.tsx:251-320` (cabeçalho, `EditableTitle`, `DeleteAction` local, `Tabs`); `features/email/EmailScreen.tsx:234` (`location.state`) e `:394` (`newMessage(to: Recipient[])`, que põe a assinatura); `features/email/format.ts:137` (`Recipient`); `src/shared/routes.ts:35` (`WhatsAppNavigationState`), `emailPath`; `design/` (`EditableTitle`, `ActionButton`, `Tabs`, `Select`, `TextField`, `EmptyState`, `Note`); `src/main/smoke.ts` (bloco `funilKanbanChecks` do 112, `expectedShots` `:13421`).

## Superfície

### `features/funil/FunilScreen.tsx`
`oportunidades/:id` passa a montar `OportunidadeScreen` (no lugar do "Em preparação" do 112).

### `features/funil/OportunidadeScreen.tsx` (R27, R28, artboard `04`)
- Voltar "‹ Oportunidades"; linha do título com `EditableTitle` (≤ 200), `Select` de etapa (`data-funil-etapa-select`; trocar chama `moveOportunidade`; escolher Perdido abre o campo Motivo na própria linha antes de gravar) e, à direita, "Apagar" com confirmação na própria linha (`action="funil-apagar"`, `action="funil-apagar-confirmar"`; apagar volta ao kanban); subtítulo "Há N d em <etapa> · criada em <data> · última interação <quando>".
- Linha própria de `ActionButton`: "Escrever e-mail" (`action="funil-escrever-email"`; desabilitado sem contato com e-mail, razão em `title`), "Abrir WhatsApp" (`action="funil-abrir-whatsapp"`; só com `whatsappChatIds` da linha do tempo; navega para `/whatsapp` com `WhatsAppNavigationState { chatId }`), "Vincular reunião" (`action="funil-vincular-reuniao"`; lista inline das reuniões dos últimos 90 dias com `SearchField`, clique acrescenta a `meetingIds`), "Marcar como ganha" (`action="funil-marcar-ganha"`), "Marcar como perdida" (`action="funil-marcar-perdida"`, pede o Motivo na linha) e, **só em etapa `ganho` ou `perdido`**, "Arquivar" (`action="funil-arquivar"`, confirma na linha com `action="funil-arquivar-confirmar"`; chama `archiveOportunidade` e volta ao kanban).
- Campos em duas colunas (`data-funil-campo="empresa|contatos|valor|previsao|proximo-passo|origem|motivo"`), cada um salva no blur ou Enter por `saveOportunidade`: Empresa (`SearchPicker` com "Criar «texto»"), Contatos (`SearchPicker` múltiplo com "×" e "+ Contato"), Valor (`formatarBRL` na leitura, `parseValor` na edição), Previsão, Próximo passo (texto + data; vencido mostra "<dd/mm> · vencido" em `--rec`), Origem ("Reunião · <título com link>" quando veio de reunião), Motivo (só em `perdido`).
- `Tabs` Linha do tempo · Reuniões · Notas (R29): Linha do tempo pelo `scribe:funil-timeline` em `Timeline.tsx`; Reuniões com as reuniões de `meetingIds` e, em cada linha, "Desvincular" (`action="funil-desvincular"`), inclusive na linha "Reunião apagada"; Notas com `textarea` e "Salvar" (`action="funil-nota-salvar"`, `addNota`), notas listadas abaixo. Id inexistente ou arquivado → `EmptyState` "Essa oportunidade não existe mais." com link para o kanban.

### `features/funil/Timeline.tsx` (novo; o 114 reaproveita)
Uma linha por `ItemLinhaDoTempo` (`data-funil-timeline-item="reuniao|email|whatsapp|evento"`): ícone, rótulo do tipo, título, data "dd/mm · hh:mm" (sem data no item `apagada`), uma linha de texto e o link: "Abrir resumo" → `/reunioes/:id`; "Abrir e-mail" → `emailPath` da conta e pasta com `{ messageId }`, ausente quando `noCache`; "Abrir conversa" → `/whatsapp` com `{ chatId }`. Item `apagada: true` mostra "Reunião apagada" (`data-funil-timeline-apagada`), sem link. Modo `compacto` (uma linha por item, como a ficha do artboard `05`).

### Escrever e-mail (`features/email/EmailScreen.tsx`, D12)
O botão navega para `/email` com `state: { compose: { to } }` (`to` = e-mail principal de cada contato, sem repetição, por `composeDe` em `funilFormat.ts`). Em `EmailScreen`, chegando `compose` com contas carregadas, chama o `newMessage` existente (`:394`) com os endereços convertidos para `Recipient` (`format.ts:137`), aplica `subject` quando houver e limpa o `state` (`navigate(…, { replace: true })`) para não reabrir; sem conta, a tela abre normal. `Composer.tsx` não muda.

### `funilFormat.ts`, `funilStore.ts`
`composeDe(contatos)`, `textoSubtitulo(oportunidade, etapa, ultima, now)`, `podeArquivar(etapa)` com testes; no store, só o que a tela precisar.

### Smoke (`src/main/smoke.ts`, bloco `funilDetalheChecks` logo depois de `funilKanbanChecks`; checks obrigatórios `funilDetail`, `funilReuniaoApagada`, `funilEtapaSelect`, `funilNota`, `funilCompose`, `funilWhatsAppOculto`, `funilArquivar`)
- `funilDetail` (CA13): o bloco liga ao `op-loja`, pelo canal `scribe:funil-oportunidade-save`, o id da primeira reunião de `scribe:meetings-list` e um item `emails` montado do primeiro email em cache (`accountId`, `id`, `assunto`, `de`, `data`); abrir `/funil/oportunidades/op-loja` → `[role=tab]` = 3 dentro da tela e, na Linha do tempo, exatamente 1 `reuniao`, 1 `email` e 1 `evento`; o Valor mostra `formatarBRL`; print `funil-oportunidade`.
- `funilReuniaoApagada`: acrescentar `reuniao-que-nao-existe` a `meetingIds` → a Linha do tempo mostra `[data-funil-timeline-apagada]` "Reunião apagada"; na aba Reuniões, "Desvincular" nessa linha tira o id de `meetingIds`.
- `funilEtapaSelect`: trocar o `Select` de etapa de `op-loja` para Proposta → evento `etapa`; voltar para Negociação.
- `funilNota`: escrever e Salvar uma nota → aparece em Notas e como evento na Linha do tempo.
- `funilCompose`: "Escrever e-mail" → rota `/email…`, `[data-email-composer="new"]` com `rafael.lima@lojista.example` em Para; feche descartando.
- `funilWhatsAppOculto`: `op-loja` não tem chat ligado → `[data-action="funil-abrir-whatsapp"]` não existe.
- `funilArquivar` (R27): em `op-loja` (aberta) não existe `funil-arquivar`; em `op-ganha-mes`, Arquivar → confirmar → volta ao kanban e o filtro Ganhas não mostra mais o cartão; `arquivado: true` pelo canal.
- Prints novos: 1 nome × 2 temas: **`expectedShots += 2`** (de `+ 185` para `+ 187`).

## Critérios de aceite
- **CA1** (CA13 da spec) `funilDetail` passa e `funil-oportunidade-light.png`/`-dark.png` existem.
- **CA2** (modelo, R29) `funilReuniaoApagada` passa: o id fica em `meetingIds` até o "Desvincular", e a linha não tem link.
- **CA3** (R27) "Arquivar" só existe em `ganho` e `perdido`; `funilArquivar` passa; a oportunidade arquivada não volta ao kanban em nenhum filtro.
- **CA4** (R28, D12) `funilCompose` passa; sem contato com e-mail, "Escrever e-mail" está desabilitado com `title`; a assinatura da conta entra no texto como num "Nova mensagem" comum (mesmo `newMessage`).
- **CA5** (R28) `funilWhatsAppOculto` passa; com um contato com chat ligado (teste de `funilFormat` ou check com fixture), o botão navega para `/whatsapp` com `state.chatId`.
- **CA6** `test/renderer/funil-format.test.ts`: `composeDe` não repete e-mail e ignora contato sem e-mail; `podeArquivar` é verdadeiro só para `ganho` e `perdido`; `textoSubtitulo` usa "ontem" e "hoje" como o artboard.
- **CA7** (CA17 da spec, parte) `expectedShots` = `SCREENS.length * THEMES.length + 187` e o número de PNGs bate.

## Invariantes
- O kanban e os checks do 112 continuam iguais; os ids `op-integracao` e `op-vistoria` não são alterados por este bloco (o 117 usa).
- `Composer.tsx` não muda; o Email sem `state.compose` abre como hoje (checks de email existentes verdes).
- Nenhum canal, tipo compartilhado ou arquivo do main muda além de `smoke.ts` e `smoke-fixtures.ts`.
- Nenhum literal de cor fora de `tokens.css`; sem sombra, sem pílula, raio até 6 px; nenhum texto técnico; nenhum modal.

## Fora de escopo desta tarefa
Kanban (112); Contatos e Empresas (114); restaurar arquivada pela interface; vincular e-mail pela interface (o modelo aceita, a tela desta versão não oferece).

## Gates
`cd /Users/andrew/Documents/GitHub/meeting-scribe-funil-119/apps/desktop && SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde. Testes: CA6 em `test/renderer/funil-format.test.ts`; smoke com os 7 checks.

## Relatório final (formato)
Arquivos; gates (contagens, `expectedShots` novo); `data-*` e `data-action` criados; API do `Timeline`; diferenças em relação ao artboard `04` e por quê; o que o revisor deve olhar no print.
