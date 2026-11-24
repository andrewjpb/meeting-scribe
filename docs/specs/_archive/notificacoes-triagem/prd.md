# PRD — Centro de notificações e triagem do WhatsApp por agente

Data: 2026-11-23 · Produto: LAP Reuniões (app Electron macOS) · Base: 0.23.1

## Problema
O que precisa de atenção está espalhado: os e-mails não lidos ficam dentro do Email, as mensagens novas do WhatsApp ficam na lista de conversas, e a única visão agregada (Início) mostra números, não itens. No WhatsApp, a lista é cronológica: o que é urgente, o que é trabalho e o que é pessoal se misturam, e separar isso à mão não escala.

## Objetivo
1. **Um lugar só para o que não foi lido**: item "Notificações" na barra lateral, com badge, listando cada conversa do WhatsApp com mensagens não lidas e cada e-mail não lido da Entrada de todas as contas. Um clique abre a conversa ou o e-mail.
2. **WhatsApp organizado por triagem**: abas Todas · Não lidas · Urgentes · Pessoal · Profissional na lista de conversas, com a etiqueta visível em cada linha e trocável com um clique.
3. **Triagem feita por um agente, não por regra solta**: um "Agente de triagem do WhatsApp" das Automações, com instruções editáveis (os critérios de urgente, pessoal e profissional ficam nelas), gatilho "quando chega mensagem do WhatsApp", Haiku por padrão, execuções na aba Execuções e pausa como qualquer tarefa. A cada mensagem nova de uma conversa, o agente classifica a conversa e grava uma etiqueta local.
4. **Tudo pelo Assistente**: criar, editar e pausar o agente de triagem; mover uma conversa para uma etiqueta, marcar urgente, limpar etiqueta; abrir as Notificações; perguntar "o que está urgente no WhatsApp?" e "o que ficou sem resposta?" com citação da fonte.

## Princípios (não negociáveis)
- A IA **só etiqueta**. Nada é enviado, movido entre pastas remotas ou apagado por ela. Nenhum recibo de leitura vai ao WhatsApp.
- A etiqueta é **local** (`userData/whatsapp/triagem.json`) e **reversível com um clique**; a escolha do usuário prevalece sobre a do agente.
- A triagem pode ser **desligada em Configurações** (interruptor) e **pausada** como tarefa das Automações. Sem agente ativo, as abas Urgentes/Pessoal/Profissional ficam vazias e o app diz como criar.
- **Nenhum conteúdo de mensagem em log** (devLog, console, `detail` do smoke). O `detail` do smoke só tem números e booleanos.
- **Custo**: uma chamada curta por conversa com mudança (não por mensagem), debounce por conversa, Haiku por padrão, teto diário próprio.
- O **Email não muda**: nem `main/email/*` nem `EmailScreen` (Painel de e-mail em paralelo).

## O agente de triagem (modelo pronto "Triagem do WhatsApp")
| Campo | Valor padrão |
|---|---|
| Nome | Triagem do WhatsApp |
| Descrição | Classifica cada conversa que recebe mensagem: urgente ou não; pessoal ou profissional. |
| Modelo | haiku |
| Permissões | Pode ler o funil: **sim** (decide pessoal × profissional pelo contato/empresa). Internet: não. Tarefas: não. |
| Leitura do WhatsApp | Dada pelo gatilho: a tarefa "quando chega mensagem do WhatsApp" entrega ao agente as últimas mensagens **da conversa que recebeu a mensagem**, e nada mais. |
| Gatilho (tarefa) | Quando chega mensagem do WhatsApp · espera 30 s depois da última mensagem · só conversas de pessoa (grupos: desligado) |
| Saída | Etiqueta local da conversa: `urgente: sim/não` + `âmbito: pessoal / profissional / indefinido` + motivo curto |
| Instruções padrão | "Você faz a triagem de conversas do WhatsApp do dono do app. Para a conversa recebida, decida duas coisas. **Urgente**: sim quando a pessoa pede resposta hoje, cita prazo, pagamento, cobrança, falha em produção, saúde, segurança ou emergência, ou mandou várias mensagens seguidas sem resposta; não para conversa casual, confirmação simples ou assunto que pode esperar. **Âmbito**: profissional quando trata de trabalho, cliente, projeto, proposta, orçamento, reunião, nota fiscal ou cobrança; pessoal quando família, amigos, lazer, saúde própria ou assunto particular. Se o contato está no funil de vendas, pende para profissional, salvo contexto claro em contrário. Em dúvida, âmbito indefinido. Nunca invente fatos: use só o que está nas mensagens." |

