# Contrato 130 — Ajustes apontados pela auditoria dos prints
Feature: tarefas  ·  Wave: 8 (correção pós-fechamento)  ·  Depende de: 129 (`auditoria-prints.md`)

## Pré-condições
- `tarefas` com os contratos 121–129 e a correção do check `funilTarefasSecao`; `pnpm gates` verde (256 prints).
- Achados em `docs/specs/tarefas/auditoria-prints.md`: B1 (bloqueador) e M1–M9 (menores). Nenhum muda regra de negócio.
- Constituição: `CLAUDE.md` do repo e `docs/specs/desktop-shell/design.md`.

## Superfície
- `apps/desktop/src/renderer/src/features/tarefas/{NovaTarefaInline,TarefasScreen,TarefaDetalhe,TarefaLinha}.tsx`,
  `features/tarefas/tarefasFormat.ts`, `features/email/ReadingPane.tsx`, `features/whatsapp/DetailsPanel.tsx`,
  `features/funil/OportunidadeScreen.tsx`, `features/meetings/MeetingDetailScreen.tsx` (só se B1 for do produto).
- `apps/desktop/src/main/smoke.ts`: enquadramento dos prints `detalhe-resumo-tarefas` (B1) e `configuracoes-geral-light` (M9)
  e as asserções novas abaixo. Nenhum print novo; `expectedShots` não muda.

## Critérios de aceite (Dado/Quando/Então)
- **CA1 (B1)** Dado o detalhe da reunião com a seção Tarefas abaixo da dobra, quando o smoke enquadra o print
  `detalhe-resumo-tarefas-*`, então a barra lateral fica no lugar (logo visível no topo) e não há faixa vazia no rodapé:
  o scroll acontece **só** no contêiner rolável da tela, nunca na raiz. Asserção no smoke: `document.scrollingElement.scrollTop === 0`
  e `getBoundingClientRect().top` do logo da barra ≤ 24 px no momento do print. Se a raiz rola também pelo teclado
  (Tab até um botão abaixo da dobra), corrigir a tela (`overflow` do contêiner certo), não só o smoke.
- **CA2 (M1, M2)** `NovaTarefaInline` ganha a variante `compacta` (prop), usada no e-mail e no WhatsApp: sem caixa de feito,
  sem campo de oportunidade, dica curta "Enter cria · Esc cancela", título e prazo numa linha (no painel de 300 px, prazo e
  botões na segunda linha, nunca "Cancelar" sozinho numa terceira). No e-mail, a frase do vínculo passa a "Ligada a este
  e-mail · <contato> · <oportunidade>" (as partes que existirem) e a caixa externa some (fica só a borda do formulário).
  Asserção: no print `email-leitura-tarefa-*` o formulário tem no máximo 2 linhas de controles; no `whatsapp-detalhes-tarefa-light`,
  no máximo 2 linhas e o botão Cancelar na mesma linha de Criar.
- **CA3 (M3)** Na lista estreita, "Vencidas · 2" com os espaços (usar `gap` ou `&nbsp;`); asserção: `textContent` do cabeçalho
  casa com `/^\S+ · \d+$/`.
- **CA4 (M4)** No detalhe, os rótulos de Vínculos ficam centrados verticalmente com os campos de 32 px (diferença ≤ 2 px);
  asserção por `getBoundingClientRect` do rótulo e do campo.
- **CA5 (M5)** O campo de oportunidade da Nova tarefa (variante completa) tem o ícone do funil à esquerda e o × para limpar
  quando há valor, como o artboard 05; asserção: ícone presente e × só com valor.
- **CA6 (M6)** O cabeçalho do grupo "Sem oportunidade" alinha a contagem à direita como os demais; asserção: `right` da
  contagem igual (±2 px) à dos outros grupos.
- **CA7 (M7)** Na seção Tarefas da oportunidade e no bloco das fichas, a coluna de origem não repete a própria
  oportunidade/contato: `TarefaLinha` ganha a prop `ocultarOrigem` (ou equivalente) usada ali; asserção: nenhuma linha da
  seção contém "Oportunidade: <título da própria oportunidade>".
- **CA8 (M9)** `configuracoes-geral-light` rolado até a seção Tarefas como o escuro (mesmo enquadramento nos dois temas).
- **CA9** `pnpm gates` (da raiz) verde: 256 prints, `failures: []`, nenhum literal de cor, nenhum título/e-mail nos `detail`.

## Invariantes
- Nenhum canal IPC, store, schema ou regra de negócio muda. Nenhum print novo. M8 (Tarefas antes de Oportunidades na ficha)
  **não muda**: é a ordem que o contrato 125 fixou.
- Os usos atuais de `NovaTarefaInline` (tela Tarefas, seção da oportunidade, fichas) continuam com a variante completa.
- Só tokens de `tokens.css`; raio ≤ 6 px; sem sombra; sem pílula; sem modal.

## Fora de escopo
- Observações da auditoria sem pendência (enquadramento da citação do Assistente, print do Resumo antes de Adicionar, foco).
- Pendências do plan (sugestão de análise, código morto dos lembretes, `emailExport.reminders` sem teste).

## Gates
- `pnpm gates` da raiz, verde por inteiro (CA9), com a tela do Mac acesa.
- Testes unitários: só se mexer em `tarefasFormat.ts` (frase do vínculo) — atualizar o caso existente.
