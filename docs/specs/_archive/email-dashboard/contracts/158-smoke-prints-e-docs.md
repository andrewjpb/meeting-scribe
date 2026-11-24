# Contrato 158 — Smoke do Painel (checks e 14 prints), docs permanentes e design.md
Feature: email-dashboard · Wave: 4 · Depende de: 157 · Spec: `docs/specs/email-dashboard/spec.md` ("Prints exigidos", CA1–CA10, R7, N6) · Plan: D9, "Fechamento" 2

Caminhos relativos a `apps/desktop/src`. Constituição: `~/CLAUDE.md` e `docs/specs/desktop-shell/design.md`.

## Pré-condições
- 155, 156 e 157 commitados; `test/fixtures/fake-claude.mjs` já responde a `purpose: 'email-dashboard'` e `main/email/fake-email.ts` tem a pasta `Newsletters` (156).
- Moldes (ler antes): `main/smoke.ts` — `SCREENS` (`:270`), `capture(win, outDir, name)` (`:3317`), grupo `email` (`:17192`), `emailRulesCheck` (`:11439`) e `emailFoldersUiChecks` (`:16164`) como molde de check que entrega mensagens no servidor falso, espera o poll e navega; `expectedShots` (`:17934`) com o comentário por contrato; R36 (`detail` só números/booleanos, comentários em `:2373`, `:3645`, `:18003`). README `:66-79` (seção Email, defasada), `resources/assistente/guia-do-app.md` `:109-124` e `:208-222`, `docs/specs/desktop-shell/design.md` (seções "Telas": Início `:146-153`, Tarefas › Sugestões `:138+`), `docs/telas/README.md`, e a auditoria `docs/specs/_archive/funil-vendas/auditoria-prints.md` como formato de relatório.

## Superfície

### `main/smoke.ts` — grupo `email`, checks novos
- `dashboardRun`: com a análise ligada (padrão) e a fixture do Claude, entrega 6 mensagens na INBOX da conta IMAP falsa (3 ímpares com resposta, 3 pares com mover para `Newsletters` pela fixture), chama `scribe:email-dashboard-run` pela janela (ou o serviço direto, como os outros checks fazem), espera `running=false`, lê `scribe:email-dashboard-get` e confere: `analyzed >= 6`, `attention.length >= 6`, `replies.length >= 3`, `moves` com 1 grupo de `>= 3` linhas para `Newsletters`, `lastRun.error === null`. `detail`: `analyzed=6 attention=6 replies=3 moveGroups=1 moveRows=3 error=false`.
- `dashboardIdempotent`: segundo `run` sem mensagem nova → `lastRun.analyzed === 0` e o contador de chamadas da fixture não aumenta (se a fixture expõe contagem; senão, comparar `lastRun.at` e `analyzed`). `detail` com números.
- `dashboardIgnore`: `ignore` de uma resposta e de um mover → `replies` e `moveRows` caem em 1 cada; `run` de novo não os devolve. `detail` com os quatro números.
- `dashboardMove`: `apply-move` do grupo inteiro → no servidor falso as mensagens saem da INBOX e entram em `Newsletters`; `batch-get` devolve um lote com `origem:'painel'`; `batch-undo` devolve as mensagens à INBOX. `detail`: `moved=3 inboxAfter=N newsletters=3 undone=true`.
- `dashboardReply`: navegar pelo Painel até "Abrir no Composer" (clique no DOM) → Composer aberto com `textarea` cujo valor começa pelo texto da resposta e contém a citação; nenhum `scribe:email-send` registrado (contar chamadas no serviço falso). `detail`: `composerOpen=true startsWithReply=true quoted=true sent=0`.
- `dashboardDisabled`: com `emailDashboard.enabled=false` (via `scribe:settings-set`), `run` devolve `{started:false, running:false}`, a fixture não é chamada, e a página mostra a nota e o botão desabilitado (ler o DOM). `detail`: `started=false calls=0 noteShown=true buttonDisabled=true`. Voltar a ligar ao final do check.
- `dashboardLocked`: com o app bloqueado (como os outros checks de bloqueio fazem), os 5 canais são recusados. `detail`: `refused=5`.
- `dashboardLogPrivacy`: capturar as linhas de log emitidas durante `dashboardRun` (o smoke já intercepta o log em outros checks; senão, ler o arquivo de log) e conferir que nenhuma contém os assuntos/remetentes das 6 mensagens falsas. `detail`: `lines=N leaked=false`.

