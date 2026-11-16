# Linguagem visual — Meeting Scribe desktop (identidade LAP)

Versão 2, de 14/11/2026. Pedido do Andrew: "quero que seja como se fosse da LAP". Substitui a versão 1 ("caderno de estúdio", arquivada em `design-v1-caderno.md`). Vale para toda tela do app e prevalece sobre preferência do implementador. Fonte da marca: `~/.claude/skills/propostas-lap/references/identidade-visual.md`; logos em `docs/specs/desktop-shell/brand/`.

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
- Rótulos de fonte ("VOCÊ", "PARTICIPANTES") e a assinatura "LAP SOFTWARE": 10–11 px, maiúsculas, peso 500, `letter-spacing: .14em`, como a linha "SOFTWARE & CONSULTORIA" do logo. São os únicos usos de maiúsculas.

## Espaço, forma, movimento

- Escala de espaço: 4, 8, 12, 16, 24, 32, 48, 64.
- Raio: 4 em controles e etiquetas, 6 em painéis e na barra de controles. Nada acima de 6. Nenhuma pílula.
- Nenhuma sombra (`box-shadow` proibido). Separação por fio de 1 px, por bloco azul ou por espaço.
- Movimento: 120–180 ms `ease-out`. Com `prefers-reduced-motion: reduce`, nenhuma animação.
- Foco: contorno de 2 px em `--focus` com deslocamento de 2 px, só em `:focus-visible`; sobre `--side-bg` o contorno é branco.
- Ícones: `lucide-react`, traço 1,5, 16 px. Nunca emoji.

## Marca

- **Logo no app:** símbolo da LAP em versão para fundo azul (quadrado branco com raio proporcional ao `rx=6` do original, "L" em `#0A2A5E` com o mesmo traço, quadrado pequeno em `#3B82F6`), 28 px, no topo da barra lateral. Ao lado, "Meeting Scribe" em 15 px peso 700 branco e, abaixo, "LAP SOFTWARE" em 10 px, maiúsculas espaçadas, `--side-muted`. O logo colorido original não é usado sobre azul.
- **Nome:** o app se chama "Meeting Scribe"; título da janela "Meeting Scribe"; painel Sobre com "© 2026 LAP Software & Consultoria".
- **Ícone:** o símbolo original (quadrado `#0A2A5E`, "L" branco, quadrado `#3B82F6`) com margem de 10%, em PNG 1024 e `.icns`, usado no Dock.
- **Quadrado de gravação:** o indicador de gravação é um quadrado de 8 px em `--rec` (não um círculo), ecoando o quadrado do logo; pulsa em 1,6 s enquanto grava e fica parado em `--text-faint` quando pausado.

## Janela e estrutura

- Janela 1120×740, mínimo 900×600, `titleBarStyle: 'hiddenInset'`, `trafficLightPosition: {x: 18, y: 18}`. Sem `vibrancy`: a barra lateral é opaca.
- Barra lateral de 224 px em `--side-bg` nos dois temas. De cima para baixo: espaço dos botões da janela; bloco da marca; itens de navegação (ícone 16 + rótulo 13 em `--side-muted`; item ativo com fundo `--side-active` e texto `--side-text`); no rodapé, bloco "Permissões" com duas linhas (quadrado de estado de 6 px + nome + estado em `--side-muted`).
- Faixa superior de 52 px arrastável; controles dentro dela com `no-drag`.

## Telas

**Reuniões.** Título à esquerda e botão primário "Nova gravação" à direita com a dica `⌘N` (`--accent` com texto `--on-accent`, raio 4). Lista em linhas separadas por fio, agrupadas por dia ("Hoje", "Ontem", depois "12 de novembro") com o nome do grupo em 12 px peso 700 `--text-muted`: título 15/500; apoio em 12 `--text-muted` no formato `18:12 · 32 min`; à direita, dois quadrados de 6 px nas cores das fontes capturadas. Hover: fundo `--bg-sunken`. Estado vazio: no centro óptico da área, ilustração em SVG de uma fita parada com as duas cores e pontas retas, título "Nenhuma reunião ainda" (20/26, peso 700), uma frase de apoio e o botão.

**Gravação ao vivo.** Cabeçalho: quadrado de gravação + "Gravando" ou "Pausado"; cronômetro 15 px peso 500 tabular; título editável no lugar (Enter confirma, Esc cancela). Abaixo, a **fita**: canvas de largura total e 96 px de altura sobre `--bg-sunken`, fio central, traço do microfone para cima em `--mic` e do sistema para baixo em `--sys`, barras de 3 px com 1 px de intervalo e pontas retas, o mais novo à direita rolando para a esquerda; altura proporcional ao nível em dBFS mapeado de −60..0 para 0..1; rótulos "VOCÊ" e "PARTICIPANTES" à esquerda. Pausado: a fita congela e cai para 40% de opacidade. Fonte ausente: o lado dela fica com um tracejado `--line-strong` e o rótulo ganha "sem sinal". Avisos: faixa em linha logo abaixo da fita, fundo `--bg-sunken` com barra de 3 px em `--title` à esquerda (a "nota" dos documentos da LAP), ícone, texto e link de ação; nunca modal.

Coluna de transcrição: largura máxima 680, centralizada. Cada trecho: horário em 12 tabular `--text-faint` numa calha esquerda de 64 px; rótulo de quem fala na cor da fonte; texto 16/26; tradução logo abaixo em 14/22 `--text-muted`, com filete esquerdo de 2 px `--line-strong`. Trecho parcial em `--text-muted` itálico. Rola sozinha para o fim; se o usuário subir, para de rolar e mostra a etiqueta "Ir para o fim". Estado sem chave: ícone, a frase do estado, apoio e os links de ação. O exemplo aparece com a etiqueta "Exemplo" fixa no topo da coluna.

Barra de controles: bloco em `--side-bg` com raio 6, centralizado a 24 px do rodapé, sem sombra, texto `--side-text`. Conteúdo: Pausar/Retomar (ícone + rótulo), divisor de 1 px em `--side-active`, etiqueta do par de idiomas (`PT → EN`), etiqueta do modelo (id em `Menlo`), divisor, "Encerrar" com um quadrado de 8 px em `--rec` antes do rótulo. Barra de espaço alterna pausa quando o foco não está em campo de texto.

**Detalhe da reunião.** Mesmo esqueleto da gravação, sem fita ao vivo: título editável, linha de apoio com data, hora e duração, coluna de transcrição e as ações "Copiar transcrição" e "Excluir" (com confirmação).

**Configurações.** Coluna única rolável, largura máxima 640. Seções com título 17/24 peso 700 `--title` e um fio `--title` de 2 px e 24 px de largura abaixo do título. Cada linha: nome 13/500 e descrição 12 `--text-muted` à esquerda, controle à direita, fio entre linhas. Seletor de modelo: painel dentro da página com campo de busca, lista de linhas (nome 13/500, id em `Menlo` 11 `--text-faint`, à direita preço tabular no formato `US$ 0,10 / 0,50 por 1M` e contexto como `200k`); o modelo atual tem a marca de seleção em `--accent`.

## Texto

pt-BR, só a primeira letra maiúscula, frases curtas. Nunca usar na interface: "fase", "backend", "IPC", "loopback", "stub". Botões dizem a ação ("Nova gravação", "Pausar", "Encerrar", "Tentar de novo").

## Não fazer

Gradiente; sombra; vidro fosco; serifa; raio acima de 6; pílula; cor fora das variáveis; verde, amarelo ou roxo; botão em maiúsculas; tudo centralizado; spinner onde cabe esqueleto; texto de preenchimento; fonte carregada da rede ou embutida.
