# Guia do app

Este é o guia do app de reuniões, para o Assistente responder perguntas sobre o próprio app. Versão instalada: {{versao}}.

O app roda neste Mac. Ele escuta a reunião (o seu microfone e o som do Zoom, Meet, Teams ou qualquer outro app), mostra a transcrição ao vivo, traduz enquanto as pessoas falam e, no fim, entrega o resumo, as decisões e as tarefas. Não entra nenhum bot na chamada.

Cite este guia como [Guia].

## Barra lateral

A barra lateral tem, de cima para baixo: Reuniões, Assistente, Email (com o número de emails não lidos de todas as contas), Redes (só aparece com uma conta do Instagram conectada, com o número de comentários e mensagens não lidos), Automações, WhatsApp (só aparece com o WhatsApp instalado) e Configurações. Email abre um nível próprio da barra, que desliza por cima do menu: no topo, a seta "Email" volta ao menu sem sair da tela aberta; abaixo, as contas de email com as pastas. Qualquer tela de email aberta mostra esse nível. Configurações também abre um nível próprio, com a seta "Configurações" no topo e uma linha por aba; qualquer tela de Configurações mostra esse nível. O Assistente também abre um nível próprio, com a seta "Assistente" no topo e as conversas; a tela do Assistente mostra esse nível. Redes também abre um nível próprio, com a seta "Redes" no topo e as contas com as seções; qualquer tela de Redes mostra esse nível. As outras telas mostram o menu. No rodapé ficam o botão "Bloquear", o aviso de versão nova (quando há) e as permissões do microfone e do áudio do sistema.

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

Antes se chamava "Perguntar". É este chat: responde sobre as reuniões, o WhatsApp, os emails, as automações e o próprio app, e pode propor ações. As conversas ficam no nível Assistente da barra lateral: "Nova conversa" começa outra, a busca procura pelo título, as conversas aparecem agrupadas por dia, e o "…" de cada uma renomeia ou exclui. O Contexto fica à direita, sempre aberto numa conversa. A tela não tem título: no topo fica a linha da conversa, com o título (que dá para renomear), o escopo, o modelo e "Contexto", que levam à seção dele. Numa conversa nova, o Contexto abre pelo botão "Contexto".

O painel "Contexto" mostra o escopo das reuniões (todas, últimos 7 ou 30 dias, ou as escolhidas), as fontes com interruptor (WhatsApp, Email, Redes, Automações, Guia do app, Internet; o Email só aparece com conta de email, e a Redes, que vem desligada, só com conta do Instagram), as reuniões consultadas, os totais e o modelo. O estado do app (data, hora, fuso, conexões) vai sempre.

O que o Assistente faz: lê as fontes e responde citando de onde veio cada coisa; propõe ações em cartões: lembrete (uma notificação do macOS no horário, que aparece em Automações › Tarefas agendadas), resposta no WhatsApp (com o texto editável), emails (cada um num cartão com quem mandou, o assunto, a hora e a conta; o clique abre a mensagem na tela Email), rascunho de resposta por email (o destinatário, o assunto "Re:" e a conta vêm do app; o texto é editável e só sai com o clique em "Enviar", que vira "Enviado às hh:mm"), lembrete de responder um email (como os outros lembretes, com "Abrir" na mensagem), alterar a hora ou o texto de um lembrete que já existe e apagar um lembrete (cada um num cartão: "Salvar" e "Apagar lembrete" só valem no seu clique, e o que mudou aparece em Automações › Tarefas agendadas), evento no Calendário do Mac (o título, o dia e a hora, o local e a agenda, com "Editar" para ajustar antes; o app só grava quando você clica em "Pôr na agenda", e o cartão vira "Evento criado"; sem acesso ao Calendário, o cartão mostra "Pedir acesso"), tarefa agendada (abre o formulário das Automações preenchido) e botões para abrir uma tela.

