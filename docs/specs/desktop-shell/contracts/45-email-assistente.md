# Contrato 45 — Email no Assistente: pendências, rascunhos e tarefas
Feature: desktop-shell · Wave: 4 · Depende de: 42, 43 · PRD: `docs/specs/desktop-shell/prd-email.md`

## Pré-condições
- Seguir EXATAMENTE o desenho do WhatsApp no Assistente (contratos 25/38): ferramentas expostas ao motor, cartões no chat, envio só por clique, sem diálogo de confirmação extra.
- Conferir no código como o Assistente lê as conversas do WhatsApp hoje (ferramentas/contexto) e espelhar.

## Superfície
- Criar: ferramentas de email no módulo do Assistente (main), cartão `EmailCard` no renderer (reusar a base dos cartões existentes), testes.
- Alterar: prompt/sistema do Assistente (capacidades), tipos compartilhados.

## Critérios de aceite
- CA1 — Dado contas conectadas, quando o Assistente precisa de contexto, então existem ferramentas: listar não-lidos/pendentes (recebidos sem resposta minha, por conta, com idade), ler mensagem (corpo texto), buscar por remetente/assunto no cache local. Tudo só leitura do store do 42 — nenhuma ida extra ao servidor dentro da pergunta.
- CA2 — Dado "o que tenho de email pendente?", então a resposta usa a ferramenta e o chat mostra cartões de email (remetente, assunto, hora, conta) clicáveis — clique abre a tela Email naquela mensagem.
- CA3 — Dado "responde pro Fulano dizendo X", então o Assistente gera RASCUNHO num cartão com destinatário, assunto (Re:) e corpo editável + botão **Enviar** — o envio só acontece no clique (N1 da PRD) e usa o `scribe:email-send` do 42 com In-Reply-To correto; depois do envio o cartão vira "enviado às hh:mm".
- CA4 — Dado "cria uma tarefa pra responder o Fulano amanhã", então nasce tarefa no sistema de tarefas existente do Assistente com link para a mensagem; a tarefa aberta aparece nas pendências seguintes.
- CA5 — Dado o app bloqueado, as ferramentas de email ficam indisponíveis ao Assistente (mesma regra dos canais do 42) e os cartões antigos não vazam conteúdo novo.
- CA6 — Testes: regras de pendência (recebido sem resposta posterior minha conta como pendente; respondido não), montagem do rascunho (Re:/In-Reply-To), gate do clique (nenhum envio sem o evento do botão), ferramenta bloqueada com app bloqueado. Smoke: cenário fake com pergunta de pendências → cartão aparece; clique em Enviar no rascunho → fake SMTP recebe.

## Invariantes
- Fluxos atuais do Assistente (WhatsApp, reuniões, lembretes) intactos — testes existentes verdes.
- N1/N2 da PRD: nada sai sem clique; conteúdo só vai ao motor nas conversas, como já acontece com o WhatsApp.

## Fora de escopo
- Resposta automática; resumo diário agendado de emails; classificação/etiquetas.

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.
