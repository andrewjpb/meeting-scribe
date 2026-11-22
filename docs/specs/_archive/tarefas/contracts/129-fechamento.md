# Contrato 129: Fechamento das tarefas (docs, telas, auditoria dos prints e preparação do arquivamento)

Feature `tarefas` · Wave 7 · Depende de: 121 a 128 commitados e mesclados na `tarefas` · Spec `../spec.md` (CA17; "Prints exigidos"; "Telas de impacto no usuário"; "Verificação end-to-end") · Plan `../plan.md` (D17, "Fechamento", "Ambiguidades da spec") · Mockup `../mockups/Tarefas.dc.html` (todos os artboards, como fonte para `docs/telas`). **Você não commita.** Worktree `/Users/andrew/Documents/GitHub/meeting-scribe-tarefas` (branch `tarefas`). Único contrato da wave 7. A publicação nos artefatos do claude.ai é do coordenador; você deixa os arquivos-fonte prontos no repositório.

## Pré-condições
- Leia a spec inteira, o plan e os relatórios dos contratos 121 a 128 (o coordenador passa os caminhos ou cola os trechos de "diferenças em relação ao contrato").
- No repositório: `README.md` (seção "Funil de vendas" `:81-93` como molde), `resources/assistente/guia-do-app.md` (o bloco `<!-- tela: tarefas -->` do 123 e as trocas de texto do 128), `docs/telas/README.md`, `docs/telas/artboards/` e `docs/telas/artboards/canvas.json` (`boards`, `order`), `docs/specs/desktop-shell/design.md`, e como modelo de fechamento o contrato 118 (`docs/specs/_archive/funil-vendas/contracts/118-fechamento.md`) e a `auditoria-prints.md` dele.
- Rode `SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` uma vez no início para ter os prints frescos em `apps/desktop/out/smoke/`.

## Superfície

### Auditoria dos prints (CA17)
- Confira os **19 PNGs novos**: `tarefas-hoje` (claro e escuro), `tarefas-todas-agrupadas`, `tarefas-detalhe`, `tarefas-nova`, `tarefas-sugestoes` (claro e escuro cada), `tarefas-vazia-light`, `funil-contato-tarefas-light`, `detalhe-resumo-tarefas`, `email-leitura-tarefa` (claro e escuro cada), `whatsapp-detalhes-tarefa-light`, `assistente-tarefas` (claro e escuro); e os **regravados**: `funil-oportunidade-*` (seção Tarefas), `automacoes-agendamentos-light` (antes `tarefas-light`), `configuracoes-geral-*` (rolado até Tarefas), `sidebar-raiz-*` (item Tarefas com o contador), `detalhe-resumo-*` (coluna nova).
- Abra cada um e compare com o artboard correspondente; registre em `docs/specs/tarefas/auditoria-prints.md` uma linha por print: "ok" ou o achado (corte, sobreposição, espaço morto, desalinhamento, texto técnico, cor fora do token, contraste ruim no escuro, título de tarefa cortado sem reticências, linha fora dos 44 px).
- Correção de uma linha em `features/tarefas/**`, nos componentes que a feature tocou ou em `smoke.ts` é sua; o resto vira pendência. `expectedShots` termina em `SCREENS.length * THEMES.length + 222` com `SCREENS` de 17 itens; se a auditoria mudar algum print, o número não muda.