Regras de desempate (fora das instruções, no código): **não lida** é transversal e determinística (`unread > 0`); **urgente** vale até o dono responder (mensagem `fromMe`) ou tirar à mão; **âmbito** é da relação: persiste até mudar; se o dono fixou o âmbito à mão, o agente não o altera.

## Telas de impacto no usuário
1. **Barra lateral**: item novo "Notificações" (ícone sino) logo abaixo de Início, com badge do total (e-mails não lidos + não lidas do WhatsApp, mesma regra do badge do Dock).
2. **Tela Notificações** (nova): segmentado Todas · WhatsApp · Email; lista em linhas de 44 px (quem, prévia, hora, contagem, etiqueta Urgente quando houver); clique abre; e-mail tem "Marcar como lida"; estado vazio "Nada por ler".
3. **WhatsApp — lista de conversas**: segmentado de abas Todas · Não lidas · Urgentes · Pessoal · Profissional entre a busca e a lista, com contagem em Não lidas e Urgentes; etiqueta (chip retangular 20 px) em cada linha; estado vazio das abas de triagem com botão "Criar agente de triagem".
4. **WhatsApp — cabeçalho da conversa**: controles da etiqueta (segmentado Pessoal · Profissional · — e botão Urgente), um clique para mudar ou limpar.
5. **Automações — Tarefas**: gatilho novo "Quando chega mensagem do WhatsApp" no formulário da tarefa (espera em segundos, incluir grupos); aba Execuções mostra as triagens (gatilho "WhatsApp").
6. **Automações — Agentes**: modelo pronto "Triagem do WhatsApp" disponível para criar.
7. **Configurações › Claude**: interruptor "Triagem do WhatsApp por agente".
8. **Assistente**: cartões "Criar/editar/pausar agente de triagem", "Etiquetar conversa", "Abrir Notificações"; respostas sobre urgentes e sem resposta com citação.
9. **Início**: o cartão de pendências ganha o atalho "Ver notificações".

Há telas de impacto: a apresentação do cliente pode ser gerada depois da implementação, com prints reais, se o Andrew quiser (perguntar antes).

## Fora de escopo
- Marcar conversa do WhatsApp como lida sem abrir (a ponte não oferece); recibos de leitura.
- Permissão geral "Pode ler o WhatsApp" para agentes com outros gatilhos.
- Triagem de e-mail (o Painel de e-mail cuida das sugestões de e-mail).
- Notificações do macOS novas ou diferentes das existentes; flyout/popover na barra lateral.
- Triagem retroativa de todo o histórico (só conversas que recebem mensagem a partir da ativação; o usuário pode pedir "Triar agora" por conversa no cabeçalho).

## Sucesso
- Com o agente ativo, uma mensagem nova de um contato do funil pedindo "preciso disso hoje" aparece em Urgentes e Profissional em até ~1 minuto, com uma execução na aba Execuções, sem nenhuma mensagem enviada.
- Um clique troca a etiqueta e a troca sobrevive a mensagens novas (âmbito) até o usuário mudar.
- Notificações lista todos os não lidos e o badge bate com a soma do Email e do WhatsApp.
- Gates verdes, `detail` do smoke sem texto de mensagem.
