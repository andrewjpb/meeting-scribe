---
status: aprovada
feature: inicio-atualizar
tipo: spec
data: 2026-11-23
semana: 2026-W48
base: versão com os agentes de atendimento (0.23.0)
---

# Spec — Início: atualizar quando chega email e botão "Atualizar"

## Problema e objetivo
A tela Início (0.22.0) só relê quando é aberta, quando a janela ganha foco ou quando uma fonte avisa. De
email ela mostra apenas o total da pasta "Pendentes", tirado de uma lista de pastas guardada, que não muda
quando chega mensagem. Resultado: chega email e nada muda no Início. O Andrew pediu (23/11/2026) que o Início
se atualize sempre que chegar email e que haja um botão para atualizar na hora. Decisão dele no mesmo dia:
o botão **só atualiza a tela**; nada de IA, nada de triagem automática.

## Requisitos
- R1. O cartão de pendências do Início DEVE mostrar "N emails não lidos" (soma da caixa de entrada das contas
  conectadas), lido do que o app já tem guardado, sem abrir conexão. Com zero, a linha não aparece. O clique
  leva à tela Email.
- R2. QUANDO chega email novo com o app desbloqueado, O SISTEMA DEVE atualizar o Início em até 2 s, sem clique
  e sem a tela precisar de foco. Uma rajada de emails gera no máximo uma atualização por segundo.
- R3. O topo do Início DEVE ter o botão "Atualizar". QUANDO clicado, O SISTEMA DEVE reler na origem a agenda
  (Google e Microsoft), o Calendário do Mac, a lista de pastas do email (para o total de Pendentes) e depois
  montar a tela de novo. Durante a leitura o botão mostra "Atualizando…" e não aceita outro clique.
- R4. Ao lado do botão, O SISTEMA DEVE mostrar "Atualizado às HH:MM" com a hora da última leitura bem-sucedida
  (por clique ou automática).
- R5. QUANDO uma fonte falha no "Atualizar", O SISTEMA DEVE manter o que estava na tela para aquela fonte,
  atualizar as demais e mostrar "Não foi possível atualizar tudo." ao lado do botão até a próxima leitura.
- R6. QUANDO o app é desbloqueado, O SISTEMA DEVE reler o Início (o que chegou durante o bloqueio aparece).

## Regras
- N1. Só leitura: "Atualizar" não grava, não move, não marca como lido e não chama modelo.
- N2. Email novo nunca abre conexão extra por causa do Início: a contagem de não lidos vem do que já foi lido.
- N3. Com o app bloqueado o Início continua sem se atualizar e o botão é recusado, como os demais.
- N4. A linha de não lidos pertence ao bloco "Pendências": some com ele quando o bloco é desligado em
  Configurações › Geral › Início, e não aparece para conta de email desconectada.

## Telas de impacto no usuário
- Início: botão "Atualizar" e o texto "Atualizado às HH:MM" no topo, à direita da saudação; linha
  "N emails não lidos" no cartão de pendências. Mockup em `mockups/`.
Dá para gerar a apresentação depois da implementação, com prints reais.

## Critérios de aceite
- CA1. Uma conta com 3 não lidos na caixa de entrada e outra com 2: o Início mostra "5 emails não lidos"; com 1, "1 email não lido"; com 0, a linha não existe.
- CA2. Chega um email (serviço de email falso do smoke): sem clicar e sem focar a janela, o número sobe em até 2 s e "Atualizado às" muda.
- CA3. Dez emails em 1 s geram no máximo duas montagens da tela.
- CA4. Clique em "Atualizar": a agenda, o Calendário do Mac e a lista de pastas são relidos uma vez cada; o botão fica "Atualizando…" e desabilitado até o fim; dois cliques seguidos geram uma leitura.
- CA5. Agenda fora do ar no clique: os eventos que estavam na tela continuam, as outras fontes atualizam e aparece "Não foi possível atualizar tudo.".
- CA6. App bloqueado: o pedido de atualizar é recusado; ao desbloquear, o Início é relido uma vez.
- CA7. Nenhuma chamada a modelo, nenhuma gravação e nenhuma conexão de email nova são feitas pela chegada de email (teste com dependências falsas que contam chamadas).
- CA8. Os checks e prints atuais do Início no smoke continuam passando; os prints do Início mudam só pelo topo novo e, onde houver não lidos, pela linha nova.

## Fora de escopo
1. Triagem de emails, resumo do dia ou qualquer uso de IA no Início.
2. Mostrar remetente, assunto ou prévia de email no Início.
3. Atualização com o app bloqueado.
4. Intervalo de atualização configurável.
5. Mudança na tela Email.

## Verificação end-to-end
Com o smoke: abrir o Início, conferir "Atualizado às"; injetar um email não lido e ver a linha "1 email não
lido" aparecer sozinha; clicar "Atualizar" e ver "Atualizando…" e depois a hora nova; bloquear, injetar outro
email, desbloquear e ver "2 emails não lidos".
