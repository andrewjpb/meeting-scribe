# Guia do app

Este é o guia do app de reuniões, para o Assistente responder perguntas sobre o próprio app. Versão instalada: {{versao}}.

O app roda neste Mac. Ele escuta a reunião (o seu microfone e o som do Zoom, Meet, Teams ou qualquer outro app), mostra a transcrição ao vivo, traduz enquanto as pessoas falam e, no fim, entrega o resumo, as decisões e as tarefas. Não entra nenhum bot na chamada.

Cite este guia como [Guia].

## Barra lateral

A barra lateral tem, de cima para baixo: Reuniões, Assistente, Automações, WhatsApp (só aparece com o WhatsApp instalado) e Configurações. No rodapé ficam o botão "Bloquear", o aviso de versão nova (quando há) e as permissões do microfone e do áudio do sistema.

<!-- tela: reunioes -->
## Reuniões

A tela inicial. Lista as reuniões gravadas, da mais recente para a mais antiga, com a prévia do resumo. A busca (⌘F) procura no título, na transcrição e no resumo. "Nova gravação" (⌘N) começa a gravar.

Com a agenda Google ou Microsoft conectada (Configurações › Contas), o topo mostra "Próximas": até 3 reuniões da agenda das próximas 24 horas, com a hora, o título, os participantes, "Entrar na chamada" (abre o Meet, Teams ou Zoom no navegador) e "Gravar". A gravação que começa perto de uma reunião da agenda (até 10 minutos antes ou durante) leva o título do evento, e a reunião salva guarda os participantes: a lista e o detalhe mostram os nomes ("Da agenda: Google · 14:00"), e o resumo usa esses nomes para dizer quem é quem, sem inventar.

### Avisos da agenda

Com a agenda conectada, o app avisa por notificação do macOS: "Reunião em 5 min: <título>" (o tempo se escolhe em Configurações › Contas › Agenda: 1, 5 ou 10 minutos), com o botão "Gravar"; 2 minutos depois do início, se nada estiver gravando, "A reunião … começou e não está sendo gravada." (repete uma vez aos 10 minutos), também com uma faixa no topo do app com "Gravar" e "Ignorar"; e, se uma reunião já avisada for cancelada, "A reunião … foi cancelada." Nada grava sozinho: só com o seu clique. Com o app bloqueado, a notificação não mostra o título nem os participantes.

<!-- tela: gravacao -->
## Gravação

A tela da reunião em andamento: a transcrição ao vivo, a tradução abaixo de cada fala (quando ligada), o nível do microfone e do áudio do sistema, e o painel de anotações (post-its). "Analisar até agora" (⌘⇧A) mostra as perguntas em aberto e o que não ficou claro até ali. "Encerrar" salva a reunião; com "Resumir ao encerrar" ligado, o Claude escreve o resumo logo depois.

<!-- tela: detalhe -->
## Detalhe da reunião

Abre ao clicar numa reunião. Tem as abas Resumo, Anotações, Assistente (um chat só sobre aquela reunião), Transcrição e Áudio. No Resumo ficam as decisões, as tarefas com responsável e as perguntas em aberto, com "Gerar de novo" e "Copiar resumo". Dá para ligar uma conversa do WhatsApp à reunião, para o resumo usar as mensagens do dia.

<!-- tela: assistente -->
## Assistente

Antes se chamava "Perguntar". É este chat: responde sobre as reuniões, o WhatsApp, as automações e o próprio app, e pode propor ações. As conversas ficam à esquerda; "Nova conversa" começa outra.

O painel "Contexto" mostra o escopo das reuniões (todas, últimos 7 ou 30 dias, ou as escolhidas), as fontes com interruptor (WhatsApp, Automações, Guia do app, Internet), as reuniões consultadas, os totais e o modelo. O estado do app (data, hora, fuso, conexões) vai sempre.

O que o Assistente faz: lê as fontes e responde citando de onde veio cada coisa; propõe ações em cartões: lembrete (uma notificação do macOS no horário, que aparece em Automações › Tarefas agendadas), resposta no WhatsApp (com o texto editável), tarefa agendada (abre o formulário das Automações preenchido) e botões para abrir uma tela.

O que o Assistente não faz: não envia mensagem, não cria tarefa e não muda nada sozinho. Toda ação precisa do seu clique no cartão, e todo envio pelo WhatsApp pede ainda a confirmação do macOS ("Enviar para <nome>?"). Ele só lê: não tem acesso a comandos do terminal nem a outras pastas do Mac.

