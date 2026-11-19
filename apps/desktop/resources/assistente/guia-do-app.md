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

Antes se chamava "Perguntar". É este chat: responde sobre as reuniões, o WhatsApp, os emails, as automações e o próprio app, e pode propor ações. As conversas ficam à esquerda; "Nova conversa" começa outra.

O painel "Contexto" mostra o escopo das reuniões (todas, últimos 7 ou 30 dias, ou as escolhidas), as fontes com interruptor (WhatsApp, Email, Automações, Guia do app, Internet; o Email só aparece com conta de email), as reuniões consultadas, os totais e o modelo. O estado do app (data, hora, fuso, conexões) vai sempre.

O que o Assistente faz: lê as fontes e responde citando de onde veio cada coisa; propõe ações em cartões: lembrete (uma notificação do macOS no horário, que aparece em Automações › Tarefas agendadas), resposta no WhatsApp (com o texto editável), emails (cada um num cartão com quem mandou, o assunto, a hora e a conta; o clique abre a mensagem na tela Email), rascunho de resposta por email (o destinatário, o assunto "Re:" e a conta vêm do app; o texto é editável e só sai com o clique em "Enviar", que vira "Enviado às hh:mm"), lembrete de responder um email (como os outros lembretes, com "Abrir" na mensagem), tarefa agendada (abre o formulário das Automações preenchido) e botões para abrir uma tela.

Email no Assistente: ele lê os emails recebidos nos últimos 30 dias que já estão no app (com quem mandou, a idade, se foi lido e se está pendente de resposta, isto é, se você não respondeu depois) e o texto dos que já foram abertos ou baixados. Para o resto, ele tem duas ferramentas do próprio app, só de leitura: buscar emails (por remetente, destinatário, assunto, texto ou período, no que o app já tem e, nas contas IMAP, no servidor, em todas as pastas, até 50 resultados) e ler um email (o que ainda não foi baixado vem do servidor sem marcar como lido e sem entrar na Caixa de Entrada do app). Nas contas POP3, só vale o que já foi baixado. Os passos mostram "Buscando emails" e "Abrindo o email «…»". Com o app bloqueado, nada do email chega ao Assistente.

O que o Assistente não faz: não envia mensagem nem email, não marca como lido, não apaga, não cria tarefa e não muda nada sozinho. Toda ação precisa do seu clique no cartão, e todo envio pelo WhatsApp pede ainda a confirmação do macOS ("Enviar para <nome>?"). Ele só lê: não tem acesso a comandos do terminal nem a outras pastas do Mac.

Internet: com a fonte "Internet" ligada no Contexto (vem ligada), o Assistente busca na web quando a pergunta pedir e cita cada página como um link [Web · site · título], que abre no navegador do Mac depois de confirmar. Ele só abre páginas que apareceram num resultado de busca feita para a mesma pergunta (os resultados de uma pergunta não valem para a seguinte) ou cujo endereço você escreveu na conversa; um endereço que o próprio Assistente pôs numa busca nunca abre; qualquer outro endereço é recusado e aparece nos passos como "Endereço bloqueado: não veio da busca". São até 10 buscas e 15 páginas por pergunta. A resposta que usou a internet mostra no rodapé "Usou a internet · N buscas · M páginas", e cada cartão de ação dela avisa para conferir antes. A fonte "Internet" controla só essa busca e a leitura de páginas: desligada, ele não busca nem lê páginas por ela. O navegador do plugin (abaixo) é independente, com o próprio interruptor ("Ativar ponte" em Configurações › Plugins). Pela linha de comando (Configurações › Claude), a fonte aparece desligada, com o aviso "Só com o motor ACP (Configurações › Claude)".

Navegador: com "Ativar ponte" ligado em Configurações › Plugins e a extensão "Controle do navegador" conectada no Chrome quando a conversa começa, o Assistente também controla uma janela própria do Chrome: abre sites em abas novas, lê a página, clica, digita, espera e fecha abas, quando a pergunta pedir (pesquisar num site, abrir um sistema web, conferir uma página). Cada ação aparece nos passos da resposta, como "Abriu site.com (aba 2)", "Leu a página", "Clicou no elemento 3" ou "Aguardou 5 s", sempre só com o nome do site, nunca o endereço inteiro. Ele não mexe nas suas abas, não digita senha (o login é com você, na janela do navegador) e trata o que está nas páginas só como dado: se uma página mandar fazer algo, ele não faz e avisa. Saiba que o navegador abre qualquer endereço http ou https sem pedir confirmação: uma página maliciosa pode tentar enganar o Assistente, e a proteção é a instrução de tratar o conteúdo das páginas como dado, não um bloqueio de endereços. Pela linha de comando (Configurações › Claude) o navegador não existe. Se a ponte cair no meio da conversa, ele diz o que fazer (ligar a ponte, abrir o Chrome com a extensão); ligada depois de a conversa começar, vale a partir da próxima conversa.

