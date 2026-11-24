---
feature: email-dashboard
tipo: spec
status: implementada-2026-11-23 (0.25.0, arquivada)
criado: 2026-11-23
base: main 47ad5c1 (0.23.0)
contratos: 155–158
---

# Spec — Painel de e-mail

Caminhos relativos a `apps/desktop/src`. Leitura obrigatória antes: `analise.md`,
`prd.md`, `docs/specs/desktop-shell/design.md`, `~/CLAUDE.md` (constituição).

## Problema e objetivo

A tela Email só tem pastas. Saber o que importa, o que responder e o que tirar da Caixa de
Entrada exige percorrer conta por conta ou perguntar ao Assistente no chat. O objetivo é um
**Painel** dentro do Email, cobrindo todas as contas, com três listas produzidas por IA:
e-mails que precisam de atenção, respostas sugeridas e sugestões de organização, onde
**nada é enviado nem movido sem clique**.

## Não-objetivos

- Triagem automática, antispam, detecção de malicioso.
- Enviar do painel. Criar pastas. Criar regras.
- Qualquer mudança no Início, no `EMAILS.md` ou nas ferramentas do Assistente.
- Anexos e imagens no modelo (frente `ia-midia`).

## O que existe hoje (âncoras)

- Cache por conta: `main/email/email-store.ts` (`inbox`, `sent` até 200; `<conta>.bodies/`;
  `<conta>.folders/`). `service.ts:645 cached()`, `:647 cachedBody()`, `loadBody` (baixa).
- Heurística pendente de resposta: `main/email/export.ts:114 isPending`.
- Mover: `service.ts moveMessages(accountId, fromPath, uids, toPath)`; lotes com Desfazer:
  `main/email/batches.ts`, `organize.ts undoBatch`, `EmailBatchCard.tsx`, banner em
  `EmailScreen.tsx:286,560`, IPC `scribe:email-batch-get|undo`.
- Composer: `features/email/emailStore.ts:91 openDraft(draft)`, `EmailScreen.tsx:379 compose`,
  `format.ts:169 ComposeDraft`, `:227 composeFrom`; estado de navegação
  `shared/routes.ts:101 EmailNavigationState` (`compose: {to, subject}` só).
- Passada de IA: `main/meetings/claude-one-shot.ts:52 runClaudeOneShot` (`purpose`, `model`),
  moldes `main/invites/suggest.ts` e `main/funil/extract.ts` (Haiku fixo, 30 s, um por vez,
  log só com resultado/modelo/custo/tempo), prompt em `main/claude-cli/funnel.ts`,
  parse `extractJsonObject`. Fixture do smoke: `apps/desktop/test/fixtures/fake-claude.mjs`.
- Sugestões com Ignorar: `shared/tarefas-sugestoes.ts`, `features/tarefas/SugestoesTarefas.tsx`,
  `main/tarefas/store.ts ignorados {chave, em}[]`.
- Cartões: `features/inicio/inicioFormat.ts:205 INICIO_CARTAO_CLASS` (borda `--line-strong`,
  raio de painel, `bg-raised`, `px-3 pt-2.5 pb-3`, cabeçalho 24 px, título 14/20 600).
- Rotas: `shared/routes.ts:23 email: '/email/:conta?/:pasta?'`, `:71 emailPath`,
  `:59 EMAIL_ROOT_PATH`; `app/useMainNavigation.ts:61`; barra lateral `features/email/EmailNav.tsx`,
  `app/Sidebar.tsx:66`, `app/SidebarStack.tsx:66` (`lastEmailPath`).
- Configurações: `features/settings/EmailSettingsTab.tsx:26`, `shared/settings-defaults.ts:214`
  (`inviteSuggest` como molde de interruptor), `claudeModel` (`haiku`|`sonnet`).
- Smoke: `main/smoke.ts` grupo `email` (`:17192`), `emailRulesCheck` (`:11439`) como molde,
  `expectedShots` (`:17934`), `detail` só números/booleanos (R36).

## Modelo de dados

### `userData/email/dashboard.json` (novo, 0600, gravação atômica, versão 1)