Internet: com a fonte "Internet" ligada no Contexto (vem ligada), o Assistente busca na web quando a pergunta pedir e cita cada página como um link [Web · site · título], que abre no navegador do Mac depois de confirmar. Ele só abre páginas que apareceram num resultado de busca feita para a mesma pergunta (os resultados de uma pergunta não valem para a seguinte) ou cujo endereço você escreveu na conversa; um endereço que o próprio Assistente pôs numa busca nunca abre; qualquer outro endereço é recusado e aparece nos passos como "Endereço bloqueado: não veio da busca". São até 10 buscas e 15 páginas por pergunta. A resposta que usou a internet mostra no rodapé "Usou a internet · N buscas · M páginas", e cada cartão de ação dela avisa para conferir antes. Desligando a fonte, ele não acessa a internet. Pela linha de comando (Configurações › Claude), a fonte aparece desligada, com o aviso "Só com o motor ACP (Configurações › Claude)".

<!-- tela: automacoes -->
## Automações

Agentes que leem as suas reuniões e, se você deixar, a internet, e respondem na hora ou no horário que você escolher. No topo, "Pedir agora": escolha um agente, escreva o pedido e ele responde na hora. Abaixo, três abas:

- Agentes: cada agente tem nome, instruções, modelo, escopo de reuniões, saída (conversa no Assistente, post-it na reunião, arquivo .md na pasta ou notificação do macOS) e o interruptor "Pode pesquisar na internet" (vem desligado). Ligado, o agente busca na web e abre as páginas que encontrar, com a mesma regra do Assistente: só endereços que vieram da busca daquela mesma execução ou que você escreveu no pedido ou nas instruções (numa tarefa agendada, o formulário mostra "O agente poderá abrir: …" com os endereços da mensagem), até 10 buscas e 15 páginas por execução; o cartão do agente mostra "Internet". "Pedir agora" e as tarefas agendadas usam o que está no agente. "Testar agora" roda sem gravar.
- Tarefas agendadas: um agente, uma mensagem e a frequência (todo dia, toda semana, todo mês, uma vez, a cada N minutos, cron ou depois de cada reunião). Os lembretes do Assistente aparecem aqui como "Lembrete", sem agente.
- Execuções: o histórico das últimas 500 execuções, com o pedido e a resposta.

"Pausar todas as tarefas" para tudo o que é automático. Uma tarefa que falha 3 vezes seguidas pausa sozinha. As tarefas rodam com o app aberto, mesmo só com o ícone na barra de menus. Os agentes só leem (as reuniões e, se você deixar, a internet): não enviam nada a ninguém.

<!-- tela: whatsapp -->
## WhatsApp

Experimental e desligado por padrão. Usa um cliente não oficial do WhatsApp: o WhatsApp pode bloquear o seu número, e a LAP não tem como desfazer um bloqueio. Para ligar: Configurações › Contas › WhatsApp, aceitar o aviso, instalar (precisa do Python 3.10 ou mais novo) e ler o QR code no celular.

A tela lista as conversas e as mensagens. "Rascunho com o Claude" escreve uma resposta no campo. Nenhuma mensagem sai sem o seu clique em "Enviar" (ou ⌘↵) e a confirmação do macOS. As mensagens ficam só neste Mac; anexos aparecem só como nome e tamanho, nada é baixado.

<!-- tela: configuracoes -->
## Configurações

Configurações… (⌘,) abre a última aba aberta. ⌘1 a ⌘8 trocam de aba. A busca no topo acha qualquer opção pelo nome.

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

A conta Google (para guardar o áudio, a transcrição e o resumo no Google Drive, na pasta "LAP Reuniões", e para ler a agenda), a conta Microsoft (para ler a agenda do Outlook; pede só o "ID do aplicativo (cliente)" registrado no Microsoft Entra), o bloco "Agenda" e o WhatsApp (experimental). Quem conectou o Google antes da agenda vê "Permitir acesso à agenda".

No bloco "Agenda": "Avisar reuniões da agenda" (ligado), "Avisar antes" (1, 5 ou 10 minutos; o padrão é 5), "Avisar se a reunião não estiver sendo gravada" (ligado) e quais agendas de cada conta o app lê (o padrão é a principal). O app só lê as agendas: não responde convites, não cria eventos e não manda nada a ninguém.

<!-- aba: plugins -->
### Plugins

