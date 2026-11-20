# Contrato 55 — Telas do email: árvore de pastas, mover, assinatura, painel "Organizando" e Configurações › Email

> Integrado à barra lateral em pilha em 19/11/2026: a árvore de pastas renderiza no nível Email (ver docs/specs/_archive/sidebar-pilha/), os itens principais não ficam acima dela e a aba Email é uma linha do nível Configurações.

> Aprovado pelo Andrew em 19/11/2026: \Archive na ordem alfabética e protegida, \Important escondida; pastas recentes do menu "Mais" gravadas no settings (`emailRecentFolders`); a frase da senha na seção Contas fica "cifrada neste Mac"; demais decisões como propostas.
Feature: email-organizacao · Wave: 4 · Depende de: 52, 53, 54, 56 · Spec: `docs/specs/email-organizacao/spec.md` (R1, R2, R3, R5, R6, R7, R8, R11, R12, N1, N2, N3, N6) · Plan: `docs/specs/email-organizacao/plan.md`


Pedido do Andrew (19/11/2026 13:00): "organizar o email como no Outlook desktop". Este contrato é **só o renderer**
(mais o mínimo no main para o que é da tela: duas chaves novas no settings e a navegação a partir do aviso). Os
núcleos já estão nos contratos 52 (pastas), 53 (regras), 54 (assinatura) e 56 (agente organiza); aqui não se cria
canal IPC de negócio novo. Se faltar algo no main para cumprir um CA, o implementador **para e relata** (não inventa
canal).

## Desenho aprovado (19/11/2026)
Mockup `docs/specs/desktop-shell/mockups/EmailOrganizacao.dc.html` (12 telas, cada uma em claro e escuro, tokens do
`design.md` v2), aprovado pelo Andrew em 19/11/2026 com as decisões abaixo **como propostas**. Elas valem como parte dos
critérios; o CA que cumpre cada uma está entre parênteses.
- D1 Ordem das pastas: Caixa de Entrada, Rascunhos e Enviados no topo; depois as pastas da pessoa em ordem alfabética;
  Spam e Lixeira no fim. "[Gmail]", "Todos os e-mails" e "Com estrela" escondidas no sidebar (aparecem só no seletor). (CA2)
- D2 Linhas de pasta com 30 px (a navegação principal segue com 40); contagem só de não lidas. (CA2)
- D3 Seleção múltipla: a marcada troca o avatar por caixa de seleção; com 2 ou mais, barra "N selecionadas" e a leitura
  vira o resumo com as ações. Atalho ⇧⌘M para "Mover para…". (CA4, CA5)
- D4 Menu "Mais" novo na barra da leitura, só com "Mover para…" e as 3 últimas pastas usadas. (CA6)
- D5 Assinatura entra como texto do próprio campo do Composer, sem caixa à parte, com uma linha de apoio no rodapé
  apontando para Configurações › Email. (CA11)
- D6 O painel "Organizando" toma a área da leitura enquanto roda; clicar numa decisão abre o email no lugar e "Voltar
  ao andamento" traz o painel de volta. (CA12)
- D7 Sem verde nem amarelo: Resolvido em azul cheio, Pendente com contorno, outra pasta em cinza azulado. A faixa
  "O Assistente moveu N mensagens · Desfazer" fica no topo da lista até o fim do dia ou até fechar. (CA12, CA13)
- D8 Um seletor de conta só, abaixo de Contas, vale para Assinatura, Regras e Pastas. (CA15)
- D9 Cada regra tem interruptor para ligar e desligar sem apagar. (CA17)
- D10 A ordem das regras muda arrastando pela alça e por "Subir/Descer" no menu ⋯ (teclado); o editor abre no lugar da
  linha. (CA17, CA18)
- D11 Apagar pasta com mensagens pede confirmação dizendo que as mensagens são apagadas no servidor sem passar pela
  Lixeira (o `DELETE` do IMAP). (CA9, CA20)
- D12 Aba Email depois de Contas, no ⌘6; Plugins, Conexões e Sobre passam para ⌘7, ⌘8 e ⌘9 (a spec dizia "⌘9"; vale a
  ordem do plan, e o R7 da spec é corrigido no fechamento). (CA14)

## Pré-condições
- **O 55 só começa depois dos commits do 53 e do 56** na branch `email-organizacao` (52 em b624852; 54 já commitado).
  Conferir com `git log --oneline -6` e `git status` limpo.
- Ler antes: o mockup inteiro (abrir no navegador; as legendas de cada tela são parte do pedido); os contratos 52, 53,
  54 e 56; no renderer `features/email/{EmailNav,EmailScreen,ReadingPane,Composer,emailStore,format}.ts(x)`,
  `features/settings/{SettingsScreen,EmailSection,AccountsSection,settingsTabs}.ts(x)`, `features/meetings/{MoveMenu,
  FolderBar,menu}.ts(x)` (o padrão de menu em linha que já existe: `MENU_PANEL`, `MENU_ITEM`, `useInlineMenu`), os
  componentes de `design/` (`Button`, `Field`, `Switch`, `Segmented`, `SettingRow`, `Section`, `Note`, `Icon`),
  `shared/{email,email-signature,email-rules,routes,settings-index}.ts`, o preload do email e, no smoke
  (`main/smoke.ts`), os passos de email (`email-light`, `email-leitura-*`, `email-composer-*`) e o de Configurações
  (o que confere ⌘2/⌘8 e "linhas fora do índice").

## Critérios de aceite