<!-- tela: automacoes -->
## Automações

Agentes que leem as suas reuniões e, se você deixar, a internet, e respondem na hora ou no horário que você escolher. No topo, "Pedir agora": escolha um agente, escreva o pedido e ele responde na hora. Abaixo, três abas:

- Agentes: cada agente tem nome, instruções, modelo, escopo de reuniões, saída (conversa no Assistente, post-it na reunião, arquivo .md na pasta ou notificação do macOS) e o interruptor "Pode pesquisar na internet" (vem desligado). Ligado, o agente busca na web e abre as páginas que encontrar, com a mesma regra do Assistente: só endereços que vieram da busca daquela mesma execução ou que você escreveu no pedido ou nas instruções (numa tarefa agendada, o formulário mostra "O agente poderá abrir: …" com os endereços da mensagem), até 10 buscas e 15 páginas por execução; o cartão do agente mostra "Internet". "Pedir agora" e as tarefas agendadas usam o que está no agente. "Testar agora" roda sem gravar.
- Tarefas agendadas: um agente, uma mensagem e a frequência (todo dia, toda semana, todo mês, uma vez, a cada N minutos, cron ou depois de cada reunião). Os lembretes do Assistente aparecem aqui como "Lembrete", sem agente. A seção "Pode enviar email" (vem desligada) deixa a tarefa enviar email sem pedir o seu clique: você escolhe a conta, a lista de destinatários permitidos (endereços exatos ou domínios como @empresa.com, que não valem para subdomínios; de 1 a 50) e o teto por execução (padrão 5, até 20). Ligar e salvar é a permissão, gravada com a data; a tarefa aparece na lista com o ícone de envio. Nas execuções dela, o agente também lê o email. Envio fora da lista, de outra conta ou acima do teto é recusado, e o que um email lido pedir nunca muda a lista. Desligar a seção, excluir a tarefa, "Pausar todas as tarefas" ou o app bloqueado cortam os envios na hora, mesmo no meio de uma execução.
- Execuções: o histórico das últimas 500 execuções, com o pedido e a resposta. Na execução de uma tarefa com "Pode enviar email", os emails enviados (para quem, assunto, hora e Message-ID) e os recusados (com o motivo); os enviados ficam também na pasta Enviados, e no fim sai a notificação "Tarefa X enviou 2 emails".

"Pausar todas as tarefas" para tudo o que é automático. Uma tarefa que falha 3 vezes seguidas pausa sozinha. As tarefas rodam com o app aberto, mesmo só com o ícone na barra de menus. Os agentes só leem (as reuniões e, se você deixar, a internet): não enviam nada a ninguém, a não ser o email de uma tarefa com "Pode enviar email" ligada, dentro do que você permitiu.

<!-- tela: whatsapp -->
## WhatsApp

Experimental e desligado por padrão. Usa um cliente não oficial do WhatsApp: o WhatsApp pode bloquear o seu número, e a LAP não tem como desfazer um bloqueio. Para ligar: Configurações › Contas › WhatsApp, aceitar o aviso, instalar (precisa do Python 3.10 ou mais novo) e ler o QR code no celular.

A tela lista as conversas e as mensagens. "Rascunho com o Claude" escreve uma resposta no campo. Nenhuma mensagem sai sem o seu clique em "Enviar" (ou ⌘↵) e a confirmação do macOS. As mensagens ficam só neste Mac; anexos aparecem só como nome e tamanho, nada é baixado.

<!-- tela: email -->
## Email

Contas de email IMAP ou POP3 (para receber) e SMTP (para enviar), adicionadas em Configurações › Contas › Email: o email e a senha (no Gmail, uma "senha de app" do Google), e o app descobre os servidores sozinho; "Configuração avançada" mostra os servidores para editar. "Testar conexão" confere antes de adicionar.

Cada conta aparece na barra lateral, abaixo dos outros itens, pelo nome; a seta abre e fecha as pastas "Caixa de Entrada" (com o número de não lidas) e "Enviados", e o app lembra o que ficou aberto. A tela tem duas colunas: a lista das mensagens, com "Nova mensagem" no topo, e a leitura da mensagem escolhida, com Responder, Responder a todos, Encaminhar, Apagar e Marcar como lida ou não lida. As imagens de fora do email só aparecem com "Carregar imagens", e os links abrem no navegador depois da confirmação. Nada é enviado sem o seu clique em "Enviar". Cada email novo vira uma notificação do macOS (dá para desligar em Contas › Email).

<!-- tela: configuracoes -->
## Configurações