Email no Assistente: ele lê os emails recebidos nos últimos 30 dias que já estão no app (com quem mandou, a idade, se foi lido e se está pendente de resposta, isto é, se você não respondeu depois) e o texto dos que já foram abertos ou baixados. Para o resto, ele tem duas ferramentas do próprio app, só de leitura: buscar emails (por remetente, destinatário, assunto, texto ou período, no que o app já tem e, nas contas IMAP, no servidor, em todas as pastas, até 50 resultados) e ler um email (o que ainda não foi baixado vem do servidor sem marcar como lido e sem entrar na Caixa de Entrada do app). Nas contas POP3, só vale o que já foi baixado. Os passos mostram "Buscando emails" e "Abrindo o email «…»". Com o app bloqueado, nada do email chega ao Assistente.

O que o Assistente não faz: não envia mensagem nem email, não marca como lido, não apaga, não cria tarefa nem evento e não muda nada sozinho: tudo passa por cartão que você confirma. Ele não altera nem apaga eventos da agenda. Toda ação precisa do seu clique no cartão, e todo envio pelo WhatsApp pede ainda a confirmação do macOS ("Enviar para <nome>?"). Ele só lê: não tem acesso a comandos do terminal nem a outras pastas do Mac.

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

Contas de email IMAP ou POP3 (para receber) e SMTP (para enviar), adicionadas em Configurações › Email (⌘6): o email e a senha (no Gmail e na Zoho com verificação em duas etapas, uma "senha de app" gerada no provedor), e o app descobre os servidores sozinho, inclusive de domínio próprio hospedado na Zoho, no Google Workspace ou no Microsoft 365, pelo MX do domínio; "Configuração avançada" mostra os servidores para editar. "Testar conexão" confere antes de adicionar.

Email, na barra lateral, abre o nível Email: a última pasta aberta na sessão (na primeira vez, a Caixa de Entrada da primeira conta) e cada conta pelo nome, com as pastas dela. Com duas contas ou mais, a seta ao lado de cada uma abre e fecha as pastas, e o app lembra o que ficou aberto; com uma conta só, as pastas ficam sempre à mostra. A seta "Email" no topo do nível volta ao menu sem fechar o email aberto. Numa conta IMAP, a barra mostra a árvore de pastas do servidor: Caixa de Entrada, Rascunhos e Enviados no topo, as suas pastas em ordem alfabética (com as subpastas, que abrem e fecham) e Spam e Lixeira no fim, cada uma com o número de não lidas; no Gmail, "Todos os e-mails" e "Com estrela" não aparecem na barra (só no "Mover para…"). Numa conta POP3, só Caixa de Entrada e Enviados (o POP3 não tem pastas no servidor). O clique direito numa pasta tem "Nova subpasta…", "Renomear…" e "Apagar pasta…"; as pastas do sistema não se renomeiam nem se apagam (aparecem com cadeado). Apagar uma pasta com mensagens pede confirmação e apaga as mensagens no servidor, sem passar pela Lixeira.

A tela tem duas colunas: a lista das mensagens da pasta aberta, com "Nova mensagem" no topo, e a leitura da mensagem escolhida, com Responder, Responder a todos, Encaminhar, Apagar, Marcar como lida ou não lida e "Mais" (com "Mover para…" e as 3 pastas usadas por último). Para mover: arraste a mensagem para uma pasta da barra lateral, use "Mover para…" (⇧⌘M), que busca a pasta pelo nome e cria uma pasta nova ali mesmo, ou o clique direito na mensagem ("Mover para ›"). ⌘ clique escolhe várias mensagens uma a uma, ⇧ clique escolhe um intervalo e Esc limpa; com duas ou mais, a leitura vira o resumo da seleção, com Mover, Marcar como lidas e Apagar. Mover não passa pelo Assistente e não tem Desfazer; se o servidor recusar, as mensagens voltam para a lista e a tela diz por quê. As imagens de fora do email só aparecem com "Carregar imagens", e os links abrem no navegador depois da confirmação. Nada é enviado sem o seu clique em "Enviar". Cada email novo vira uma notificação do macOS (dá para desligar em Configurações › Email › Avisos); o de um email que uma regra moveu abre a pasta para onde ele foi.

