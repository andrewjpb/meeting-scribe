# Spec — notificacoes-triagem

Feature: centro de notificações na barra lateral, abas de triagem no WhatsApp e agente de triagem das Automações.
Data: 2026-11-23 · Base: `6afc661` (0.23.1) · Contratos: 159–164 · Constituição: `~/CLAUDE.md` + `docs/specs/desktop-shell/design.md` + README.

## Problema e objetivo
Ver `prd.md`. Em resumo: um item "Notificações" na barra lateral com tudo que não foi lido (e-mail e WhatsApp); a lista de conversas do WhatsApp em abas por triagem; a triagem feita por um agente das Automações, acionado por mensagem nova, que só grava uma etiqueta local; e cada ação disponível por cartão no Assistente.

## Vocabulário
- **Etiqueta** de uma conversa: `{ urgente: boolean; ambito: 'pessoal' | 'profissional' | null; origem: 'agente' | 'manual'; ambitoFixo: boolean; at: number; lastMessageId: string | null; motivo?: string }` em `shared/triagem.ts`. Gravada em `userData/whatsapp/triagem.json` (`WHATSAPP_PATHS.triagem`), por `chatId`.
- **Agente de triagem**: um `Agent` comum das Automações ligado a uma `ScheduledTask` cujo `schedule.kind === 'whatsapp-message'`. "Ativo" = tarefa `enabled && !autoPaused` e agendamentos não pausados globalmente e interruptor `settings.whatsappTriagem` ligado.
- **Triagem**: uma classificação de uma conversa pelo agente (uma chamada `runClaudeOneShot`, `purpose: 'whatsapp-triagem'`).

## Requisitos

### A. Centro de notificações
- R1. QUANDO o app abre, O SISTEMA DEVE mostrar na raiz da barra lateral o item "Notificações" (`RouteId 'notificacoes'`, caminho `/notificacoes`, ícone lucide `bell`), logo abaixo de Início, com badge igual a `totalUnread(email)` + soma de `chat.unread` dos chats que contam para o badge do Dock (mesma regra de `whatsappBadgeCount`). Badge oculto quando zero.
- R2. A tela Notificações DEVE listar, em ordem decrescente de hora: (a) uma linha por conversa do WhatsApp com `unread > 0` (nome, prévia da última mensagem em 1 linha, hora, contagem "N não lidas", chip "Urgente" quando a etiqueta tiver `urgente`); (b) uma linha por e-mail `!seen` da Entrada de cada conta conectada (remetente, assunto, hora, nome da conta). Dados vêm dos stores do renderer já existentes (`features/email/emailStore.ts` folders `<conta>:inbox`, `features/whatsapp/whatsappStore.ts` chats); nenhum canal IPC novo para isso. SE as pastas de e-mail não estiverem carregadas ao abrir a tela, O SISTEMA DEVE pedi-las pelo canal existente `scribe:email-messages`.
- R3. Segmentado Todas · WhatsApp · Email (28 px) no topo; estado vazio "Nada por ler." (sem exemplo falso).
- R4. QUANDO o usuário clica numa linha de WhatsApp, O SISTEMA DEVE navegar para o WhatsApp e abrir a conversa (mesmo caminho do clique na notificação do macOS, `scribe:open-whatsapp`). QUANDO clica numa linha de e-mail, DEVE fazer o que o clique na notificação de e-mail do macOS faz hoje (`scribe:open-email`), sem alterar `EmailScreen`.
- R5. Cada linha de e-mail DEVE ter o botão "Marcar como lida" (ghost, 32 px, visível ao passar o mouse e sempre acessível por teclado) que chama o canal existente `scribe:email-mark-read`. Linhas de WhatsApp não têm essa ação (a ponte não oferece; o clique abre).
- R6. O cartão de pendências do Início (`features/inicio/CartaoPendencias.tsx`) DEVE ganhar o link "Ver notificações" para `/notificacoes`. Os números do Início não mudam de fonte.
- R7. A tela DEVE atualizar ao vivo pelos eventos que os stores já recebem (`scribe:whatsapp-message`, `scribe:whatsapp-chats-changed`, `scribe:email-message`, `scribe:email-changed`).

