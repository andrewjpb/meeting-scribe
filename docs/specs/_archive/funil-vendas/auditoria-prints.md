---
feature: funil-vendas
contrato: 118
status: concluido
data: 2026-11-21
semana: 2026-W47
base: main a4b62ad
---

# Auditoria dos prints do smoke (funil-vendas)

Prints de `apps/desktop/out/smoke/` gravados pelo `pnpm gates` de 21/11/2026 às 17:55 (`report.json` com `generatedAt` 2026-11-21T20:55:56Z, `failures` e `consoleErrors` vazios, 237 PNGs de 2240×1480). Conferidos os 26 prints de "Prints exigidos" da spec (13 telas × claro e escuro) e `configuracoes-geral` nos dois temas. Cada print foi aberto inteiro e comparado com o artboard correspondente de `mockups/png/` e com `docs/specs/desktop-shell/design.md`; onde havia dúvida, o trecho foi recortado em resolução cheia. Procurei corte, sobreposição, espaço morto, desalinhamento, texto técnico (id, JSON, "undefined"), cor fora do token, contraste ruim no escuro e divergência de conteúdo em relação à spec.

## Resumo

- **28 prints:** 16 `ok`, 12 `ajustar`.
- Nenhuma cor fora da paleta nos dois temas, nenhuma sombra, nenhuma pílula, nenhum id, JSON ou "undefined" na interface. Densidade igual à do resto do app (cabeçalhos de coluna de 44, linhas de 44 e 28, controles de 32).
- Os artboards `04` e `09` do mockup **não** tinham as duas correções que a spec manda; foram corrigidos nesta tarefa (ver "Artboards 04 e 09").

### Bloqueador (quebra visível para o usuário)

- **B1. Título da oportunidade cortado no detalhe.** Em `funil-oportunidade-*`, o título "Loja virtual" aparece como "Loja vi…", com a linha quase toda livre à direita. O `Select` de etapa (mínimo de 240 px pelo `design/Field.tsx`) fica com o espaço e o invólucro do `EditableTitle` (`max-w-full min-w-0`, sem base flexível) encolhe até poucos caracteres. Um título comum fica ilegível no cabeçalho da tela. Componente: `features/funil/OportunidadeScreen.tsx`, linhas ~479–488.

### Menor (estético)

- **M1. Placeholder da busca do kanban cortado sem reticências.** "Buscar oportunidades" perde o "s" final, encostado no "⌘F" (`funil-oportunidades-*`, `funil-oportunidades-nova-*`, `funil-oportunidades-editar-etapas-*`). O mockup encurta para "Buscar oportunida…". Componente: `features/funil/OportunidadesScreen.tsx:486` (rótulo do `SearchField`).
- **M2. Select de mapeamento cortado na importação.** Na prévia do CSV, a coluna Empresa mostra "Empresɛ": a seta nativa e o `px-2.5` do `Select` não cabem nas colunas de cerca de 150 px (`funil-contatos-importar-*`). Componente: `features/funil/ImportarPainel.tsx:129–133`.
- **M3. "×" de apagar etapa em todas as colunas.** Em Editar etapas, o "×" aparece também nas etapas com cartões (desabilitado, em `--rec` com opacidade). No escuro, o desabilitado quase não se distingue de um botão ativo. O mockup e R26 só mostram o "×" na etapa aberta vazia (`funil-oportunidades-editar-etapas-*`). Componente: `features/funil/OportunidadesScreen.tsx`, linhas ~297–305.
- **M4. "+ Contato" abaixo do remetente no Email.** R36 pede "ao lado do remetente". No print, o botão desce para uma segunda linha sob "Paulo Siqueira paulo.siqueira@…" e empurra o "Para:" para baixo (`email-leitura-contato-*`). O `flex-wrap` da linha do remetente quebra porque a data ocupa a direita. Componente: `features/email/ReadingPane.tsx:259–268`, com `features/funil/ContactLink.tsx`.

