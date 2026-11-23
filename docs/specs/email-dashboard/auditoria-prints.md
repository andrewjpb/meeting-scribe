---
feature: email-dashboard
contrato: 158
correcoes: 165
status: em-correcao
data: 2026-11-23
semana: 2026-W48
base: email-dashboard 4af7500 (+158 não commitado)
---

# Auditoria dos prints do smoke (email-dashboard)

Prints de `apps/desktop/out/smoke/` gravados pelo `pnpm gates` do contrato 158 em 23/11/2026 às 19:51 (287 PNGs de 2240×1480, `failures` vazio). Conferidos os 14 prints de "Prints exigidos" da spec (7 telas × claro e escuro), cada um comparado com o artboard correspondente de `mockups/png/` e com `docs/specs/desktop-shell/design.md`. Procurei corte, sobreposição, espaço morto, desalinhamento, texto técnico (id, JSON, "undefined"), cor fora do token, contraste ruim no escuro e divergência de conteúdo em relação à spec.

## Resumo

- **14 prints:** 6 `ok`, 8 `ajustar` (os 8 pelos achados A1 e A2, que atravessam as telas com conteúdo).
- Nenhuma cor fora da paleta nos dois temas, nenhuma sombra, nenhuma pílula, nenhum id, JSON ou "undefined". Estrutura igual ao mockup: contas no topo da coluna esquerda, "Precisam de atenção" em 380 px, respostas e organização à direita, linhas de 44, quadrado de 6 px, grupo com "Mover todos (N)", item Painel de 28 px marcado na barra.
- Os achados viraram o **contrato 165**; a tabela abaixo é da rodada do 158 e será refeita com os prints regravados.

### Ajustar (vão ao contrato 165)

- **A1. Conta pelo endereço.** Linha da conta, sufixo "· conta" das linhas dos três cartões, cabeçalho do grupo ("Mover para Newsletters · andrew.teste@lap….", cortado) e apoio do banner mostram `andrew.teste@lap.example`; o mockup e a barra lateral mostram o nome ("Andrew Teste"). Origem: `main/email/dashboard.ts` `view()` usa `account.address`. Todos os prints com conteúdo.
- **A2. "0 e-mails" no subtítulo e em Última análise.** Depois da passada idempotente, "Analisado às 19:51 · 0 e-mails · Haiku" com 6 e-mails na tela (`email-painel-resposta`, `email-painel-desfazer`, `email-painel-ia-desligada`, `config-email-painel`). O texto conta a última passada (`lastRun.analyzed`), não o que está analisado.
- **A3. Faixa da Caixa de Entrada rotula o lote do Painel como Assistente.** `OrganizePanel.tsx` monta "O Assistente moveu N mensagens" para qualquer lote; o lote com `origem: 'painel'` deveria dizer "O Painel moveu N mensagens". Visto por leitura do código; em `email-compor-sugerida` a faixa "O Assistente moveu 1 mensagem · 19:50 · desfeito em parte" é de um check anterior, não do Painel.
- **A4. Faixa "Desfeito" velha no print da IA desligada.** `email-painel-ia-desligada` traz "Desfeito: 3 mensagens voltaram para a Caixa de Entrada." do check anterior (janela de 5 s da frase). Correção no smoke: fechar a faixa antes da captura.

### Observações (não viram pendência)

- **Dados do cenário, não da interface.** "Motivo de teste N" e a resposta igual em todos os blocos vêm da fixture do modelo falso. "Arquivo 8" na barra é o isolamento da INBOX falsa feito pelo check (as 8 mensagens dos checks anteriores ficam em Arquivo durante os prints do Painel). "Nova versão 0.24.0 / Atualizar" no rodapé vem do atualizador falso.
- **Motivo também nas linhas da organização** ("Newsletter" depois do assunto): o mockup não o desenha nessas linhas, mas é o mesmo padrão das outras linhas e cabe; mantido.
- **"6 não lidos pendentes"** no cabeçalho do cartão com a IA desligada é o texto do artboard C aprovado; mantido.
- **Faixa "Desfeito" na própria tela do Painel** (A4) é o comportamento normal da `OrganizeBanner` reaproveitada: a frase fica 5 s e some; só o print a pegou.

## Por print

| print | artboard | veredito | achado |
|---|---|---|---|
| `email-painel-{light,dark}` | 01 A | ajustar | A1 |
| `email-painel-vazio-{light,dark}` | 02 B | ok | — |
| `email-painel-ia-desligada-{light,dark}` | 03 C | ajustar | A1, A2, A4 |
| `email-painel-resposta-{light,dark}` | 04 D | ajustar | A1, A2 |
| `email-painel-desfazer-{light,dark}` | 05 G | ajustar | A1, A2 |
| `email-compor-sugerida-{light,dark}` | 06 E | ok | — (faixa de check anterior; ver A3) |
| `config-email-painel-{light,dark}` | 07 F | ok | A2 só no texto "0 e-mails" |