### Tela de email (telas 01 a 05)
- CA1 — Rotas de pasta. `emailPath(accountId, folder)` passa a aceitar `'inbox' | 'sent' | { path: string }`.
  Caixa de Entrada e Enviados mantêm `/email/<id>/entrada` e `/email/<id>/enviados` (links antigos e o clique no aviso
  continuam valendo). As outras pastas vão num segmento que não colide com os dois slugs (ex.: `p~` +
  `encodeURIComponent(path)`), com a função inversa em `shared/routes.ts`. Teste: ida e volta com `/`, `.`, espaço,
  acento, `%`, `~`, e uma pasta chamada literalmente "entrada". Path que não existe mais na conta abre a Caixa de
  Entrada com a nota "A pasta “X” não existe mais nesta conta.".
- CA2 — Árvore no sidebar (R1, D1, D2). `EmailNav` mostra, abaixo de cada conta IMAP, a árvore de
  `scribe:email-folders` (52). Função pura `features/email/folderTree.ts` (`sidebarTree(nodes)`, `pickerTree(nodes)`,
  `folderLabel(node)`, `breadcrumb(path, nodes)`) com:
  - Nomes da casa: `INBOX` → "Caixa de Entrada", `\Drafts` → "Rascunhos", `\Sent` → "Enviados", `\Junk` → "Spam",
    `\Trash` → "Lixeira", onde quer que estejam no servidor (no Gmail, os filhos de `[Gmail]` sobem para a raiz). As
    outras com o nome do servidor (já decodificado pelo imapflow).
  - Ordem: Caixa de Entrada, Rascunhos, Enviados; as pastas da pessoa em ordem alfabética (`localeCompare` pt-BR, sem
    diferenciar maiúscula), também dentro de cada subpasta; Spam e Lixeira por último.
  - Escondidas no sidebar e mostradas no seletor (CA7): `\All` ("Todos os e-mails"), `\Flagged` ("Com estrela") e o nó
    `[Gmail]` quando ele é `\Noselect` e todos os filhos subiram ou foram escondidos. **[decidir]** `\Archive` e
    `\Important`: proposta — `\Archive` entra na ordem alfabética com o nome do servidor (protegida, com cadeado no menu
    da CA9); `\Important` some como `\All`.
  - Linha de pasta com 30 px de altura, recuo por nível, seta para abrir/fechar só quando tem filhos, contagem só de
    não lidas (`unseen`; a INBOX segue contando pela lista local, como hoje). Pasta `\Noselect` não abre nem recebe
    soltura, só abre/fecha. A linha da conta continua com 40 px. As subárvores fechadas ficam gravadas em
    `settings.emailFoldersCollapsed: string[]` (chave `<conta>\n<path>`), filtradas quando a conta sai, no mesmo
    desenho do `emailCollapsed` de hoje.
  - Conta POP3: só Caixa de Entrada e Enviados, como hoje (N2). Conta com `state: 'error'` ou `scribe:email-folders`
    com `unavailable`: mostra Caixa de Entrada e Enviados e a última árvore conhecida da sessão, sem quebrar.
  - Contagens atualizam depois de mover, criar, renomear, apagar, ao receber `scribe:email-changed`/`email-message` e ao
    abrir a pasta. Cada pasta aberta que não é a INBOX chama `scribe:email-folder-watch` (52 CA3) ao abrir e `null` ao sair.
- CA3 — Lista de qualquer pasta. Abrir uma pasta pelo sidebar chama `scribe:email-open-folder` e mostra a lista no mesmo
  desenho da Caixa de Entrada (grupos Hoje/Ontem/Esta semana, título com o nome da casa, "N não lidas", endereço da
  conta). `useEmail.folders` passa a ter chave por path (`folderKey(conta, path)`); a INBOX e os Enviados seguem com o
  comportamento de hoje. `receive` (`scribe:email-message`) põe a mensagem na lista do `mailbox` dela (53 CA5: movida
  por regra cai na pasta destino, não na INBOX) só se essa lista já foi lida.
- CA4 — Seleção múltipla (R2, D3). Função pura `features/email/selection.ts`: clique simples abre (e seleciona só ela),
  ⌘ clique liga/desliga uma, ⇧ clique escolhe o intervalo desde a âncora, Esc limpa; mudar de pasta limpa. Linha
  marcada (com 2 ou mais) troca o avatar por uma caixa de seleção (`role="checkbox"`, `aria-checked`), e o cabeçalho da
  lista mostra "N selecionadas". Com 2 ou mais, a área da leitura vira `SelectionSummary`: "N mensagens selecionadas",
  "Arraste para uma pasta na barra lateral ou escolha uma ação.", botões **Mover para… ⇧⌘M**, **Marcar como lidas** e
  **Apagar** (com a mesma confirmação do apagar de uma, no plural), e a dica "⌘ clique escolhe uma a uma · ⇧ clique
  escolhe um intervalo · Esc limpa". Em POP3 o "Mover para…" não aparece.
- CA5 — Arrastar para a pasta (R2). Linha da lista é arrastável (a selecionada leva a seleção inteira; a não selecionada
  leva só ela). Pasta do sidebar **da mesma conta**, que não é a atual nem `\Noselect`, destaca como alvo (fundo
  `--hl`) e mostra a etiqueta "Mover N mensagens para <nome>" (singular para 1). Soltar chama `scribe:email-move`
  (52, até 500 UIDs; acima disso, em lotes de 500). Pasta de outra conta, a atual, Rascunhos e POP3 não aceitam
  soltura. O teclado tem o mesmo caminho por ⇧⌘M (CA7).