### Observações (não viram pendência)

- **Prints que não mostram tudo o que a spec pede.** `detalhe-resumo-oportunidade-*` enquadra o cartão "Oportunidade detectada" logo depois de Decisões. A ação "Detectar oportunidade", as Tarefas e o bloco Participantes ficam fora do quadro. A ordem (cartão acima das Tarefas) é conferida pelo smoke (`resumoCartao.acima: true`, `resumoMaisContato`). `assistente-funil-*` mostra só o cartão "Mover"; o `oportunidade-criar` não está no quadro. Em `configuracoes-geral-*`, a seção Funil de vendas aparece só até a segunda linha; o Switch "Avisar oportunidades esfriadas e passos vencidos" fica abaixo da dobra, porque a seção Marca, nova, empurrou a página.
- **Dados do cenário do smoke, não da interface.** Em `assistente-funil-*`, "op-vistoria" está na pergunta digitada pelo próprio cenário, não é a tela vazando id. "Portal do associado" aparece duas vezes na resposta porque o cenário do Resumo criou uma segunda oportunidade com esse nome antes. A contagem "Sugestões 6" em `funil-contatos-*` contra "Sugestões 3" em `funil-contatos-sugestoes-*` vem de o cenário ignorar três sugestões entre os dois prints (`contatosSugestoes`).
- **Padrões que já existiam no app.** O `Select` do design system é o `<select>` nativo, com a seta do sistema encostada na borda (etapa no detalhe e no cartão do Resumo), enquanto o `SearchPicker` usa o chevron do lucide. Campo de data vazio mostra "dd/mm/aaaa" na cor do texto, e não na do placeholder: o mesmo acontece em `ActionCards`, `PublicationEditor` e `InviteSuggestCard`. As citações `[Funil · …]` saem como texto comum, igual às de Email e WhatsApp (`features/chat/markdown.ts` não estiliza citação), enquanto o mockup 10 as desenha em cinza. Em `whatsapp-detalhes-contato-*`, o telefone do cabeçalho sem formatação e a reação com emoji são da tela do WhatsApp, anteriores ao funil.
- **Diferenças de desenho aceitáveis.** No cartão de nova oportunidade, Valor e Previsão ficam empilhados (no mockup ficam lado a lado). No kanban, o rodapé "há 10 d nesta e…" usa reticências quando há "esfriou". No WhatsApp, o print mostra a variante "+ Contato" e o mockup mostra a ficha ligada; as duas estão em R37.

## Por print