Configurações… (⌘,) abre a última aba aberta. ⌘1 a ⌘8 trocam de aba. A busca no topo acha qualquer opção pelo nome.

<!-- aba: geral -->
### Geral

Marca (nome do app, subtítulo e logo), tema (sistema, claro ou escuro), o que acontece ao fechar a janela (o app pode ficar na barra de menus, com as tarefas rodando), abrir ao entrar no Mac, o bloqueio (senha, Touch ID, bloquear sozinho depois de um tempo, bloquear quando o Mac bloquear a tela, pedir senha ao abrir) e as atualizações.

<!-- aba: gravacao -->
### Gravação

Microfone, cancelamento de eco, a chave da AssemblyAI (a transcrição), remover o eco do alto-falante, identificar quem fala, o idioma falado e a tradução ao vivo.

"Avisar quando uma reunião começar" (vem ligado) fica logo abaixo de "Quem fala no Meet". No navegador, depende dele e do plugin no Chrome; em apps como Zoom, FaceTime, Slack, Teams, Webex e Discord, basta o app ligar o microfone por alguns segundos (o microfone do navegador sozinho, sem o plugin, não avisa). Ao entrar numa reunião, aparece um aviso pequeno no topo da tela, sem tirar o foco da reunião, com o título dela (num app, "Reunião no Zoom", por exemplo) e o botão "Começar a transcrever", que abre o app e começa a gravação, com o título da reunião quando a página do Meet ou do Teams tem um. A seta ao lado do botão tem "Não perguntar nesta reunião" e "Nunca perguntar" (que desliga esta opção); o "x" fecha só desta vez. Cada reunião avisa uma vez; o aviso some sozinho em 1 minuto e não aparece com uma gravação em andamento nem com o app bloqueado.

<!-- aba: claude -->
### Claude

A conexão com o Claude (pelo agente ou pela linha de comando), o caminho do claude instalado, o modelo da tradução, o modelo do chat (usado no Assistente), "Resumir ao encerrar" e o limite diário de execuções agendadas.

<!-- aba: arquivos -->
### Arquivos

"Salvar áudio e transcrição numa pasta": para cada reunião, o áudio e a transcrição em texto numa pasta do Mac. Avise as pessoas antes de gravar.

<!-- aba: contas -->
### Contas

A conta Google (para guardar o áudio, a transcrição e o resumo no Google Drive, na pasta "LAP Reuniões", e para ler a agenda), a conta Microsoft (para ler a agenda do Outlook; pede só o "ID do aplicativo (cliente)" registrado no Microsoft Entra), o bloco "Agenda", o WhatsApp (experimental) e as contas de email. Quem conectou o Google antes da agenda vê "Permitir acesso à agenda".

No bloco "Agenda": "Avisar reuniões da agenda" (ligado), "Avisar antes" (1, 5 ou 10 minutos; o padrão é 5), "Avisar se a reunião não estiver sendo gravada" (ligado) e quais agendas de cada conta o app lê (o padrão é a principal). O app só lê as agendas: não responde convites, não cria eventos e não manda nada a ninguém.

<!-- aba: plugins -->
### Plugins

Aqui ficam as extensões de navegador que vêm dentro do app. São duas, ambas para o Google Chrome. A primeira, "Quem fala no Meet", manda ao app os nomes de quem fala no Google Meet (a transcrição diz quem falou cada trecho). O cartão mostra se ela está conectada agora (fora de reunião, "Desconectado" é o normal).

"Salvar plugin…" grava a pasta "LAP Reunioes - Quem fala no Meet" na pasta que você escolher. "Como instalar" mostra o passo a passo: no Chrome, digitar `chrome://extensions` no endereço (não abre por link), ligar "Modo do desenvolvedor", clicar em "Carregar sem compactação" e escolher a pasta salva; depois recarregar a aba do Meet. Desligue o picture-in-picture automático do Meet (o mini-player esconde a reunião do plugin) e mantenha a aba do Meet aberta. Nada é baixado da internet: o plugin só fala com o app, neste computador.

Na gravação, o marcador do Meet ("Meet desconectado" ou "Meet conectado · N participantes") abre esta aba.

A segunda, "Controle do navegador", é a ponte para o app executar comandos numa janela própria do Chrome (abrir endereços em abas novas, ler a página, clicar, digitar, fechar). Age só nessa janela, com até 10 abas: não lê nem mexe nas suas abas e não digita em campo de senha. O texto das páginas volta ao app só como dado. "Ativar ponte" liga a conexão local (vem desligada); o cartão mostra "Conectado" quando a extensão está carregada no Chrome e a ponte ligada. Instala do mesmo jeito: "Salvar plugin…" grava a pasta "LAP Reunioes - Controle do navegador", e "Como instalar" mostra o passo a passo. O Assistente usa essa ponte para navegar quando a pergunta pedir (veja Assistente › Navegador).