### Docs permanentes (anti-drift)
- `README.md`: seção "Tarefas" depois de "Funil de vendas" (o que é; Hoje, Próximas, Todas, Feitas e Sugestões; de onde nascem: Resumo, oportunidade, ficha, e-mail, WhatsApp, Assistente; lembretes e o aviso "Hoje"; o próximo passo da oportunidade é a próxima tarefa aberta; "Agendamentos" nas Automações; Configurações › Geral › Tarefas; onde ficam os dados: `tarefas.json` no userData, só neste Mac; a migração única do próximo passo e dos lembretes, com as cópias `*.bak-tarefas-*`). Na seção do funil, troque "próximo passo" pelo texto novo.
- `resources/assistente/guia-do-app.md`: complete `<!-- tela: tarefas -->` (tela, detalhe, Nova tarefa e ⌘⇧T, sugestões, lembretes, aviso "Hoje"); na seção do Assistente, a fonte Tarefas (ligada por padrão) e os cartões `tarefa-criar`, `tarefa-concluir`, `tarefa-adiar`, o `lembrete` que vira tarefa e o `agendamento`; nas Automações, "Agendamentos" e "Pode ler as tarefas"; no funil, a seção Tarefas da oportunidade e "Sem tarefa" no kanban. `test/assistant.test.ts` continua verde.
- `docs/specs/desktop-shell/design.md`: os padrões novos (linha de tarefa de 44 px com caixa de feito; detalhe ao lado sem modal; grupo com cabeçalho de 28 px; formulário em linha no topo da lista; contador de vencidas na raiz no padrão do Email), com a data real do fechamento. A lista da raiz (`design.md:87`) passa a citar Tarefas depois de Reuniões.
- `docs/telas/`: um artboard `.dc.html` por tela nova ou mudada (Tarefas › Hoje, detalhe, Sugestões; Funil › Oportunidade com Tarefas; Reunião › Resumo com Adicionar; barra raiz com Tarefas), a partir do mockup aprovado e corrigido pelo print real, no padrão dos existentes; `canvas.json` (`boards`, `order`, Tarefas logo depois de Reuniões) e `docs/telas/README.md` (lista e contagem).

### Preparação do arquivamento (o `git mv` é depois do teste navegado)
- **Não mova a spec.** O arquivamento é do coordenador, depois do teste navegado em sessão nova.
- Deixe prontos: `docs/specs/tarefas/notas-release.md` (destaques em pt-BR para as notas da versão, sem termo técnico) e, no fim do `plan.md`, a seção "Pendências" com o que a auditoria e os relatórios deixaram.
- O prompt do teste navegado (no relatório), seguindo "Verificação end-to-end" da spec, passo a passo.

## Critérios de aceite
- **CA1** (CA17 da spec) Dado o worktree no fim, quando `SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates`, então tudo verde e o smoke gera exatamente `SCREENS.length * THEMES.length + 222` PNGs (256 com `SCREENS` de 17), incluindo os 19 novos; `report.json` sem título de tarefa nem endereço de e-mail nos `detail` novos.
- **CA2** `auditoria-prints.md` tem uma linha para cada um dos 19 PNGs novos e para os regravados citados acima.
- **CA3** `README.md` tem a seção "Tarefas" e cita `tarefas.json`; o guia tem `<!-- tela: tarefas -->` e menciona as visões, as sugestões, os lembretes, o aviso "Hoje", os três cartões novos e o `agendamento`.
- **CA4** `docs/telas/artboards/canvas.json` lista os artboards novos em `boards` e `order`, e cada arquivo listado existe.
- **CA5** `docs/specs/tarefas/` continua no lugar, com `auditoria-prints.md`, `notas-release.md` e a seção "Pendências" no fim do `plan.md`.

## Invariantes
- Nenhuma regra de negócio, canal, tipo ou store muda nesta tarefa.
- O número de prints não muda em relação ao 127.
- Nenhum literal de cor fora de `tokens.css` nos componentes.

## Fora de escopo desta tarefa
Publicar os artefatos no claude.ai (coordenador); mover a spec para `_archive` (coordenador, depois do teste navegado); release, tag e `.dmg`; correções maiores que a auditoria achar (viram contrato próprio).

## Gates
`cd /Users/andrew/Documents/GitHub/meeting-scribe-tarefas && SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde no início e no fim.

## Relatório final (formato)
Arquivos (resumo por grupo); gates (contagens, `expectedShots` final); pendências da auditoria (uma linha cada); o que o coordenador publica (caminhos em `docs/telas`) e em qual artefato; o prompt de teste navegado para a sessão nova.