- CA6 — Menu "Mais" na leitura (D4, tela 02). Botão "Mais" (`MoreHorizontal`, `aria-label="Mais"`, `aria-haspopup`)
  depois de Apagar na barra do `ReadingPane`, no padrão `useInlineMenu`. Itens: **Mover para… ⇧⌘M** (abre o seletor da
  CA7) e, sob o rótulo "RECENTES", as até 3 últimas pastas usadas para mover nesta conta (com breadcrumb "Clientes ›
  ABF"), fora a pasta atual. Recentes em `settings.emailRecentFolders: Record<accountId, string[]>` (até 3, a mais nova
  primeiro), atualizadas a cada mover bem-sucedido por qualquer caminho, corrigidas no renomear e limpas no apagar pelo
  app e quando a conta sai. **[decidir]** gravar no settings (proposta) ou só na memória da sessão. POP3: sem o botão
  (o menu só tem itens de mover).
- CA7 — Seletor "Mover para…" (tela 03). `MoveToPicker` (`role="dialog"`, `aria-modal`, foco no campo ao abrir e
  devolvido ao fechar): título "Mover para…" e "1 mensagem"/"N mensagens"; campo de busca que filtra pelo nome enquanto
  digita (sem acento nem maiúscula, `normalizeSearch`), destacando o trecho achado e mantendo os pais da pasta achada;
  a árvore `pickerTree` da conta (inclui `\All` e `\Flagged`; a pasta atual e as `\Noselect` desligadas); setas
  ↑/↓ andam, → / ← abrem e fecham; **Enter** move para a escolhida; **Esc** fecha sem mover; "Nova pasta em “<escolhida>”…"
  (ou "Nova pasta…" na raiz) abre o campo de nome no próprio seletor, cria por `scribe:email-folder-create` e move para
  ela; rodapé com "<conta> · <endereço>", **Cancelar** e **Mover** (desligado sem destino). O mesmo seletor serve à
  leitura, ao resumo da seleção, ao menu de contexto e a ⇧⌘M (com a lista em foco ou uma mensagem aberta).
- CA8 — Clique direito na mensagem (tela 04). Menu no padrão de `menu.ts`: Responder, Encaminhar, **Mover para ›**
  (submenu com as pastas do sidebar, fora Rascunhos, Enviados e Lixeira, a atual desligada), "Outra pasta… ⇧⌘M",
  Marcar como lida/não lida, Apagar. Clique direito numa linha da seleção age na seleção inteira (Responder e
  Encaminhar desligados com 2 ou mais); fora da seleção, troca a seleção por ela. Abre também por ⇧F10 / tecla de
  menu na linha em foco. POP3: sem "Mover para" nem "Outra pasta".
- CA9 — Clique direito na pasta (R3, tela 05). Menu com **Nova subpasta…**, **Renomear…**, **Apagar pasta…**.
  "Nova subpasta…" abre um campo de texto dentro da árvore, embaixo da pasta (Enter cria por `folder-create`, Esc
  desiste); "Renomear…" troca o nome no lugar (`folder-rename`). Na INBOX e em pasta com `specialUse` (52
  `EMAIL_PROTECTED_SPECIAL_USE`), Renomear e Apagar aparecem **desligados com cadeado** (`Lock`) e a dica "Pasta do
  sistema". "Apagar pasta…" pede confirmação: pasta vazia — "Apagar a pasta “X”?"; com conteúdo (o `invalid` +
  `contents` do 52 sem `force`) — "Apagar a pasta “X” e as N mensagens dela?" (e "e as M subpastas", quando houver) e
  "As mensagens são apagadas no servidor, sem passar pela Lixeira. Para guardar, mova antes para outra pasta.", botões
  **Apagar pasta e mensagens** (perigo) e **Cancelar**; só então chama com `force: true` (D11). Nome validado como no
  52 (1–100, sem o delimitador, sem CR/LF) antes de enviar, com a frase do erro embaixo do campo. Apagar a pasta aberta
  leva para a Caixa de Entrada.