```ts
type EmailDashboardStore = {
  version: 1
  lastRun: { at: number; model: 'haiku'|'sonnet'; analyzed: number; costUsd: number|null; error: string|null } | null
  // uma entrada por mensagem analisada; chave = `${accountId}:${messageKey}`
  items: Record<string, EmailDashboardItem>
  ignored: { key: string; at: number }[]          // key = `${accountId}:${messageKey}:${'reply'|'move'}`
  opened: { key: string; at: number }[]           // respostas já abertas no Composer
}
type EmailDashboardItem = {
  accountId: string
  messageKey: string            // o `id` da EmailMessage na INBOX (UID ou UIDL)
  messageId: string | null      // Message-ID, para sobreviver a troca de UID
  analyzedAt: number
  model: 'haiku'|'sonnet'
  importance: 0|1|2|3|4|5       // 0 = o modelo não devolveu
  reason: string                // ≤ 140 chars
  needsReply: boolean
  reply: string | null          // ≤ 1200 chars, texto puro
  move: { folder: string; reason: string } | null   // folder = path existente na conta
}
```

`messageKey` segue o `id` que a INBOX já usa (`service.ts:479`). O item morre quando a
mensagem sai do cache da INBOX (movida, apagada, expirada); `ignored` e `opened` vivem até
365 dias e são podados a cada gravação.

### Settings (`shared/settings-defaults.ts`)

```ts
emailDashboard: { enabled: boolean /* true */; model: 'haiku'|'sonnet' /* 'haiku' */ }
```

### Visão para o renderer (`shared/email-dashboard.ts`, novo)

```ts
type EmailDashboardView = {
  enabled: boolean
  lastRun: EmailDashboardStore['lastRun']
  running: boolean
  accounts: { accountId: string; name: string; unread: number; pending: number; pop3: boolean }[]
  attention: AttentionRow[]        // ≤ 15, importance desc, date desc
  replies: ReplyRow[]              // ≤ 20, importance desc
  moves: MoveGroup[]               // por conta+pasta destino, ≤ 10 grupos, ≤ 50 linhas no total
}
type AttentionRow = { accountId; messageKey; from: string; subject: string; date: number; importance; reason; seen: boolean }
type ReplyRow     = AttentionRow & { reply: string; opened: boolean }
type MoveGroup    = { accountId; folder: string; folderName: string; rows: (AttentionRow & { moveReason: string })[] }
```

Linhas só entram se a mensagem ainda está na INBOX em cache; `replies` exclui mensagens com
`answered` ou com enviado em resposta (`isPending` falso) e as ignoradas com sufixo `reply`;
`moves` exclui ignoradas com sufixo `move`, contas POP3 e pastas que não existem mais.
Quando `enabled` é falso, `attention` vem da heurística (não lidos pendentes, `importance 0`,
`reason ''`) e `replies`/`moves` vêm vazios.

## Requisitos

### Passada de IA (R1–R9)

- **R1** QUANDO a análise está ligada e (a) o usuário clica em Analisar agora ou (b) o app
  está desbloqueado, com rede, e `lastRun.at` é de outro dia civil local (ou nulo), O SISTEMA
  DEVE rodar uma passada única (nunca duas em paralelo; a segunda chamada é ignorada e devolve
  `running: true`).
- **R2** A passada percorre a INBOX em cache de **todas** as contas, mensagens dos últimos
  **7 dias**, não enviadas por conta própria, sem item em `items` com `analyzedAt` posterior à
  data da mensagem. Teto: **60 mensagens por conta** e **150 por passada**, as mais recentes
  primeiro.
- **R3** Para cada mensagem o modelo recebe: conta (nome), remetente, destinatários próprios,
  assunto, data, `seen`, `answered`, pendente (heurística), se o remetente é contato do
  funil, e a prévia do corpo em texto puro com **até 1.500 caracteres**. Corpo não baixado é
  baixado na hora, com teto de **30 downloads por conta por passada**; sem corpo, vai só o
  assunto.
- **R4** O modelo recebe também a lista de pastas da conta (paths e nomes, até 40), excluindo
  INBOX, Enviados, Rascunhos, Lixeira e Spam, e a instrução de só sugerir mover para uma
  dessas. Sugestão para pasta fora da lista é descartada.
- **R5** Lotes de **até 15 mensagens por chamada**, JSON fechado, sem ferramentas, via
  `runClaudeOneShot` com `purpose: 'email-dashboard'` e `model: settings.emailDashboard.model`.
  Prazo de 60 s por chamada; falha de uma chamada não derruba a passada (as outras seguem) e
  entra em `lastRun.error` com texto genérico, sem conteúdo de e-mail.