### B. Abas de triagem e etiqueta no WhatsApp
- R8. Entre a busca e a lista de conversas (`WhatsAppScreen.tsx`, `<aside>` de 300 px), O SISTEMA DEVE mostrar o segmentado Todas · Não lidas · Urgentes · Pessoal · Profissional (28 px, `design/Segmented.tsx`), com contagem entre parênteses em Não lidas e Urgentes quando maior que zero. Padrão: Todas. A busca filtra dentro da aba.
- R9. Filtros: Não lidas = `unread > 0`; Urgentes = `etiqueta.urgente`; Pessoal = `ambito === 'pessoal'`; Profissional = `ambito === 'profissional'`. Uma conversa urgente e profissional aparece nas duas abas.
- R10. Cada linha de conversa DEVE mostrar, à direita do nome, até dois chips retangulares (raio 4, 20 px, texto 11, tokens): "Urgente" (quando `urgente`) e o âmbito (quando definido). Urgente vem primeiro.
- R11. O cabeçalho da conversa aberta DEVE ter os controles da etiqueta: segmentado Pessoal · Profissional · Nenhum (28 px) e botão de alternância "Urgente" (32 px). Um clique grava a etiqueta com `origem:'manual'`; trocar o âmbito à mão define `ambitoFixo: true`; escolher "Nenhum" limpa o âmbito e `ambitoFixo`. Botão "Triar agora" (ghost) pede uma triagem imediata quando há agente ativo.
- R12. Estado vazio das abas Urgentes/Pessoal/Profissional: SE não há agente de triagem ativo, texto "Nenhum agente de triagem ativo. Um agente das Automações etiqueta cada conversa que recebe mensagem." + botão "Criar agente de triagem" (cria agente e tarefa a partir do modelo, R20, e navega para Automações › Tarefas) ou, se o interruptor estiver desligado, "A triagem está desligada em Configurações." + botão "Abrir Configurações". SE há agente ativo e a aba está vazia, "Nenhuma conversa aqui."
- R13. Store do renderer `features/whatsapp/triagemStore.ts`: carrega por `scribe:triagem-list`, recebe `scribe:triagem-changed {chatId, etiqueta}`, grava por `scribe:triagem-set {chatId, patch}` e pede `scribe:triagem-run {chatId}`.

### C. Agente de triagem (Automações)
- R14. `Schedule` ganha a variante `{ kind: 'whatsapp-message'; esperaSeg: number (5–600, padrão 30); grupos: boolean (padrão false) }` em `shared/automations.ts` (`SCHEDULE_KINDS`, schemas zod, `frequency.ts` do renderer com o rótulo "Quando chega mensagem do WhatsApp"). `RUN_TRIGGERS` ganha `'whatsapp'` (não conta em `AUTOMATIC_TRIGGERS` nem no limite diário de 50).
- R15. `TaskForm` DEVE oferecer o gatilho "Quando chega mensagem do WhatsApp" com os campos "Esperar N segundos depois da última mensagem" e "Incluir grupos" (Switch); a mensagem da tarefa é opcional nesse gatilho. O formulário DEVE avisar, em texto, "Esta tarefa deixa o agente ler as últimas mensagens da conversa que recebeu a mensagem, e nada mais do WhatsApp. O agente só grava uma etiqueta; não envia nem apaga."
- R16. Só pode existir **uma** tarefa `whatsapp-message` habilitada por vez: ao habilitar uma segunda, o serviço recusa com erro legível ("Já existe um agente de triagem ativo: <nome>").
- R17. Modelo pronto: `EXAMPLE_AGENTS` ganha o agente "Triagem do WhatsApp" (campos da tabela do `prd.md`, `funil: true`, `web: false`, `tarefas: false`, `model: 'haiku'`). Para instalações já semeadas, `createTriagemFromTemplate()` (serviço) cria agente + tarefa a partir do mesmo objeto; é o que o botão R12 e o cartão R24 chamam. Se já houver agente com esse nome, reaproveita-o e só cria a tarefa.
- R18. Motor (`main/whatsapp/triagem/`): `onMessage(message, chat)` ignora `fromMe`, mensagens com mais de 5 min (`INCOMING_MAX_AGE_MS`), grupos quando `grupos === false`, e conversas cujo `lastMessageId` já foi triado. Debounce por conversa de `esperaSeg`; fila com no máximo 2 triagens simultâneas; teto de 300 triagens por dia (ao atingir, registra uma execução `failed` com "Teto diário de triagens atingido" uma vez e para até o dia seguinte).
- R19. Cada triagem chama `runClaudeOneShot` com `purpose: 'whatsapp-triagem'`, `model: agent.model` (padrão haiku), timeout 30 s, `acpDir` próprio, system prompt = instruções do agente + formato de saída, entrada = últimas 12 mensagens da conversa (texto; mídia como `[imagem]`, `[áudio]`, etc.; máximo 4.000 caracteres, escapadas em `<conversa>`), mais a linha "Contato do funil de vendas: sim (empresa X) / não" quando `agent.funil` (usa `contatoLigado` movido para `shared/funil-logic.ts`). Saída zod: `{ urgente: boolean; ambito: 'pessoal'|'profissional'|'indefinido'; motivo: string ≤160 }`. Resposta inválida ou timeout = execução `failed`, etiqueta inalterada.
- R20. Aplicação do resultado: `urgente` sobrescreve sempre (exceto se o dono marcou à mão depois da última mensagem triada); `ambito` só é gravado se `!ambitoFixo`; `origem:'agente'`, `lastMessageId` da mensagem mais recente, `motivo`. QUANDO chega mensagem `fromMe`, O SISTEMA DEVE limpar `urgente` (o dono respondeu). Abrir a conversa não muda a etiqueta.
- R21. Cada triagem grava um `AutomationRun` em `schedule-runs` com `trigger: 'whatsapp'`, `prompt` curto ("Triagem da conversa <nome> · N mensagens novas", **sem** texto de mensagem), `answer` "Etiqueta: Urgente · Profissional. Motivo: …" e `model`/`costUsd` quando disponíveis. A aba Execuções mostra o gatilho como "WhatsApp".
- R22. A triagem roda também com o app bloqueado (como o atendimento); o evento `scribe:triagem-changed` só é emitido desbloqueado e o renderer relê a lista ao desbloquear. Nenhuma linha de devLog contém texto de mensagem (só `chatId` truncado, contagens e tempos).
- R23. `triagem.json` entra na limpeza de "Remover" e "Sair da conta" do WhatsApp (`main/whatsapp/service.ts`, junto de `insights.json`).

