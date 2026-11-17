# Guia do app

Este é o guia do app de reuniões, para o Assistente responder perguntas sobre o próprio app. Versão instalada: {{versao}}.

O app roda neste Mac. Ele escuta a reunião (o seu microfone e o som do Zoom, Meet, Teams ou qualquer outro app), mostra a transcrição ao vivo, traduz enquanto as pessoas falam e, no fim, entrega o resumo, as decisões e as tarefas. Não entra nenhum bot na chamada.

Cite este guia como [Guia].

## Barra lateral

A barra lateral tem, de cima para baixo: Reuniões, Assistente, Automações, WhatsApp (só aparece com o WhatsApp instalado) e Configurações. No rodapé ficam o botão "Bloquear", o aviso de versão nova (quando há) e as permissões do microfone e do áudio do sistema.

<!-- tela: reunioes -->
## Reuniões

A tela inicial. Lista as reuniões gravadas, da mais recente para a mais antiga, com a prévia do resumo. A busca (⌘F) procura no título, na transcrição e no resumo. "Nova gravação" (⌘N) começa a gravar.

<!-- tela: gravacao -->
## Gravação

A tela da reunião em andamento: a transcrição ao vivo, a tradução abaixo de cada fala (quando ligada), o nível do microfone e do áudio do sistema, e o painel de anotações (post-its). "Analisar até agora" (⌘⇧A) mostra as perguntas em aberto e o que não ficou claro até ali. "Encerrar" salva a reunião; com "Resumir ao encerrar" ligado, o Claude escreve o resumo logo depois.

<!-- tela: detalhe -->
## Detalhe da reunião

Abre ao clicar numa reunião. Tem as abas Resumo, Anotações, Assistente (um chat só sobre aquela reunião), Transcrição e Áudio. No Resumo ficam as decisões, as tarefas com responsável e as perguntas em aberto, com "Gerar de novo" e "Copiar resumo". Dá para ligar uma conversa do WhatsApp à reunião, para o resumo usar as mensagens do dia.

<!-- tela: assistente -->
## Assistente

Antes se chamava "Perguntar". É este chat: responde sobre as reuniões, o WhatsApp, as automações e o próprio app, e pode propor ações. As conversas ficam à esquerda; "Nova conversa" começa outra.

O painel "Contexto" mostra o escopo das reuniões (todas, últimos 7 ou 30 dias, ou as escolhidas), as fontes com interruptor (WhatsApp, Automações, Guia do app), as reuniões consultadas, os totais e o modelo. O estado do app (data, hora, fuso, conexões) vai sempre.

O que o Assistente faz: lê as fontes e responde citando de onde veio cada coisa; propõe ações em cartões: lembrete (uma notificação do macOS no horário, que aparece em Automações › Tarefas agendadas), resposta no WhatsApp (com o texto editável), tarefa agendada (abre o formulário das Automações preenchido) e botões para abrir uma tela.

O que o Assistente não faz: não envia mensagem, não cria tarefa e não muda nada sozinho. Toda ação precisa do seu clique no cartão, e todo envio pelo WhatsApp pede ainda a confirmação do macOS ("Enviar para <nome>?"). Ele só lê arquivos: não tem acesso à internet, a comandos do terminal nem a outras pastas do Mac.

<!-- tela: automacoes -->
## Automações

Agentes que leem as suas reuniões e respondem na hora ou no horário que você escolher. No topo, "Pedir agora": escolha um agente, escreva o pedido e ele responde na hora. Abaixo, três abas:

- Agentes: cada agente tem nome, instruções, modelo, escopo de reuniões e saída (conversa no Assistente, post-it na reunião, arquivo .md na pasta ou notificação do macOS). "Testar agora" roda sem gravar.
- Tarefas agendadas: um agente, uma mensagem e a frequência (todo dia, toda semana, todo mês, uma vez, a cada N minutos, cron ou depois de cada reunião). Os lembretes do Assistente aparecem aqui como "Lembrete", sem agente.
- Execuções: o histórico das últimas 500 execuções, com o pedido e a resposta.

