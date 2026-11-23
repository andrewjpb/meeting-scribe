# Contrato 162 — WhatsApp: abas de triagem, chips, controles da etiqueta, estado vazio; gatilho no formulário; interruptor

Feature: notificacoes-triagem  ·  Wave: 3  ·  Depende de: 160, 161  ·  Gate humano: desenho aprovado (`mockups/png/03-*`, `04-*`, `05-*`, `06b-*`, `08-*`)

Constituição: `~/CLAUDE.md` e `docs/specs/desktop-shell/design.md`. Prevalecem sobre este contrato.

## Pré-condições
- 160 e 161 commitados (canais `scribe:triagem-*` e eventos expostos no preload; `shared/triagem.ts`; tela Notificações com `etiquetas = {}`).
- Só renderer (+ `shared/routes.ts` para o `aba` do estado de navegação). Não tocar `main/*`, `features/email/*`, `features/chat/*`, `main/smoke.ts`.

## Contexto mínimo
Desenho aprovado (mockups 03/04/05/06b/08): na coluna de conversas (`WhatsAppScreen.tsx`, `<aside>` l.1108), entre a busca (`data-whatsapp-search`) e `AtendimentoPauseBar`, entra o segmentado de triagem em **duas linhas** (3 + 2): Todas · Não lidas (N) · Urgentes (N) / Pessoal · Profissional. Em cada `ChatRow` (l.98), os chips vão na **linha da prévia**, antes da contagem de não lidas, onde o `AtendimentoChip` já fica: "Urgente" (fundo `--accent`, texto `--on-accent`) e o âmbito (fundo de superfície secundária, texto secundário); 20 px, raio 4, texto 11. Na conversa aberta, **uma barra de 44 px logo abaixo do `<header>`** (l.720) com o rótulo "Etiqueta", o segmentado Pessoal · Profissional · Nenhum (28 px), o botão de alternância "Urgente" (32 px; ligado = fundo `--accent`) e, à direita, o ghost "Triar agora" (ícone `Sparkles`). Estado vazio das abas de triagem conforme spec R12. No formulário do agendamento (`TaskForm.tsx`), a opção "Quando chega mensagem do WhatsApp" com os campos "Esperar [N] segundos depois da última mensagem" e Switch "Incluir grupos", mais o aviso em texto. Em Configurações › Claude › "Chat e resumo", a linha do interruptor.

## Superfície
- Criar `apps/desktop/src/renderer/src/features/whatsapp/triagemStore.ts` (zustand, molde de `atendimentoStore`): `etiquetas: Record<string, Etiqueta>`, `status: TriagemStatus | null`, `load()` (`scribe:triagem-list`), `set(chatId, patch)` (`scribe:triagem-set`, aplica a resposta), `runNow(chatId)` (`scribe:triagem-run`, devolve o resultado tipado), `createFromTemplate()` (`scribe:triagem-create-from-template`), `receive(evento)`; `watchTriagem()` assina `scribe:triagem-changed` e `scribe:triagem-status-changed`; `useTriagemSync()` montado no `Shell.tsx` ao lado de `useWhatsAppSync` e relendo no desbloqueio (como os outros stores fazem).
- Criar `features/whatsapp/TriagemTabs.tsx` (segmentado 3+2, `data-triagem-aba="<aba>"` no contêiner e `data-triagem-aba-opcao="<aba>"` em cada opção, contagens por `contagensAbas`) e `features/whatsapp/EtiquetaChips.tsx` (chips por `chipsDe`, `data-triagem-chip="urgente|pessoal|profissional"`), `features/whatsapp/EtiquetaBar.tsx` (barra da conversa: `data-triagem-bar`, segmentado `data-triagem-ambito`, botão `data-triagem-urgente` com `aria-pressed`, botão `data-triagem-run`).
- Alterar `features/whatsapp/WhatsAppScreen.tsx`: montar `TriagemTabs` entre a busca e a pausa do atendimento; filtrar `shown` por `naAba(chat, etiqueta, aba)` **antes** da busca; `ChatRow` recebe `etiqueta` e renderiza `EtiquetaChips`; `EtiquetaBar` sob o cabeçalho da conversa aberta (só conversa aberta); estado vazio das abas `urgentes|pessoal|profissional` (`data-triagem-vazio="sem-agente|desligado|vazio"`) com os textos e botões da spec R12 ("Criar agente de triagem" → `createFromTemplate()` e, com `ok`, `navigate(ROUTE_PATHS.automacoes, { state: { tab: 'agendamentos' } })` ou o mecanismo que o `abrir` já usa para abas das Automações; "Abrir Configurações" → aba Claude). Aba padrão `todas`; aba lida do `location.state.aba` quando houver (ver abaixo).
- Alterar `apps/desktop/src/shared/routes.ts`: `WhatsAppNavigationState` ganha `aba?: TriagemAba`.
- Alterar `features/notificacoes/notificacoesSelectors.ts`: `etiquetas` passa a vir do `triagemStore` (o chip Urgente do 160 passa a funcionar).
- Alterar `features/schedules/frequency.ts` (`FREQUENCY_OPTIONS` ganha `{ value: 'whatsapp-message', label: 'Quando chega mensagem do WhatsApp' }` antes de "Avançado") e `features/schedules/TaskForm.tsx`: no `switch` dos campos da frequência, o caso `whatsapp-message` com `<input type="number" min=5 max=600>` (`data-task-espera`) rotulado "Esperar … segundos depois da última mensagem", `Switch` "Incluir grupos" (`data-task-grupos`), o parágrafo de aviso (`data-task-whatsapp-aviso`, texto exato da spec R15), e a seção "Próximas 5 execuções" escondida para esse gatilho (não há próxima por relógio); a mensagem da tarefa fica opcional nesse gatilho (sem erro de validação por mensagem vazia). Erro de unicidade vindo do save (CA7 do 161) aparece em `data-task-form-error`.
- Alterar `features/schedules/RunsTab.tsx` só se o detalhe da execução não mostrar o gatilho: o detalhe passa a mostrar "Gatilho: WhatsApp" (via `RUN_TRIGGER_LABELS`) para todas as runs (mockup 06b). Se já mostra, não mexer.
- Alterar `features/settings/SettingsScreen.tsx`: `SettingRow name={WHATSAPP_TRIAGEM_NAME} nameId="settings-whatsapp-triagem" description={WHATSAPP_TRIAGEM_DESCRIPTION}` com `Switch` ligado a `settings.whatsappTriagem`, logo depois da linha "Detalhes com IA no WhatsApp" (l.444).
- Testes: `apps/desktop/test/renderer/triagem-store.test.ts` (store com `__scribeApi` falso), acréscimo em testes de renderer do WhatsApp/TaskForm se existirem (filtro por aba; opção nova no seletor).

