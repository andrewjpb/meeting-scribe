# Spec — Organização do email: pastas, mover, regras e assinatura

Pedido do Andrew em 19/11/2026 13:00 (semana 2026-W47). Branch `email-organizacao`
(worktree `~/Documents/GitHub/meeting-scribe-email-organizacao`). Base: `main` 0.15.0 (c714510).
Continua a feature [email](../desktop-shell/prd-email.md) (contratos 42, 43, 45, 46/51).

## Como está hoje (0.15.0)
- O app guarda e mostra só **Caixa de Entrada** e **Enviados** (`email-store.ts`: `folder: 'inbox' | 'sent'`).
- O IMAP já lista as pastas (`imap-client.ts` `folders()`), mas só a busca do Assistente usa isso.
- Ações hoje: Responder, Responder a todos, Encaminhar, Apagar, Marcar lida.
- **Não existe**: ver outras pastas, mover email, criar pasta, regras, assinatura.
- As contas ficam em Configurações › **Contas** (`EmailSection.tsx`), junto com as outras contas.

## Objetivo
Organizar o email como no Outlook desktop: ver todas as pastas da conta, mover emails
entre elas, criar regras que agem sozinhas no email que chega e ter assinatura por conta.
Tudo configurável numa aba nova **Email** em Configurações.

## Requisitos
- R1 QUANDO a conta é IMAP, O SISTEMA DEVE mostrar no sidebar todas as pastas do servidor
  (em árvore, com contagem de não lidas), e abrir a lista de qualquer pasta (as 200 mais recentes).
- R2 QUANDO o Andrew escolhe "Mover para…" (menu "Mais", clique direito ou arrastar a mensagem
  para a pasta), O SISTEMA DEVE mover no servidor (`UID MOVE`; sem MOVE: `COPY` + `\Deleted` + `EXPUNGE`)
  e tirar a mensagem da lista na hora. Seleção de várias mensagens (⌘/⇧ clique) move todas.
- R3 O SISTEMA DEVE criar, renomear e apagar pastas da conta IMAP (clique direito no sidebar e na aba Email).
  Pastas especiais (Caixa de Entrada, Enviados, Lixeira, Spam, Rascunhos) não podem ser renomeadas nem apagadas.
- R4 QUANDO chega email novo numa conta, O SISTEMA DEVE aplicar as regras dessa conta, na ordem,
  antes de avisar. Uma regra tem condições e ações; "parar aqui" impede as regras seguintes.
  - Condições (todas ou qualquer uma): remetente contém, destinatário/Cc contém, assunto contém,
    corpo contém, tem anexo.
  - Ações: mover para pasta, marcar como lida, marcar com estrela (`\Flagged`), apagar (vai para a Lixeira),
    não avisar (sem notificação).
- R5 O SISTEMA DEVE ter "Executar agora" por regra, aplicando-a na Caixa de Entrada atual (as 200 do cache),
  mostrando antes quantas mensagens serão afetadas.
- R6 O SISTEMA DEVE guardar uma assinatura por conta (texto com quebras de linha e links), com dois interruptores:
  "em mensagens novas" e "em respostas e encaminhamentos". Ela entra no Composer acima do texto citado,
  separada por `-- `, e pode ser apagada ou editada antes de enviar.
- R7 O SISTEMA DEVE ter a aba **Email** em Configurações (⌘9), com as seções: Contas (o que hoje está em Contas),
  Assinatura, Regras, Pastas e Avisos (o interruptor de notificação que já existe). A aba Contas fica com o resto.
- R8 A busca de Configurações (⌘F) acha as linhas novas (assinatura, regras, pastas).
- R9 QUANDO o Andrew pede no Assistente ("organiza meus emails", "separa o que já foi resolvido"), O SISTEMA DEVE
  deixar o agente ler as conversas (o fio inteiro: recebidos, enviados e respostas), decidir pelo contexto se cada
  assunto está **resolvido** ou **pendente** e mover os emails para as pastas `Resolvidos` e `Pendentes`
  (criadas se faltarem). Resolvido não é só "respondido": é quando a conversa fechou o assunto.