- **R6** Saída por mensagem: `importance 1–5`, `reason` (≤ 140), `needsReply`, `reply`
  (≤ 1.200, texto puro, no idioma do e-mail, sem assinatura, começando pela saudação) e
  `move` (`folder` + `reason`). `needsReply` só é aceito como verdadeiro se a mensagem está
  pendente pela heurística ou se o modelo justificou; `reply` sem `needsReply` é descartada.
- **R7** O log registra só: contas, quantidade analisada, quantidade baixada, chamadas,
  modelo, custo e tempo. **Nenhum** remetente, assunto, prévia ou resposta em log, em erro ou
  em `detail` do smoke.
- **R8** Depois da passada o main emite `scribe:email-dashboard-changed` com a visão nova;
  o Início não é avisado (fora de escopo).
- **R9** QUANDO a análise está desligada, O SISTEMA não chama o modelo em nenhuma hipótese e
  Analisar agora fica desabilitado com o aviso "Análise por IA desligada em Configurações ›
  Email".

### Tela (R10–R22)

- **R10** Rota nova `/email/painel` (`routes.ts`: slug `painel`, `emailPainelPath()`). O
  item **Painel** aparece no topo de `EmailNav`, acima das contas, com ícone `LayoutDashboard`
  (lucide), linha de 28 px como os itens de conta e pasta, separado das contas por um fio.
- **R11** Entrar na área Email pela barra lateral (`Sidebar.tsx:66`, `SidebarStack.tsx:66`)
  abre `/email/painel` quando há pelo menos uma conta; `lastEmailPath` continua guardado para
  o segundo clique (voltar à última pasta) e para a notificação de e-mail novo.
- **R12** Cabeçalho da página (padrão `px-8 pt-5`): título "Painel", subtítulo "Analisado às
  HH:MM · N e-mails · Haiku" (ou "Ainda não analisado"), botão **Analisar agora**
  (`Button variant="secondary" icon={RefreshCw}`, 32 px; estado "Analisando…" desabilitado
  enquanto `running`).
- **R13** Linhas de contas: uma linha de 28 px por conta com nome, "N não lidos", "N pendentes"
  e "POP3" quando for o caso, no topo da coluna da esquerda, acima de Precisam de atenção
  (mockup D3). Sem pílulas; texto em `--text-muted`.
- **R14** Cartão **Precisam de atenção** (`INICIO_CARTAO_CLASS`): até 15 linhas de 44 px
  (remetente · conta à esquerda, hora à direita; assunto · motivo em `--text-muted` na
  segunda linha). Importância 4–5 marcada com um ponto `--accent` à esquerda. Clicar navega
  para `emailPath(conta,'inbox')` com `{messageId}` (abre a leitura).
- **R15** Cartão **Respostas sugeridas**: até 20 blocos; cada bloco tem a linha de 44 px da
  mensagem, o motivo, a resposta recolhida em 2 linhas (`line-clamp-2`) que expande em linha
  ao clicar em "Ver resposta", e dois `ActionButton` de 28 px: **Abrir no Composer** e
  **Ignorar**. Bloco já aberto no Composer mostra "Aberta" em `--text-muted` no lugar do
  botão, mas continua clicável para reabrir.
- **R16** **Abrir no Composer** navega para `emailPath(conta,'inbox')` com estado
  `compose: { replyTo: { messageKey, mailbox: 'INBOX' }, text }`. `EmailScreen` resolve a
  mensagem no cache, monta o rascunho com `composeFrom(message)` e substitui o texto por
  `text + '\n\n' + citação`, aplica a assinatura como hoje (`signedDraft`) e chama
  `openDraft`. Se a mensagem não está mais no cache, mostra a nota "Este e-mail saiu da Caixa
  de Entrada" e não abre o Composer. Nenhum envio acontece sem o clique em Enviar do Composer.
- **R17** Cartão **Sugestões de organização**: grupos por conta e pasta destino, título
  "Mover para <pasta> · <conta>" (ou "Arquivar · <conta>" quando a pasta tem o uso especial
  `\Archive`), botão **Mover todos (N)** no cabeçalho do grupo, e linhas de 44 px com
  remetente, assunto e motivo, cada uma com `ActionButton` **Mover** e **Ignorar**.
