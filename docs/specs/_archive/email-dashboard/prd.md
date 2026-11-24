---
feature: email-dashboard
tipo: prd
status: aprovada-2026-11-23
criado: 2026-11-23
autor: LAP
versao-alvo: a definir no fechamento (main em 0.23.0; 0.23.1 e 0.24.0 reservadas)
contratos: 155–158
---

# PRD: Painel de e-mail

## Em uma frase

Na tela Email, um painel que olha todas as contas de uma vez e diz o que importa: os
e-mails que pedem atenção, quais merecem resposta (com a resposta já rascunhada) e quais
podem sair da Caixa de Entrada (com a pasta já escolhida), tudo analisado por IA e nada
feito sem um clique.

## Por que existe

Hoje a tela Email é um Outlook: pastas, lista, leitura. Para saber o que precisa de ação, o
Andrew percorre conta por conta, ou pergunta ao Assistente, que responde no chat. O
Assistente já sabe mover e já sabe rascunhar resposta, mas só quando pedido e uma vez por
vez. Não há lugar onde as três perguntas de quem abre o e-mail estejam respondidas lado a
lado: o que importa, o que respondo, o que tiro daqui.

Pedido do Andrew em 23/11/2026: "na tela de emails, quero um dash com os principais emails e
sugestões de mover emails e de respostas por email, um dash do email com todas as caixas
analisada por ia com sugestões e tal".

## Para quem

O próprio Andrew, com duas ou mais contas (Gmail por senha de app, Zoho, outras IMAP) e
caixas que acumulam newsletters, avisos de sistema e conversas de cliente misturados.

## Não é

- Não é triagem automática: o painel sugere; mover, responder e arquivar continuam sendo
  cliques dele.
- Não é um filtro antispam nem detector de e-mail malicioso (pendência antiga, fora daqui).
- Não é o Início: o Início continua sem IA (decisão de 23/11 na `inicio-atualizar`).
- Não substitui o Assistente: o chat continua lendo `EMAILS.md` e movendo a pedido.

## O que entra (visão de produto)

### 1. O Painel como primeira visão do Email

Um item **Painel** no topo da barra lateral do Email, antes das contas. Ao entrar na área
Email o app abre o Painel (hoje abre a última pasta). O Painel cobre todas as contas; cada
linha diz de qual conta é.

### 2. Cabeçalho com situação e o botão Analisar

"Analisado às HH:MM · N e-mails lidos pela IA · modelo" e o botão **Analisar agora**. Uma
linha por conta com não lidos e pendentes de resposta. Quando a análise por IA está
desligada, o painel mostra só o que a heurística atual já sabe (não lidos e pendentes) e um
aviso curto com o caminho das Configurações.

### 3. Cartão "Precisam de atenção"

Os e-mails que a IA classificou como mais importantes nos últimos 7 dias, de todas as
contas, com o motivo em uma frase ("cliente pergunta prazo da proposta", "cobrança vence
amanhã"). Clicar abre o e-mail na pasta dele. Nada aqui é ação, só leitura.

### 4. Cartão "Respostas sugeridas"

Para cada e-mail que a IA entende que espera resposta sua: remetente, assunto, motivo e o
rascunho da resposta (recolhido; expande em linha). Botões **Abrir no Composer** (abre a
resposta no Composer da conta certa, com o texto preenchido, para ele editar e enviar) e
**Ignorar**. O painel nunca envia.

### 5. Cartão "Sugestões de organização"

E-mails que podem sair da Caixa de Entrada, agrupados por destino ("Mover para Newsletters",
"Arquivar"), cada um com o motivo. Botões **Mover** por linha, **Mover todos** por grupo e
**Ignorar**. Só pastas que já existem na conta; contas POP3 não entram aqui. Todo mover vira
um lote com **Desfazer**, como o do Assistente.

### 6. Análise barata, diária e sob demanda

A IA roda sozinha uma vez por dia (na primeira vez que o app está desbloqueado e com rede
depois de virar o dia) e quando ele clica em Analisar agora. Só e-mails ainda não analisados
vão ao modelo; o resto vem do cache. Modelo padrão Haiku; opção de Sonnet e interruptor para
desligar a análise em Configurações › Email.

### 7. Memória do que ele decidiu

Sugestão ignorada não volta, mesmo depois de nova análise. E-mail movido ou respondido sai do
painel sozinho.

## Telas de impacto no usuário

| Tela | O que muda |
|---|---|
| Email › barra lateral | Item **Painel** no topo, antes das contas; entrar no Email abre o Painel. |
| Email › Painel (nova) | Cabeçalho com situação e Analisar agora; três cartões: Precisam de atenção, Respostas sugeridas, Sugestões de organização; estado vazio e estado "IA desligada". |
| Email › Composer | Pode abrir já com a resposta sugerida preenchida (vindo do Painel). Nada muda visualmente no Composer em si. |
| Email › lista da pasta | Banner de Desfazer já existente passa a aparecer também para lotes aplicados pelo Painel. |
| Configurações › Email | Seção nova **Painel**: interruptor "Analisar e-mails com IA", escolha do modelo (Haiku padrão / Sonnet), "Última análise às HH:MM" e o botão Analisar agora. |

Dá para gerar a apresentação do cliente depois da implementação, com prints reais; perguntar
antes de gerar.

## Fora de escopo desta versão

1. Detecção de e-mail malicioso ou phishing.
2. Criar pastas a partir de uma sugestão (só pastas existentes).
3. Enviar resposta direto do painel.
4. Regras automáticas geradas a partir das sugestões ("sempre mover este remetente").
5. Mudanças no Início (outra frente, sem IA por decisão).
6. Marcar importância no `EMAILS.md` do Assistente (fica como pendência).
7. Análise de anexos e imagens (frente `ia-midia`).
8. Contas Exchange/EWS e OAuth (adiados desde o contrato 44).

## Métricas de sucesso (uso pessoal)

- Abrir o Email e saber em menos de 10 segundos o que precisa de resposta hoje.
- Pelo menos metade das respostas do dia começando por "Abrir no Composer".
- Caixa de Entrada com menos de uma tela de e-mails depois de aplicar as sugestões.
- Custo por análise diária abaixo de alguns centavos de dólar com Haiku.

## Riscos

- **Qualidade do Haiku** em motivo e rascunho: mitigado pela opção de Sonnet e pelo fato de
  tudo ser editável antes de agir.
- **Privacidade**: prévias de e-mail vão ao modelo. Mesmo caminho que o Assistente já usa;
  interruptor para desligar; nada em log.
- **Corpos não baixados**: baixar tudo custa tempo de servidor. Teto por passada e prévia
  curta.
- **Conflito com outra frente**: `ia-midia` e `inicio-atualizar` mexem em `index.ts`, `ipc.ts`
  e `smoke.ts` ao mesmo tempo. Merge cuidadoso no fechamento.

## Documentos

- `analise.md` (levantamento), `spec.md`, `plan.md`, `contracts/155-*.md` a `158-*.md`,
  `mockups/`.
- Cofre: `Implementacoes/email-dashboard/`.
