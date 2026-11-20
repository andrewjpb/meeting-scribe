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
- Título de página 26/32, peso 700, `letter-spacing: -0.3px`, cor `--title`. Título de seção 17/24, peso 700. Título da reunião 20/26, peso 700.
- Interface 12, 13 e 15; pesos 400, 500 e 700. Transcrição 16/26, peso 400.
- Números (cronômetro, horários, preços) na mesma família com `font-variant-numeric: tabular-nums`. Só ids de modelo usam `Menlo, ui-monospace, monospace`.
- Rótulos de fonte ("VOCÊ", "PARTICIPANTES") e a assinatura "LAP SOFTWARE": 10–11 px, maiúsculas, peso 500, `letter-spacing: .14em`, como a linha "SOFTWARE & CONSULTORIA" do logo. Na barra lateral, o mesmo estilo vale para os rótulos de grupo ("PERMISSÕES" e os dias das conversas no nível Assistente). São os únicos usos de maiúsculas.

## Espaço, forma, movimento

- Escala de espaço: 4, 8, 12, 16, 24, 32, 48, 64.
- Raio: 4 em controles e etiquetas, 6 em painéis e na barra de controles. Nada acima de 6. Nenhuma pílula.
- Nenhuma sombra (`box-shadow` proibido). Separação por fio de 1 px, por bloco azul ou por espaço.
- Movimento: 120–180 ms `ease-out`. Com `prefers-reduced-motion: reduce`, nenhuma animação. O único deslize horizontal do app é o da barra lateral em pilha (padrão em "Deslize horizontal", abaixo); tela nova que precise deslizar usa o mesmo padrão.
- Foco: contorno de 2 px em `--focus` com deslocamento de 2 px, só em `:focus-visible`; sobre `--side-bg` o contorno é branco.
- Ícones: `lucide-react`, traço 1,5, 16 px. Nunca emoji.

## Marca

- **Logo no app:** símbolo da LAP em versão para fundo azul (quadrado branco com raio proporcional ao `rx=6` do original, "L" em `#0A2A5E` com o mesmo traço, quadrado pequeno em `#3B82F6`), 28 px, no topo da barra lateral. Ao lado, "Meeting Scribe" em 15 px peso 700 branco e, abaixo, "LAP SOFTWARE" em 10 px, maiúsculas espaçadas, `--side-muted`. O logo colorido original não é usado sobre azul.
- **Nome:** o app se chama "Meeting Scribe"; título da janela "Meeting Scribe"; painel Sobre com "© 2026 LAP Software & Consultoria".
- **Ícone:** o símbolo original (quadrado `#0A2A5E`, "L" branco, quadrado `#3B82F6`) com margem de 10%, em PNG 1024 e `.icns`, usado no Dock.
- **Quadrado de gravação:** o indicador de gravação é um quadrado de 8 px em `--rec` (não um círculo), ecoando o quadrado do logo; pulsa em 1,6 s enquanto grava e fica parado em `--text-faint` quando pausado.

## Janela e estrutura

- Janela 1120×740, mínimo 900×600, `titleBarStyle: 'hiddenInset'`, `trafficLightPosition: {x: 18, y: 18}`. Sem `vibrancy`: a barra lateral é opaca.
- Barra lateral de 224 px (`--sidebar-width`) em `--side-bg` nos dois temas. De cima para baixo: espaço dos botões da janela; bloco da marca; a coluna de navegação em pilha (abaixo); no rodapé, Bloquear, o aviso de versão e o bloco "Permissões" com duas linhas (quadrado de estado de 6 px + nome + estado em `--side-muted`). A marca e o rodapé ficam parados; só a coluna do meio troca de nível.
- Faixa superior de 52 px arrastável; controles dentro dela com `no-drag`.

**Barra lateral em pilha.** Navegação em dois níveis, no máximo, como os Ajustes do iOS. Nenhuma linha de um nível de seção abre um terceiro nível.