### D. Configurações
- R24a. Interruptor `whatsappTriagem: boolean` (padrão `true`) em `settings-defaults`, nos dois schemas, em `settings-index` e em Configurações › Claude, seção "Chat e resumo": nome "Triagem do WhatsApp por agente", descrição "O agente de triagem das Automações etiqueta cada conversa que recebe mensagem (urgente, pessoal, profissional). Só grava etiquetas no seu Mac; nunca envia nem apaga." Desligado: o motor não chama a IA e as abas mostram o estado vazio R12.

### E. Assistente
- R24. Cartão `triagem-agente` (`lap-acao` `{tipo:'triagem-agente', acao:'criar'|'editar'|'pausar'|'retomar', instrucoes?, esperaSeg?, grupos?}`): criar = R17; editar = troca instruções/opções da tarefa existente; pausar/retomar = `enabled` da tarefa. Clique obrigatório; cartão mostra o resumo (nome, modelo, gatilho, permissões) antes do clique. Segue o padrão do contrato 153 (`main/chat/actions.ts`, `ActionCards.tsx`, canal `scribe:chat-action-triagem`, `WHEN_LOCKED` não).
- R25. Cartão `triagem-etiqueta` (`{tipo:'triagem-etiqueta', chatId, urgente?: boolean, ambito?: 'pessoal'|'profissional'|'nenhum'}`): aplica R11 com `origem:'manual'`. O cartão mostra o nome da conversa e a etiqueta resultante.
- R26. Cartão `abrir` aceita `tela:'notificacoes'` e `tela:'whatsapp'` com `aba: 'nao-lidas'|'urgentes'|'pessoal'|'profissional'` (navega e seleciona a aba).
- R27. Fonte WhatsApp (`main/whatsapp/export.ts`): `overviewLine` ganha `etiqueta: Urgente · Profissional` (ou `—`) e o cabeçalho de `CONVERSAS-WHATSAPP.md` ganha "Urgentes: N · Pendentes de resposta: M". `AUTOMACOES.md` ganha a seção "Triagem do WhatsApp" (agente, ativo/pausado, triagens hoje, urgentes agora). O system prompt do Assistente (`main/claude-cli/chat.ts`) documenta os três cartões e orienta a responder "o que está urgente?" e "o que ficou sem resposta?" citando a fonte.

