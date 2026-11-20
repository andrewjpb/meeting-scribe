# Linguagem visual — Meeting Scribe desktop (identidade LAP)

Versão 2, de 14/11/2026. Pedido do Andrew: "quero que seja como se fosse da LAP". Substitui a versão 1 ("caderno de estúdio", arquivada em `design-v1-caderno.md`). Vale para toda tela do app e prevalece sobre preferência do implementador. Fonte da marca: `~/.claude/skills/propostas-lap/references/identidade-visual.md`; logos em `docs/specs/desktop-shell/brand/`. Atualizada em 19/11/2026 com a barra lateral em pilha e o deslize horizontal (feature `sidebar-pilha`).

## Conceito: precisão LAP

O app é um produto da LAP Software & Consultoria e tem que parecer irmão das propostas e apresentações dela: azul profundo, branco, desenho plano, cantos quase retos, títulos em negrito apertado. O motivo gráfico é o do logo: quadrados e ângulos retos. Continua silencioso, com um único instrumento vivo, a fita de níveis. Sem gradiente, sem sombra, sem vidro fosco, sem serifa, sem pílula, sem emoji.

## Cores (variáveis CSS em `tokens.css`; componentes só usam variáveis)

Paleta da LAP: azul profundo `#0A2A5E`, azul corporativo `#1E5BB8`, azul vibrante `#3B82F6`, azul quase preto `#061A3D`, cinza azulado `#5B6B85`, azul névoa `#EEF2F9`, borda `#C9D4E5`, texto sobre azul `#A8B5CC`, branco.

| Variável | Claro | Escuro | Uso |
|---|---|---|---|
| `--bg` | `#FFFFFF` | `#061A3D` | fundo da área principal |
| `--bg-raised` | `#FFFFFF` | `#0A2A5E` | campos, painéis |
| `--bg-sunken` | `#EEF2F9` | `#04122B` | faixa da fita, linhas zebradas, notas |
| `--line` | `#E3E9F2` | `rgba(201,212,229,.14)` | fios de 1 px |
| `--line-strong` | `#C9D4E5` | `rgba(201,212,229,.28)` | bordas de controle |
| `--title` | `#0A2A5E` | `#FFFFFF` | títulos |
| `--text` | `#061A3D` | `#FFFFFF` | texto |
| `--text-muted` | `#5B6B85` | `#A8B5CC` | texto secundário |
| `--text-faint` | `#7F8DA6` | `#7C8CAB` | marcações, horários |
| `--accent` | `#1E5BB8` | `#3B82F6` | botão primário, seleção, link |
| `--on-accent` | `#FFFFFF` | `#061A3D` | texto sobre `--accent` |
| `--mic` | `#1E5BB8` | `#3B82F6` | fonte Você |
| `--sys` | `#5B6B85` | `#A8B5CC` | fonte Participantes |
| `--rec` | `#C62F34` | `#F0646A` | quadrado de gravação e ação destrutiva |
| `--ok` | `#1E5BB8` | `#3B82F6` | estado ok |
| `--focus` | `#1E5BB8` | `#3B82F6` | anel de foco |
| `--side-bg` | `#0A2A5E` | `#0A2A5E` | barra lateral e barra de controles |
| `--side-text` | `#FFFFFF` | `#FFFFFF` | texto sobre a barra lateral |
| `--side-muted` | `#A8B5CC` | `#A8B5CC` | texto secundário sobre a barra lateral |
| `--side-active` | `rgba(255,255,255,.12)` | `rgba(255,255,255,.12)` | item ativo da barra lateral |

`--rec` é a única cor fora da paleta da LAP: vermelho é o sinal universal de gravação e de ação destrutiva. Não há verde nem amarelo.

Contraste mínimo: `--text` e `--title` 7:1 sobre `--bg`, `--bg-raised` e `--bg-sunken`; `--text-muted`, `--accent`, `--mic`, `--sys`, `--rec`, `--ok` 4,5:1 sobre `--bg` e `--bg-raised`; `--text-faint` 3:1 (só texto de apoio de 12 px ou mais sem informação única); `--on-accent` 4,5:1 sobre `--accent`; `--side-text` 7:1 e `--side-muted` 4,5:1 sobre `--side-bg`. Um teste automatizado lê esta tabela e `tokens.css` e reprova se algum par cair abaixo; se um valor não cumprir, ajuste a luminosidade mantendo o matiz e registre no relatório.

Tema: atributo `data-theme="light|dark"` em `<html>`. `system` segue o macOS. O tema claro é o de referência da marca.

## Tipografia (nenhuma fonte embutida, nenhuma requisição externa)

