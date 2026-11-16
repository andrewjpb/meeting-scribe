# Contrato 10 — Tela de Reuniões mais completa: dias, busca e resumo na lista
Feature: desktop-shell  ·  Wave: 10  ·  Depende de: 09 (mexe no smoke e na barra lateral)

## Pré-condições
- Contratos 01 a 09 aceitos; `gates.sh` verde (smoke com `--no-sandbox`).
- Pedido do Andrew (15/11/2026 20:40): "não estou gostando da forma como estão as reuniões, acho que poderia melhorar". Escolhas dele às 20:48: **agrupar por dia, busca, resumo na lista, dados da agenda**. Os dados da agenda chegam no contrato 12; este contrato deixa o lugar pronto (campos opcionais), sem depender dele.
- Hoje: `features/meetings/MeetingsScreen.tsx` lista por dia (`groupByDay` em `format.ts`) com título, hora, duração e `SourceDots`. O resumo (contrato 08) está em `userData/meetings/<id>.summary.json`.

## Superfície
- `features/meetings/MeetingsScreen.tsx`, `format.ts` e componentes novos da lista.
- `src/main/meetings/` — índice leve para a lista e a busca; `src/shared/` (tipos, IPC); preload.
- `src/main/smoke.ts` + fixtures.

## Critérios de aceite
- CA1: novo IPC `scribe:meetings-overview` devolve, por reunião, `{ meeting, summary: { overview: string (até 200 caracteres, cortado em palavra, com "…"), tasks: number, decisions: number } | null, summaryState: 'none' | 'generating' | 'ready' | 'error' }`, numa chamada só (sem N chamadas do renderer). Testes.
- CA2: grupos de dia com rótulos "Hoje", "Ontem", o dia da semana para os últimos 6 dias ("Quinta-feira") e "15 de novembro" (com o ano só se não for o atual) para os demais. Cabeçalho do grupo com o total do dia ("3 reuniões · 1 h 20 min"). Testes da função pura.
- CA3: cada linha mostra: título; hora de início e duração; `SourceDots`; a primeira frase do resumo em uma ou duas linhas (cinza, cortada com reticências); marcadores discretos "N tarefas" e "N decisões" quando houver; "Gerando resumo…" quando gerando; nada quando não tem resumo. Linha inteira clicável para o detalhe (mantém o comportamento de hoje, inclusive teclado). Espaço reservado para os participantes da agenda (contrato 12): se `meeting.calendar?.attendees` existir, mostra até 3 nomes + "+N". Segue `design.md` (sem sombra, sem pílula, raio ≤ 6 px).
- CA4: campo de busca no topo da tela ("Buscar reuniões", atalho ⌘F foca o campo). Busca sem diferenciar maiúsculas nem acentos, em: título, texto da transcrição, resumo (overview, decisões, tarefas, responsáveis). Feita no main (`scribe:meetings-search`, termo de 2 a 100 caracteres), com espera de 200 ms depois de digitar. Resultado: as mesmas linhas, agrupadas por dia, com um trecho de até 120 caracteres em volta da primeira ocorrência e a palavra marcada (`<mark>` com os tokens), e onde achou ("no título", "na transcrição", "no resumo"). Sem resultado: "Nada encontrado para "<termo>"." Esc limpa. Testes do main (acentos, maiúsculas, transcrição grande, termo curto) e desempenho: 300 reuniões de 1 h simuladas em menos de 300 ms.
- CA5: o resumo e a contagem na lista se atualizam quando um resumo termina (evento `scribe:summary-state` do contrato 08), sem recarregar a tela.
- CA6: estado vazio e de erro como hoje. Smoke: `reunioes-lista-light.png`, `-dark.png` e `reunioes-busca-light.png` com fixtures de 6 reuniões em dias diferentes, 2 com resumo; confere os rótulos dos dias, o trecho do resumo, "N tarefas" e uma busca por palavra que só existe na transcrição.

## Invariantes
- Contratos 01 a 09 continuam passando. Nenhum texto da transcrição sai do Mac por causa da busca. `prova/` e `docs/` não mudam.

## Fora de escopo
- Filtros por data/participante, ordenar por outro campo, apagar várias de uma vez, busca por significado.

## Gates
- `gates.sh` (smoke à mão com `--no-sandbox`) e `scripts/pack.sh` gerando o `.dmg`.

## Telas de impacto no usuário
- Reuniões: dias com rótulos claros, resumo e tarefas na lista, busca no topo.

## Notas do coordenador
- Nada de commit.