- CA10 — Mover na tela, erros e esmaecimento. Mover (qualquer caminho) tira as mensagens da lista na hora, com
  esmaecimento de `--duration-base` (160 ms; nenhum com `prefers-reduced-motion`), e as devolve se o servidor recusar,
  como o "Marcar lida" de hoje. A mensagem aberta que saiu abre a próxima da lista (ou o vazio "Escolha uma mensagem
  para ler."). Erros do 52 em frase, numa `Note` acima da lista: `unavailable` "Sem conexão com o servidor. Nada foi
  movido."; `server` "O servidor recusou. Nada foi movido."; `invalid` (UIDVALIDITY) "A pasta mudou no servidor.
  Atualize e tente de novo."; `unsupported` "Este servidor não move sem risco de apagar outras mensagens."; `protected`
  e `pop3` não chegam a aparecer (a tela não oferece). Mover parcial (lote de 500 que falha no meio) diz quantas foram.

### Composer (tela 06)
- CA11 — Assinatura no Composer (R6, D5). O texto vem do `withSignature` do 54 (já aplicado no Composer); este contrato
  só acrescenta, no rodapé do Composer, a linha de apoio "Assinatura da conta <nome>. Pode editar ou apagar aqui; a
  padrão fica em Configurações › Email", com "Configurações › Email" como link para `settingsPath('email', 'assinatura')`.
  A linha só aparece quando a assinatura entrou (texto não vazio e interruptor do tipo ligado). Nenhuma caixa à parte:
  a assinatura é texto do campo, editável e apagável. Envio, token de clique e o contrato 51 sem mudança.

### Painel "Organizando" (telas 07 e 08)
- CA12 — Painel ao vivo (R12, D6, D7, tela 07). `OrganizePanel` toma a área da leitura da conta que o Assistente está
  organizando, em qualquer pasta dela, enquanto a organização roda. Mostra:
  - "Organizando a <pasta>" e "Pedido no Assistente às HH:MM: “<pedido>”"; botão **Parar** (chama o parar do 56, o
    mesmo caminho do parar do chat).
  - As etapas **Lendo · Decidindo · Movendo** com a atual marcada; contadores "X de Y lidos", "Z movidos" e, por
    destino, "N Resolvidos", "N Pendentes", "N outras pastas"; uma barra de progresso (`role="progressbar"`,
    `aria-valuenow` = lidos, `aria-valuemax` = Y).
  - A nota do limite N7 quando a pasta tem mais de 200: "A Caixa de Entrada tem T mensagens: o Assistente lê as 200 mais
    recentes e T−200 ficam de fora. Na dúvida, vai para Pendentes."
  - "Decisões por assunto": uma linha por assunto, na ordem em que saem — veredito (**Resolvido** em `--accent` cheio
    com `--on-accent`; **Pendente** com contorno `--accent`; outra pasta em `--bg-sunken`/`--text-muted` com o
    breadcrumb "Clientes › ABF"; sem verde nem amarelo; raio 4, sem pílula), assunto, "remetente · N emails", o motivo
    em uma frase e a evidência em texto menor. A linha em andamento mostra "decidindo" e "lendo N emails do fio".
    Região viva (`aria-live="polite"`) anuncia só a decisão nova, não cada contador.
  - Clicar numa linha abre o email (a mensagem mais recente do assunto) no lugar do painel, com o botão **Voltar ao
    andamento**; o mesmo botão aparece se a pessoa abrir outra mensagem da lista durante a organização.
  - As mensagens que o agente move somem da lista com o esmaecimento da CA10, sem recarregar a pasta.
  - Fonte (contrato 56 CA10–CA13): o evento `scribe:email-organize`, que traz **o estado inteiro a cada vez** (não o
    delta): `{ batchId, chatId, accountId, state, etapa, read, total, outOfLimit, moved, byFolder: { path, count }[],
    topics: { assunto, from, count, veredito: 'resolvido' | 'pendente' | 'outra', destino, motivo, evidencia, status:
    'decidindo' | 'decidido' | 'movido', open: { accountId, mailbox, id } | null }[] }`. Ao abrir a tela de email (ou
    reabrir o app) no meio, o painel se monta pelo invoke `scribe:email-organize-state` (lote `running` mais recente e
    os de hoje). O pedido e a hora ("Pedido no Assistente às HH:MM: “…”") vêm do lote (`request`, `startedAt`) por
    `scribe:email-batch-get { batchId }`, chamado uma vez por `batchId` novo. "Clicar na linha abre o email" usa
    `topics[].open` (a mensagem onde ela está agora); `open: null` deixa a linha sem clique. "N outras pastas" soma os
    `byFolder` que não são `Resolvidos` nem `Pendentes`. Parar é o `scribe:chat-stop` de hoje com o `chatId` do lote.
  - A lógica fica numa função pura `features/email/organizeState.ts` (`organizeView(event | batch, agora)` → o que o
    painel e a faixa desenham), testada sem tela; o componente só desenha. Evento de outra conta não mexe no painel
    desta. Com o app bloqueado o evento não chega (56): o painel fica como estava e se refaz pelo
    `email-organize-state` ao desbloquear.
  - **[alinhar com o 56]** o evento não diz qual pasta está sendo organizada: o título usa o `fromPath` dos itens do
    lote (por `email-batch-get`) e, sem item ainda, "a Caixa de Entrada".
- CA13 — Parado/terminado e Desfazer (R11, D7, tela 08). Ao Parar ou ao terminar, o painel vira o resumo: "Organização
  parada" / "Organização concluída"; "Você parou às HH:MM. O que já foi movido ficou onde está." (ou "Terminou às
  HH:MM."); "N em Resolvidos, N em Pendentes, N em <pasta>"; "X de Y mensagens lidas. As outras Y−X não foram tocadas;
  T−200 ficaram de fora por passar das 200 mais recentes." (cada parte só quando vale); botões **Desfazer as N**,
  **Abrir no Assistente** (abre a conversa do pedido) e **Fechar**; e "Decisões por assunto · A assuntos, N mensagens"
  com as mesmas linhas. No topo da lista da pasta organizada, a faixa `OrganizeBanner`: "O Assistente moveu N mensagens"
  · "hoje, HH:MM · parado por você" (ou "· concluído") · **Desfazer** · fechar (×). A faixa fica até o fim do dia (meia-
  noite local) ou até o ×; "Desfazer" (painel ou faixa) chama `scribe:email-batch-undo { batchId }` (56 CA9), as
  mensagens voltam à lista de origem pelo `scribe:email-changed` (sem aviso de "email novo": o 56 marca `movedIn`), e a
  faixa vira "Desfeito: N mensagens voltaram para a <pasta>." e some depois de 5 s. Resultado com `failed` diz quantas
  voltaram e quantas não, em frase por código: `folder-missing` "a pasta de destino sumiu", `origin-missing` "a pasta
  de origem não existe mais (o app não recria)", `not-found` "já tinham saído da pasta"; com falha, o botão vira
  **Tentar de novo** (o 56 tenta só as que falharam). Lote `running` não mostra Desfazer (o 56 responde `busy`).
  Lote `undone` não mostra faixa; `partial-undo` mostra a faixa com o que sobrou. Lote sem nada movido não mostra faixa
  nem "Desfazer". A faixa sai dos lotes de hoje do `scribe:email-organize-state` (sobrevive a trocar de tela e a
  reabrir o app; o × vale até o app fechar). "Abrir no Assistente" abre a conversa `chatId` do lote. O cartão do lote
  no chat do Assistente é do 56 (CA12 dele), não deste contrato.

### Configurações › Email (telas 09 a 12)
- CA14 — Aba nova (R7, D12). `SETTINGS_TABS` = `geral, gravacao, claude, arquivos, contas, email, plugins, conexoes,
  sobre`; rótulo "Email"; ⌘6 abre Email, ⌘7 Plugins, ⌘8 Conexões, ⌘9 Sobre (`tabForShortcut` já aceita 1–9; os
  comentários "⌘1…⌘8" do renderer passam a "⌘1…⌘9"). `settingsPath('email', âncora)` funciona. O `EmailSection` sai do
  painel `contas` (que fica com Google, Microsoft, agendas e WhatsApp) e a aba Email tem, nesta ordem, as seções
  **Contas**, o seletor de conta, **Assinatura**, **Regras**, **Pastas** e **Avisos**.
- CA15 — Contas e seletor de conta (D8, tela 09). Seção **Contas**: o que hoje está em `EmailSection` (lista com
  "IMAP · servidor"/"POP3 · a cada N min", estado, Editar, Remover, "Adicionar conta", formulário), com a descrição
  "Contas de email IMAP ou POP3, com envio por SMTP. A senha fica no Chaveiro do macOS." **[decidir]** a frase da senha:
  o código de hoje diz "cifrada neste Mac" (safeStorage); o mockup diz "Chaveiro do macOS" — proposta: manter a frase
  verdadeira de hoje. "Buscar emails novos a cada" fica nesta seção, como aparece hoje. Logo abaixo, uma linha só:
  "Assinatura, regras e pastas de [seletor de conta] <endereço>" (com "· POP3" na conta POP3); a escolha vale para as três
  seções e fica lembrada enquanto o app está aberto (padrão: a primeira conta). Sem conta: as três seções somem e fica a
  nota "Adicione uma conta para configurar assinatura, regras e pastas."
- CA16 — Assinatura (R6). "Texto da assinatura" (campo de várias linhas, `maxLength` 2000, contador "N de 2000") com a
  descrição "Texto simples. Links e emails viram link. Entra acima do texto citado, depois de “-- ”."; interruptores
  "Em mensagens novas" e "Em respostas e encaminhamentos". Lê com `scribe:email-signature-get` ao trocar de conta e grava
  com `scribe:email-signature-set` (texto ao sair do campo ou 600 ms depois de parar de digitar; interruptor na hora).
  Falha ao gravar: `Note` "Não foi possível salvar a assinatura." e o campo mantém o que a pessoa digitou.
- CA17 — Lista de regras (R4, R5, N1, N6, D9, D10, tela 09). Seção **Regras** com "N de 50" e **Nova regra** (desligado
  em 50, com a dica "Limite de 50 regras por conta"); o texto "As regras são do app: agem no email que chega, na ordem
  da lista, só enquanto o Meeting Scribe está aberto. “Parar aqui” impede as regras de baixo."; uma linha por regra
  (`scribe:email-rules-get` do 53), com: alça de arrastar (`GripVertical`), número, nome, o resumo em uma frase,
  interruptor ligar/desligar (D9, `aria-label="Regra <nome> ligada"`, grava na hora), **Executar agora** e o menu ⋯
  (Editar, Subir, Descer, Apagar). Função pura `features/settings/rulesFormat.ts`:
  - `ruleSummary(rule, folders)`: "Se o remetente contém “@abf.com.br” Mover para Clientes › ABF · parar aqui"; com
    mais de uma condição, "Se todas:"/"Se qualquer uma:" e as condições separadas por vírgula; ações em minúscula
    separadas por " · ", a primeira em maiúscula; nomes das condições "o remetente contém", "o destinatário ou Cc
    contém", "o assunto contém", "o corpo contém", "tem anexo"; das ações "mover para <breadcrumb>", "marcar como lida",
    "marcar com estrela", "apagar (vai para a Lixeira)", "não avisar".
  - `ruleErrorText(code, rule, folders, agora)`: "Último erro <quando>: " +
    `folder-missing` "a pasta “X” não existe mais no servidor. O email ficou na Caixa de Entrada.";
    `no-trash` "a conta não tem Lixeira, então a regra não apaga. O email ficou na Caixa de Entrada.";
    `unavailable` "sem conexão com o servidor. O email ficou na Caixa de Entrada.";
    `server` "o servidor recusou. O email ficou na Caixa de Entrada.";
    `pop3` "conta POP3 não move, não marca com estrela nem apaga." — com "<quando>" "hoje, 09:12", "ontem, 18:40" ou a
    data. A linha com erro mostra o texto em `--rec` com `TriangleAlert` e o link **Editar regra**. Nada do conteúdo do
    email aparece (o 53 não guarda).
  - Reordenar: arrastar pela alça ou Subir/Descer manda a lista inteira na ordem nova por `scribe:email-rules-set`; a
    tela muda na hora e volta se o main recusar. A posição nova é anunciada ("Regra Faturas na posição 2 de 4").
- CA18 — Editor de regra (D10, tela 10). Abre no lugar da linha (uma por vez; com alterações não salvas, as outras
  linhas ficam sem "Editar" e o cabeçalho mostra "alterações não salvas"). Campos: **Nome**; "Quando chega email que
  atende a [todas | qualquer uma] destas condições:" (`Segmented`); uma linha por condição (tipo + texto, sem texto em
  "tem anexo", botão de tirar), **Adicionar condição** (até 10) e a dica "Condições: remetente contém · destinatário ou
  Cc contém · assunto contém · corpo contém · tem anexo"; "Fazer isto:" com uma linha por ação (tipo; em "mover para a
  pasta", o destino escolhido pelo seletor da CA7 sem a INBOX), **Adicionar ação** (cada ação uma vez; "mover" e
  "apagar" se excluem) e a dica "Ações: mover para a pasta · marcar como lida · marcar com estrela · apagar (vai para a
  Lixeira) · não avisar"; "Parar aqui: não aplicar as regras de baixo"; **Salvar regra**, **Cancelar**, **Apagar regra**
  (com confirmação "Apagar a regra “X”?"). Regra nova abre no fim da lista com uma condição "Remetente contém" vazia e
  nenhuma ação (53: nenhuma regra nasce apagando). Salvar desligado, com a frase do que falta, quando a regra não
  passa no formato do 53 CA1 (nome 1–100, texto 1–200, sem CR/LF, ao menos uma condição e uma ação, sem mover junto
  com apagar) — validação na função pura `validateRuleDraft` em `rulesFormat.ts`, espelho do esquema do 53, que segue
  sendo a palavra final. Erros do `rules-set` em frase no editor: `folder-missing` "A pasta escolhida não existe mais.
  Escolha outra."; `no-trash` "A conta não tem Lixeira: apagar não fica disponível."; `pop3` (ver CA21); `invalid`
  "Confira os campos da regra."; `unavailable` grava (53 CA9) sem erro.
  Conta IMAP sem pasta `\Trash`: a ação "apagar" fica desligada no seletor com a dica "Esta conta não tem Lixeira" (N3).