- Tudo em `"Helvetica Neue", Helvetica, Arial, sans-serif`, a mesma família do logo. Nunca serifa.
- Títulos em `--title`: de página 20/26, peso 700, `letter-spacing: -0.3px`; de seção ou painel (a aba de Configurações, o cabeçalho da conversa e da leitura, o título editável da reunião) 15/20, peso 700; de bloco dentro da página (os blocos do Resumo, os formulários) 14/20, peso 600.
- Interface 13/20 e 12/16; metadados secundários 11/16; pesos 400, 500, 600 e 700. Leitura (resumo, corpo de email, transcrição) 15/24, tradução 13/20; balões e prévias 14/22.
- Números (cronômetro, horários, preços) na mesma família com `font-variant-numeric: tabular-nums`. Só ids de modelo usam `Menlo, ui-monospace, monospace`.
- Rótulo de seção ou de grupo (títulos de `Section`, dias, "Permissões", cabeçalhos de tabela): classe `.label`, 11/16, peso 500, `--text-muted` (na barra lateral, `--side-muted`), em caixa normal e sem espaçamento entre letras.
- Caixa alta só na fita e na marca: os rótulos de fonte de áudio ("VOCÊ", "PARTICIPANTES") e a assinatura "LAP SOFTWARE", classe `.caps` (10 px, peso 500, `letter-spacing: .14em`), como a linha "SOFTWARE & CONSULTORIA" do logo. Nenhum outro uso de maiúsculas.

## Espaço, forma, movimento

- Escala de espaço: 4, 8, 12, 16, 24, 32, 48, 64.
- Raio: 4 em controles e etiquetas, 6 em painéis e na barra de controles. Nada acima de 6. Nenhuma pílula.
- Nenhuma sombra (`box-shadow` proibido). Separação por fio de 1 px, por bloco azul ou por espaço.
- Movimento: 120–180 ms `ease-out`. Com `prefers-reduced-motion: reduce`, nenhuma animação. O único deslize horizontal do app é o da barra lateral em pilha (padrão em "Deslize horizontal", abaixo); tela nova que precise deslizar usa o mesmo padrão.
- Foco: contorno de 2 px em `--focus` com deslocamento de 2 px, só em `:focus-visible`; sobre `--side-bg` o contorno é branco.
- Ícones: `lucide-react`, traço 1,5, 16 px. Nunca emoji.

## Controles e densidade

Decisão de 2026-11-20: densidade no estilo do painel do Claude Desktop, aprovada pelo Andrew (feature `densidade`, `docs/specs/_archive/densidade/spec.md`). Medidas nos componentes de `design/` e nos tokens de `tokens.css` (`--control-h`, `--control-compact-h`, `--row-h`, `--row-compact-h`, `--panel-head-h`, `--page-x`, `--page-top`).

- Botão (`Button`) de 32 px, `px-3`, gap 8, rótulo 13/500; um tamanho só. `ActionButton` (só ícone) continua com 28.
- Campo (`TextField`, `Select`) de 32 px, `px-2.5`. Abas (`Tabs`) de 32, com 20 entre elas. Segmentado (`Segmented`) de 28, `px-3`. Alternador (`Switch`) de 36×20 com botão de 14.
- Nota (`Note`): `px-3 py-2`, texto 13, barra de 3 px à esquerda.
- Linha de lista de 44 (duas linhas de texto) ou 32 (uma linha); linha de tabela densa `py-1.5` (28 a 32). Linha de configuração (`SettingRow`) de 44 no mínimo, `py-2`.
- Cabeçalho de painel (Contexto, leitura de email, conversa, WhatsApp) de 44.
- Página com `px-8 pt-5` (32 nas laterais, 20 no topo) e `pb-8`; grupo de seções com `gap-6`.
- Estado vazio (`EmptyState`): ilustração com 20 abaixo, título 17/24 peso 600, texto a 8, ação a 16.

## Marca

- **Logo no app:** símbolo da LAP em versão para fundo azul (quadrado branco com raio proporcional ao `rx=6` do original, "L" em `#0A2A5E` com o mesmo traço, quadrado pequeno em `#3B82F6`), 28 px, no topo da barra lateral. Ao lado, "Meeting Scribe" em 15 px peso 700 branco e, abaixo, "LAP SOFTWARE" em 10 px, maiúsculas espaçadas, `--side-muted`. O logo colorido original não é usado sobre azul.
- **Nome:** o app se chama "Meeting Scribe"; título da janela "Meeting Scribe"; painel Sobre com "© 2026 LAP Software & Consultoria".
- **Ícone:** o símbolo original (quadrado `#0A2A5E`, "L" branco, quadrado `#3B82F6`) com margem de 10%, em PNG 1024 e `.icns`, usado no Dock.
- **Quadrado de gravação:** o indicador de gravação é um quadrado de 8 px em `--rec` (não um círculo), ecoando o quadrado do logo; pulsa em 1,6 s enquanto grava e fica parado em `--text-faint` quando pausado.

