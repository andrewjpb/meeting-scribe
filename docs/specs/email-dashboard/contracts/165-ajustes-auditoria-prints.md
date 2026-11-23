# Contrato 165 — Ajustes da auditoria dos prints do Painel
Feature: email-dashboard · Wave: 5 · Depende de: 158 (commitado) · Spec: `docs/specs/email-dashboard/spec.md` (R10, R13, R16, R22, "Prints exigidos") · Auditoria: `docs/specs/email-dashboard/auditoria-prints.md`

Caminhos relativos a `apps/desktop/src`. Constituição: `~/CLAUDE.md` e `docs/specs/desktop-shell/design.md`. Quatro correções pequenas achadas ao comparar os 14 prints do smoke com os artboards de `mockups/png/`. Nenhuma tela nova, nenhuma mudança de layout.

## Pré-condições
- 155–158 commitados no branch `email-dashboard` (HEAD com "(contrato 158)").
- Nenhum outro smoke rodando na máquina: antes do `pnpm gates`, `while pgrep -f 'scripts/smoke.mjs' >/dev/null; do sleep 30; done`. Nunca tocar em `/Users/andrew/Documents/GitHub/meeting-scribe` (repositório principal, de outra sessão).

## Superfície
- `main/email/dashboard.ts` (`view()`, linha ~148: `name: cache.status.account.address`).
- `shared/email-dashboard.ts` (`EmailDashboardView`, `buildDashboardView`) e `shared/email-dashboard-schema.ts` se o esquema da view existir lá.
- `renderer/src/features/email/painelFormat.ts` (subtítulo D2 e "Última análise" D13), `PainelEmail.tsx` e `features/settings/EmailPainelSection.tsx` só onde consomem esses textos.
- `renderer/src/features/email/OrganizePanel.tsx` (faixa da pasta organizada, ~linha 195: "O Assistente moveu N mensagens").
- `main/smoke.ts`, check `dashboardDisabled` (captura `email-painel-ia-desligada`, ~linha 16745).
- Testes: `test/main/email-dashboard*.test.ts`, `test/shared/email-dashboard.test.ts`, `test/renderer/painel-email-estatico.test.ts` ou `painel-email.test.tsx`, e o teste que já cobre a faixa do `OrganizePanel` (achar por "O Assistente moveu").
- Docs só se citarem o texto alterado: `resources/assistente/guia-do-app.md`, `docs/specs/desktop-shell/design.md` (bloco "Email › Painel").

## Critérios de aceite

- **CA1 — conta pelo nome.** Dado uma conta com `account.name = "Andrew Teste"` e `address = "andrew.teste@lap.example"`, quando a view é montada, então `view.accounts[i].name === "Andrew Teste"`; com `name: null`, `name === address`. Efeito visível: linha da conta (R13), sufixo "· conta" das linhas dos três cartões, cabeçalho do grupo "Mover para Newsletters · Andrew Teste" e apoio do banner "Pelo Painel, às HH:MM · Andrew Teste". O endereço continua disponível em `view.accounts[i].address` (criar o campo se não existir) para o `title`/tooltip. Teste em `test/main/email-dashboard*.test.ts` com os dois casos.

- **CA2 — total analisado, não a última passada.** Dado um store com 6 itens das contas listadas e `lastRun.analyzed = 0` (passada idempotente), quando a view é montada, então `view.analyzed === 6` (itens de `store.items` das contas presentes, descontados os ignorados), e:
  - o subtítulo do cabeçalho é "Analisado às HH:MM · 6 e-mails · Haiku" (não "0 e-mails");
  - "Última análise" das Configurações é "Às HH:MM · 6 e-mails[ · US$ x]";
  - com store vazio, os dois mostram "0 e-mails"; sem `lastRun`, continuam "Ainda não analisado"/"Nunca".
  `lastRun.analyzed` permanece no store e na linha de log (não muda o contrato 156). Testes em `test/shared/email-dashboard.test.ts` (campo) e no teste estático do renderer (texto).

- **CA3 — faixa da Caixa de Entrada por origem.** Dado um lote com `origem: 'painel'` e 3 mensagens, quando a faixa do `OrganizePanel` renderiza na pasta, então o título é "O Painel moveu 3 mensagens" ("O Painel moveu 1 mensagem" no singular); lote sem `origem` ou com origem do Assistente continua "O Assistente moveu N mensagens". O resto da faixa (quando, Desfazer, Tentar de novo, "desfeito em parte") não muda. Teste no arquivo que já cobre a faixa, com os dois casos.

- **CA4 — print da IA desligada sem faixa velha.** Dado o check `dashboardDisabled` do smoke, quando captura `email-painel-ia-desligada`, então a faixa "Desfeito: N mensagens voltaram…" do check anterior não está no quadro: antes da captura, fechar a faixa pelo seu botão de fechar se ela existir (ou esperar ela sumir, no máximo 6 s, com `waitFor`), e acrescentar `bannerGone=true|false` ao `detail` (R36: só números/booleanos). `expectedShots` não muda (continua +251).

- **CA5 — gate completo verde e prints regravados.** `pnpm gates` da raiz do worktree termina com "gates ok"; `apps/desktop/out/smoke/report.json` sem `failures`; os 14 PNGs do Painel regravados mostram "Andrew Teste" no lugar do endereço e, em `email-painel-resposta`/`email-painel-desfazer`, o subtítulo com "6 e-mails"/"3 e-mails" conforme o que está na tela.

- **CA6 — ressalvas da revisão do 158 no smoke** (`main/smoke.ts`, `emailDashboardChecks`):
  - `dashboardIdempotent` (~16668): quando a segunda passada não termina, o `detail` não pode sair `analyzed=-1` (o `numericDetail` rejeita o sinal); usar `finished=false` e `analyzed=0`.
  - `emailDashboard.enabled` (~16735–16746), transporte e tema (~16551–16559): religar/restaurar no `finally`, não só no caminho feliz.
  - `dashboardMove` (~16714): `newsletters=` mede o tamanho real da pasta "Newsletters" no servidor falso, não repete `moved`.
  - `test/smoke-privacy.test.ts`: acrescentar os casos chave vazia (`=1`) e par sem `=` (`analyzed`), ambos rejeitados por `numericDetail`.

## Invariantes
- Nenhum e-mail, assunto, remetente, endereço ou nome no `detail` de nenhum check nem em log (R36; `numericDetail` continua valendo para todos os `detail` do grupo).
- Nada é enviado nem movido sem clique; nenhum canal IPC novo; nenhum token, tamanho ou raio novo no design system.
- Os outros 7 checks do Painel e os prints de outras telas não mudam de `ok`.

## Fora de escopo
- Qualquer mudança de layout, texto do mockup ("N não lidos pendentes" fica), ou o rodapé "Nova versão" da barra (atualizador falso).
- A barra mostrando "Arquivo 8" durante os prints (isolamento da INBOX, decisão do 158).
- O parágrafo defasado do guia sobre "Email abre a última pasta" (pendência registrada no fechamento).

## Gates
- `pnpm -C apps/desktop typecheck`, `pnpm -C apps/desktop lint`, `pnpm -C apps/desktop test` verdes.
- `pnpm gates` da raiz (inclui o smoke; tela desbloqueada; esperar outro smoke terminar).
- Relatório: arquivos tocados, CA1–CA6 com evidência, decisões, o que não foi feito.