"Pausar todas as tarefas" para tudo o que é automático. Uma tarefa que falha 3 vezes seguidas pausa sozinha. As tarefas rodam com o app aberto, mesmo só com o ícone na barra de menus. Os agentes só leem: não enviam nada a ninguém.

<!-- tela: whatsapp -->
## WhatsApp

Experimental e desligado por padrão. Usa um cliente não oficial do WhatsApp: o WhatsApp pode bloquear o seu número, e a LAP não tem como desfazer um bloqueio. Para ligar: Configurações › Contas › WhatsApp, aceitar o aviso, instalar (precisa do Python 3.10 ou mais novo) e ler o QR code no celular.

A tela lista as conversas e as mensagens. "Rascunho com o Claude" escreve uma resposta no campo. Nenhuma mensagem sai sem o seu clique em "Enviar" (ou ⌘↵) e a confirmação do macOS. As mensagens ficam só neste Mac; anexos aparecem só como nome e tamanho, nada é baixado.

<!-- tela: configuracoes -->
## Configurações

Configurações… (⌘,) abre a última aba aberta. ⌘1 a ⌘6 trocam de aba. A busca no topo acha qualquer opção pelo nome.

<!-- aba: geral -->
### Geral

Marca (nome do app, subtítulo e logo), tema (sistema, claro ou escuro), o que acontece ao fechar a janela (o app pode ficar na barra de menus, com as tarefas rodando), abrir ao entrar no Mac, o bloqueio (senha, Touch ID, bloquear sozinho depois de um tempo, bloquear quando o Mac bloquear a tela, pedir senha ao abrir) e as atualizações.

<!-- aba: gravacao -->
### Gravação

Microfone, cancelamento de eco, a chave da AssemblyAI (a transcrição), remover o eco do alto-falante, identificar quem fala, o idioma falado e a tradução ao vivo.

<!-- aba: claude -->
### Claude

A conexão com o Claude (pelo agente ou pela linha de comando), o caminho do claude instalado, o modelo da tradução, o modelo do chat (usado no Assistente), "Resumir ao encerrar" e o limite diário de execuções agendadas.

<!-- aba: arquivos -->
### Arquivos

"Salvar áudio e transcrição numa pasta": para cada reunião, o áudio e a transcrição em texto numa pasta do Mac. Avise as pessoas antes de gravar.

<!-- aba: contas -->
### Contas

A conta Google (para guardar o áudio, a transcrição e o resumo no Google Drive, na pasta "LAP Reuniões") e o WhatsApp (experimental).

<!-- aba: sobre -->
### Sobre

A versão instalada, a versão do Electron e do Chrome e a licença (código aberto, MIT).

## Atalhos

- ⌘N: nova gravação.
- ⌘, : Configurações.
- ⌘1 a ⌘6: as abas de Configurações.
- ⌘F: buscar nas reuniões.
- ⌘⇧A: analisar a gravação até agora.
- ⌘⇧L: bloquear o app.
- No Assistente: ↵ envia, ⇧↵ quebra a linha, ↑ no campo vazio edita a última pergunta.
- No WhatsApp: ⌘↵ envia (com a confirmação do macOS).

## Privacidade

As reuniões, as transcrições, as conversas do Assistente e as mensagens do WhatsApp ficam neste Mac. A transcrição usa a AssemblyAI; o resumo, a tradução e o Assistente usam o Claude da sua conta. Nada vai para o Google Drive sem a conta conectada e a opção ligada. Nenhuma IA envia mensagem a ninguém.

## Bloqueio

Com uma senha (ou o Touch ID) em Configurações › Geral, o botão "Bloquear" (⌘⇧L) esconde tudo atrás de uma camada. Bloqueado, nada abre nem muda: reuniões, Assistente, Automações e WhatsApp ficam recusados até desbloquear. Uma gravação em andamento continua gravando, e as tarefas agendadas continuam rodando.