### Prints (14; nomes exatos, claro e escuro via `capture`)
`email-painel` (A, com 6 mensagens analisadas e a barra lateral com Painel selecionado), `email-painel-vazio` (B, INBOX falsa vazia antes de entregar), `email-painel-ia-desligada` (C), `email-painel-resposta` (D, 1º bloco expandido), `email-painel-desfazer` (G, logo após Mover todos), `email-compor-sugerida` (E, Composer aberto pelo Painel), `config-email-painel` (F, aba Email rolada até a seção Painel). Somar 14 ao `expectedShots` com o comentário `// contrato 158: Painel de e-mail`.

### Docs permanentes
- `README.md`, seção "Email": reescrever o parágrafo defasado para dizer o que existe hoje (Caixa de Entrada, Enviados e pastas IMAP; mover; regras; assinatura; organizar com o Assistente a pedido; convites) e acrescentar o **Painel**: o que mostra, que nada é enviado nem movido sem clique, Haiku por padrão, interruptor e modelo em Configurações › Email, e a privacidade (prévias de até 1.500 caracteres dos e-mails dos últimos 7 dias vão ao modelo quando a análise está ligada; nada em log). Corrigir "Configurações › Contas › Email" para "Configurações › Email".
- `resources/assistente/guia-do-app.md`: em "## Email", subseção "### Painel" (como chegar, os três cartões, botões, Desfazer, Ignorar definitivo, análise diária e Analisar agora); em "### Email" das Configurações, a seção Painel. O guia é lido pelo Assistente: frases curtas, sem promessas.
- `docs/specs/desktop-shell/design.md`: seção "Email › Painel" em "Telas", com os números do mockup (D1–D13 resumidas: item 28 px, colunas 380/resto, linha de mensagem 44, quadrado 6 px, bloco de resposta, grupo 32 px, vazios 32 px) e a regra "sugestão nunca age sem clique".
- `docs/telas/README.md`: acrescentar os artboards `EmailPainel` A–G com o caminho dos PNGs do mockup.

## Critérios de aceite
- CA1 `pnpm gates` da raiz verde com os 8 checks novos no grupo `email` do `report.json` e 14 PNGs novos em `apps/desktop/out/smoke/` com os nomes exatos; `expectedShots` bate.
- CA2 Nenhum `detail` novo contém letras além dos rótulos `chave=valor` com números e `true/false` (teste estático já existente do R36 continua verde ou ganha os checks novos).
- CA3 `dashboardLogPrivacy` falha se um assunto falso for injetado no log (provar com um teste unitário da função de checagem, ou comentar no check como foi validado à mão uma vez).
- CA4 README, guia e design.md têm as seções descritas; `docs/telas/README.md` lista os 7 artboards; nenhum outro trecho desses arquivos muda além dos citados e da correção do caminho das Configurações.
- CA5 Os PNGs `email-painel-light.png` e `email-painel-dark.png` mostram o item Painel selecionado na barra lateral, três cartões com conteúdo e o botão Analisar agora (conferência visual pelo coordenador na auditoria; o implementador abre os dois e descreve em uma linha cada).

## Invariantes
- Nenhum check existente muda de resultado; nenhuma captura existente é renomeada.
- Nada além do próprio smoke é gravado em `apps/desktop/out/`.
- Nenhum e-mail falso aparece em `detail`, nome de PNG ou log do smoke.

## Fora de escopo desta tarefa
- Alterar comportamento de 155–157 (se um check revelar bug, relatar com o passo exato, sem corrigir).
- Versão, pack, arquivamento da spec, cofre (coordenador).

## Gates
- `pnpm gates` da raiz (tela do Mac desbloqueada; antes `pgrep -fl smoke` e esperar se outro smoke estiver rodando). Se falhar com "display surface not available for capture", é a tela: rodar de novo depois de desbloquear, não mexer no código.

## Relatório final (formato)
Arquivos; CA1–CA5 com evidência; números do gate (testes, PNGs, checks); uma linha descrevendo cada um dos 14 PNGs; bugs encontrados nos contratos anteriores (se houver), com o passo para reproduzir.