## Janela e estrutura

- Janela 1120×740, mínimo 900×600, `titleBarStyle: 'hiddenInset'`, `trafficLightPosition: {x: 18, y: 18}`. Sem `vibrancy`: a barra lateral é opaca.
- Barra lateral de 224 px (`--sidebar-width`) em `--side-bg` nos dois temas. De cima para baixo: espaço dos botões da janela; bloco da marca; a coluna de navegação em pilha (abaixo); no rodapé, Bloquear, o aviso de versão e o bloco "Permissões" com duas linhas (quadrado de estado de 6 px + nome + estado em `--side-muted`). A marca e o rodapé ficam parados; só a coluna do meio troca de nível.
- Faixa superior de 52 px arrastável; controles dentro dela com `no-drag`.

**Barra lateral em pilha.** Navegação em dois níveis, no máximo, como os Ajustes do iOS. Nenhuma linha de um nível de seção abre um terceiro nível. Medidas densas, no ritmo do painel lateral do Claude Desktop (decisão de 2026-11-20, aprovada pelo Andrew com o mockup `docs/specs/_archive/densidade/mockups/SidebarDensa.dc.html`, contrato 79): as alturas moram num lugar só, `--side-row` (32 px), `--side-subrow` (28 px) e `--side-indent` (28 px) em `design/base.css`, e toda linha da barra (inclusive o nível Redes) as cita em vez de repetir o número.

- **Raiz** (`<nav aria-label="Navegação principal">`): Reuniões, Assistente, Email, Automações, WhatsApp (só com o serviço instalado) e Configurações. Itens de 32 px (`--side-row`), 2 px entre eles, ícone 16 a 8 px do rótulo 13 em `--side-muted`, 16 px entre a marca e a lista; o ativo com fundo `--side-active`, texto `--side-text` e `aria-current="page"`. À direita do Email, o total de não lidas das Caixas de Entrada carregadas, 12 px tabular `--side-text`, que some em zero.
- **Nível de seção**: só Email, Configurações e Assistente têm nível próprio (`<nav>` com o nome da seção); Automações e WhatsApp são itens planos. O nível ocupa a coluna inteira entre a marca e o rodapé, e só a lista dele rola.
- **Cabeçalho-voltar**: primeira linha do nível, 32 px (`--side-row`) com 4 px abaixo, um `<button>` inteiro com `ChevronLeft` 16, o ícone da seção 16 (`Mail`, `Settings`, `Sparkles`) e o nome em 13 peso 500 `--side-text`; hover com `--side-active`. Nome acessível com o nome visível na frente: "<Seção>: voltar ao menu" (por exemplo, "Email: voltar ao menu").
- **Linhas de seção**: 28 px (`--side-subrow`), rótulo 13, recuo de 28 px (`--side-indent`), sem ícone; a ativa com `--side-active` e `--side-text`. Em Configurações, uma linha por aba de `SETTINGS_TABS`, com a dica `⌘1` a `⌘9` à direita. No Assistente, "Nova conversa" (28 px, recuo de 10 px, ícone `Plus`), a busca compacta de 28 px em `--side-active` com o texto em 13 e as conversas por dia (linhas de 28 px com recuo de 28 px, sem hora); o dia é um rótulo `.label` (11/16, caixa normal, sem espaçamento, `--side-muted`) numa linha de 28, alinhado ao título das conversas.
- **Email**: a linha da conta e a de pasta têm a mesma altura, 28 px; a conta se distingue pela seta e pela falta do ícone de pasta. As pastas, que já têm ícone, ficam com o recuo de 18 px + 16 por nível; a seta da subpasta, a 6 px do topo da linha.
- **Rodapé**: 126 px no total, sem o aviso de versão. "Bloquear" numa linha de 28 px; o rótulo "Permissões" em `.label` (11 px, caixa normal) e as duas permissões em linhas de 28 px com o texto em 12 px (em 13, "Áudio do sistema" e "não verificado" não cabem juntos em 224 px).
- **Nível e rota**: o nível segue a rota num sentido só. Toda navegação para `/email/*`, `/configuracoes/*` ou `/assistente` mostra o nível daquela seção; qualquer outra rota mostra a raiz. **Voltar não navega**: só mostra a raiz, a tela continua a mesma e o item da seção fica marcado. Clicar na seção já estando nela só mostra o nível. O nível não é guardado: abrir a janela numa rota de seção mostra o nível dela de cara, sem animação.
- **Foco**: entrar pelo clique (ou Enter) no item da raiz põe o foco no cabeçalho-voltar; voltar pelo cabeçalho põe o foco no item da seção na raiz. Navegação vinda de fora do sidebar (menu, ⌘, aviso de email, link na tela) não mexe no foco.

