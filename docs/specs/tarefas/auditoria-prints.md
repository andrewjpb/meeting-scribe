---
feature: tarefas
contrato: 129
status: concluido
data: 2026-11-22
semana: 2026-W47
base: tarefas fb8d479
---

# Auditoria dos prints do smoke (tarefas)

Prints de `apps/desktop/out/smoke-tarefas-r1/` (cópia da rodada de 22/11/2026 do `pnpm gates` na `tarefas` em `fb8d479`; `report.json` com `generatedAt` 2026-11-22T11:35:16Z, 256 PNGs de 2240×1480, `consoleErrors` vazio e `failures` só com o check `funil funilTarefasSecao`, que é um check e não um print). Conferidos os 29 prints da tabela (19 novos e 10 regravados ou renomeados), mais a conferência de `funil-oportunidades-*`. Cada print foi aberto inteiro e comparado com o artboard correspondente de `mockups/png/`, com a seção "Alinhamento com o mockup" da spec e com `docs/specs/desktop-shell/design.md`; onde havia dúvida, o trecho foi recortado em resolução cheia. Nos `detail` dos checks novos do `report.json` (`tarefas.*`) não há título de tarefa nem endereço de e-mail (D17).

## O que procurar em todos

Corte, sobreposição, espaço morto, desalinhamento, texto técnico (id, JSON, "undefined", "tarefa-criar"), cor fora do token, contraste ruim no escuro, título de tarefa cortado sem reticências, linha de tarefa fora dos 44 px, cabeçalho de grupo fora dos 28 px, raio acima de 6, sombra, pílula. No `report.json`: nenhum título de tarefa nem endereço de e-mail nos `detail` dos checks novos (só números e booleanos, D17).

## Resumo

- **29 prints:** 14 `ok`, 15 `ajustar` (2 com bloqueador, 13 só com achados menores). `funil-oportunidades-*` (conferência, fora da contagem): ok.
- Nenhuma cor fora da paleta nos dois temas, nenhuma sombra, nenhuma pílula, nenhum id, JSON, "undefined" ou nome de cartão técnico na interface. Linhas de tarefa de 44, cabeçalhos de grupo de 28, controles de 32, `--rec` em vencidas e estrela em `--title` legíveis no escuro.
- O B1 do funil (título da oportunidade cortado) e o M1 do funil (placeholder da busca do kanban) aparecem corrigidos nesta rodada.
- **Achados:** 1 bloqueador (2 prints) e 9 menores.
- **Segunda rodada (depois do contrato 130, `8fe3be2`):** fecharam B1, M2, M3, M4, M5, M6, M7 e M9; M1 fechou no essencial (uma caixa, uma linha, "Ligada a este e-mail · …"), com um resíduo novo, o título cortado no começo dentro de um campo mais estreito que o de data, e o nome do remetente ainda saindo duas vezes; M8 continua (Tarefas acima de Oportunidades na ficha do contato). Detalhe na seção "Segunda rodada", no fim.

### Bloqueador (quebra visível para o usuário)

- **B1. A janela inteira rola no detalhe da reunião.** Em `detalhe-resumo-tarefas-*`, a barra lateral aparece deslocada para cima (o logo some, "Reuniões" encosta no topo) e fica uma faixa vazia de ~100 px no pé da janela, nos dois temas. O smoke chama `scrollIntoView({ block: 'center' })` na seção Tarefas (`smoke.ts`, antes de `both('detalhe-resumo-tarefas')`) e, nessa tela, o documento é mais alto que a janela: o `scrollIntoView` rola também a raiz (o `overflow: hidden` do `body` não impede rolagem programática). Na mão, deve acontecer com qualquer coisa que traga um elemento para a vista (Tab até o "Adicionar" abaixo da dobra, por exemplo). O mesmo `scrollIntoView` no formulário de agendamento (`tarefa-email-light`) não desloca a barra, então o excesso de altura é da tela da reunião. Componente provável: `features/meetings/MeetingDetailScreen.tsx` (a coluna do detalhe com altura maior que a janela); conferir na mão antes de corrigir.

### Menor (estético)

