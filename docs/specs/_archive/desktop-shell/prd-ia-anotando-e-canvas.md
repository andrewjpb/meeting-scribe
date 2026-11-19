# PRD — IA anotando ao vivo + canvas de post-its
Feature: desktop-shell · Wave: 30 · Data: 18/11/2026 · Pedido do Andrew (18/11 11:00, refinado 11:45–11:55)

## Problema
Durante a reunião o Andrew não tem mão livre para anotar: pendências, perguntas e decisões passam e se perdem.
As anotações existem (post-its coloridos), mas são 100% manuais, sem título, sem estado e numa lista fixa.

## Solução
1. **IA anotando ao vivo**: com um interruptor ligado, a cada **5 minutos** de gravação a IA lê só o trecho novo
   da transcrição e: (a) cria cards novos (título + descrição) para assuntos/pendências/perguntas que surgiram;
   (b) relê os cards **abertos** que ela mesma criou e **resolve** os que foram respondidos na conversa,
   escrevendo o motivo do fechamento. Nunca apaga nada; resolver é mudar de estado, com histórico.
   Sem fala nova suficiente, o ciclo é pulado (não gasta IA). Card mexido pelo usuário vira intocável pela IA.
2. **Canvas de post-its**: na aba Anotações do detalhe da reunião, os post-its ficam soltos num quadro: arrastáveis
   com o mouse, posição salva, visual de post-it colado (leve rotação, sombra ao arrastar). Filtro
   Abertos · Resolvidos · Todos. Card resolvido fica esmaecido com ✓ e o motivo visível.

## O que NÃO é
- A IA não envia nada a ninguém e não executa ação: só cria/resolve post-it local.
- Não apaga nem edita texto de card; não toca em card manual ou editado pelo usuário.
- Desligado (padrão), nenhum ciclo roda e nada muda no custo.
- O painel lateral da gravação continua em coluna (o canvas é no detalhe).

## Telas de impacto no usuário
- **Gravação › painel Anotações**: interruptor "IA anotando"; cards da IA aparecendo sozinhos com título.
- **Detalhe da reunião › Anotações**: canvas arrastável, filtro, visual de resolvido com motivo.
- **Configurações › Claude**: interruptor "IA anotando ao vivo" (padrão do interruptor da gravação).

## Riscos
- Custo/latência: 1 chamada Claude a cada 5 min (mesmo motor do "Analisar até agora", ~9s/ciclo); mitigado pelo
  ciclo pulado e pelo padrão desligado. Contrato 19 dizia "nenhuma análise sem clique" — revisado aqui: o ciclo
  só roda com o interruptor LIGADO pelo usuário (consentimento explícito, por gravação).
- Saída da IA é dado: zod estrito, ids de resolução validados contra os cards enviados, limites de tamanho.
- Canvas × smoke: a ordem do DOM continua a da lista (posição é só visual), para não quebrar checks existentes.