- CA19 — "Executar agora" (R5, tela 10). Chama `scribe:email-rules-preview`; enquanto conta, "Contando… (pode levar
  alguns segundos quando a regra olha o corpo)". Mostra, embaixo da linha: "Executar “<nome>” agora?" e "N das T
  mensagens da Caixa de Entrada atendem à regra e serão <ações no particípio: movidas para X, marcadas como lidas,
  marcadas com estrela, levadas à Lixeira>." (T = mensagens da INBOX guardada; **[alinhar com o 53]** se o preview não
  devolver T, usa o tamanho da lista local); com "não avisar" na regra, acrescenta "“Não avisar” não muda nada em email
  que já chegou."; botões **Executar em N mensagens** e **Cancelar**. N = 0: "Nenhuma das T mensagens da Caixa de
  Entrada atende à regra." e só **Fechar**. Confirmar chama `scribe:email-rules-run` com o token; resultado em `Note`
  "Feito em N mensagens." (+ "M já tinham saído da Caixa de Entrada." quando `skipped` > 0); `stale` → "A regra ou a
  Caixa de Entrada mudou. Conte de novo." com o botão **Contar de novo**. Regra desligada também pode ser executada.
  Nenhum caminho executa sem a contagem mostrada antes.
- CA20 — Pastas (R3, D11, tela 09). Seção **Pastas** com **Nova pasta** (campo na lista, cria na raiz) e a lista na
  ordem `sidebarTree` com recuo, cada linha com o nome, "T · N não lidas" (número em pt-BR, "1.408"; "1 não lida";
  sem "não lidas" quando 0) e, para INBOX e pastas especiais, "do sistema" com cadeado e sem botões; nas outras,
  **Renomear** (no lugar) e **Apagar** (mesma confirmação da CA9, embaixo da linha). Mesmo cache e mesmas contagens do
  sidebar: mudar aqui muda lá, e vice-versa.