- R10 O agente ganha as ferramentas `listar_pastas`, `criar_pasta` e `mover_emails` (IMAP), além das que já tem
  (`buscar_emails`, `ler_email`). Ele também pode mover para outras pastas quando o Andrew pedir ("põe os da ABF em ABF").
- R11 Cada organização feita pelo agente vira um **lote** com resumo (quantos foram para cada pasta e por quê, uma linha
  por assunto) e um botão **Desfazer** no chat e na tela de email, que devolve tudo para a pasta de antes.
- R12 ENQUANTO o agente organiza, O SISTEMA DEVE mostrar o trabalho ao vivo, no chat e num painel na tela de email:
  etapa atual (lendo, decidindo, movendo), contador (lidos X de Y, movidos Z), e uma linha por assunto conforme sai a
  decisão: assunto, remetente, quantos emails, veredito (Resolvido/Pendente/outra pasta), o porquê em uma frase e a
  evidência (ex.: "você respondeu em 12/11 e ele agradeceu"). Clicar na linha abre o email. Botão **Parar** interrompe
  e mantém o que já foi movido (com Desfazer).

## Regras de negócio
- N1 Regras são do app (como as "só no cliente" do Outlook): só rodam com o app aberto. A tela diz isso.
- N2 POP3 não tem pastas no servidor: a conta POP3 mostra só Caixa de Entrada e Enviados, sem mover;
  regras valem só com "marcar lida" e "não avisar". A tela diz isso no lugar das opções.
- N3 Apagar por regra nunca é `EXPUNGE` direto: vai para a Lixeira (`\Trash`). Sem Lixeira, a ação fica desligada.
- N4 O Assistente **move** email só quando o Andrew pede no chat (decisão de 19/11/2026 13:20). Ele não apaga,
  não envia e não cria regra. Tarefa agendada não move (só o pedido direto). Mover é sempre desfazível (R11).
- N7 O agente lê no máximo 200 mensagens por pedido e diz quantas ficaram de fora; na dúvida, deixa em `Pendentes`.
- N5 Regras e assinaturas ficam no settings local do app, nunca no servidor. Nenhum segredo novo.
- N6 Regra que falha (pasta sumiu, sem conexão) não some com o email: ele fica na Caixa de Entrada e a regra
  mostra "último erro" na aba Email.

## Telas de impacto no usuário
1. **Sidebar do email** — cada conta IMAP passa a mostrar todas as pastas, em árvore recolhível, com contagem.
2. **Lista de mensagens** — seleção múltipla; arrastar para pasta; clique direito com "Mover para…".
3. **Leitura** — "Mover para…" no menu "Mais".
4. **Composer** — a assinatura aparece sozinha.
5. **Painel "Organizando" na tela de email** — progresso ao vivo, decisões por assunto, Parar e Desfazer.
6. **Chat do Assistente** — progresso ao vivo e cartão do lote: "12 em Resolvidos, 5 em Pendentes", lista por assunto e botão Desfazer.
7. **Configurações › Email** (aba nova) — Contas, Assinatura, Regras (lista, editor, "Executar agora"), Pastas, Avisos.
8. **Configurações › Contas** — perde o bloco de email (vai para a aba nova).

Há telas novas: o desenho (mockup) é mostrado para aprovação antes do contrato de UI.
Depois da implementação dá para gerar a apresentação com prints reais — perguntar antes.

## Fora de escopo
- F1 Regras no servidor (Sieve/ManageSieve, regras do Gmail/Exchange).
- F2 Assinatura com imagem ou editor rico (HTML livre).
- F3 Pastas locais para POP3.
- F4 Assistente apagando email, criando regra ou movendo por tarefa agendada.
- F5 Regras disparadas pelo envio (só chegada).

## Verificação end-to-end
- Testes com o servidor IMAP falso (`fake-email.ts`): listar pastas, mover (com e sem MOVE), criar/renomear/apagar,
  regra que move/marca/apaga ao chegar, "Executar agora", assinatura no Composer,
  ferramentas do agente (mover, criar pasta, desfazer lote).
- Teste real: pedir ao Assistente "organiza minha caixa em resolvidos e pendentes" e conferir o lote e o Desfazer.
- Smoke: aba Email abre, sidebar mostra a pasta "Arquivo" do servidor falso, mover funciona.
- Teste navegado em sessão nova, com conta Gmail real (senha de app).
