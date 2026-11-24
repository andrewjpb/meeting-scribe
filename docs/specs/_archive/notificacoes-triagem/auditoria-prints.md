---
feature: notificacoes-triagem
contrato: 164
status: concluido
data: 2026-11-23
semana: 2026-W48
base: main bacb708 + diff do contrato 164
rodadas: smoke-r2 (primeira) e smoke-r4 (segunda)
---

# Auditoria dos prints do smoke (notificacoes-triagem)

Prints da cópia da rodada 2 de 23/11/2026 (`smoke-r2/` no scratchpad da sessão; base `main` em `bacb708` + o diff do contrato 164; `report.json` com `generatedAt` 2026-11-23T22:04:31Z, 284 PNGs de 2240×1480, `consoleErrors` vazio). Conferidos os 26 prints da tabela (10 novos e 16 regravados ou conferidos por regressão). Cada print foi aberto inteiro e comparado com o artboard correspondente de `mockups/png/` e com `docs/specs/desktop-shell/design.md` (seções "Notificações" e "WhatsApp com a triagem"); onde havia dúvida, o trecho foi recortado em resolução cheia (chips da linha selecionada e barra da etiqueta no escuro).

## O que procurar em todos

Corte, sobreposição, espaço morto, desalinhamento, texto técnico (id, JSON, "undefined", nome de cartão técnico como "triagem-etiqueta" ou "triagem-agente"), cor fora dos tokens, contraste ruim no escuro (texto sobre `--accent` tem de ser `--on-accent`), nome truncado sem reticências, linha fora de 44 px, segmentado fora de 28, chips de etiqueta fora de 20, raio acima de 6, sombra, pílula. Nas abas da triagem em duas linhas (3 + 2), alinhamento e legibilidade em 300 px; na barra da etiqueta, se cabe em 1120 sem truncar "Triar agora". No `report.json`: nos `detail` dos checks `triagem.*` nenhum nome de contato, texto de mensagem nem motivo (só números e booleanos).

## Resumo