Convite de reunião (um email com `.ics`): a leitura mostra o cartão do convite entre o cabeçalho e o texto, com o título, a hora no fuso do Mac (e a do fuso de origem embaixo, quando é outro), a repetição, o local, o link da reunião (que abre no navegador depois da confirmação), o organizador e quantos convidados. Aceitar, Talvez e Recusar mandam a resposta ao organizador só no seu clique, pela conta que recebeu; depois, "Sua resposta" mostra o que você escolheu e dá para mudar (cada troca manda uma resposta nova). Com "Pôr na agenda" marcado, Aceitar e Talvez também gravam o evento no Calendário do Mac, na agenda escolhida ao lado (a escolha vale só para aquele convite); Recusar tira o que o app tinha posto. Nas contas Gmail e Microsoft, que já põem o convite na agenda sozinhas, a caixa vem desmarcada, e quando o evento já está lá o cartão diz "Já está na agenda" e responder não cria outro. Quando chega uma versão nova do convite, o cartão mostra o que mudou e só atualiza a agenda no clique em "Atualizar na agenda"; num cancelamento, "Tirar da agenda" aparece só para o que o app gravou, e também só sai no clique. Sem permissão de acesso ao Calendário (ou numa repetição que o app não consegue copiar), "Abrir no app de agenda" abre o convite no Calendário, que importa sozinho. A lista mostra um ícone de calendário nas mensagens com convite (com X no cancelamento). O Assistente não responde convite: só você, no cartão.

A assinatura da conta entra sozinha ao escrever (depois de "-- ", acima do texto citado, nas respostas e nos encaminhamentos). Ela é texto comum do campo: dá para editar ou apagar antes de enviar; a padrão fica em Configurações › Email › Assinatura.

Quando você pede ao Assistente para organizar o email ("organiza meus emails em resolvidos e pendentes"), a área da leitura da conta vira o painel "Organizando": o pedido, Parar, as etapas (Lendo, Decidindo, Movendo), quantas mensagens ele leu e moveu, quantas foram para Resolvidos, Pendentes e outras pastas e uma linha por assunto com o veredito, o motivo e a evidência. Clicar numa linha abre o email, e "Voltar ao andamento" traz o painel de volta. As mensagens movidas somem da lista na hora. Ele lê as 200 mensagens mais recentes da pasta; na dúvida, manda para Pendentes. Ao parar ou terminar, o painel mostra o resumo, "Desfazer as N" (devolve tudo à pasta de origem) e "Abrir no Assistente", e o topo da lista ganha a faixa "O Assistente moveu N mensagens" com Desfazer, que fica até o fim do dia ou até você fechar.

<!-- tela: redes -->
## Redes

O Instagram profissional (Business ou Creator) conectado em Configurações › Contas › Instagram, com o token gerado no painel da Meta. "Redes" só aparece na barra lateral com uma conta conectada; o clique abre o nível Redes, com cada conta pelo @ e as seções Publicações, Comentários, Mensagens e Métricas (com duas contas ou mais, a seta de cada uma abre e fecha as seções). No pé do nível, "Conectar conta…" leva a Configurações › Contas. Sem conta, a tela mostra "Nenhuma conta conectada" com o botão "Conectar conta".

Em Publicações, a fila da conta agrupada em Com erro, Rascunhos, Agendadas e Publicadas, e a cota da Meta das últimas 24 h no topo. "Nova publicação" abre o editor à direita da fila: as mídias (JPEG para imagem e carrossel de até 10; MP4 ou MOV para Reels), conferidas pelas regras do Instagram antes de entrar; a legenda, com o contador de 2.200 caracteres, hashtags e @; o texto alternativo de cada imagem; e o agendamento opcional. "Salvar rascunho" guarda; "Agendar" e "Publicar agora" só saem com o seu clique. Imagem e carrossel precisam do armazenamento de mídia (S3) configurado em Configurações › Contas; vídeo não. A publicação agendada sai na hora com o app aberto (com o app fechado, na próxima abertura). Com erro, a linha mostra o motivo e "Tentar de novo".

Em Comentários, os comentários das 25 publicações mais recentes, agrupados por publicação (a miniatura e a legenda), lidos ao abrir a seção, no "Atualizar" e de tempos em tempos (Configurações › Contas › Instagram). O número de não lidos aparece na seção, na conta e em "Redes" na raiz da barra lateral, e zera quando você abre a publicação. Em cada comentário: responder (até 2.200 caracteres), ocultar ou mostrar e excluir (com a confirmação na linha).