- **M1. Formulário "+ Tarefa" do Email em caixa dupla.** Em `email-leitura-tarefa-*`, a caixa da leitura (`--bg-sunken`, "Nova tarefa") envolve uma segunda caixa com borda, que é o formulário inteiro da tela Tarefas: caixa de feito sem função à esquerda, Oportunidade e Criar/Cancelar numa segunda linha, e a dica "Enter cria · Esc cancela · a oportunidade é opcional…" quebrando em duas. O artboard 11 tem uma caixa só, título, prazo, Criar e Cancelar numa linha, e a frase "Fica ligada a este e-mail, a <contato> e à oportunidade <…>"; o print diz só "Ligada a Paulo Siqueira" (não cita o e-mail). Na linha do remetente, o nome sai duas vezes ("Paulo Siqueira paulo.si… Paulo Siqueira" com o link da ficha), e o endereço fica truncado para caber o "+ Tarefa". Componentes: `features/email/ReadingPane.tsx` (~290), `features/tarefas/MaisTarefa.tsx` e `features/tarefas/NovaTarefaInline.tsx`; a frase em `features/tarefas/tarefasFormat.ts:337–343`.
- **M2. Formulário "+ Tarefa" no painel de 300 px do WhatsApp.** Em `whatsapp-detalhes-tarefa-light`, o formulário quebra em quatro linhas (caixa + título; prazo; Oportunidade + Criar; "Cancelar" sozinho, alinhado à esquerda), com a dica em três linhas abaixo. Nada cortado, mas o "Cancelar" órfão e a caixa de feito sem função pesam no painel estreito (pendência 4 do `plan.md`). Componentes: `features/whatsapp/DetailsPanel.tsx:89` e `features/tarefas/NovaTarefaInline.tsx` (uma variante compacta, sem a caixa e com a dica curta).
- **M3. "Vencidas· 2" sem espaço antes do ponto.** Na lista estreita do detalhe (`tarefas-detalhe-*`), os cabeçalhos saem "Vencidas· 2", "Hoje· 1", "Depois· 10"; o artboard 04 tem "Vencidas · 2". O espaço inicial de `{' · '}` cai no começo do `span`, que é item flex, e é descartado. Componente: `features/tarefas/TarefasScreen.tsx:27–35` (`CabecalhoGrupo`, ramo `estreito`).
- **M4. Rótulos de Vínculos acima do centro do campo.** Em `tarefas-detalhe-*`, "Oportunidade" e "Contatos" ficam alinhados ao topo da linha, ~5 px acima do centro do `SearchPicker` e do campo de contato de 32; nos campos de cima (Prazo, Lembrete, Responsável) o rótulo fica centrado. Componente: `features/tarefas/TarefaDetalhe.tsx` (linhas de Vínculos).
- **M5. Campo de oportunidade da Nova tarefa sem o ícone do funil.** Em `tarefas-nova-*`, o vínculo opcional é um `SearchPicker` com placeholder "Oportunidade" e chevron; R6 (alinhamento) e o artboard 05 pedem o campo com o ícone do funil e o ×. Componente: `features/tarefas/NovaTarefaInline.tsx`.
- **M6. Contagem de "Sem oportunidade" encostada no nome.** Em `tarefas-todas-agrupadas-*`, os grupos de oportunidade têm a contagem à direita (com `ml-auto`), mas "Sem oportunidade 8" a mostra colada ao nome, porque o grupo não tem etapa; no artboard 03 fica à direita como as outras. Componente: `features/tarefas/TarefasScreen.tsx:42` (`ml-auto` só quando há etapa).
- **M7. Origem repetida nas tarefas da oportunidade.** Em `funil-oportunidade-*`, cada linha da seção Tarefas mostra "Oportunidade: Loja virtual" dentro da própria tela da Loja virtual; o artboard 08 e R15 mostram só caixa, título, estrela, responsável e prazo. Componente: `features/funil/OportunidadeScreen.tsx:751` e `:793` (passar a `TarefaLinha` sem a coluna de origem) com `features/tarefas/TarefaLinha.tsx`.
- **M8. Na ficha do contato, Tarefas acima de Oportunidades.** Em `funil-contato-tarefas-light`, o bloco Tarefas vem logo depois de Notas e empurra Oportunidades para baixo da dobra; no artboard 09 Oportunidades vem antes de Tarefas. Sublinhas de 32, "+ Nova tarefa" no estilo do "+ E-mail" e o campo Notas conformes. Componente: `features/funil/ContatoFicha.tsx`.
- **M9. `configuracoes-geral-light` não está rolado até Tarefas.** O print claro mostra o topo da aba Geral (Marca, Aparência, Janela e o começo do Funil); a seção Tarefas não aparece. O escuro está rolado e mostra as quatro linhas. É enquadramento do smoke, não defeito da tela: o `scrollIntoView({ block: 'end' })` antes de `shoot('configuracoes-geral', …)` não segura no primeiro tema (provavelmente a aba ainda rola para o topo depois, em `features/settings/SettingsScreen.tsx:200–215`). Componente: `src/main/smoke.ts:16268–16271`.

