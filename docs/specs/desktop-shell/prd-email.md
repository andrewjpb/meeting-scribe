# PRD — Email no LAP Reuniões (IMAP/POP3/SMTP, Gmail e Outlook)
Pedido do Andrew (19/11/2026 00:14 e 00:35). Branch: `email` (worktree). Contratos 42–45.

## Problema e objetivo
O app já concentra reuniões e WhatsApp com gestão pelo Assistente. Falta o email.
Objetivo: ler e enviar email dentro do app — contas IMAP, POP3 e SMTP genéricas,
mais Gmail e Outlook pessoais via OAuth2 sobre os mesmos protocolos — com
notificações, tela própria e o Assistente gerenciando pendências e tarefas,
no mesmo desenho do WhatsApp (nada sai sem clique do Andrew).

Evidência de referência (análise do Microsoft Outlook para Mac, 19/11/2026):
Gmail no Outlook = OAuth2 em webview + IMAP/SMTP com `AUTHENTICATE XOAUTH2` em
`imap.gmail.com`/`smtp.gmail.com`; IMAP com `CAPABILITY`, `UID FETCH/SEARCH`,
`IDLE`, `APPEND`, `STARTTLS`; POP3 com `UIDL`/`RETR`/`TOP`/`DELE`; SMTP com
`EHLO`/`MAIL FROM`/`RCPT TO`/`AUTH`. Ou seja: protocolos abertos — aqui usamos
bibliotecas Node no main do Electron, sem bridge.

## Decisões técnicas
- **IMAP**: `imapflow` (mantida, mesmo autor do nodemailer; IDLE nativo). Porquê: implementar IMAP à mão não compensa.
- **SMTP**: `nodemailer`. **MIME de entrada**: `mailparser`.
- **POP3**: cliente mínimo próprio sobre `node:tls`/`node:net` (UIDL/RETR/TOP/DELE/STLS). Porquê: não há lib POP3 mantida; o protocolo é trivial e testável com servidor falso.
- **Autoconfiguração**: presets embutidos (gmail, outlook/hotmail/live, yahoo, icloud, uol, terra) → ISPDB do Thunderbird (`https://autoconfig.thunderbird.net/v1.1/<domínio>`) → manual. Porquê: é o mecanismo aberto equivalente ao autodiscover.
- **Gmail/Outlook**: mesmos IMAP/SMTP com XOAUTH2 (loopback + PKCE); client IDs ficam nas Configurações, nunca no repo.
- **Exchange/EWS/Graph**: fora desta fase (o Outlook usa autodiscover+EWS; fica para depois).
- **Segredos** (senhas, refresh tokens): `safeStorage` do Electron, guardados cifrados no settings.
- **Cache de mensagens**: store próprio em `userData` (padrão dos stores existentes), corpo sob demanda.
- Tudo no processo main, espelhando `src/main/whatsapp/` (service + client + store + IPC + settings).

## Requisitos
- R1 QUANDO o Andrew adiciona uma conta digitando email e senha, O SISTEMA DEVE descobrir servidores sozinho (preset/ISPDB) e permitir edição manual (host, porta, TLS/STARTTLS, IMAP ou POP3).
- R2 QUANDO uma conta IMAP está conectada, O SISTEMA DEVE sincronizar a INBOX (últimas 200), receber novas por IDLE e marcar lida/apagar refletindo no servidor.
- R3 QUANDO uma conta POP3 está conectada, O SISTEMA DEVE baixar novas por UIDL em intervalo configurável, mantendo-as no servidor por padrão.
- R4 QUANDO o Andrew envia/responde, O SISTEMA DEVE enviar por SMTP da conta escolhida, sem diálogo de confirmação (regra já definida no WhatsApp), e gravar o enviado na pasta de enviados (IMAP APPEND; POP3: só local).
- R5 QUANDO chega email novo, O SISTEMA DEVE notificar como no contrato 40 (foco/conversa aberta não notifica; app bloqueado = sem conteúdo; interruptor próprio).
- R6 QUANDO a conta é Gmail ou Outlook/Microsoft, O SISTEMA DEVE autenticar por OAuth2 (XOAUTH2) com renovação automática e estado visível de "reconectar" quando o refresh falhar.
- R7 QUANDO o Andrew fala com o Assistente, O SISTEMA DEVE expor emails como contexto (pendências, resumo, busca) e permitir rascunho de resposta e criação de tarefa — envio só por clique.

## Regras de negócio
- N1 Nada é enviado, apagado ou marcado sem ação explícita do Andrew (Assistente só prepara).
- N2 Conteúdo de email nunca sai da máquina, exceto o que o motor de IA já recebe nas conversas do Assistente (mesma regra do WhatsApp).
- N3 Senha/token nunca em texto puro no disco nem em log.
- N4 Erro de conexão nunca derruba o app: conta fica "com problema" e o resto segue.

## Telas de impacto no usuário
- Configurações › Contas › **Email**: lista de contas, adicionar (autoconfig + manual), testar conexão, OAuth Google/Microsoft, remover; interruptor de notificações.
- Email no **sidebar existente** (pedido do Andrew 19/11 00:52): cada conta pelo nome, expansível/retrátil, com "Caixa de Entrada" (contador de não-lidas) e "Enviados" — mesmos componentes e ícones lucide dos itens atuais. Clicar na Caixa de Entrada abre a área de email com duas colunas: lista de mensagens (remetente forte, assunto, prévia de 1 linha, hora, ponto de não-lida, avatar com iniciais, "Nova mensagem" no topo) + painel de leitura (cabeçalho e ações Responder/Responder a todos/Encaminhar/Apagar/Marcar). Estrutura do Outlook **desktop**; cores, tipografia e componentes do design system do app — nada de identidade visual da Microsoft.
- Leitura com HTML sanitizado; composição/resposta/encaminhar; anexos (baixar; enviar anexo local).
- Notificações nativas de email novo.
- Assistente: cartões de email (pendências, rascunho com botão Enviar, criar tarefa).

## Fora de escopo (desta feature inteira)
- F1 Exchange/EWS/Graph e autodiscover da Microsoft.
- F2 Pastas além de INBOX + Enviados; regras/filtros; busca no servidor além de UID SEARCH básico.
- F3 Assinaturas HTML ricas, criptografia S/MIME/PGP, convites .ics.
- F4 Responder automático pelo Assistente.

## Verificação end-to-end
1. Adicionar conta IMAP real → INBOX aparece; chega email → notificação; abrir → ler; responder → chega no destinatário; enviado aparece em Enviados.
2. Conta POP3 (ou fake no smoke): novas baixadas por poll, permanecem no servidor.
3. Gmail e Outlook por OAuth: parear, receber, enviar.
4. Assistente: "o que tenho de email pendente?" → lista; "responde pro fulano X" → rascunho no cartão → clique → enviado; "cria tarefa pra responder amanhã" → tarefa criada.

## Grafo de tarefas
| # | Microtarefa | Toca | Depende | Wave |
|---|---|---|---|---|
| 42 | Núcleo: contas, IMAP/POP3/SMTP, autoconfig, store, IPC | shared/, main/email/, settings, test/ | — | 1 |
| 43 | Telas: Configurações, tela Email, notificações, smoke | renderer/, preload, main (notif.) | 42 | 2 |
| 44 | OAuth2 Gmail + Microsoft (XOAUTH2) | main/email/, Configurações | 42, 43 | 3 |
| 45 | Assistente: contexto, cartões, tarefas | main/assistant*, renderer | 42, 43 | 4 |

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde em todo contrato.