## Comportamento
1. Filtro: `shown = chats.filter(c => naAba(c, etiquetas[c.id] ?? null, aba)).filter(busca)`; contagens das abas sobre todos os chats (não sobre a busca).
2. Clique num chip da linha não faz nada (só exibição). Na barra: escolher Pessoal/Profissional → `set(chatId, { ambito })`; Nenhum → `set(chatId, { ambito: null })`; Urgente → `set(chatId, { urgente: !atual })`; "Triar agora" → `runNow(chatId)`; resultado `ok:false` mostra texto curto inline (`data-triagem-run-erro`): `sem-agente` → "Nenhum agente de triagem ativo.", `desligado` → "A triagem está desligada em Configurações.", `pausado` → "O agente de triagem está pausado.", `sem-mensagens` → "Nada para triar nesta conversa.", `teto` → "Teto diário de triagens atingido.", `ocupado` → "Já há uma triagem desta conversa em andamento.". Enquanto roda, botão `disabled` e texto "Triando…".
3. `EtiquetaBar` só aparece em conversas de pessoa **e** de grupo (a etiqueta manual vale para os dois); o "Triar agora" fica `disabled` com `title` explicativo quando o status diz que grupos não entram (`status.ativo && !grupos`); o renderer não sabe `grupos` → se o status não trouxer, deixar habilitado e o main responde `sem-agente`/erro tipado. (Se o 161 expuser `grupos` em `TriagemStatus`, usar.)
4. `location.state.aba` (vindo do cartão `abrir` do 163 ou de link interno) seleciona a aba ao entrar; sem ele, `todas`. Trocar de aba não persiste.
5. Estado vazio: prioridade `desligado` > `sem-agente` > `vazio` (igual ao `status.motivo`). Com `status === null` (ainda carregando), mostrar "Nenhuma conversa aqui." sem botão.
6. `TaskForm` com `whatsapp-message`: `scheduleOf(draft)` monta `{ kind, esperaSeg, grupos }`; `esperaSeg` fora de 5–600 mostra erro inline e bloqueia salvar; a prévia de execuções some; o campo "Mensagem" mostra o texto de ajuda "Opcional neste gatilho: o agente recebe a conversa que chegou." (`data-task-message-help`).