### Observações (não viram pendência)

- **Prints que não mostram tudo o que a spec pede.** `detalhe-resumo-tarefas-*` é tirado antes de qualquer "Adicionar": as duas linhas mostram "Adicionar" e a coluna de estado de 32 está vazia; a caixa marcada da linha já adicionada e o ícone de abrir não aparecem (o smoke confere em `resumoTarefas`). `funil-oportunidade-*` não mostra "Feitas N" (não há feita nesse momento; `feitas28` é conferido depois no check) nem item `tarefa` na linha do tempo. "Nova tarefa" aparece como "+ Nova tarefa", que abre o formulário em linha, e não como o campo sempre visível do artboard 08 (`nova40: true` no check). `assistente-tarefas-*` enquadra o cartão `tarefa-criar`; a resposta com a citação `[Tarefa · …]` ficou acima, só o fim ("revisado].") aparece. "Pode ler as tarefas" não está em nenhum print (o formulário de agente não é fotografado).
- **Foco.** Em `tarefas-nova-*` o título não mostra o anel de foco: o smoke tira o foco (`activeElement.blur()`) antes de capturar, então não dá para conferir o anel em `--focus` pelo print.
- **Dados do cenário do smoke, não da interface.** "Revisar a transcrição da reunião" três vezes em `tarefas-sugestoes-*` (uma por reunião gravada no laço). "Copiado" no botão de `detalhe-resumo-light` (o cenário clicou em Copiar antes). Fonte Funil desligada em `assistente-tarefas-*`. "Nova versão 0.21.0" e "Áudio do sistema · não verificado" na barra lateral. `agendamento-editar-light` mostra o formulário "Novo agendamento" preenchido (o nome do print é herdado).
- **Padrões que já existiam no app.** `Select` nativo com a seta do sistema encostada na borda ("Agrupar por", Lembrete, Responsável); campo de data vazio com "dd/mm/aaaa" na cor do texto; telefone sem formatação e avatar sem iniciais no cabeçalho do WhatsApp; tabela de agendamentos com nome e ações em duas linhas. O print `tarefa-email-light` (formulário de agendamento com email) mantém o nome antigo, com "tarefa".

## Por print

