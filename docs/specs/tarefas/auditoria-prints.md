---
feature: tarefas
contrato: 129
status: pendente-de-execucao
data: 2026-11-22
semana: 2026-W47
base: tarefas a44f843
---

# Auditoria dos prints do smoke (tarefas)

**Não executada.** O `SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` do fechamento (22/11/2026, 05:38, na `tarefas` em `a44f843`) passou typecheck, lint, vitest (169 arquivos, 2897 testes) e build, e parou no smoke com `[smoke] erro: Error: Current display surface not available for capture`: a tela do Mac estava bloqueada (`CGSSessionScreenIsLocked = true` no `ioreg`, conferido antes e depois). O `report.json` ficou com "0 PNGs em vez de 256" e todos os checks "não executado". Nenhum print novo foi gerado. Os passos 6 a 8 dos gates (cores, formas, pytest) não rodaram nessa execução porque o script para no primeiro erro.

Para concluir: com a tela acesa e desbloqueada, rodar `SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` da raiz, conferir `expectedShots` = `SCREENS.length * THEMES.length + 222` = 256 (SCREENS com 17) e `failures` vazio, abrir cada print abaixo inteiro e comparar com o artboard do mockup (`mockups/png/`) e com `docs/specs/desktop-shell/design.md`, e trocar o veredito "não executado" de cada linha por "ok" ou pelo achado, no formato de `docs/specs/_archive/funil-vendas/auditoria-prints.md`. Depois, o resumo por gravidade e `status: concluido`.

## O que procurar em todos

Corte, sobreposição, espaço morto, desalinhamento, texto técnico (id, JSON, "undefined", "tarefa-criar"), cor fora do token, contraste ruim no escuro, título de tarefa cortado sem reticências, linha de tarefa fora dos 44 px, cabeçalho de grupo fora dos 28 px, raio acima de 6, sombra, pílula. No `report.json`: nenhum título de tarefa nem endereço de e-mail nos `detail` dos checks novos (só números e booleanos, D17).

## Resumo

- **0 de 29 prints conferidos** (19 novos e 10 regravados ou renomeados), mais a linha de conferência de `funil-oportunidades-*`. Nenhum gerado nesta execução.
- Prints reais que já existiam, de execuções parciais do contrato 123 no worktree `meeting-scribe-tarefas-123` (anteriores aos contratos 124 a 127, então não valem como auditoria final): `tarefas-hoje-light` bate com o artboard 02 (vencida em `--rec` com "há 2 d", "hoje" em peso 500, linhas de 44, cabeçalhos de grupo de 28, badge "1" ao lado de Tarefas; a busca tem 240 px, e não 200 como no mockup); `configuracoes-geral-light` mostra a seção Tarefas com os quatro campos e os textos do app, iguais aos do artboard 15 menos as descrições do Funil, que o mockup trazia antigas. As duas diferenças já foram levadas para os artboards de `docs/telas`.

### Bloqueador

Nenhum conhecido (não executado).

### Menor

Nenhum conhecido (não executado). A conferir com atenção, pelo que a leitura do código já indica (ver "Pendências" no fim do `plan.md`): o formulário "+ Tarefa" no painel de 300 px do WhatsApp (o campo Oportunidade e a dica longa quebram em várias linhas) e a seção Tarefas da oportunidade apertando as abas.

## Por print