## Critérios de aceite
- CA1: Com 4 chats como no CA5 do 159, a aba Todas lista 4; Não lidas lista 2 e mostra "(2)"; Urgentes lista 1 e mostra "(1)"; Pessoal 1; Profissional 1; a busca por nome dentro de Urgentes filtra só entre os urgentes. (`data-triagem-aba-opcao` + `data-whatsapp-chat`.)
- CA2: A linha do chat urgente profissional tem `data-triagem-chip="urgente"` **antes** de `data-triagem-chip="profissional"` na mesma linha da prévia; a linha sem etiqueta não tem chip; o nome não trunca mais do que hoje em 300 px (chips não ficam na linha do nome).
- CA3: Na conversa aberta, clicar "Pessoal" chama `scribe:triagem-set` com `{ chatId, patch: { ambito: 'pessoal' } }` e o segmentado reflete a resposta; "Nenhum" envia `{ ambito: null }`; "Urgente" alterna e envia `{ urgente: <novo> }` com `aria-pressed` correto; "Triar agora" chama `scribe:triagem-run` e, com `{ok:false,error:'sem-agente'}`, mostra "Nenhum agente de triagem ativo." em `data-triagem-run-erro`.
- CA4: Evento `scribe:triagem-changed { chatId, etiqueta }` atualiza chips e barra sem reload; `scribe:triagem-status-changed` troca o estado vazio.
- CA5: Aba Urgentes vazia com `status.motivo === 'sem-agente'` mostra o texto da R12 e o botão "Criar agente de triagem" (`data-triagem-criar`); clique chama `scribe:triagem-create-from-template` e, com `ok`, navega para Automações › Agendamentos. Com `motivo === 'desligado'`, texto "A triagem está desligada em Configurações." e botão "Abrir Configurações" (`data-triagem-configuracoes`) que vai à aba Claude. Com agente ativo e aba vazia: "Nenhuma conversa aqui.".
- CA6: `TaskForm` com o seletor em "Quando chega mensagem do WhatsApp" mostra `data-task-espera` (valor 30 por padrão), `data-task-grupos` (desligado), `data-task-whatsapp-aviso` com o texto exato da R15, esconde `data-task-preview`, e salvar com mensagem vazia não dá erro; `esperaSeg = 4` dá erro inline e não salva. Editar uma tarefa existente `whatsapp-message` reabre com os valores dela.
- CA7: Configurações › Claude mostra `#settings-whatsapp-triagem` com o `Switch` refletindo `settings.whatsappTriagem`; desligar chama `update({ whatsappTriagem: false })`. O smoke que confere "toda linha da tela está no índice" continua verde (a entrada já existe desde o 159).
- CA8: Notificações: com etiqueta urgente numa conversa com não lidas, a linha dela mostra o chip "Urgente" (o 160 já desenhou; aqui passa a ser alimentado).
- CA9: Gates rápidos verdes; `triagem-store.test.ts` cobre `load`, `set`, `receive` e `runNow` com erro tipado.

## Invariantes
- Sem cor literal, sombra, pílula ou raio > 6 (gates 6 e 7). Alturas: segmentado 28, botões 32, barra 44, chips 20.
- `features/whatsapp/WhatsAppScreen.tsx`: comportamento existente de busca, abertura de conversa (`open` zera `unread`), painel Detalhes, atendimento e envio inalterados (`data-*` existentes preservados; o smoke `whatsappChecks` e `atendimentoChecks` continuam verdes — será conferido no gate completo do fim da wave).
- Nenhum envio novo: nada em `features/whatsapp/triagem*`/`Etiqueta*` chama `scribe:whatsapp-send`.
- `git diff --stat` não mostra `main/`, `preload/`, `features/email/`, `features/chat/`.

## Fora de escopo desta tarefa
- Cartões do Assistente e `OPEN_SCREENS` (163); smoke, prints e docs (164); mudanças no motor (161).

## Gates
- `pnpm --filter desktop typecheck && pnpm --filter desktop lint && pnpm --filter desktop test` (da raiz). O gate completo (`pnpm gates`, smoke) roda ao fim da wave 3, pelo coordenador.

## Relatório esperado
≤ 35 linhas: arquivos, contagem de testes, como ficou a navegação para Automações › Agendamentos e Configurações › Claude, decisões onde houve escolha, cláusulas não cumpridas.

## Adendo (depois do 161)
- `scribe:tasks-toggle` agora devolve `TaskToggleResult = ScheduledTask | null | { ok: false; error: TriagemUnicaError }`. `features/schedules/SchedulesTab.tsx` (~l.120) deve tratar `{ ok: false }`: o interruptor volta ao estado anterior e a frase do erro aparece inline na linha da tarefa (`data-task-toggle-error`), sumindo ao trocar de tarefa ou em 6 s. Acrescente também a chave da frase da unicidade a `TASK_ERRORS` (ou trate `TriagemUnicaError` como texto literal) para o `TaskForm` não mostrar o genérico "invalid" (CA6 passa a cobrir isso).