| print | artboard de referência | veredito | achado |
|---|---|---|---|
| `tarefas-hoje-light.png` | `02-tarefas-hoje-claro` | ok | Vencidas (2) antes de Hoje (1); vencidas "20/11 · há 2 d" em `--rec` peso 500; "hoje" em `--text` peso 500; linhas de 44 com caixa de 16, origem, responsável com ícone, estrela em `--title`; cabeçalhos de 28 com contagem; "Sugestões 1" no Segmented; badge "2" em Tarefas igual ao do Email. |
| `tarefas-hoje-dark.png` | `02-tarefas-hoje-escuro` | ok | O mesmo; `--rec` e a estrela legíveis, caixa de feito visível sobre `--bg`. |
| `tarefas-todas-agrupadas-light.png` | `03-tarefas-todas-agrupadas-claro` | ajustar | M6: "Sem oportunidade 8" com a contagem colada ao nome. Cabeçalhos "nome · etapa · N", grupos pelo prazo mais perto (App de vistoria 21/11, Loja virtual 23/11, Consultoria fiscal 26/11, Portal 27/11), "Sem oportunidade" no fim, conformes. |
| `tarefas-todas-agrupadas-dark.png` | `03-tarefas-todas-agrupadas-escuro` | ajustar | M6, igual ao claro. Fio `--line-strong` dos cabeçalhos visível. |
| `tarefas-detalhe-light.png` | `04-tarefas-detalhe-claro` | ajustar | M3: "Vencidas· 2", "Hoje· 1", "Depois· 10"; M4: rótulos de Vínculos acima do centro do campo. Lista estreita em duas linhas com a aberta em `--bg-sunken`, sem modal, Concluir/Cancelar/Apagar abaixo do título, campos de 32 com rótulo à esquerda, Lembrete "Em…" com data, hora e o aviso "amanhã, 10:30", Responsável Contato… com o picker, "Vincular reunião" e Histórico, "Agrupar por" escondido: conformes. |
| `tarefas-detalhe-dark.png` | `04-tarefas-detalhe-escuro` | ajustar | M3 e M4, iguais ao claro. `<input type=date>`, hora e `select` nativos legíveis no escuro; Switch desligado distinguível. |
| `tarefas-nova-light.png` | `05-tarefas-nova-claro` | ajustar | M5: oportunidade como `SearchPicker` sem o ícone do funil e sem ×. Formulário em linha no topo da lista (painel com fio `--line-strong`, raio 6), prazo, "Criar" e "Cancelar", "Enter cria · Esc cancela…" abaixo: conformes. Anel de foco não conferível (observação). |
| `tarefas-nova-dark.png` | `05-tarefas-nova-escuro` | ajustar | M5, igual ao claro. Contraste bom; "Criar" em `--accent`. |
| `tarefas-sugestoes-light.png` | `06-tarefas-sugestoes-claro` | ok | Linhas de 44 com o ícone da origem num quadrado de 28 (Reunião, WhatsApp), texto, origem "Reunião: … · do resumo" / "WhatsApp: Ana Souza", "prazo dd/mm" ou "de dd/mm", Adicionar e Ignorar (com ícone); "Agrupar por" escondido; nenhum texto técnico. Repetição de texto é do cenário (observação). |
| `tarefas-sugestoes-dark.png` | `06-tarefas-sugestoes-escuro` | ok | O mesmo; Segmented ativo em branco, como no resto do app. |
| `tarefas-vazia-light.png` | `07-tarefas-vazia-claro` | ok | `EmptyState` "Nada para hoje" centrado com a frase e "Ver todas (12)"; sem badge em Tarefas na barra. |
| `funil-oportunidade-light.png` (regravado) | `08-funil-oportunidade-claro` | ajustar | M7: "Oportunidade: Loja virtual" em cada linha. Seção Tarefas entre a grade de campos e as abas com "2 abertas · a primeira é o próximo passo no quadro"; sem o campo Próximo passo; título "Loja virtual" inteiro (B1 do funil corrigido); abas visíveis. "+ Nova tarefa" e "Feitas" (observação). |
| `funil-oportunidade-dark.png` (regravado) | `08-funil-oportunidade-escuro` | ajustar | M7, igual ao claro. Contraste bom. |
| `funil-contato-tarefas-light.png` | `09-funil-contato-tarefas-claro` | ajustar | M8: Tarefas acima de Oportunidades. Bloco "Tarefas 4 abertas" com sublinhas de 32, vencida em `--rec`, estrela, "+ Nova tarefa" no estilo do "+ E-mail"; Notas continua na ficha. |
| `detalhe-resumo-tarefas-light.png` | `10-detalhe-resumo-tarefas-claro` | ajustar | **B1:** barra lateral deslocada para cima (logo fora do quadro) e faixa vazia no pé da janela. Tabela conforme: coluna de estado de 32, "27/11 sexta-feira" com o dito em `--text-faint`, "—" sem prazo, "Adicionar" de 28 alinhado, "Adicionar as minhas" no título. Linha já adicionada fora do print (observação). |
| `detalhe-resumo-tarefas-dark.png` | `10-detalhe-resumo-tarefas-escuro` | ajustar | **B1**, igual ao claro. |
| `detalhe-resumo-light.png` (regravado, coluna nova) | `10-detalhe-resumo-tarefas-claro` | ok | A coluna de estado não desalinha Tarefa, Quem e Prazo; "Adicionar" cabe à direita; nenhuma linha quebra. |
| `detalhe-resumo-dark.png` (regravado, coluna nova) | `10-detalhe-resumo-tarefas-escuro` | ok | O mesmo; contraste bom. |
| `email-leitura-tarefa-light.png` | `11-email-leitura-tarefa-claro` | ajustar | M1: caixa dentro de caixa, formulário em duas linhas com caixa de feito sem função, dica quebrando, frase "Ligada a Paulo Siqueira" sem o e-mail, nome do remetente duas vezes. "+ Tarefa" à direita ao lado da data e pressionado (`--bg-sunken`); título = assunto; corpo do e-mail carregado. |
| `email-leitura-tarefa-dark.png` | `11-email-leitura-tarefa-escuro` | ajustar | M1, igual ao claro. "+ Tarefa" pressionado legível no escuro. |
| `whatsapp-detalhes-tarefa-light.png` | `12-whatsapp-detalhes-tarefa-claro` | ajustar | M2: formulário em quatro linhas, "Cancelar" sozinho, dica em três linhas. Só "+ Tarefa" no bloco Contato, sem "N abertas com ele" (R25), pressionado enquanto aberto. |
| `assistente-tarefas-light.png` | `13-assistente-tarefas-claro` | ok | Fonte Tarefas primeira e ligada no Contexto, com a descrição; cartão "Criar tarefa Mandar proposta" com Prazo, Lembrete, Oportunidade "Loja virtual · Negociação" e Contato "(da oportunidade)", Criar, Editar e Descartar; nenhum id nem nome de bloco. Citação fora do quadro (observação). |
| `assistente-tarefas-dark.png` | `13-assistente-tarefas-escuro` | ok | O mesmo; contraste bom. |
| `automacoes-agendamentos-light.png` (antes `tarefas-light`) | `14-automacoes-agendamentos-claro` | ok | Aba "Agendamentos"; "Novo agendamento"; "Pausar todos os agendamentos"; a lista só com os dois agendamentos do cenário, nenhum lembrete. |
| `agendamento-editar-light.png` (antes `tarefa-editar-light`) | `14-automacoes-agendamentos-claro` | ok | "‹ Agendamentos · Novo agendamento", sugestões, Nome, Agente e Mensagem; nenhum "tarefa" sobrando nos rótulos e botões ("Minhas tarefas" é o nome de um agente). |
| `configuracoes-geral-light.png` (regravado, rolado até Tarefas) | `15-configuracoes-geral-tarefas-claro` | ajustar | M9: print no topo da aba; a seção Tarefas não aparece. Funil com "tarefa concluída" na descrição de esfriada (visível). |
| `configuracoes-geral-dark.png` (regravado) | `15-configuracoes-geral-tarefas-escuro` | ok | Rolado até Tarefas: Hora do lembrete (campo de 96 com relógio, 09:00), Lembrar no prazo, Aviso diário Hoje e Sugerir tarefas das reuniões; "Incluir oportunidades esfriadas no aviso Hoje" no Funil; textos iguais aos do artboard. |
| `sidebar-raiz-light.png` (regravado) | `01-barra-raiz-claro` | ok | Tarefas logo depois de Reuniões, ícone `SquareCheck`, contador "2" em 12 tabular `--side-text` igual ao "1" do Email. |
| `sidebar-raiz-dark.png` (regravado) | `01-barra-raiz-escuro` | ok | O mesmo. |
| `funil-oportunidades-*` (já existentes; o cartão mudou) | `16-funil-kanban-proxima-tarefa-*` | ok | Cartão com a próxima tarefa e a data ("Revisar con… 23/11" na Loja virtual), em `--rec` quando venceu ("Ligar para o… 21/11"), "Sem tarefa" na Integração Parceiro; placeholder "Buscar oportunidades" inteiro (M1 do funil corrigido). Fora da contagem. |

