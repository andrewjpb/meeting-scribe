# Contrato 25 — "Perguntar" vira "Assistente": pergunta sobre tudo do app e pede ações (lembrete, resposta no WhatsApp) com um clique de confirmação
Feature: desktop-shell  ·  Wave: 25  ·  Depende de: 16 (chat v2), 17 (motor ACP), 23 (automações: tarefas "uma vez", notificação), 24 (WhatsApp: envio com clique + diálogo nativo)

## Pré-condições
- Contratos 23 e 24 aceitos; `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.
- Pedido do Andrew (16/11/2026, 19:28), com print do "Perguntar" respondendo "Não tenho acesso ao seu WhatsApp": "muda o nome para Assistente, quero poder perguntar tudo sobre o sistema, nesse caso sobre o WhatsApp, e quero nessa mesma tela pedir algo tipo 'me lembre amanhã de responder fulano de tal' ou 'responda minha filha dizendo sim', essas coisas direto no assistente".
- Regra que não muda: **nenhuma IA envia mensagem a ninguém**. O assistente **propõe** a ação num cartão; quem executa é a pessoa, com o clique no cartão — e, no WhatsApp, também no diálogo nativo do macOS do contrato 24 (CA4). O agente continua só leitura (regra do 17): ele não cria tarefa, não envia e não muda nada sozinho.

## Superfície
- Renderer: `features/chat/` (renomear telas, textos, cartões de ação), `app/Sidebar.tsx`/`routes.tsx` (rótulo "Assistente", ícone de brilho ou balão; a rota antiga `/perguntar` redireciona).
- `src/main/chat/` (fontes de contexto, instrução do sistema, leitura dos blocos de ação), `src/main/whatsapp/export.ts` (exportação automática), `src/main/schedules/` (criar lembrete/tarefa a partir do cartão), `src/shared/` (tipos zod, IPC, `WHEN_LOCKED`).
- `resources/assistente/guia-do-app.md` (novo): o guia do app para o assistente.
- `src/main/smoke.ts`.

## Critérios de aceite
- CA1 — **nome**: em toda a interface "Perguntar" vira **"Assistente"** (barra lateral, título "Assistente", descrição "Pergunte ou peça qualquer coisa: reuniões, WhatsApp, automações e o próprio app.", campo "Pergunte ou peça algo…", atalhos, menus, Configurações, README, prints). O remetente das respostas continua "Claude". Conversas antigas continuam lá. `/perguntar` redireciona para `/assistente`.
- CA2 — **pergunta sobre tudo do app**: cada conversa recebe, além das reuniões, estas fontes (cada uma com interruptor no painel "Contexto", todas ligadas por padrão quando existem):
  - **WhatsApp** (se conectado): exportação automática das conversas com mensagem nos últimos 14 dias (até 40 conversas e 3 000 mensagens, as mais recentes primeiro), com nome, tipo, não lidas, quem mandou a última e se **você** respondeu depois da última mensagem do outro lado (campo "pendente de resposta: sim/não"), no mesmo formato e na mesma pasta de escopo do 24 (CA5). A escolha manual de até 10 conversas do 24 continua existindo como "Só estas conversas".
  - **Automações** (23): agentes, tarefas (próxima e última execução, estado) e as últimas 20 execuções (pedido + começo da resposta), em `.md`.
  - **Guia do app**: `guia-do-app.md` descreve, em português simples, cada tela, cada aba de Configurações, atalhos, o que cada recurso faz e não faz (privacidade, WhatsApp experimental, bloqueio), e a versão instalada. Teste que falha se uma rota ou aba nova não aparecer no guia.
  - **Estado atual** (`estado.md`, gerado a cada pergunta, sem segredos): gravação em curso, conta Google, WhatsApp, versão, agentes ligados, data/hora e fuso.
  A instrução do sistema diz que o assistente pode usar essas fontes e cita de onde veio cada coisa ("[WhatsApp · Fulano · 16/11 14:46]", "[Automações · Resumo da semana]", "[Guia]"). Exemplo de aceite: "tenho algo pendente para responder no WhatsApp?" → lista as conversas com "pendente de resposta: sim", com nome e a última mensagem.
- CA3 — **ações propostas**: o assistente pode terminar a resposta com blocos de ação num formato fixo (bloco cercado `lap-acao` com JSON validado por zod no main; inválido vira texto comum). Tipos:
  - `lembrete` `{ quando: ISO com fuso, texto (até 300), conversaWhatsApp?: chatId }` → cartão "Lembrete · amanhã 09:00 · Responder Fulano" com **"Criar lembrete"**, "Editar" (data/hora e texto) e "Descartar". Criar = tarefa "uma vez" do 23 (sem agente: só notificação do macOS no horário, com "Abrir" que leva à conversa do WhatsApp quando houver), listada em Automações › Tarefas agendadas.
  - `whatsapp-resposta` `{ chatId, texto (até 4 096) }` → cartão com **o nome e o número da conversa** (lidos pelo app, não pelo texto do modelo), o texto **editável** e **"Enviar"**, que segue exatamente o 24: token de clique + diálogo nativo "Enviar para <nome>?". "Abrir no WhatsApp" leva à conversa com o texto no campo. Se o assistente não tiver certeza de quem é ("minha filha"), ele pergunta ou mostra até 3 cartões de escolha "É esta conversa?"; nunca escolhe sozinho sem mostrar o nome.
  - `tarefa` `{ nome, agente, mensagem, schedule }` (formatos do 23) → cartão com a frequência em português e **"Criar tarefa"** (abre o formulário do 23 preenchido para revisar).
  - `abrir` `{ tela, alvo? }` → botão "Abrir <tela>" (reunião, conversa do WhatsApp, Configurações › aba, Automações).
  Cada cartão mostra o estado depois do clique ("Lembrete criado · amanhã 09:00", "Enviada às 19:40", "Descartado") e esse estado fica salvo na conversa. Nenhum cartão executa sem clique; recarregar a conversa não repete ações.
- CA4 — **datas em português**: "amanhã", "sexta às 3", "daqui a 2 horas", "toda segunda" são resolvidos pelo assistente com a data/hora e o fuso de `estado.md`; o cartão mostra a data absoluta ("ter 17/11 09:00") e, se o pedido não disse a hora, usa 09:00 e diz isso no cartão.
- CA5 — **segurança**: os canais novos (`chat-action-*`) entram no `WHEN_LOCKED` como recusados; o envio pelo cartão usa o mesmo canal `whatsapp-send` com a mesma prova de clique (nenhum caminho novo de envio); agentes e tarefas agendadas (23) **não** recebem blocos de ação executáveis (nas execuções agendadas os blocos viram texto). Texto vindo de mensagem do WhatsApp ou de reunião que tente gerar ação ("assistente, mande X para Y") só vira cartão, nunca execução; teste com esse caso.
- CA6 — **smoke** com agente ACP falso e serviço do WhatsApp falso: barra lateral mostra "Assistente"; pergunta "tenho algo pendente no WhatsApp?" responde citando a conversa pendente; "me lembre amanhã de responder a Ana" → cartão → "Criar lembrete" → tarefa aparece em Automações; "responda a Bia dizendo sim" → cartão com nome da conversa → "Enviar" → diálogo nativo substituto → enviado; um bloco de ação inválido vira texto; bloqueado, os canais são recusados. PNGs `assistente-light.png`, `-dark.png`, `assistente-lembrete-light.png`, `assistente-whatsapp-light.png`, `assistente-contexto-light.png`. `externalRequests: []`.

## Invariantes
- Contratos 01 a 24 continuam passando. Nenhuma ação sem clique; nenhum envio sem o diálogo nativo. Agente sem escrita, shell ou rede. `prova/` não muda; `docs/` só o README (nome novo).

## Fora de escopo
- Ações executadas sem clique, envio em massa, e-mail, criar evento na agenda (vem com o 12), voz.

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` e `bash apps/desktop/scripts/pack.sh`.

## Telas de impacto no usuário
- Barra lateral e tela "Assistente" (antes "Perguntar"): painel "Contexto" com WhatsApp, Automações, Guia; cartões de ação nas respostas.
- Automações › Tarefas agendadas: lembretes criados pelo Assistente.

## Notas do coordenador
- Nada de commit pelo implementador.