- **26 prints:** 14 `ok`, 12 `ajustar` (3 com bloqueador, 9 só com achados menores).
- Nenhuma cor fora da paleta nos dois temas, nenhuma sombra, nenhuma pílula, nenhum id, JSON, "undefined" ou nome de cartão técnico na interface. Chip "Urgente" de 20 com raio 4 em `--accent`; no escuro o texto sai em `--on-accent` (#061a3d), tanto no chip quanto no botão "Urgente" ligado da barra e no "Criar agente de triagem" (recorte conferido). Abas da triagem em duas linhas, botões de 28, alinhadas à borda da busca, legíveis nos dois temas; "Urgentes (1)" cabe inteiro (o artboard 04 tinha o "(1)" estourando; o app está melhor que o mockup). Barra da etiqueta cabe em 1120 com "Triar agora" inteiro, e cabe também na coluna estreita com o painel Detalhes ou Atendimento aberto (`whatsapp-light`, `whatsapp-atendimento-painel-dark`). Prévias truncadas com reticências ("Preciso do orça…", "Você: Recebido, Ana! J…").
- **`report.json`, privacidade:** os `detail` de `triagem.semAgente`, `unicidade`, `triagem`, `notificacoes`, `manual`, `respondeu`, `assistente`, `desligado`, `estadoFinal`, `privacidade` e `notificacoesEmail` só têm números e booleanos (`injetadasEmMs: 808`, `execucoes: 2`, `linhasDoLog: 4`, `promptSemTexto: true`, `detailLimpo: true`, `logLimpo: true`…). Nenhum nome de contato, texto de mensagem nem motivo.
- **Achados:** 2 bloqueadores (3 prints) e 7 menores.
- **Segunda rodada (smoke-r4, 287 PNGs, `failures` vazio):** B1, B2, M1 e M7 fecharam e a captura nova do e-mail está conforme o artboard 01; M3 fechou em parte (aviso, Ligada e Salvar entram no quadro, mas "Incluir grupos" e a frase-resumo saíram por cima); M2, M4, M5 e M6 não foram mexidos; um achado novo menor (N1). Detalhe em **Segunda rodada**, no fim.

### Falhas de check em `report.json.failures` (contexto)

Seis falhas, que estão em correção:

- Três antigas, por lista fixa de itens da barra lateral nos checks (a lista nova tem `notificacoes` depois de `inicio`): `email list`, `barra lateral settingsDoubleClick` e `barra lateral rootItems`. Não afetam as capturas: os prints da barra mostram a ordem certa.
- Três novas: `triagem notificacoes` (`linhasEmail: 0`, `contagensCertas: false`, `escuro: false`, `marcarComoLidaExercitado: false`), `triagem assistente` (`escuro: false`) e `triagem notificacoesEmail` (`badgeBaixou1: false`). **Ressalva:** ao contrário do que se esperava, estas três afetam as capturas: os `escuro: false` são exatamente os prints escuros que não mostram a tela (B1 e B2), e `linhasEmail: 0` é o print claro de Notificações sem nenhuma linha de e-mail (B1). Depois da correção, regravar e conferir de novo `notificacoes-*` e `assistente-cartao-triagem-dark`.

### Bloqueador (o print não mostra a tela que a spec pede)

- **B1. Notificações sem e-mail no claro e vazia no escuro.** `notificacoes-light` mostra só duas linhas do WhatsApp ("4 mensagens no WhatsApp por ler."); não há linha de e-mail, então o quadrado com `Mail`, "assunto · conta" e o "Marcar como lida" do artboard 01 não aparecem, e o Email da barra lateral está sem número. `notificacoes-dark` mostra o estado vazio ("Tudo lido no Email e no WhatsApp." / "Nada por ler."), que é o artboard 02, não o 01: não dá para conferir chip, hora em `--accent` nem contraste das linhas no escuro. Corresponde às falhas `triagem notificacoes` e `triagem notificacoesEmail`. Pode ser só ordem do cenário (as linhas de e-mail aparecem depois, `notificacoesEmail.linhas: 4`), mas `contagensCertas: false` precisa ser conferido na mão antes de dar a tela por boa (R2: pedir as pastas por `scribe:email-messages` se não estiverem carregadas). Componentes: `src/main/smoke.ts` (`triagemChecks`, captura `notificacoes`) e, se for defeito, `features/notificacoes/notificacoesSelectors.ts`.
- **B2. `assistente-cartao-triagem-dark` é uma conversa nova vazia.** O print escuro mostra "Nova conversa" com as sugestões; nenhum cartão. O claro mostra o cartão. Corresponde a `triagem assistente` com `escuro: false`. Componente: `src/main/smoke.ts` (captura `assistente-cartao-triagem`, o tema escuro troca antes de a conversa reabrir).

### Menor (estético ou de enquadramento)

- **M1. Chip de âmbito some na linha selecionada.** Em `whatsapp-triagem-*`, a linha aberta (Ana Souza) fica em `--bg-sunken` e o chip "Pessoal" também é `--bg-sunken`: sobra só o texto `--text-muted`, sem caixa. No artboard 03 o chip da linha selecionada aparece sobre `--bg` ("Profissional" em branco). Componente: `features/whatsapp/EtiquetaChips.tsx:15` (na linha ativa, usar `bg-bg` ou fio `--line`).
- **M2. Altura das linhas de conversa irregular.** O chip de 20 (`h-5`) é mais alto que a linha da prévia (12/16), então as linhas com etiqueta ficam ~4 px mais altas que as sem (Ana Souza x Bruno Lima e Projeto Atlas). Nenhuma linha tem 44: com `py-1.5` e duas linhas de texto, ficam em ~48–52, como já era antes desta feature e como está no artboard 03. Componente: `features/whatsapp/WhatsAppScreen.tsx:117` e `:127` (fixar a linha da prévia em `h-5` para todas, ou atualizar o design.md para a altura real).
- **M3. `automacoes-tarefa-whatsapp-*` cortado em "Incluir grupos".** O print é o "Editar agendamento" a partir do topo da página; termina na linha do Switch (cortado no pé). O aviso de R15 ("Esta tarefa deixa o agente ler as últimas mensagens…"), a frase-resumo ("Roda em cada conversa…, 30 s depois da última"), "Ligada" e "Salvar agendamento", que são o ponto do artboard 05, ficam fora. Gatilho, "Esperar 30 segundos depois da última mensagem" e "Opcional neste gatilho: o agente recebe a conversa que chegou." conformes. Componente: `src/main/smoke.ts` (rolar o formulário até o aviso antes de `both('automacoes-tarefa-whatsapp')`).
- **M4. "Nada por ler." como título.** No vazio (`notificacoes-dark`), o texto sai no título do `EmptyState` (peso 700, `--title`, maior); o artboard 02 tem a frase em 13 regular `--text-muted`. Componente: `features/notificacoes/NotificacoesScreen.tsx:107` (passar a frase como descrição, sem título, ou uma variante do `EmptyState`).
- **M5. "Ver notificações" do Início não aparece em nenhum print.** `inicio-dia-*` e `inicio-gravando-light` não têm o cartão Pendências (o cenário do smoke não tem pendência nesse momento), então o link do artboard 09 não é conferível; o código existe (`features/inicio/CartaoPendencias.tsx:38`). Componente: `src/main/smoke.ts` (uma captura do Início com pendências, ou o check do link).
- **M6. Run da triagem na última linha de `execucoes-light`, cortada no pé.** "Hoje 18:55 · Triagem do WhatsApp · Concluída · 0 s · menos de US$ 0,01 · Haiku" aparece só pela metade, abaixo de dez runs do cenário; no artboard 06 as triagens estão no topo. Ordem correta (o relógio do smoke põe runs em 24/11). Componente: `src/main/smoke.ts` (filtrar por "Triagem do WhatsApp" ou rolar antes da captura).
- **M7. `configuracoes-claude-light/dark` não chegam ao interruptor.** Os dois param em "Resumir ao encerrar"; "Triagem do WhatsApp por agente" (artboard 08) só aparece em `configuracoes-claude-midia-light`, que está conforme (nome, descrição de R24a, Switch ligado, última linha de "Chat e resumo"). Falta o escuro. Componente: `src/main/smoke.ts` (rolar até `whatsappTriagem` numa captura nos dois temas).

### Observações (não viram pendência)

- **Cobertura.** O cartão `triagem-agente` (criar/editar/pausar/retomar, metade de cima do artboard 07) não está em nenhum print; só o `triagem-etiqueta`. Os artboards 06b (detalhe da execução) e o vazio com o interruptor desligado ("Abrir Configurações") também não têm captura.
- **Dados do cenário, não da interface.** Avatares sem iniciais (quadrados de cor) e telefone sem formatação no cabeçalho do WhatsApp; "Combinado. <b>Não</b> esquece a pauta." (teste de escape); "Nova versão 0.24.0" e "Áudio do sistema · não verificado" na barra lateral; "Bloquear" esmaecido; "Agente do smoke" e as runs "Perdida/Falha/Lenta"; "2 vencidas" com uma tarefa só na lista do Início.
- **Padrões que já existiam no app.** Com Detalhes ou Atendimento aberto, a coluna de conversas não aparece em 1120 (`whatsapp-light`, `whatsapp-detalhes-light`, `whatsapp-atendimento-painel-dark`); "Pausar todos os agendamentos" abaixo da descrição da página, e não à direita como nos artboards 05 e 06; `Select` nativo com a seta do sistema; caminho do Claude CLI em `Menlo` nas Configurações.
- **Ícone do agente "Triagem do WhatsApp".** Sino sobre `--note-orange`, token existente; conforme.

## Por print

| print | artboard de referência | veredito | achado |
|---|---|---|---|
| `notificacoes-light.png` | `01-notificacoes-claro` | ajustar | **B1:** só linhas do WhatsApp, nenhuma de e-mail, sem "Marcar como lida". `PageHeader` com o resumo, `Segmented` de 28 Todas · WhatsApp · Email, linhas em duas linhas com quadrado de 28 e iniciais, nome 13/700, chip "Urgente" de 20, origem com `Smartphone` em `--text-faint`, hora e "3 não lidas" em `--accent` à direita, badge "4" em Notificações na barra: conformes. |
| `notificacoes-dark.png` | `01-notificacoes-escuro` | ajustar | **B1:** estado vazio (artboard 02) no lugar da lista; M4: "Nada por ler." como título. Segmentado ativo em branco como no resto do app. |
| `whatsapp-triagem-light.png` | `03-whatsapp-abas-claro` | ajustar | M1: chip "Pessoal" sem caixa na linha selecionada; M2: linha com chips mais alta. Abas 3 + 2 de 28 entre a busca e a lista, "Não lidas (1)" e "Urgentes (1)"; chips na linha da prévia, Urgente primeiro, a prévia com reticências; barra da etiqueta de 44 com "Etiqueta", Pessoal · Profissional · Nenhum de 28, "Urgente" de 32 ligado em `--accent` e "Triar agora" inteiro à direita: conformes. |
| `whatsapp-triagem-dark.png` | `03-whatsapp-abas-escuro` | ajustar | M1 e M2, iguais ao claro. "Urgente" (chip e botão) com texto `--on-accent` escuro, legível; aba Todas e "Pessoal" ativos em branco. |
| `whatsapp-triagem-vazio-light.png` | `04-whatsapp-urgentes-vazia-claro` | ok | Aba Urgentes ativa; "Nenhum agente de triagem ativo. Um agente das Automações etiqueta cada conversa que recebe mensagem." em 12 `--text-muted`; "Criar agente de triagem" primário com `Plus`; "Escolha uma conversa." à direita. |
| `whatsapp-triagem-vazio-dark.png` | `04-whatsapp-urgentes-vazia-escuro` | ok | O mesmo; botão em `--accent` com texto `--on-accent`. |
| `automacoes-tarefa-whatsapp-light.png` | `05-automacoes-tarefa-whatsapp-claro` | ajustar | M3: corte em "Incluir grupos", aviso e Salvar fora. "Editar agendamento", Nome e Agente "Triagem do WhatsApp", Mensagem com "Opcional neste gatilho…", Frequência "Quando chega mensagem do WhatsApp" com "Esperar 30 segundos depois da última mensagem": conformes. |
| `automacoes-tarefa-whatsapp-dark.png` | `05-automacoes-tarefa-whatsapp-escuro` | ajustar | M3, igual ao claro. Campos legíveis no escuro. |
| `assistente-cartao-triagem-light.png` | `07-assistente-cartoes-triagem-claro` | ok | Cartão "Etiquetar conversa Ana Souza como Urgente · Pessoal" com ícone de etiqueta, "Etiqueta" e os chips Urgente e Pessoal de 20, "Aplicar" primário e "Descartar"; nenhum "triagem-etiqueta" nem `chatId`. O cartão `triagem-agente` não aparece (observação). |
| `assistente-cartao-triagem-dark.png` | `07-assistente-cartoes-triagem-escuro` | ajustar | **B2:** conversa nova vazia, sem cartão. |
| `agentes-light.png` (regravado) | — | ok | Quarto agente "Triagem do WhatsApp" com sino, "Classifica cada conversa que recebe mensagem: urgente ou não; pessoal ou profissional.", "Haiku · Nenhuma reunião · Nenhum agendamento", Editar/Duplicar/Excluir; grade 2 × 2 alinhada. |
| `agentes-dark.png` (regravado) | — | ok | O mesmo; ícone legível sobre `--note-orange` do escuro. "Agente do smoke" na terceira linha (cenário). |
| `execucoes-light.png` (regravado) | `06-automacoes-execucoes-claro` | ajustar | M6: a run da triagem é a última linha, cortada no pé. Agendamento e agente "Triagem do WhatsApp", Concluída, "menos de US$ 0,01", Haiku; nenhum texto de mensagem na linha. |
| `inicio-dia-light.png` (regravado) | `09-inicio-pendencias-claro` | ajustar | M5: sem o cartão Pendências, o link "Ver notificações" não aparece. Item Notificações na barra logo abaixo de Início. |
| `inicio-dia-dark.png` (regravado) | `09-inicio-pendencias-escuro` | ajustar | M5, igual ao claro. |
| `inicio-gravando-light.png` (regravado) | — | ok | Barra com Notificações; nada desalinhado pela linha nova. |
| `sidebar-raiz-light.png` (regravado) | `01-notificacoes-claro` (barra) | ok | Notificações (`Bell`) entre Início e Reuniões, item plano, número "1" em 12 tabular igual ao do Email e ao de Tarefas; alturas iguais às outras linhas. |
| `sidebar-raiz-dark.png` (regravado) | `01-notificacoes-escuro` (barra) | ok | O mesmo no escuro. |
| `configuracoes-claude-light.png` (regravado) | `08-configuracoes-claude-claro` | ajustar | M7: o print para antes do interruptor da triagem. Resto da aba sem mudança. |
| `configuracoes-claude-dark.png` (regravado) | `08-configuracoes-claude-escuro` | ajustar | M7, igual ao claro. |
| `configuracoes-claude-midia-light.png` (regravado) | `08-configuracoes-claude-claro` | ok | "Triagem do WhatsApp por agente" como última linha de "Chat e resumo", descrição de R24a inteira em três linhas, Switch ligado na coluna de 340, linha com fio como as outras. |
| `whatsapp-light.png` (regravado) | `03-whatsapp-abas-claro` | ok | Com Detalhes aberto, a barra da etiqueta cabe na coluna estreita: Nenhum ativo, "Urgente" desligado com contorno, "Triar agora" inteiro. |
| `whatsapp-dark.png` (regravado) | `03-whatsapp-abas-escuro` | ok | O mesmo no escuro; "Nenhum" ativo em branco legível. |
| `whatsapp-detalhes-light.png` (regravado) | — | ok | Barra da etiqueta acima das mensagens sem empurrar o painel Detalhes; "+ Tarefa" e "+ Contato" intactos. |
| `whatsapp-atendimento-selo-light.png` (regravado) | — | ok | Abas sem contagem quando zero ("Não lidas", "Urgentes"); "1 atendida · Pausar todos os atendimentos" abaixo das abas; chip "Recados" do atendimento na linha da prévia sem empurrar a hora; nomes inteiros. |
| `whatsapp-atendimento-painel-dark.png` (regravado) | — | ok | Barra da etiqueta convive com "Recados · atendendo" no cabeçalho e o painel Atendimento; nada cortado. |

## Segunda rodada (smoke-r4, depois das correções de B1, B2, M1, M3 e M7)

Prints da rodada 4 de 23/11/2026 (`smoke-r4/` no scratchpad da sessão; `report.json` com `generatedAt` 2026-11-23T22:42:18Z, 287 PNGs de 2240×1480, `failures` vazio, `consoleErrors` vazio). Só os prints afetados por B1, B2, M1, M3 e M7 e as duas capturas novas do e-mail. Cada um foi aberto inteiro e comparado com o artboard; os chips da linha selecionada em `whatsapp-triagem-*` foram recortados em resolução cheia.

**`report.json`:** os `detail` dos onze checks `triagem.*` continuam só com números e booleanos (`injetadasEmMs: 807`, `linhasEmail: 0`, `badge: 5`, `linhasDoLog: 4`, `detailLimpo: true`, `logLimpo: true`…); nenhum nome de contato, texto de mensagem nem motivo. As três falhas novas da primeira rodada viraram `ok`: `notificacoes` (`contagensCertas: true`, `escuro: true`), `assistente` (`escuro: true`) e `notificacoesEmail` (`badgeBaixou1: true`, `hoverClaro` e `hoverEscuro: true`, `devolvidoANaoLido: true`). As três antigas da barra lateral também saíram.

| item | print | veredito | o que o print mostra agora |
|---|---|---|---|
| B1 | `notificacoes-light.png` | fechou | As duas linhas do WhatsApp carregam sem passar pela tela WhatsApp: Ana Souza com chip "Urgente" de 20, `Smartphone` + "WhatsApp" em `--text-faint`, "19:33" e "3 não lidas" em `--accent`; Bruno Lima com "1 não lida"; badge "4" em Notificações. O e-mail ficou para a captura própria (abaixo), então esta fase não tem linha de e-mail nem número no Email, de propósito (`linhasEmail: 0` no check). |
| B1 | `notificacoes-dark.png` | fechou | A mesma lista no escuro, no lugar do estado vazio da primeira rodada: chip "Urgente" com texto `--on-accent`, hora e contagem em `--accent` claro legíveis, iniciais sobre os quadrados de cor do escuro, Todas ativo em branco. |
| e-mail | `notificacoes-email-light.png` | fechou | Artboard 01 conferido: "5 por ler: 1 mensagem no WhatsApp e 4 e-mails."; quatro linhas de e-mail com o quadrado de 28 e `Mail`, remetente 13/700, `Mail` + "Email" em `--text-faint`, "assunto · conta" na segunda linha, hora em `--text-faint` sem contagem; a linha do WhatsApp (Bruno Lima) no fim, em `--accent`; badges "5" em Notificações e "4" no Email. Hover na primeira linha: fundo `--bg-sunken` e "Marcar como lida" com o envelope aberto à esquerda da hora, no mesmo lugar do artboard. Diferença com o artboard só de dados (lá as origens se intercalam por hora; aqui os e-mails do cenário são todos das 19:38). |
| e-mail | `notificacoes-email-dark.png` | fechou | O mesmo no escuro; a linha em hover fica mais escura que o fundo, "Marcar como lida" em `--text` legível, quadrados de `Mail` com fio visível. |
| B2 | `assistente-cartao-triagem-dark.png` | fechou | O cartão aparece no escuro: "Etiquetar conversa Ana Souza como Urgente · Pessoal" com o ícone de etiqueta, "Etiqueta", chips Urgente (`--accent`, texto `--on-accent`) e Pessoal, "Aplicar" primário e "Descartar"; nenhum "triagem-etiqueta" nem `chatId`. Rodapé "Sonnet · 1 s · …" e Copiar/Refazer como nas outras respostas. |
| M1 | `whatsapp-triagem-light.png` | fechou | Na linha selecionada (Ana Souza, `--bg-sunken`), o chip "Pessoal" tem fio `--line` e a caixa aparece inteira (recorte); "Urgente" segue em `--accent`. Prévia "Preciso do orça…" com reticências. |
| M1 | `whatsapp-triagem-dark.png` | fechou | O mesmo no escuro: "Pessoal" com fio claro visível sobre a linha selecionada (recorte). Barra da etiqueta, abas 3 + 2 e "Triar agora" sem mudança. |
| M1 | `whatsapp-atendimento-selo-light.png`, `whatsapp-light.png`, `whatsapp-dark.png` | ok | Sem regressão: o chip "Recados" do atendimento continua com o seu fio e a hora no lugar; nessas capturas a conversa está em "Nenhum", então não há chip de âmbito. |
| M3 | `automacoes-tarefa-whatsapp-light.png` | fechou em parte | O formulário rolou: o aviso de R15 inteiro em duas linhas, Fuso, Tempo máximo, Saída, Avisos, "Pode enviar email", "Ligada" e "Salvar agendamento"/"Cancelar" entram no quadro. Mas a rolagem passou do ponto: "Incluir grupos" e a frase-resumo ("Roda em cada conversa…, 30 s depois da última"), que no artboard 05 ficam logo acima do aviso, saíram por cima; do gatilho sobra só o texto "Quando chega mensagem do WhatsApp" colado sob as abas, sem a caixa do `Select` (parece texto solto). "Salvar agendamento" encosta no pé do quadro. Componente: `src/main/smoke.ts` (rolar até o Switch "Incluir grupos" no topo, não até o aviso). |
| M3 | `automacoes-tarefa-whatsapp-dark.png` | fechou em parte | O mesmo do claro; aviso em `--bg-sunken` com a barra `--accent` à esquerda e texto legível. |
| M7 | `configuracoes-claude-midia-light.png` | fechou | "Triagem do WhatsApp por agente" como última linha de "Chat e resumo", descrição de R24a em três linhas, Switch ligado alinhado com os de cima. |
| M7 | `configuracoes-claude-midia-dark.png` | fechou | O escuro que faltava: mesma linha, Switch ligado em `--accent` com o botão escuro, descrição em `--text-muted` legível. |

**Não mexidos nesta rodada (continuam como na primeira):** M2 (altura das linhas com chip), M4 ("Nada por ler." como título no vazio; o vazio não tem mais captura, porque `notificacoes-dark` agora mostra a lista), M5 ("Ver notificações" do Início sem captura) e M6 (run da triagem cortada no pé de `execucoes-light`).

### Achado novo

- **N1 (menor). Barra de rolagem do sistema visível nas capturas roladas.** Em `automacoes-tarefa-whatsapp-*` e `configuracoes-claude-midia-*`, a barra cinza da rolagem aparece na borda direita do conteúdo. Não é desta feature (é o padrão das telas roladas do app) e não corta nada; registrado só para não ser confundido com defeito da triagem.

**Ficou para depois:** o ajuste do enquadramento do M3 (rolar menos) e os menores M2, M4, M5 e M6, que não eram bloqueio desta entrega.