Em Mensagens, as conversas da caixa de mensagens diretas do Instagram e a resposta pela tela. O Instagram só aceita resposta até 24 h depois da última mensagem da pessoa: fora disso, a tela avisa antes de enviar. Se o Instagram não liberou o acesso às mensagens da conta, a seção explica como liberar ("Permitir acesso a mensagens" no app do Instagram).

Em Métricas, os números da conta (seguidores, alcance, visualizações, contas engajadas, interações, curtidas, comentários, salvamentos, compartilhamentos, seguidores ganhos e perdidos, toques nos links do perfil) nos últimos 7, 28 ou 90 dias, e a tabela das 25 publicações mais recentes, que dá para ordenar por cada coluna. Uma métrica que o Instagram não entregou aparece como "—".

Em Configurações › Contas: a seção Instagram (colar o token, a conta conectada com o tipo, os seguidores e a validade do token, "Renovar agora", "Remover" e de quanto em quanto tempo ler comentários e mensagens) e a seção Armazenamento de mídia (S3), com o endereço, o bucket, as chaves e o endereço público, "Salvar", "Testar" e "Remover". O token e a chave secreta ficam guardados cifrados neste Mac. Remover a conta apaga o token, o que estava guardado e a fila; o que já foi publicado continua no Instagram.