- **Raiz** (`<nav aria-label="Navegação principal">`): Reuniões, Assistente, Email, Automações, WhatsApp (só com o serviço instalado) e Configurações. Itens de 40 px, ícone 16 + rótulo 13 em `--side-muted`; o ativo com fundo `--side-active`, texto `--side-text` e `aria-current="page"`. À direita do Email, o total de não lidas das Caixas de Entrada carregadas, 12 px tabular `--side-text`, que some em zero.
- **Nível de seção**: só Email, Configurações e Assistente têm nível próprio (`<nav>` com o nome da seção); Automações e WhatsApp são itens planos. O nível ocupa a coluna inteira entre a marca e o rodapé, e só a lista dele rola.
- **Cabeçalho-voltar**: primeira linha do nível, 40 px, um `<button>` inteiro com `ChevronLeft` 16, o ícone da seção 16 (`Mail`, `Settings`, `Sparkles`) e o nome em 13 peso 500 `--side-text`; hover com `--side-active`. Nome acessível com o nome visível na frente: "<Seção>: voltar ao menu" (por exemplo, "Email: voltar ao menu").
- **Linhas de seção**: 30 px, rótulo 13, recuo de 32 px (o mesmo das pastas do email), sem ícone; a ativa com `--side-active` e `--side-text`. Em Configurações, uma linha por aba de `SETTINGS_TABS`, com a dica `⌘1` a `⌘8` à direita. No Assistente, "Nova conversa" (30 px, recuo de 10 px, ícone `Plus`), a busca compacta de 28 px em `--side-active` e as conversas por dia (linhas de 30 px com recuo de 32 px, sem hora), com o dia em maiúsculas espaçadas de 10 px.
- **Nível e rota**: o nível segue a rota num sentido só. Toda navegação para `/email/*`, `/configuracoes/*` ou `/assistente` mostra o nível daquela seção; qualquer outra rota mostra a raiz. **Voltar não navega**: só mostra a raiz, a tela continua a mesma e o item da seção fica marcado. Clicar na seção já estando nela só mostra o nível. O nível não é guardado: abrir a janela numa rota de seção mostra o nível dela de cara, sem animação.
- **Foco**: entrar pelo clique (ou Enter) no item da raiz põe o foco no cabeçalho-voltar; voltar pelo cabeçalho põe o foco no item da seção na raiz. Navegação vinda de fora do sidebar (menu, ⌘, aviso de email, link na tela) não mexe no foco.

**Esmaecimento de rolagem.** Lista que rola dentro da barra lateral (contas e pastas do nível Email, conversas do nível Assistente) ganha um esmaecimento de 24 px na borda de baixo (`design/ScrollFade.tsx`, classe `.scroll-fade` em `design/base.css`: gradiente de transparente para `var(--side-bg)`, `pointer-events: none`). Aparece só quando há conteúdo escondido abaixo e some no fim da rolagem; não altera layout nem altura de linha; ao focar por teclado uma linha que cairia sob a faixa, a lista rola o que falta para o anel aparecer inteiro. Lista que cabe inteira não mostra nada. Contrato 68.

**Deslize horizontal.** Primeiro padrão de deslize do app, definido pela barra lateral em pilha (keyframes `side-push-in`, `side-push-out`, `side-pop-in` e `side-pop-out` em `design/base.css`; lógica em `app/SidebarStack.tsx` e `app/sidebarLevels.ts`).

- Duração `--duration-slow` (180 ms) com `--ease-out`, sem biblioteca.
- Entrar (push): o nível novo vem de `translateX(calc(100% + var(--space-3)))` para 0; o que sai vai de 0 para `translateX(-30%)` com a opacidade caindo para 0. Voltar (pop) é o inverso: a raiz volta de `translateX(-30%)` com opacidade 0, e o nível de seção sai para `translateX(calc(100% + var(--space-3)))`. A soma do `--space-3` faz o nível sair inteiro pela borda do sidebar, e não parar no recuo de 12 px. De uma seção direto para outra, vale o push.
- A coluna fica com `overflow: hidden` durante o deslize (classe `is-sliding`), para cortar o que passa da borda. Os dois níveis só existem juntos no DOM durante a transição; o que sai fica `inert` e `aria-hidden`. Um clique no meio termina a transição anterior na hora e começa a nova.
- Com `prefers-reduced-motion: reduce`, a troca é instantânea e o nível que sai nem é montado. Como o `tokens.css` zera toda animação nesse modo (e o `animationend` não chega), um temporizador de reserva de 260 ms (180 + 80) tira o nível que sai se o ajuste mudar no meio do deslize.

## Telas