<!-- aba: conexoes -->
### Conexões

Os servidores MCP, que dão ao Claude ferramentas de outros sistemas. Tudo começa desligado. Servidores MCP dão ao Claude acesso a outros sistemas: ligue só os que você confia. Texto de reunião pode tentar pedir ações: confira cada pedido. A fonte "Internet" do Assistente e os servidores MCP são permissões separadas.

"Do Claude CLI": os servidores que o claude instalado neste Mac já tem (claude mcp list), com o estado que o próprio CLI dá (conectado, falhou, pendente de aprovação). "Usar no app" liga um deles para o app, com os usos (chat e análise); "Testar" lista as ferramentas; "Ver detalhes" mostra a configuração com as variáveis e os cabeçalhos mascarados; "Remover" tira o servidor também do Claude CLI do terminal (pede confirmação). Os servidores de plugin não dão para usar no app; os conectores do claude.ai têm a seção própria, no fim da aba.

"Servidores do app": os que valem só aqui. "Encontrados neste Mac": os do Claude Desktop, só para importar (para o Claude CLI ou só no app; os segredos não vêm e precisam ser preenchidos).

"Adicionar servidor MCP": um comando local (stdio: comando, argumentos, pasta e variáveis) ou um endereço (HTTP: https://, ou http:// só no próprio Mac, e cabeçalhos), ou colar o JSON do Claude Desktop. Variável ou cabeçalho marcado como segredo fica cifrado neste Mac. "Testar conexão" mostra as ferramentas; só depois disso "Salvar" fica ativo. Por padrão salva no Claude CLI (vale também no terminal); dá para salvar só neste app.

Cada ferramenta tem uma regra: Perguntar (o padrão), Permitir ou Negar. Com "Perguntar", a conversa mostra o cartão "O Claude quer usar <ferramenta> de <servidor>" com os argumentos e os botões "Permitir uma vez", "Sempre permitir esta ferramenta" e "Negar"; sem resposta em 2 minutos, nega. No Assistente, o Contexto tem a linha "Conexões" para desligar um servidor só naquela conversa. Os servidores MCP só valem com o agente (ACP); a tradução e o resumo nunca usam.

"Conectores do claude.ai" (a última seção): os conectores ligados na sua conta do claude.ai (Notion, Google Drive, Gmail…), lidos do mesmo claude mcp list. Cada linha mostra "Conector do claude.ai" e o estado: Conectado, Precisa autorizar ou Com problema. Todos começam desligados, inclusive um conector novo que aparecer na conta: o agente só usa o que você ligar, um por um. Ao ligar pela primeira vez, a linha avisa "O agente poderá usar o <Nome> da sua conta do claude.ai. Cada ferramenta pergunta antes, até você mudar." Ligar ou desligar vale na próxima pergunta. Ligado, o conector vale no Assistente e no chat da reunião; a tradução, o resumo, a análise e as Automações nunca usam conector. "Ver ferramentas" (só com o conector conectado) lista as ferramentas, cada uma com Perguntar (o padrão), Permitir ou Negar, e o mesmo cartão de aprovação na conversa ("claude.ai Notion"). O rótulo "Escrita" marca as ferramentas com nome de escrita (enviar, criar, apagar, mudar): é só um aviso, a regra continua Perguntar. O login de cada conector fica no claude.ai: o app não vê nem guarda token. "Precisa autorizar": o interruptor fica travado e o link "Autorizar no claude.ai" abre claude.ai/settings/connectors no navegador. Os conectores só funcionam com o Claude logado pela assinatura: com chave de API ou outro provedor, a seção mostra só essa frase e o botão "Abrir Configurações › Claude".

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

As reuniões, as transcrições, as conversas do Assistente e as mensagens do WhatsApp ficam neste Mac. A transcrição usa a AssemblyAI; o resumo, a tradução e o Assistente usam o Claude da sua conta. Nada vai para o Google Drive sem a conta conectada e a opção ligada. As agendas Google e Microsoft são só lidas, pelo próprio app; a última leitura fica guardada neste Mac para funcionar sem internet. Nenhuma IA envia mensagem a ninguém, a não ser o email das tarefas em que você ligou "Pode enviar email", só para os destinatários que você permitiu.

## Bloqueio

Com uma senha (ou o Touch ID) em Configurações › Geral, o botão "Bloquear" (⌘⇧L) esconde tudo atrás de uma camada. Bloqueado, nada abre nem muda: reuniões, Assistente, Automações e WhatsApp ficam recusados até desbloquear. Uma gravação em andamento continua gravando, e as tarefas agendadas continuam rodando.