| print | artboard de referência | veredito | o que conferir |
|---|---|---|---|
| `tarefas-hoje-light.png` | `02-tarefas-hoje-claro` | não executado | Vencidas antes de Hoje; vencida "dd/mm · há N d" em `--rec` peso 500; "hoje" em `--text` peso 500; linhas de 44 com caixa de 16, origem em 236, responsável em 112, estrela em `--title`; cabeçalhos de grupo de 28 com contagem; "Sugestões N" no Segmented; badge de vencidas na barra igual ao do Email. |
| `tarefas-hoje-dark.png` | `02-tarefas-hoje-escuro` | não executado | O mesmo; `--rec` e a estrela legíveis no escuro; caixa de feito visível sobre `--bg`. |
| `tarefas-todas-agrupadas-light.png` | `03-tarefas-todas-agrupadas-claro` | não executado | Agrupado por Oportunidade: cabeçalho "nome · etapa · N", grupos pelo prazo mais perto, "Sem oportunidade" no fim; sem prazo no fim de cada grupo. |
| `tarefas-todas-agrupadas-dark.png` | `03-tarefas-todas-agrupadas-escuro` | não executado | O mesmo; fio `--line-strong` dos cabeçalhos visível. |
| `tarefas-detalhe-light.png` | `04-tarefas-detalhe-claro` | não executado | Lista estreita de 340 px em duas linhas (título; "origem · prazo"), a aberta em `--bg-sunken`; detalhe sem modal; Concluir, Cancelar e Apagar logo abaixo do título; campos de 32 com rótulo de 96; texto do aviso ao lado do Lembrete; Vínculos com "Abrir" e "+ Vincular reunião"; Histórico; "Agrupar por" escondido. |
| `tarefas-detalhe-dark.png` | `04-tarefas-detalhe-escuro` | não executado | O mesmo; `<input type=date>` e `select` nativos legíveis no escuro. |
| `tarefas-nova-light.png` | `05-tarefas-nova-claro` | não executado | Formulário em linha no topo da lista (painel com fio `--line-strong`, raio 6), título com foco, prazo de 140, oportunidade com ícone do funil e ×, "Criar" desabilitado sem título, "Enter cria · Esc cancela". |
| `tarefas-nova-dark.png` | `05-tarefas-nova-escuro` | não executado | O mesmo; anel de foco em `--focus`. |
| `tarefas-sugestoes-light.png` | `06-tarefas-sugestoes-claro` | não executado | Linhas de 44 com o ícone da origem num quadrado de 28, texto, origem e data, "Adicionar" e "Ignorar"; "Agrupar por" escondido; nada de texto técnico na origem. |
| `tarefas-sugestoes-dark.png` | `06-tarefas-sugestoes-escuro` | não executado | O mesmo. |
| `tarefas-vazia-light.png` | `07-tarefas-vazia-claro` | não executado | `EmptyState` "Nada para hoje" centrado, com "Ver todas (N)"; sem badge na barra quando não há vencidas. |
| `funil-oportunidade-light.png` (regravado) | `08-funil-oportunidade-claro` | não executado | Seção Tarefas entre a grade de campos e as abas, "N abertas · a primeira é o próximo passo no quadro"; sem o campo Próximo passo; "Nova tarefa" em 40; "Feitas N" recolhida em 28; título da oportunidade sem corte (o B1 do funil); abas ainda visíveis. |
| `funil-oportunidade-dark.png` (regravado) | `08-funil-oportunidade-escuro` | não executado | O mesmo. |
| `funil-contato-tarefas-light.png` | `09-funil-contato-tarefas-claro` | não executado | Bloco Tarefas na ficha com sublinhas de 32 e "+ Nova tarefa" no estilo do "+ E-mail"; o campo Notas continua na ficha. |
| `detalhe-resumo-tarefas-light.png` | `10-detalhe-resumo-tarefas-claro` | não executado | Coluna de estado de 32 à esquerda; prazo "dd/mm" com o que foi dito em `--text-faint`; "Adicionar" (28) ou o ícone de abrir; "Adicionar as minhas" no título da seção; caixa marcada na linha já adicionada. |
| `detalhe-resumo-tarefas-dark.png` | `10-detalhe-resumo-tarefas-escuro` | não executado | O mesmo. |
| `detalhe-resumo-light.png` (regravado, coluna nova) | `10-detalhe-resumo-tarefas-claro` | não executado | A tabela de tarefas do Resumo com a coluna nova não desalinha as outras colunas nem empurra Responsável e Prazo para fora; nenhuma linha quebra. |
| `detalhe-resumo-dark.png` (regravado, coluna nova) | `10-detalhe-resumo-tarefas-escuro` | não executado | O mesmo. |
| `email-leitura-tarefa-light.png` | `11-email-leitura-tarefa-claro` | não executado | "+ Tarefa" no cabeçalho à direita, ao lado da data, pressionado (`--bg-sunken`) com o formulário aberto; caixa entre o cabeçalho e o corpo com título = assunto e a frase "Ligada a …"; corpo do e-mail carregado; nenhum endereço de e-mail no `detail` do check. |
| `email-leitura-tarefa-dark.png` | `11-email-leitura-tarefa-escuro` | não executado | O mesmo. |
| `whatsapp-detalhes-tarefa-light.png` | `12-whatsapp-detalhes-tarefa-claro` | não executado | Só "+ Tarefa" no bloco Contato (sem "N abertas com ele"); o formulário no painel de 300 px: ver quebra do campo Oportunidade e da dica longa (pendência 4 do plan). |
| `assistente-tarefas-light.png` | `13-assistente-tarefas-claro` | não executado | Fonte Tarefas primeira e ligada no Contexto; cartão "Criar tarefa <título>" com pares Prazo, Lembrete, Oportunidade e Contato; citação `[Tarefa · …]`; nenhum id nem nome de bloco técnico na resposta. |
| `assistente-tarefas-dark.png` | `13-assistente-tarefas-escuro` | não executado | O mesmo. |
| `automacoes-agendamentos-light.png` (antes `tarefas-light`) | `14-automacoes-agendamentos-claro` | não executado | Aba "Agendamentos"; "Novo agendamento"; "Pausar todos os agendamentos"; nenhum lembrete na lista; "Pode ler as tarefas" abaixo de "Pode ler o funil" quando o formulário do agente aparece. |
| `agendamento-editar-light.png` (antes `tarefa-editar-light`, contrato 128) | `14-automacoes-agendamentos-claro` | não executado | Formulário do agendamento com o vocabulário novo; nenhum "tarefa" sobrando nos rótulos, botões e mensagens do formulário. |
| `configuracoes-geral-light.png` (regravado, rolado até Tarefas) | `15-configuracoes-geral-tarefas-claro` | não executado | Seção Tarefas abaixo de Funil de vendas com Hora do lembrete (campo de 96 com relógio), Lembrar no prazo, Aviso diário Hoje e Sugerir tarefas das reuniões; "Incluir oportunidades esfriadas no aviso Hoje" no Funil. |
| `configuracoes-geral-dark.png` (regravado) | `15-configuracoes-geral-tarefas-escuro` | não executado | O mesmo. |
| `sidebar-raiz-light.png` (regravado) | `01-barra-raiz-claro` | não executado | Tarefas logo depois de Reuniões, ícone `SquareCheck`, contador de vencidas em 12 tabular `--side-text` igual ao do Email; nada quando zero. |
| `sidebar-raiz-dark.png` (regravado) | `01-barra-raiz-escuro` | não executado | O mesmo. |
| `funil-oportunidades-*` (já existentes; o cartão mudou) | `16-funil-kanban-proxima-tarefa-*` | não executado | Cartão com a próxima tarefa e a data (em `--rec` quando venceu) e "Sem tarefa" quando não há; os mesmos passos de antes da migração (CA1). Não é print novo nem exigido; conferir junto. |