**Esmaecimento de rolagem.** Lista que rola dentro da barra lateral (contas e pastas do nível Email, conversas do nível Assistente) ganha um esmaecimento de 24 px na borda de baixo (`design/ScrollFade.tsx`, classe `.scroll-fade` em `design/base.css`: gradiente de transparente para `var(--side-bg)`, `pointer-events: none`). Aparece só quando há conteúdo escondido abaixo e some no fim da rolagem; não altera layout nem altura de linha; ao focar por teclado uma linha que cairia sob a faixa, a lista rola o que falta para o anel aparecer inteiro. Lista que cabe inteira não mostra nada. Contrato 68.

**Deslize horizontal.** Primeiro padrão de deslize do app, definido pela barra lateral em pilha (keyframes `side-push-in`, `side-push-out`, `side-pop-in` e `side-pop-out` em `design/base.css`; lógica em `app/SidebarStack.tsx` e `app/sidebarLevels.ts`).

- Duração `--duration-slow` (180 ms) com `--ease-out`, sem biblioteca.
- Entrar (push): o nível novo vem de `translateX(calc(100% + var(--space-3)))` para 0; o que sai vai de 0 para `translateX(-30%)` com a opacidade caindo para 0. Voltar (pop) é o inverso: a raiz volta de `translateX(-30%)` com opacidade 0, e o nível de seção sai para `translateX(calc(100% + var(--space-3)))`. A soma do `--space-3` faz o nível sair inteiro pela borda do sidebar, e não parar no recuo de 12 px. De uma seção direto para outra, vale o push.
- A coluna fica com `overflow: hidden` durante o deslize (classe `is-sliding`), para cortar o que passa da borda. Os dois níveis só existem juntos no DOM durante a transição; o que sai fica `inert` e `aria-hidden`. Um clique no meio termina a transição anterior na hora e começa a nova.
- Com `prefers-reduced-motion: reduce`, a troca é instantânea e o nível que sai nem é montado. Como o `tokens.css` zera toda animação nesse modo (e o `animationend` não chega), um temporizador de reserva de 260 ms (180 + 80) tira o nível que sai se o ajuste mudar no meio do deslize.

## Telas

**Reuniões.** Título à esquerda e botão primário "Nova gravação" à direita com a dica `⌘N` (`--accent` com texto `--on-accent`, raio 4). Lista em linhas separadas por fio, agrupadas por dia ("Hoje", "Ontem", depois "12 de novembro") com o nome do grupo em `.label` (11/16, caixa normal) e 20 acima de cada grupo. Linha de 44 no mínimo (`px-2 py-1`, gap 12): título 13/500; apoio em 11 `--text-muted` no formato `18:12 · 32 min`; prévia do resumo em 12 numa linha só; à direita, dois quadrados de 6 px nas cores das fontes capturadas. Hover: fundo `--bg-sunken`. Busca de 32 por 240 ao lado do botão; opções de pasta de 28; "Próximas" em linhas de 44 (`py-1`, duas linhas de texto) com título 13 e botões de 28; "Gravando agora" em `px-3 py-2`, texto 13. Estado vazio: no centro óptico da área, ilustração em SVG de uma fita parada com as duas cores e pontas retas, título "Nenhuma reunião ainda" (17/24, peso 600), uma frase de apoio e o botão.

**Gravação ao vivo.** Cabeçalho (`px-8 pt-5 pb-3`): linha de status de 20 com o quadrado de gravação + "Gravando" ou "Pausado" em `.label` na cor do estado e o cronômetro 14 px peso 500 tabular; 8 abaixo, o título editável 15/20 no lugar (Enter confirma, Esc cancela). Abaixo, a **fita**: canvas de largura total e 96 px de altura sobre `--bg-sunken`, fio central, traço do microfone para cima em `--mic` e do sistema para baixo em `--sys`, barras de 3 px com 1 px de intervalo e pontas retas, o mais novo à direita rolando para a esquerda; altura proporcional ao nível em dBFS mapeado de −60..0 para 0..1; rótulos "VOCÊ" e "PARTICIPANTES" à esquerda, a 32 da borda como o resto da página. Pausado: a fita congela e cai para 40% de opacidade. Fonte ausente: o lado dela fica com um tracejado `--line-strong` e o rótulo ganha "sem sinal". Avisos: faixa em linha logo abaixo da fita, fundo `--bg-sunken` com barra de 3 px em `--title` à esquerda (a "nota" dos documentos da LAP), ícone, texto e link de ação; nunca modal.