As extensões de navegador que vêm dentro do app. Hoje uma: "Quem fala no Meet", para o Google Chrome, que manda ao app os nomes de quem fala no Google Meet (a transcrição diz quem falou cada trecho). O cartão mostra se ela está conectada agora (fora de reunião, "Desconectado" é o normal).

"Salvar plugin…" grava a pasta "LAP Reunioes - Quem fala no Meet" na pasta que você escolher. "Como instalar" mostra o passo a passo: no Chrome, digitar `chrome://extensions` no endereço (não abre por link), ligar "Modo do desenvolvedor", clicar em "Carregar sem compactação" e escolher a pasta salva; depois recarregar a aba do Meet. Desligue o picture-in-picture automático do Meet (o mini-player esconde a reunião do plugin) e mantenha a aba do Meet aberta. Nada é baixado da internet: o plugin só fala com o app, neste computador.

Na gravação, o marcador do Meet ("Meet desconectado" ou "Meet conectado · N participantes") abre esta aba.

<!-- aba: conexoes -->
### Conexões

Os servidores MCP, que dão ao Claude ferramentas de outros sistemas. Tudo começa desligado. Servidores MCP dão ao Claude acesso a outros sistemas: ligue só os que você confia. Texto de reunião pode tentar pedir ações: confira cada pedido. A fonte "Internet" do Assistente e os servidores MCP são permissões separadas.

"Do Claude CLI": os servidores que o claude instalado neste Mac já tem (claude mcp list), com o estado que o próprio CLI dá (conectado, falhou, pendente de aprovação). "Usar no app" liga um deles para o app, com os usos (chat e análise); "Testar" lista as ferramentas; "Ver detalhes" mostra a configuração com as variáveis e os cabeçalhos mascarados; "Remover" tira o servidor também do Claude CLI do terminal (pede confirmação). Os conectores do claude.ai não dão para usar no app.

"Servidores do app": os que valem só aqui. "Encontrados neste Mac": os do Claude Desktop, só para importar (para o Claude CLI ou só no app; os segredos não vêm e precisam ser preenchidos).

"Adicionar servidor MCP": um comando local (stdio: comando, argumentos, pasta e variáveis) ou um endereço (HTTP: https://, ou http:// só no próprio Mac, e cabeçalhos), ou colar o JSON do Claude Desktop. Variável ou cabeçalho marcado como segredo fica cifrado neste Mac. "Testar conexão" mostra as ferramentas; só depois disso "Salvar" fica ativo. Por padrão salva no Claude CLI (vale também no terminal); dá para salvar só neste app.

Cada ferramenta tem uma regra: Perguntar (o padrão), Permitir ou Negar. Com "Perguntar", a conversa mostra o cartão "O Claude quer usar <ferramenta> de <servidor>" com os argumentos e os botões "Permitir uma vez", "Sempre permitir esta ferramenta" e "Negar"; sem resposta em 2 minutos, nega. No Assistente, o Contexto tem a linha "Conexões" para desligar um servidor só naquela conversa. Os servidores MCP só valem com o agente (ACP); a tradução e o resumo nunca usam.

<!-- aba: sobre -->
### Sobre

A versão instalada, a versão do Electron e do Chrome e a licença (código aberto, MIT).

## Atalhos

- ⌘N: nova gravação.
- ⌘, : Configurações.
- ⌘1 a ⌘8: as abas de Configurações.
- ⌘F: buscar nas reuniões.
- ⌘⇧A: analisar a gravação até agora.
- ⌘⇧L: bloquear o app.
- No Assistente: ↵ envia, ⇧↵ quebra a linha, ↑ no campo vazio edita a última pergunta.
- No WhatsApp: ⌘↵ envia (com a confirmação do macOS).

## Privacidade

As reuniões, as transcrições, as conversas do Assistente e as mensagens do WhatsApp ficam neste Mac. A transcrição usa a AssemblyAI; o resumo, a tradução e o Assistente usam o Claude da sua conta. Nada vai para o Google Drive sem a conta conectada e a opção ligada. As agendas Google e Microsoft são só lidas, pelo próprio app; a última leitura fica guardada neste Mac para funcionar sem internet. Nenhuma IA envia mensagem a ninguém.

## Bloqueio

Com uma senha (ou o Touch ID) em Configurações › Geral, o botão "Bloquear" (⌘⇧L) esconde tudo atrás de uma camada. Bloqueado, nada abre nem muda: reuniões, Assistente, Automações e WhatsApp ficam recusados até desbloquear. Uma gravação em andamento continua gravando, e as tarefas agendadas continuam rodando.
