# PRD — Pastas de reuniões e gravação em andamento na lista
Feature: desktop-shell · Wave: 28 · Data: 18/11/2026 · Pedido do Andrew (18/11/2026 11:12, com print da lista)

## Problema
A lista de Reuniões é uma linha do tempo única: tudo junto, por dia. Com clientes diferentes, o Andrew quer
organizar: "quero colocar as reuniões em pastas e poder mover a gravação para pastas, posso colocar nome de
cliente ou qualquer outro". Além disso, quando uma gravação está em andamento, a lista não mostra nada — parece
que não há nada acontecendo e é preciso lembrar que a tela de gravação existe.

## Solução
1. **Gravando agora na lista**: com uma gravação em andamento, a lista de Reuniões mostra, acima dos grupos de
   dias, um cartão "Gravando agora" com o ponto vermelho pulsante, o título e o tempo decorrido; clicar leva à
   tela de gravação.
2. **Pastas**: o usuário cria pastas com nome livre (ex.: cliente), move qualquer reunião para uma pasta pelo
   menu da linha, e filtra a lista por pasta numa barra de pastas ("Todas" + cada pasta). Pasta pode ser
   renomeada e excluída (excluir a pasta NUNCA apaga reuniões: elas voltam para fora de pasta).

## O que NÃO é
- Não é hierarquia: pastas não têm subpastas.
- Excluir pasta não exclui reunião nenhuma.
- A busca continua global (procura em todas as pastas).
- Sem arrastar e soltar nesta fase: mover é pelo menu da linha.

## Telas de impacto no usuário
- **Reuniões (lista)**: cartão "Gravando agora" quando há gravação; barra de pastas abaixo do cabeçalho
  ("Todas" + pastas + "Nova pasta"); menu "⋯" em cada linha com "Mover para…"; contagem por pasta.
- **Nenhuma outra tela muda.**

## Riscos
- `meetings.json` ganha campos novos (`folders`, `folderId`) mantendo `version: 1` e compatibilidade: arquivo
  antigo continua carregando; app antigo que abra arquivo novo ignora os campos.
- Menu dentro de uma linha que é inteira um link: seguir o padrão já usado no ChatRow.