- **R18** **Mover** e **Mover todos** chamam `scribe:email-dashboard-apply-move` com a lista de
  `messageKey`; o main usa `moveMessages` e registra um lote em `batches.ts` com origem
  `'painel'`, devolvendo o `batchId`. A tela mostra o banner de Desfazer já existente
  (`EmailScreen.tsx:286`) no painel, com "N e-mails movidos para <pasta> · Desfazer". Desfazer
  usa `scribe:email-batch-undo`.
- **R19** **Ignorar** chama `scribe:email-dashboard-ignore` com `{accountId, messageKey, kind}`;
  a linha sai na hora (otimista) e não volta em análises futuras.
- **R20** Estado vazio de cada cartão em uma linha de 32 px: "Nada precisa de atenção",
  "Nenhuma resposta sugerida", "Caixa de Entrada em ordem". Estado sem conta: a tela Email
  já trata (não entra no painel).
- **R21** Com `enabled` falso, a página mostra o cabeçalho, a linha de contas, o cartão
  Precisam de atenção com a heurística (não lidos pendentes, sem motivo) e uma nota em linha
  "Análise por IA desligada. Ligue em Configurações › Email para ver respostas e sugestões de
  organização." com um link para a aba Email das Configurações. Sem os outros dois cartões.
- **R22** Com a janela abaixo de 900 px os cartões empilham em uma coluna; acima, contas e
  Precisam de atenção à esquerda (380 px, como a `AgendaDia` do Início) e os outros dois à
  direita, com a coluna da direita rolando sozinha. Respostas sugeridas mostra 3 blocos e um
  "Mostrar mais N" em linha para o resto (mockup D6).

### Configurações (R23–R24)

- **R23** Seção **Painel** na aba Email (`EmailSettingsTab.tsx`, depois de "Avisos"):
  `SettingRow` "Analisar e-mails com IA" (switch, `emailDashboard.enabled`), `SettingRow`
  "Modelo" (Segmented 28 px: Haiku / Sonnet, `emailDashboard.model`), linha "Última análise
  às HH:MM · N e-mails · US$ 0,00" e `Button secondary` **Analisar agora**.
- **R24** Mudar o modelo não invalida itens já analisados; a próxima passada usa o modelo novo.

### Bloqueio, privacidade e segurança (R25–R28)

- **R25** Todos os canais novos são recusados com o app bloqueado (`ipc.ts:1497`), e a passada
  diária não roda bloqueado (mesmo critério de `inicioChanged`).
- **R26** `dashboard.json` tem permissão 0600 e vive em `userData/email/`; é apagado quando a
  última conta é removida e tem os itens da conta removidos em `remove-account`.
- **R27** O texto da resposta sugerida nunca vai ao SMTP sem passar pelo Composer; o canal de
  envio existente (`scribe:email-send`) não é tocado.
- **R28** Mover pelo painel aceita só `messageKey` da INBOX da conta e pasta destino que
  existe no cache de pastas; qualquer outro valor devolve erro sem efeito.

## Regras de negócio

- **N1** IA só sugere. Enviar, mover e arquivar exigem clique; "Mover todos" é um clique por
  grupo e é desfazível.
- **N2** Ignorado é definitivo para aquele e-mail e aquele tipo (resposta ou mover). Nova
  análise não ressuscita.
- **N3** Pasta destino sempre existente. Sem criar pasta, sem regra automática.
- **N4** Contas POP3: só atenção e respostas. Nunca mover.
- **N5** Uma passada por vez, no máximo uma automática por dia civil local; Analisar agora
  sempre pode rodar outra (respeitando R2, que só analisa o que falta).
- **N6** Nenhum conteúdo de e-mail em log, erro, `detail` do smoke ou nome de arquivo.
- **N7** Padrão Haiku; Sonnet só por escolha nas Configurações.
- **N8** O painel não muda nada no Início, no `EMAILS.md`, nas ferramentas do Assistente nem
  nas regras.

## Telas de impacto no usuário

| Tela | Mudança |
|---|---|
| Email › barra lateral | Item Painel no topo; clique em Email abre o Painel. |
| Email › Painel (nova) | Cabeçalho, linha de contas, três cartões, estados vazio e IA desligada, banner de Desfazer. |
| Email › Composer | Abre pré-preenchido com a resposta sugerida (texto antes da citação). |
| Configurações › Email | Seção Painel: interruptor, modelo, última análise, Analisar agora. |

