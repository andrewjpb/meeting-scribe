# Linguagem visual — Meeting Scribe desktop

Vale para toda tela do app. Prevalece sobre preferência do implementador. O que não estiver aqui segue o padrão do macOS.

## Conceito: caderno de estúdio

O produto transforma fala em texto. A tela é um caderno bem composto, silencioso, com um único instrumento vivo: a fita de níveis. Tipografia e espaço em branco fazem o trabalho; não há painel de indicadores, gradiente, vidro fosco em cartões, sombra em linha de lista nem emoji.

## Cores (variáveis CSS em `tokens.css`; componentes só usam variáveis)

| Variável | Escuro | Claro | Uso |
|---|---|---|---|
| `--bg` | `#131211` | `#F6F3EC` | fundo da área principal |
| `--bg-raised` | `#1B1A18` | `#FFFFFF` | barra flutuante, campos, painel |
| `--bg-sunken` | `#0E0D0C` | `#EDE9E0` | faixa da fita, trilhos |
| `--line` | `rgba(255,255,255,.08)` | `rgba(31,29,26,.10)` | fios de 1 px |
| `--line-strong` | `rgba(255,255,255,.14)` | `rgba(31,29,26,.18)` | bordas de controle |
| `--text` | `#ECE8E1` | `#1F1D1A` | texto |
| `--text-muted` | `#A29C92` | `#6B665E` | texto secundário |
| `--text-faint` | `#7A746B` | `#8A847A` | marcações, horários |
| `--mic` | `#E9A23B` | `#9A5F0A` | fonte Você |
| `--sys` | `#45B3A4` | `#1A7468` | fonte Participantes |
| `--rec` | `#E5484D` | `#C62F34` | ponto de gravação e ação de encerrar |
| `--ok` | `#4CB782` | `#1E7F4F` | estado ok |
| `--focus` | `#E9A23B` | `#9A5F0A` | anel de foco |

Contraste mínimo sobre `--bg` e sobre `--bg-raised`: `--text` 7:1; `--text-muted`, `--mic`, `--sys`, `--rec`, `--ok` 4,5:1; `--text-faint` 3:1 (só para texto de apoio de 12 px ou mais que não carrega informação única). Um teste automatizado lê `tokens.css` e reprova se algum par cair abaixo; se um valor da tabela não cumprir, ajuste a luminosidade mantendo o matiz e registre no relatório.

Tema: atributo `data-theme="light|dark"` em `<html>`. `system` segue o macOS e reage à troca em tempo real.

## Tipografia (fontes embutidas no pacote, nenhuma requisição externa)

- Interface: pilha do sistema (`-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`). Tamanhos 12, 13 e 15; pesos 400, 500 e 600.
- Títulos e texto de transcrição: Newsreader Variable (`@fontsource-variable/newsreader`). Título de página 28/34 peso 500; título de seção 20/26 peso 500; título da reunião 22/28; transcrição 17/27 peso 400.
- Números e identificadores (cronômetro, horários, preços, ids de modelo): JetBrains Mono Variable (`@fontsource-variable/jetbrains-mono`) com `font-variant-numeric: tabular-nums`.
- Rótulos de fonte ("VOCÊ", "PARTICIPANTES"): 11 px, maiúsculas, `letter-spacing: .06em`, peso 600, na cor da fonte. É o único uso de maiúsculas.

## Espaço, forma, movimento

- Escala de espaço: 4, 8, 12, 16, 24, 32, 48, 64.
- Raio: 6 em controles, 10 em painéis, 999 em pílulas.
- Sombra só na barra flutuante de controles (`0 8px 30px rgba(0,0,0,.35)` no escuro, `0 8px 24px rgba(31,29,26,.12)` no claro).
- Separação por fio de 1 px e espaço, não por cartão.
- Movimento: 120–180 ms `ease-out` em hover, pressão e troca de rota. Sem mola. Com `prefers-reduced-motion: reduce`, nenhuma animação nem o pulso do ponto de gravação.
- Foco: anel de 2 px em `--focus` com deslocamento de 2 px, só em `:focus-visible`.
- Ícones: `lucide-react`, traço 1,5, 16 px. Nunca emoji.

## Janela e estrutura