Coluna de transcrição: largura máxima 680, centralizada. Cada trecho, a 16 do seguinte: horário em 12 tabular `--text-faint` numa calha esquerda de 48 px; rótulo de quem fala na cor da fonte (`.caps`, uma das duas exceções da caixa alta); texto 15/24; tradução logo abaixo em 13/20 `--text-muted`, com filete esquerdo de 2 px `--line-strong`. Trecho parcial em `--text-muted` itálico. Rola sozinha para o fim; se o usuário subir, para de rolar e mostra a etiqueta "Ir para o fim". Estado sem chave: ícone, a frase do estado, apoio e os links de ação. O exemplo aparece com a etiqueta "Exemplo" fixa no topo da coluna.

Barra de controles: bloco em `--side-bg` com raio 6, centralizado a 24 px do rodapé, sem sombra, texto `--side-text`. Conteúdo, com 4 de respiro: botões de 32 (Pausar/Retomar com ícone + rótulo; microfone, anotações, análise e Bloquear só com o ícone), divisor de 1 px em `--side-active`, etiquetas de 24 em 12 px com o par de idiomas (`PT → EN`) e o modelo (id em `Menlo`), divisor, "Encerrar" com um quadrado de 8 px em `--rec` antes do rótulo. Barra de espaço alterna pausa quando o foco não está em campo de texto.

**Detalhe da reunião.** Mesmo esqueleto da gravação, sem fita ao vivo. Cabeçalho `px-8 pt-5`: "Reuniões" para voltar em 12, o título editável 15/20 peso 700, linha de apoio em 12 com data, hora, duração e as etiquetas de 20, e as abas de 32 a 12 abaixo; à direita as ações "Copiar transcrição" e "Excluir" (com confirmação). Avisos a 32 das laterais e 12 do cabeçalho. Resumo numa coluna de 680 com 24 entre os blocos: título do bloco 14/20 peso 600 com fio de 2×20, texto 15/24, tabela de tarefas com cabeçalho em `.label` e linhas `py-1.5` em 13. Anotações com 12 entre as partes; Áudio com rótulos `.label` numa coluna de 80; Transcrição como na gravação.

**Configurações.** Sem abas na tela: as abas são as linhas do nível Configurações da barra lateral. O topo (`px-8 pt-5 pb-2`) mostra o nome da aba aberta à esquerda (15/20, peso 700; "Configurações" durante uma busca) e a busca de 32 à direita, centrada no título. Coluna única rolável (`pt-5 pb-8`, 24 entre as seções), largura máxima 760 (`--settings-width`). Cada seção (`Section`) tem o rótulo 11 em caixa normal (`.label`) e as linhas num painel com fio de 1 px e raio 6. Cada linha (`SettingRow`, 44 no mínimo): nome 13/500 e descrição 12 `--text-muted` à esquerda, controle na coluna fixa de 340 à direita, fio entre linhas. Blocos que não são `SettingRow` (contas, Conexões, Plugins, regras de email) com `py-3`; linhas de ferramenta MCP `px-2 py-1.5`, regras `py-2` com botões de 28, pastas de 32. Seletor de modelo: painel dentro da página com campo de busca de 32, lista de linhas de 40 (nome 13/500 e, na mesma linha, o id em `Menlo` 11 `--text-faint`; à direita preço tabular no formato `US$ 0,10 / 0,50 por 1M` e contexto como `200k`); o modelo atual tem a marca de seleção em `--accent`.

## Texto

pt-BR, só a primeira letra maiúscula, frases curtas. Nunca usar na interface: "fase", "backend", "IPC", "loopback", "stub". Botões dizem a ação ("Nova gravação", "Pausar", "Encerrar", "Tentar de novo").

## Não fazer

Gradiente; sombra; vidro fosco; serifa; raio acima de 6; pílula; cor fora das variáveis; verde, amarelo ou roxo; botão em maiúsculas; tudo centralizado; spinner onde cabe esqueleto; texto de preenchimento; fonte carregada da rede ou embutida; controle de 40 px (não voltar a 40 nos controles); caixa alta em rótulo de seção; título de página acima de 20 px.