## Alinhamento com o mockup

Artboards em `mockups/EmailPainel.dc.html` (PNGs em `mockups/png/`, 1120×740, escala 2,
claro e escuro, 2026-11-23): A `Painel` (cheio; a barra lateral com o item Painel aparece
aqui), B `Painel vazio`, C `Painel IA desligada`, D `Painel resposta expandida`, E `Composer
pré-preenchido`, F `Config Email Painel`, G `Painel com banner de Desfazer`. Decisões de
desenho D1–D13 no topo do arquivo; as que mudam a spec já foram incorporadas em R10, R13,
R15 e R22. Pontos aceitos: a coluna da direita rola (Sugestões de organização pode começar
abaixo da dobra); marcador de importância é um quadrado de 6 px em `--accent`.

## Critérios de aceite (resumo; detalhados por contrato)

- CA1 Com duas contas (uma IMAP, uma POP3) e 10 mensagens no servidor falso, Analisar agora
  grava `dashboard.json` com 10 itens, `lastRun.analyzed = 10`, e a visão tem `attention`,
  `replies` e `moves` coerentes com o JSON devolvido pela fixture.
- CA2 Segundo clique em Analisar agora sem mensagem nova: 0 chamadas ao modelo,
  `lastRun.analyzed = 0`.
- CA3 Ignorar uma resposta: a linha sai; nova passada não a devolve; `ignored` tem 1 entrada.
- CA4 Mover todos num grupo de 3: as 3 mensagens saem da INBOX no servidor falso, um lote é
  gravado, o banner aparece, Desfazer devolve as 3.
- CA5 Abrir no Composer: Composer aberto na conta certa com `inReplyTo` da mensagem, texto
  começando pela resposta sugerida e terminando com a citação; nenhum envio.
- CA6 `enabled=false`: nenhuma chamada ao modelo, Analisar agora desabilitado, página com
  heurística e nota.
- CA7 App bloqueado: todos os canais `scribe:email-dashboard-*` recusados.
- CA8 Sugestão de mover para pasta inexistente ou conta POP3 não aparece em `moves`.
- CA9 Log da passada sem nenhum assunto, remetente ou texto de e-mail (teste estático sobre a
  string de log e sobre `detail`).
- CA10 Passada diária: com `lastRun.at` de ontem e app desbloqueado, a passada roda sozinha
  uma vez e não roda de novo no mesmo dia.

## Prints exigidos (claro e escuro)

`email-painel` (inclui a barra lateral com o item Painel), `email-painel-vazio`,
`email-painel-ia-desligada`, `email-painel-resposta` (bloco expandido), `email-painel-desfazer`
(banner após mover), `email-compor-sugerida` (Composer pré-preenchido), `config-email-painel`.
Sete nomes, 14 PNGs.

## Riscos

- Qualidade de Haiku em `reason`/`reply`; mitigada por Sonnet opcional e edição antes de agir.
- Tempo da passada com muitos corpos a baixar; mitigado pelos tetos de R2–R3.
- Conflitos de merge em `index.ts`, `ipc.ts`, `smoke.ts`, `settings-defaults.ts` com `ia-midia`
  e `inicio-atualizar`; esta branch junta a main antes de cada gate completo.

## Fora de escopo

Ver PRD (1–8). Além disso: preferências por conta (ligar análise só em uma conta), histórico
de análises, exportar o painel para o Assistente.

## Verificação end-to-end

1. `pnpm gates` na raiz verde (typecheck, lint, testes, build, smoke com os 14 prints novos).
2. No app instalado, com as contas reais e a análise ligada: clicar em Email abre o Painel;
   Analisar agora termina em menos de 2 minutos; os três cartões têm conteúdo plausível.
3. Abrir uma resposta sugerida no Composer, editar e enviar: o e-mail some de Respostas
   sugeridas na próxima leitura.
4. Mover todos num grupo, conferir no webmail que as mensagens foram para a pasta, Desfazer e
   conferir que voltaram.
5. Ignorar uma sugestão, Analisar agora de novo: ela não volta.
6. Desligar a análise nas Configurações: o painel mostra a nota e nenhuma chamada aparece no
   log.