### F. Smoke e gates
- R28. `triagemChecks` depois de `atendimentoChecks` em `src/main/smoke.ts`, com o claude falso devolvendo uma etiqueta: prova R18–R21 (etiqueta gravada, `fromMe` limpa urgente, `ambitoFixo` respeitado, run gravada com `prompt` sem texto de mensagem, debounce agrupa 3 mensagens em 1 chamada). `detail` só com números e booleanos. Capturas: `notificacoes-{light,dark}`, `whatsapp-triagem-{light,dark}` (abas + chips), `whatsapp-triagem-vazio-{light,dark}`, `automacoes-tarefa-whatsapp-{light,dark}`, `assistente-cartao-triagem-{light,dark}`; todas em `SCREENS`.

## Regras de negócio
- N1. A IA só etiqueta. Nenhum caminho novo chega a `send-guard`, a mover pasta de e-mail ou a apagar nada.
- N2. "Não lidas" é determinística (`unread > 0`), nunca vem do agente.
- N3. Urgente prevalece na exibição (chip primeiro) e vale até o dono responder ou tirar.
- N4. Pessoal × profissional: contato do funil pende para profissional; o contexto da conversa decide; em dúvida, indefinido (não aparece em nenhuma das duas abas).
- N5. Etiqueta manual prevalece: âmbito fixado à mão não é alterado pelo agente; urgente manual vale até a próxima mensagem recebida.
- N6. Uma chamada por conversa com mudança; debounce; teto diário próprio; Haiku por padrão; o agente só vê a conversa que recebeu a mensagem.
- N7. Sem agente ativo ou com o interruptor desligado, nenhuma chamada à IA acontece; as etiquetas manuais continuam funcionando.
- N8. Nenhum conteúdo de mensagem em devLog, console, `prompt` de run ou `detail` do smoke.

## Telas de impacto no usuário
Ver `prd.md` (9 telas). Mockups em `mockups/` precisam do ok do Andrew antes dos contratos de UI (160, 162, 163).

## Fora de escopo
1. Marcar WhatsApp como lida sem abrir; recibos de leitura.
2. Permissão geral "Pode ler o WhatsApp" para agentes com outros gatilhos.
3. Triagem de e-mail; qualquer alteração em `main/email/*` ou `EmailScreen`.
4. Notificações do macOS novas; flyout/popover na barra; terceiro nível na barra.
5. Triagem retroativa do histórico (só "Triar agora" por conversa).
6. Grupos por padrão (opt-in na tarefa).
7. Contrato 153/154 (cartão de criar agente de atendimento) continua com a sessão principal; aqui só se segue o mesmo padrão.

## Verificação end-to-end
1. Com o claude falso do smoke e o interruptor ligado, criar o agente pelo botão "Criar agente de triagem" na aba Urgentes: agente "Triagem do WhatsApp" e tarefa com gatilho WhatsApp aparecem nas Automações.
2. Simular 3 mensagens recebidas em 10 s de um contato do funil pedindo "preciso disso hoje": uma única triagem roda após a espera; a conversa aparece em Urgentes e Profissional, com os dois chips; a aba Execuções mostra 1 execução com gatilho "WhatsApp" e `prompt` sem o texto da mensagem.
3. Responder (`fromMe`): a conversa sai de Urgentes; continua em Profissional.
4. No cabeçalho, trocar para Pessoal: nova mensagem recebida triada como profissional não muda o âmbito (`ambitoFixo`); marcar Urgente à mão aparece de imediato.
5. Notificações: badge = e-mails não lidos + não lidas do WhatsApp; a lista mostra as duas origens; clicar na conversa abre o WhatsApp nela; "Marcar como lida" num e-mail tira a linha e baixa o badge.
6. No Assistente: "marca a conversa com a Ana como urgente" gera o cartão `triagem-etiqueta`; o clique aplica; "o que está urgente no WhatsApp?" responde citando `CONVERSAS-WHATSAPP.md`; "abrir notificações" navega.
7. Desligar o interruptor: mensagem nova não gera triagem; a aba mostra "A triagem está desligada em Configurações."; "Remover" o WhatsApp apaga `triagem.json`.
8. `pnpm gates` da raiz verde; nenhum `detail` com texto de mensagem.