## Segunda rodada (depois do contrato 130, base tarefas 8fe3be2)

Prints de `apps/desktop/out/smoke-tarefas-r2/` (cópia da rodada final do `pnpm gates` na `tarefas` em `8fe3be2`; `report.json` com `generatedAt` 2026-11-22T12:46:58Z, 256 PNGs de 2240×1480, `failures` só com `gravação notesDetail`, flake conhecido sem relação com Tarefas). Só os prints afetados por B1 e M1–M9. Cada um foi aberto inteiro e comparado com o mesmo print de `smoke-tarefas-r1/` e com o artboard; o formulário do Email, o do WhatsApp e os Vínculos do detalhe foram recortados em resolução cheia.

| print | achado | veredito | o que o print mostra agora |
|---|---|---|---|
| `detalhe-resumo-tarefas-light.png` | B1 | ok | Barra lateral no lugar, logo e "LAP SOFTWARE" no topo, "Reuniões" na altura de sempre; nenhuma faixa vazia no pé (Permissões e "Áudio do sistema" encostados embaixo como nas outras telas). A seção Tarefas continua enquadrada com a tabela inteira. |
| `detalhe-resumo-tarefas-dark.png` | B1 | ok | O mesmo no escuro. |
| `email-leitura-tarefa-light.png` | M1 | ajustar | Fechado no essencial: uma caixa só (sem a caixa dentro da caixa), título, prazo, Criar e Cancelar numa linha, sem a caixa de feito e sem o campo Oportunidade; "Ligada a este e-mail · <contato>" acima do formulário; dica curta "Enter cria · Esc cancela" numa linha. **Resíduo:** o campo do título ficou mais estreito que o de data e mostra o fim do assunto, com o começo cortado sem reticências ("…mento do módulo de conciliação"); no artboard 11 o título é o campo mais largo. Na linha do remetente o nome ainda sai duas vezes (texto e link da ficha) e o endereço continua truncado para caber o "+ Tarefa". |
| `email-leitura-tarefa-dark.png` | M1 | ajustar | O mesmo resíduo do claro; caixa em `--bg-sunken` com fio legível, "Criar" em `--accent`. |
| `whatsapp-detalhes-tarefa-light.png` | M2 | ok | Duas linhas (título; prazo, Criar e Cancelar), "Cancelar" dentro da borda com folga, sem a caixa de feito, dica numa linha só. "+ Tarefa" pressionado enquanto o formulário está aberto. |
| `tarefas-detalhe-light.png` | M3, M4 | ok | M3: "Vencidas · 2", "Hoje · 1", "Depois · 10" com espaço dos dois lados do ponto, como no artboard 04. M4: "Oportunidade", "Contatos" e "Reunião" centrados na altura dos campos de 32 (recorte comparado com a rodada anterior, onde ficavam ~5 px acima). |
| `tarefas-detalhe-dark.png` | M3, M4 | ok | O mesmo no escuro. |
| `tarefas-nova-light.png` | M5 | ok | O campo de oportunidade tem o ícone do funil à esquerda, como no artboard 05. O × não é conferível neste print: nenhuma oportunidade foi escolhida, então o campo mostra o chevron; no artboard o × aparece com "Loja virtual" escolhida. |
| `tarefas-nova-dark.png` | M5 | ok | O mesmo; ícone do funil legível no escuro. |
| `tarefas-todas-agrupadas-light.png` | M6 | ok | "Sem oportunidade" com a contagem 8 à direita, na mesma coluna das contagens dos grupos com etapa. |
| `tarefas-todas-agrupadas-dark.png` | M6 | ok | O mesmo no escuro. |
| `tarefas-hoje-light.png` | M6 | ok | No agrupamento por prazo a contagem continua colada ao nome ("Vencidas 2", "Hoje 1"), como no artboard 02; a mudança do M6 não vazou para cá. |
| `tarefas-hoje-dark.png` | M6 | ok | O mesmo no escuro. |
| `funil-oportunidade-light.png` | M7 | ok | As linhas da seção Tarefas mostram só caixa, título e prazo; nenhum "Oportunidade: Loja virtual" repetido. |
| `funil-oportunidade-dark.png` | M7 | ok | O mesmo no escuro. |
| `funil-contato-tarefas-light.png` | M8 | ajustar | M8 continua: o bloco Tarefas vem logo depois de Notas e Oportunidades fica no pé, quase fora do quadro; no artboard 09 Oportunidades vem antes de Tarefas. |
| `configuracoes-geral-light.png` | M9 | ok | Rolado até Tarefas com o mesmo enquadramento do escuro: fim de Janela, Funil de vendas inteiro e as quatro linhas de Tarefas (Hora do lembrete, Lembrar no prazo, Aviso diário Hoje, Sugerir tarefas das reuniões). |

**Ficou para depois:** o resíduo do M1 (largura do campo do título no Email e o nome do remetente duplicado) e o M8 (ordem dos blocos na ficha do contato).