O Assistente e o Instagram: com a fonte "Redes" ligada no Contexto (vem desligada; só aparece com conta conectada), ele lê as contas, as 10 últimas publicações com as métricas já lidas, a fila de rascunhos e agendadas e os comentários e as mensagens não lidos. Ele escreve posts e propõe o cartão "Rascunho para o Instagram", com a legenda, o contador (caracteres, # e @) e a data planejada, quando há: "Criar rascunho" põe o rascunho, sem mídia, na fila da conta e abre o editor em Redes › Publicações, onde você escolhe as imagens e publica; "Editar" muda a legenda e a data no cartão. Com a fonte ligada, ele também lista a fila e os comentários e pode criar um rascunho direto (até com arquivos deste Mac que você indicar). O Assistente não publica, não agenda, não responde comentário nem mensagem, não oculta e não exclui nada no Instagram: tudo isso é com você, na tela Redes. Com o app bloqueado, nada do Instagram chega ao Assistente.

<!-- tela: configuracoes -->
## Configurações

Configurações… (⌘,) abre a última aba aberta. As abas ficam no nível Configurações da barra lateral, uma por linha, com o atalho ao lado; a seta "Configurações" no topo do nível volta ao menu sem sair da aba aberta. ⌘1 a ⌘9 trocam de aba (as linhas da barra lateral, na ordem: ⌘6 é Email; Plugins, Conexões e Sobre ficam em ⌘7, ⌘8 e ⌘9). A tela mostra no topo o nome da aba aberta e a busca, que acha qualquer opção pelo nome.

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

A conta Google (para guardar o áudio, a transcrição e o resumo no Google Drive, na pasta "LAP Reuniões", e para ler a agenda), a conta Microsoft (para ler a agenda do Outlook; pede só o "ID do aplicativo (cliente)" registrado no Microsoft Entra), o bloco "Agenda", o WhatsApp (experimental), o Instagram (o token da Meta e a conta conectada) e o Armazenamento de mídia (S3), onde ficam as imagens até o Instagram publicar (detalhes na seção Redes). As contas de email ficam na aba Email. Quem conectou o Google antes da agenda vê "Permitir acesso à agenda".

No bloco "Agenda": "Avisar reuniões da agenda" (ligado), "Avisar antes" (1, 5 ou 10 minutos; o padrão é 5), "Avisar se a reunião não estiver sendo gravada" (ligado) e quais agendas de cada conta o app lê (o padrão é a principal). O app só lê essas agendas (Google e Microsoft): não responde convites, não cria eventos nelas e não manda nada a ninguém. No Calendário do Mac, o Assistente propõe eventos por cartão; o app só grava quando você clica em "Pôr na agenda", e nunca apaga evento que não criou.

<!-- aba: email -->
### Email

Nesta ordem: Contas (as contas de email IMAP ou POP3, com o servidor e o estado de cada uma, "Adicionar conta", "Remover" e "Buscar emails novos a cada", que vale só para as POP3), a escolha da conta ("Assinatura, regras e pastas de …", que vale para as três seções abaixo), Assinatura, Regras, Pastas, Avisos e Convites.

Assinatura: o texto (até 2000 caracteres; links e emails viram link) e dois interruptores, "Em mensagens novas" e "Em respostas e encaminhamentos". Grava sozinho.

Regras: até 50 por conta, na ordem da lista. Cada regra tem condições (remetente, destinatário ou Cc, assunto ou corpo contém um texto, ou tem anexo; todas ou qualquer uma) e ações (mover para a pasta, marcar como lida, marcar com estrela, apagar, que leva à Lixeira, e não avisar); "Parar aqui" impede as regras de baixo. As regras são do app: agem no email que chega à Caixa de Entrada só enquanto o app está aberto. Cada regra liga e desliga sem apagar; a ordem muda arrastando pela alça ou por Subir e Descer no menu ⋯. "Executar agora" conta antes quantas mensagens da Caixa de Entrada a regra pega e só age depois do seu clique em "Executar em N mensagens". Quando uma regra não consegue agir (a pasta de destino sumiu, sem conexão), a linha mostra o último erro. Numa conta POP3, as regras só marcam como lida e não avisam.

Pastas: "Nova pasta" e a lista das pastas da conta, com o total e as não lidas, "Renomear" e "Apagar" (as do sistema não mudam). É a mesma árvore da barra lateral.

Avisos: "Avisar quando chega email" (a notificação do macOS; uma regra com "não avisar" vale mais).

Convites (vale para todas as contas): "Agenda padrão" (onde entra o convite aceito, entre as agendas do Calendário do Mac em que dá para gravar; dá para trocar em cada convite), "Pôr na agenda ao aceitar" (ligado, Aceitar e Talvez também gravam o evento), "Acesso ao Calendário do Mac" (permitido, não pedido, com "Pedir acesso", ou negado, com "Abrir Ajustes"; o app nunca apaga evento que não criou) e "Sugerir evento quando o email não tem convite".

Convite nas regras e "Sugerir evento": uma regra com a condição "É convite" e a ação "Pôr na agenda" grava o convite que chega na agenda padrão, sem responder ao organizador e sem pedir acesso ao Calendário (não existe nas contas Gmail e Microsoft, que já põem sozinhas, nem fora do Mac). "Sugerir evento" (desligado por padrão) põe um botão na leitura de um email sem convite: no seu clique, o Claude lê só o texto daquele email e propõe título, data, hora, duração e link num cartão "Sugestão — confira", com os campos editáveis; nada vai para a agenda sem o clique em "Pôr na agenda", e ninguém recebe resposta.

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
- ⌘1 a ⌘9: as abas de Configurações (as linhas do nível Configurações da barra lateral).
- No Email: ⇧⌘M move a mensagem aberta (ou as escolhidas) para outra pasta; ⌘ clique e ⇧ clique escolhem várias; Esc limpa.
- ⌘F: buscar nas reuniões.
- ⌘⇧A: analisar a gravação até agora.
- ⌘⇧L: bloquear o app.
- No Assistente: ↵ envia, ⇧↵ quebra a linha, ↑ no campo vazio edita a última pergunta.
- No WhatsApp: ⌘↵ envia (com a confirmação do macOS).

## Privacidade

As reuniões, as transcrições, as conversas do Assistente e as mensagens do WhatsApp ficam neste Mac. A transcrição usa a AssemblyAI; o resumo, a tradução e o Assistente usam o Claude da sua conta. Nada vai para o Google Drive sem a conta conectada e a opção ligada. As agendas Google e Microsoft são só lidas, pelo próprio app; a última leitura fica guardada neste Mac para funcionar sem internet. Nenhuma IA envia mensagem a ninguém, a não ser o email das tarefas em que você ligou "Pode enviar email", só para os destinatários que você permitiu.

## Bloqueio

Com uma senha (ou o Touch ID) em Configurações › Geral, o botão "Bloquear" (⌘⇧L) esconde tudo atrás de uma camada. Bloqueado, nada abre nem muda: reuniões, Assistente, Automações e WhatsApp ficam recusados até desbloquear. Uma gravação em andamento continua gravando, e as tarefas agendadas continuam rodando.