| print | artboard de referência | veredito | achado |
|---|---|---|---|
| `funil-oportunidades-light.png` | `01-oportunidades-claro` | ajustar | M1: "Buscar oportunidades" perde o "s" final, cortado sem reticências no "⌘F". Resto conforme: totais na linha de 32, quatro colunas de 182 px com cabeçalho de 44, faixas Ganho 2 e Perdido 1 de 32 px, "esfriou" e o passo/previsão vencidos em `--rec`. |
| `funil-oportunidades-dark.png` | `01-oportunidades-escuro` | ajustar | M1, igual ao claro. Contraste bom: cartões em `--bg-raised`, colunas em `--bg-sunken`, `--rec` legível. |
| `funil-oportunidades-nova-light.png` | `02-oportunidades-nova-claro` | ajustar | M1. Cartão em edição no topo de Contato, com borda `--accent`, sem modal. Valor e Previsão empilhados (observação). |
| `funil-oportunidades-nova-dark.png` | `02-oportunidades-nova-escuro` | ajustar | M1. Ícone do calendário nativo visível no escuro; "Criar" em `--accent` com `--on-accent`. |
| `funil-oportunidades-editar-etapas-light.png` | `03-oportunidades-editar-etapas-claro` | ajustar | M1; M3: "×" em todas as quatro colunas, inclusive com cartões (desabilitado). Alças, faixa tracejada "+ Etapa", lápis em Ganho e Perdido e "Nova oportunidade" desabilitada conformes. |
| `funil-oportunidades-editar-etapas-dark.png` | `03-oportunidades-editar-etapas-escuro` | ajustar | M1; M3, mais visível no escuro: o "×" desabilitado parece clicável. |
| `funil-oportunidade-light.png` | `04-oportunidade-detalhe-claro` | ajustar | **B1:** título "Loja virtual" truncado em "Loja vi…" ao lado do Select de etapa. Valor "R$ 64.000" sem centavos (conforme). Ações numa linha, faixa de campos em duas colunas, abas e linha do tempo (e-mail, reunião, etapa) conformes. "Abrir WhatsApp" some sem chat ligado, como manda R28. |
| `funil-oportunidade-dark.png` | `04-oportunidade-detalhe-escuro` | ajustar | **B1**, igual ao claro. Chip "Rafael Lima" em `--bg-sunken` legível. |
| `funil-contatos-light.png` | `05-contatos-claro` | ok | Lista de 340 px com linhas de 44 e origem "Manual"; ficha com ações, Empresa, Cargo, E-mails, Telefones, Notas, Oportunidades (estado vazio em texto) e Linha do tempo. |
| `funil-contatos-dark.png` | `05-contatos-escuro` | ok | Linha selecionada em `--bg-sunken`, mais escura que a lista, como no Email. Contraste bom. |
| `funil-contatos-sugestoes-light.png` | `06-contatos-sugestoes-claro` | ok | Três linhas de 44 com ícone do canal (Mail, Smartphone, NotebookText), "N interações · última em hoje", Adicionar e Ignorar (com ícone, o mockup não tinha). |
| `funil-contatos-sugestoes-dark.png` | `06-contatos-sugestoes-escuro` | ok | Segmented ativo em branco, como no resto do app no escuro. |
| `funil-contatos-importar-light.png` | `07-contatos-importar-claro` | ajustar | M2: o Select da coluna Empresa mostra "Empresɛ". Arquivo, "5 linhas · separador ; · UTF-8", prévia de 5 linhas com "—" nos vazios, "Importar 4 contatos" e a dica conformes. |
| `funil-contatos-importar-dark.png` | `07-contatos-importar-escuro` | ajustar | M2, igual ao claro. |
| `funil-contatos-novo-light.png` | sem artboard (spec: "ficha Novo contato" não desenhada; padrão do `05`) | ok | Ficha "Novo contato" com a dica "Nome e pelo menos um e-mail ou telefone.", cinco campos e "Criar" desabilitado com o formulário vazio. |
| `funil-contatos-novo-dark.png` | sem artboard (padrão do `05`) | ok | "Criar" desabilitado legível como desabilitado. |
| `funil-empresas-light.png` | `08-empresas-claro` | ok | Lista + ficha. Chip de domínio retangular, "+ Domínio", "Apagar" desabilitado com a razão, blocos Contatos e Oportunidades (a arquivada sem link, com "arquivada"). |
| `funil-empresas-dark.png` | `08-empresas-escuro` | ok | Contraste bom; "Apagar" desabilitado em `--rec` esmaecido. |
| `detalhe-resumo-oportunidade-light.png` | `09-reuniao-resumo-oportunidade-claro` (corrigido) | ok | Cartão "Oportunidade detectada" com "Haiku · 17:54", justificativa, campos editáveis, aviso de duplicata com link e "Vincular a existente…", Criar e Ignorar. Participantes, Tarefas e "Detectar oportunidade" fora do quadro (observação). |
| `detalhe-resumo-oportunidade-dark.png` | `09-reuniao-resumo-oportunidade-escuro` (corrigido) | ok | Aviso de duplicata em `--bg-sunken` com barra `--accent`, contraste bom. |
| `email-leitura-contato-light.png` | `12a-email-leitura-contato-claro` | ajustar | M4: "+ Contato" numa linha própria abaixo do remetente, e não ao lado. |
| `email-leitura-contato-dark.png` | `12a-email-leitura-contato-escuro` | ajustar | M4, igual ao claro. |
| `whatsapp-detalhes-contato-light.png` | `12b-whatsapp-detalhes-contato-claro` | ok | Bloco Contato no topo do painel Detalhes com o nome e "+ Contato" (variante sem ficha; o mockup mostra a ligada). |
| `whatsapp-detalhes-contato-dark.png` | `12b-whatsapp-detalhes-contato-escuro` | ok | Contraste bom. |
| `assistente-funil-light.png` | `10-assistente-funil-claro` | ok | Fonte Funil ligada no Contexto com a descrição; cartão "Mover App de vistoria de Proposta para Negociação" com a nota, Mover e Descartar. Citações em texto comum e dados do cenário (observação). |
| `assistente-funil-dark.png` | `10-assistente-funil-escuro` | ok | Contraste bom. |
| `configuracoes-geral-light.png` | `11-configuracoes-geral-funil-claro` | ok | Seção "Funil de vendas" com a dica, "Detectar oportunidades nas reuniões" ligado e "Considerar esfriada após (dias)" = 7. A terceira linha fica abaixo da dobra (observação). Textos de apoio mais curtos que os do mockup, sem perda. |
| `configuracoes-geral-dark.png` | `11-configuracoes-geral-funil-escuro` | ok | Igual ao claro; Switch ligado em `--accent`. |