**Reuniões.** Título à esquerda e botão primário "Nova gravação" à direita com a dica `⌘N` (`--accent` com texto `--on-accent`, raio 4). Lista em linhas separadas por fio, agrupadas por dia ("Hoje", "Ontem", depois "12 de novembro") com o nome do grupo em 12 px peso 700 `--text-muted`: título 15/500; apoio em 12 `--text-muted` no formato `18:12 · 32 min`; à direita, dois quadrados de 6 px nas cores das fontes capturadas. Hover: fundo `--bg-sunken`. Estado vazio: no centro óptico da área, ilustração em SVG de uma fita parada com as duas cores e pontas retas, título "Nenhuma reunião ainda" (20/26, peso 700), uma frase de apoio e o botão.

**Gravação ao vivo.** Cabeçalho: quadrado de gravação + "Gravando" ou "Pausado"; cronômetro 15 px peso 500 tabular; título editável no lugar (Enter confirma, Esc cancela). Abaixo, a **fita**: canvas de largura total e 96 px de altura sobre `--bg-sunken`, fio central, traço do microfone para cima em `--mic` e do sistema para baixo em `--sys`, barras de 3 px com 1 px de intervalo e pontas retas, o mais novo à direita rolando para a esquerda; altura proporcional ao nível em dBFS mapeado de −60..0 para 0..1; rótulos "VOCÊ" e "PARTICIPANTES" à esquerda. Pausado: a fita congela e cai para 40% de opacidade. Fonte ausente: o lado dela fica com um tracejado `--line-strong` e o rótulo ganha "sem sinal". Avisos: faixa em linha logo abaixo da fita, fundo `--bg-sunken` com barra de 3 px em `--title` à esquerda (a "nota" dos documentos da LAP), ícone, texto e link de ação; nunca modal.

Coluna de transcrição: largura máxima 680, centralizada. Cada trecho: horário em 12 tabular `--text-faint` numa calha esquerda de 64 px; rótulo de quem fala na cor da fonte; texto 16/26; tradução logo abaixo em 14/22 `--text-muted`, com filete esquerdo de 2 px `--line-strong`. Trecho parcial em `--text-muted` itálico. Rola sozinha para o fim; se o usuário subir, para de rolar e mostra a etiqueta "Ir para o fim". Estado sem chave: ícone, a frase do estado, apoio e os links de ação. O exemplo aparece com a etiqueta "Exemplo" fixa no topo da coluna.

Barra de controles: bloco em `--side-bg` com raio 6, centralizado a 24 px do rodapé, sem sombra, texto `--side-text`. Conteúdo: Pausar/Retomar (ícone + rótulo), divisor de 1 px em `--side-active`, etiqueta do par de idiomas (`PT → EN`), etiqueta do modelo (id em `Menlo`), divisor, "Encerrar" com um quadrado de 8 px em `--rec` antes do rótulo. Barra de espaço alterna pausa quando o foco não está em campo de texto.

**Detalhe da reunião.** Mesmo esqueleto da gravação, sem fita ao vivo: título editável, linha de apoio com data, hora e duração, coluna de transcrição e as ações "Copiar transcrição" e "Excluir" (com confirmação).

**Configurações.** Sem abas na tela: as abas são as linhas do nível Configurações da barra lateral. O topo mostra o nome da aba aberta à esquerda ("Configurações" durante uma busca) e a busca à direita. Coluna única rolável, largura máxima 640. Seções com título 17/24 peso 700 `--title` e um fio `--title` de 2 px e 24 px de largura abaixo do título. Cada linha: nome 13/500 e descrição 12 `--text-muted` à esquerda, controle à direita, fio entre linhas. Seletor de modelo: painel dentro da página com campo de busca, lista de linhas (nome 13/500, id em `Menlo` 11 `--text-faint`, à direita preço tabular no formato `US$ 0,10 / 0,50 por 1M` e contexto como `200k`); o modelo atual tem a marca de seleção em `--accent`.

## Texto

pt-BR, só a primeira letra maiúscula, frases curtas. Nunca usar na interface: "fase", "backend", "IPC", "loopback", "stub". Botões dizem a ação ("Nova gravação", "Pausar", "Encerrar", "Tentar de novo").

## Não fazer

Gradiente; sombra; vidro fosco; serifa; raio acima de 6; pílula; cor fora das variáveis; verde, amarelo ou roxo; botão em maiúsculas; tudo centralizado; spinner onde cabe esqueleto; texto de preenchimento; fonte carregada da rede ou embutida.