- CA21 — Conta POP3 (N2, tela 11). Cabeçalho do seletor com "· POP3". Regras: a nota "Conta POP3 não tem pastas no
  servidor: as regras desta conta só podem marcar como lida e não avisar. Mover, estrela e apagar ficam desligados." e,
  no editor, só "marcar como lida" e "não avisar" no seletor de ações. Pastas: no lugar da lista, "Conta POP3: o app
  mostra só Caixa de Entrada e Enviados. Para ter pastas, use IMAP nesta conta." Regra antiga com ação de IMAP mostra o
  erro `pop3` da CA17.
- CA22 — Avisos. Seção **Avisos** com "Avisar quando chega email" (o `emailNotifications` de hoje) e a descrição
  "Notificação do macOS para email novo na Caixa de Entrada. Uma regra com “não avisar” vale mais."
- CA23 — Busca ⌘F (R8, tela 12). `shared/settings-index.ts`: as três linhas de email de `contas` passam para `email`, e
  entram as linhas novas com `section` e textos iguais aos da tela: "Email › Assinatura" ("Texto que entra no fim das
  mensagens da conta. Um por conta."), "Assinatura em mensagens novas" ("Põe a assinatura ao abrir “Nova mensagem”."),
  "Assinatura em respostas e encaminhamentos" ("Põe a assinatura acima do texto citado."), "Regras" (descrição com
  "regra", "executar", "mover"), "Pastas" (com "pasta", "criar", "renomear", "apagar", "mover") e "Avisar quando chega
  email" (com "avisos", "notificação"). Cada uma é `data-setting-row` na tela (o smoke confere "linhas fora do índice").
  Buscar "regra", "regras", "executar", "pasta", "pastas", "mover", "assinatura" e "avisos" acha ao menos uma linha da
  aba Email; o resultado mostra "Email › <nome>" e abre a linha com o destaque de 2 s de hoje.

### Navegação e aviso
- CA24 — Aviso de email movido por regra (53 CA5). `EmailNavigationState` ganha `mailbox?: string`. Clicar na
  notificação de uma mensagem que a regra moveu abre a pasta destino e a mensagem pelo id novo; sem `COPYUID` (`uid:
  null`), abre a pasta destino com a nota "A mensagem foi movida para <pasta> por uma regra." Mensagens com
  `notify: false` não geram notificação (53), mas aparecem na lista da pasta onde ficaram.

### Testes e smoke
- CA25 — Testes de unidade (Vitest, `test/renderer/`), todos em funções puras:
  - `email-folder-tree.test.ts`: ordem D1 (sistema no topo, alfabética com acento, subpastas, Spam/Lixeira no fim);
    Gmail (`[Gmail]` some, filhos sobem, `\All`/`\Flagged` só no seletor); nomes da casa; breadcrumb com `/` e `.`;
    `\Noselect`; POP3.
  - `email-selection.test.ts`: ⌘, ⇧ (para cima e para baixo), Esc, troca de pasta, mensagem que sumiu da lista.
  - `email-rules-format.test.ts`: `ruleSummary` (uma e várias condições, todas/qualquer uma, cada ação, parar aqui);
    `ruleErrorText` (cada código, hoje/ontem/data); frase do preview (cada ação, 0, singular/plural, "não avisar");
    `validateRuleDraft` (cada recusa do 53 CA1).
  - `email-move-targets.test.ts`: alvos de soltura e do submenu (atual, `\Noselect`, outra conta, Rascunhos, POP3);
    recentes (até 3, sem repetir, renomear, apagar).
  - `email-organize-state.test.ts`, com eventos no formato do `scribe:email-organize` do 56: contadores, decisões na
    ordem, "decidindo", "N outras pastas", `open: null`, fim `stopped` e `done`, nota do limite (`outOfLimit`), lote
    vazio sem Desfazer, `partial-undo` e `undone`, faixa só dos lotes de hoje (virada da meia-noite), evento de outra
    conta ignorado.
  - `settings-tabs.test.ts` (atualizar): a ordem nova, ⌘6 → `email`, ⌘9 → `sobre`; `settings-index`: as linhas novas
    na aba `email` e as palavras da CA23.
  - Rotas: ida e volta do `emailPath` (CA1).
- CA26 — Smoke (servidor IMAP falso do 52/53 e o agente falso do 56). Passos que conferem:
  - a aba Email abre por ⌘6 e ⌘9 abre Sobre (atualizar o passo que hoje confere ⌘8 = Sobre);
  - o sidebar mostra a árvore com a pasta "Arquivo" do servidor falso, na ordem D1, com a contagem;
  - ⌘ clique em 3 mensagens mostra "3 selecionadas" e o resumo; mover pelo seletor (Enter) tira as 3 da INBOX e elas
    aparecem em "Arquivo"; arrastar (eventos de drag sintéticos) uma mensagem para uma pasta move; erro do servidor
    falso devolve a linha;
  - "Nova subpasta…", "Renomear…" e "Apagar pasta…" pelo clique direito (com a confirmação D11 numa pasta com
    mensagens); pasta do sistema com Renomear/Apagar desligados;
  - Configurações › Email: grava assinatura e ela aparece no Composer de uma resposta, acima da citação, com a linha de
    apoio; cria pelo editor uma regra "mover para Arquivo", o email que chega no servidor falso vai para Arquivo (o
    passo do 53 continua passando), "Executar agora" mostra a contagem certa e executa; regra com destino apagado mostra
    o "último erro";
  - painel "Organizando" alimentado pelo "Claude" falso do smoke do 56 (CA17 dele), estendido para chamar
    `informar_progresso` e `mover_emails` com uma decisão de cada veredito: contadores, Parar (`scribe:chat-stop`),
    resumo, faixa e Desfazer devolvendo as mensagens à INBOX;
  - busca "assinatura" acha as 3 linhas da tela 12.
  Prints, em claro e escuro, passando nos gates 6 e 7 (cor e forma):
  `email-pastas-light`/`-dark` (tela 01, seleção de 3), `email-mais-light`/`-dark` (02), `email-mover-light`/`-dark`
  (03), `email-menu-mensagem-light`/`-dark` (04), `email-menu-pasta-light`/`-dark` (05),
  `email-composer-assinatura-light`/`-dark` (06), `email-organizando-light`/`-dark` (07),
  `email-organizando-parado-light`/`-dark` (08), `configuracoes-email-light`/`-dark` (09),
  `configuracoes-email-regra-light`/`-dark` (10, editor aberto e o "Executar agora" de outra regra),
  `configuracoes-email-pop3-light`/`-dark` (11), `configuracoes-busca-email-light`/`-dark` (12).
  Os prints que já existem (`email-*`, `configuracoes-contas-*`) continuam; `configuracoes-contas-*` passa a sair sem o
  bloco de email.
- CA27 — Docs no mesmo contrato: `resources/assistente/guia-do-app.md` ("⌘1 a ⌘9", a aba Email, pastas, mover, regras
  "só com o app aberto", assinatura, painel "Organizando" e Desfazer). O README fica para o fechamento da feature (plan).

## Invariantes
- Caixa de Entrada e Enviados de cada conta, IDLE, envio, token de clique, `buscar_emails`, `ler_email`, contratos 51,
  52, 53, 54 e 56: comportamento igual. Sem pasta nova, sem regra e sem assinatura, a tela de email é a da 0.15.0 com a
  árvore de pastas.
- Nada sai do app sem clique: a tela não envia email; mover, apagar pasta e "Executar agora" só agem pelo clique (ou
  Enter no seletor) da pessoa; apagar pasta com mensagens e apagar regra pedem confirmação; "Executar agora" sempre
  mostra a contagem antes.
- O renderer não grava regra fora do `scribe:email-rules-set` nem executa regra fora do par preview/run com token.
- O Assistente não ganha nada neste contrato (nenhuma ferramenta, nenhum acesso a regras).
- Design: só tokens de `tokens.css` (gate 6), raio 4 ou 6, sem sombra, sem pílula (gate 7), ícones `lucide-react` pelo
  `Icon`, textos em pt-BR do mockup. Toda ação de mouse tem caminho de teclado (⇧⌘M, menus por teclado, Subir/Descer).
- Layout estreito (< 900 px) segue a regra de hoje: lista ou leitura, com "Voltar"; o resumo da seleção e o painel
  "Organizando" ocupam o lugar da leitura.
- Nenhum assunto, remetente ou corpo vai para log, settings ou "último erro".

## Fora de escopo
- Canais IPC e lógica de pastas, regras, assinatura e agente (52, 53, 54, 56).
- Cartão do lote no chat do Assistente e o progresso no chat (56).
- Mover entre contas; arrastar pasta para reordenar ou aninhar; pastas locais para POP3 (F3).
- Desfazer de mover feito à mão (só o lote do agente tem Desfazer, R11).
- Editor rico de assinatura (F2); regras no servidor (F1); condições além das da spec.
- README e arquivamento da spec (fechamento da feature).

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde nos 8 passos.
- Os 24 prints da CA26 conferidos à mão contra o mockup aprovado, tela a tela, antes de passar ao revisor.

## Telas de impacto no usuário
1. **Sidebar do email** — árvore de pastas por conta IMAP, recolhível, com não lidas; clique direito para criar,
   renomear e apagar; alvo de arrastar.
2. **Lista de mensagens** — qualquer pasta; seleção múltipla com ⌘/⇧; arrastar; clique direito com "Mover para".
3. **Leitura** — menu "Mais" com "Mover para…" e as recentes; resumo da seleção com as ações em lote.
4. **Seletor "Mover para…"** — busca, árvore, nova pasta, ⇧⌘M.
5. **Composer** — linha de apoio da assinatura no rodapé.
6. **Painel "Organizando"** — progresso ao vivo, decisões por assunto, Parar, resumo, Desfazer; faixa no topo da lista.
7. **Configurações › Email** (aba nova, ⌘6) — Contas, seletor de conta, Assinatura, Regras (lista, editor, "Executar
   agora", último erro), Pastas, Avisos; versão POP3.
8. **Configurações › Contas** — perde o bloco de email. **Plugins, Conexões e Sobre** passam para ⌘7, ⌘8 e ⌘9.
9. **Busca de Configurações** — acha as linhas novas.

Há telas novas: depois da implementação dá para gerar a apresentação do cliente com os prints reais do smoke e do teste
navegado — perguntar ao Andrew antes de gerar.

## Para alinhar com o 56
Nomes já tirados do rascunho do 56: evento `scribe:email-organize` (estado inteiro), invokes
`scribe:email-organize-state`, `scribe:email-batch-get`, `scribe:email-batch-undo`, Parar por `scribe:chat-stop`,
códigos do Desfazer (`busy`, `folder-missing`, `origin-missing`, `not-found`). Ainda em aberto:
- O evento não traz a pasta organizada (título "Organizando a <pasta>"); proposta: o 55 usa o `fromPath` dos itens do
  lote e, sem item, "a Caixa de Entrada". Alternativa: o 56 pôr `fromPath` no evento.
- O 56 D9 (cartão do lote no chat sem mockup) está **[decidir]** lá; se o Andrew pedir mockup, o cartão pode vir para cá.
- O 56 D5 (sem confirmação para lote grande) está **[decidir]** lá; se virar "Mover 120 mensagens?", o painel precisa
  mostrar esse estado de espera — hoje este contrato não o desenha.
- O smoke do 55 depende do "Claude" falso do 56 conseguir chamar `informar_progresso` com decisões dos três vereditos.

## Decisões deste contrato (confirmar com o Andrew)
- **[decidir]** `\Archive` na ordem alfabética, protegida; `\Important` escondida como `\All` (CA2).
- **[decidir]** Pastas recentes do menu "Mais" gravadas no settings (`emailRecentFolders`), não só na sessão (CA6).
- **[decidir]** Frase da senha nas Contas: manter "cifrada neste Mac" (verdadeira hoje) em vez de "Chaveiro do macOS"
  do mockup (CA15).
- "Buscar emails novos a cada" fica na seção Contas da aba Email, como hoje (o mockup não mostra a linha).
- Rótulo "Notificações de email" passa a "Avisar quando chega email", como no mockup; a busca por "notificação" continua
  achando pela descrição.