## Barra lateral com o item Funil

Não existe print `sidebar-funil-*`. O item e o nível aparecem nestes prints:

| print | artboard de referência | veredito | achado |
|---|---|---|---|
| `sidebar-raiz-light.png` | `00a-barra-raiz-claro` | ok | Funil (ícone Funnel) entre Email e Automações. Redes não aparece porque o cenário não configura conta; a ordem Reuniões, Assistente, Email, Funil, Automações, WhatsApp, Configurações bate com `funilNav` no `report.json`. |
| `sidebar-raiz-dark.png` | `00a-barra-raiz-escuro` | ok | Igual ao claro. |
| nível Funil em `funil-oportunidades-*`, `funil-contatos-*`, `funil-empresas-*` | `00b-barra-nivel-funil-claro` / `-escuro` | ok | "‹ Funil" no cabeçalho e três linhas de 28 (Oportunidades, Contatos, Empresas), com a ativa em `--side-active` (`funilLevel`: alturas 28, `aria-current` na ativa). |

## Artboards 04 e 09 do mockup

`mockups/Funil.dc.html` ainda tinha as duas divergências que a spec manda corrigir: o artboard 04 mostrava "R$ 186.000,00" e o 09 punha Participantes logo depois de "O que aconteceu", acima do cartão. Correções feitas em 21/11/2026:

- **04:** Valor "R$ 186.000" nos dois temas, e a legenda do artboard cita a correção.
- **09:** ordem "O que aconteceu" → cartão "Oportunidade detectada" → Tarefas → Participantes nos dois temas. A legenda e a decisão D8 do cabeçalho do mockup foram atualizadas.
- PNGs regenerados: `04-oportunidade-detalhe-{claro,escuro}.png` e `09-reuniao-resumo-oportunidade-{claro,escuro}.png`, com o mesmo método dos originais: cada `.app` extraído com o `<style>` do `<helmet>` para um HTML autossuficiente e capturado no Chrome headless a 1120×740 com escala 2. O método foi validado antes: o artboard 08, sem mudança, gerou um PNG idêntico byte a byte ao existente.
- No 09, o quadro de 740 px corta Participantes na segunda linha (Lucas Vieira); a primeira linha (Juliana Prado, ligada) aparece inteira abaixo de Tarefas. A versão de `docs/telas/artboards/DetalheResumoOportunidade.dc.html`, com 900 px e as linhas de tarefa, já estava correta.