- Janela 1120×740, mínimo 900×600, `titleBarStyle: 'hiddenInset'`, `trafficLightPosition: {x: 18, y: 18}`.
- Barra lateral de 224 px com `vibrancy: 'sidebar'` (fundo da barra transparente para a translucidez aparecer); área principal opaca em `--bg`.
- Faixa superior de 52 px arrastável (`-webkit-app-region: drag`); controles dentro dela com `no-drag`.
- Barra lateral, de cima para baixo: espaço dos botões da janela; marca "Meeting Scribe" em Newsreader 17 itálico; itens de navegação (ícone 16 + rótulo 13, item ativo com fundo `--line` e texto `--text`); no rodapé, bloco "Permissões" com duas linhas (ponto de estado + nome + estado em `--text-muted`).

## Telas

**Reuniões.** Título "Reuniões" à esquerda e botão primário "Nova gravação" à direita com a dica `⌘N`. Lista em linhas separadas por fio, agrupadas por dia ("Hoje", "Ontem", depois "12 de novembro"): título 15/500; linha de apoio em mono 12 `--text-muted` no formato `18:12 · 32 min`; à direita, dois pontos pequenos nas cores das fontes capturadas. Hover: fundo `--line`. Estado vazio: centralizado na área, ilustração em SVG de uma fita de níveis parada com as duas cores, título "Nenhuma reunião ainda" (Newsreader 22), uma frase de apoio e o botão.

**Gravação ao vivo.** Cabeçalho: ponto `--rec` pulsando (1,6 s) + "Gravando" ou ponto parado `--text-faint` + "Pausado"; cronômetro em mono 15; título editável no lugar (Newsreader 22, vira campo ao clicar, Enter confirma, Esc cancela). Abaixo, a **fita**: canvas de largura total e 96 px de altura sobre `--bg-sunken`, fio central, traço do microfone para cima em `--mic` e do sistema para baixo em `--sys`, barras de 2 px com 1 px de intervalo e pontas arredondadas, o mais novo à direita rolando para a esquerda; altura proporcional ao nível em dBFS mapeado de −60..0 para 0..1; rótulos "VOCÊ" e "PARTICIPANTES" à esquerda. Pausado: a fita congela e cai para 40% de opacidade. Fonte ausente: o lado dela fica com um tracejado `--line-strong` e o rótulo ganha "sem sinal". Avisos: faixa em linha logo abaixo da fita, com ícone, texto e link de ação; nunca modal.

Coluna de transcrição: largura máxima 680, centralizada. Cada trecho: horário em mono 12 `--text-faint` numa calha esquerda de 64 px; rótulo de quem fala; texto em Newsreader 17/27; tradução logo abaixo em 14/22 na fonte da interface, `--text-muted`, com filete esquerdo de 2 px `--line-strong`. Trecho parcial em `--text-muted` itálico. Rola sozinha para o fim; se o usuário subir, para de rolar e mostra a pílula "Ir para o fim". Estado sem servidor: ícone, "Transcrição indisponível: servidor não conectado.", frase de apoio e o link "Ver exemplo". O exemplo aparece com a etiqueta "Exemplo" fixa no topo da coluna.

Barra flutuante de controles: pílula centralizada a 24 px do rodapé, `--bg-raised`, fio `--line-strong`, sombra. Conteúdo: Pausar/Retomar (ícone + rótulo), divisor, etiqueta do par de idiomas (`PT → EN`), etiqueta do modelo (id curto em mono), divisor, "Encerrar" em `--rec`. Barra de espaço alterna pausa quando o foco não está em campo de texto.

**Detalhe da reunião.** Mesmo esqueleto da gravação, sem fita ao vivo: título editável, linha de apoio com data, hora e duração, coluna de transcrição (nesta fatia, o estado sem servidor) e a ação "Excluir" com confirmação.

**Configurações.** Coluna única rolável, largura máxima 640. Seções com título Newsreader 20: Áudio, Idiomas, Tradução, Transcrição, Aparência. Cada linha: nome 13/500 e descrição 12 `--text-muted` à esquerda, controle à direita, fio entre linhas. Seletor de modelo: painel dentro da página com campo de busca, lista de linhas (nome 13/500, id em mono 11 `--text-faint`, à direita preço em mono no formato `US$ 0,10 / 0,50 por 1M` e contexto como `200k`); o principal tem marca de seleção em `--mic`; reservas numeradas de 1 a 3 com subir, descer e remover.

## Texto

pt-BR, só a primeira letra maiúscula, frases curtas. Nunca usar na interface: "fase", "backend", "IPC", "loopback", "stub". Botões dizem a ação ("Nova gravação", "Pausar", "Encerrar", "Tentar de novo").

## Não fazer

Gradiente roxo ou azul; cartão com vidro fosco; sombra em linha de lista; botão em maiúsculas; tudo centralizado; spinner onde cabe esqueleto; texto de preenchimento; cor fora das variáveis; fonte carregada da rede.
