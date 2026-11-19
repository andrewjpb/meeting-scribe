# Contrato 43 — Telas de email no estilo do Outlook + notificações
Feature: desktop-shell · Wave: 2 · Depende de: 42 · PRD: `docs/specs/desktop-shell/prd-email.md`

## Pré-condições
- Contrato 42 pronto no worktree (service, store e IPC funcionando com fakes).
- Referências de padrão: tela do WhatsApp (`renderer/src/features/whatsapp/`) para store zustand + rotas; contrato 40 para notificações; Configurações em abas (contrato 18) para a seção de contas; AttachCard/lucide-react para ícones.

## Superfície
- Criar: `renderer/src/features/email/` (EmailScreen, lista, leitura, composer, store zustand), seção Email em `features/settings/`.
- Alterar: navegação/menu lateral, `src/main/smoke.ts` (cenários fake), notificações no main.

## Critérios de aceite
- CA1 — **Layout estilo Outlook DESKTOP, integrado ao sidebar que já existe** (pedido do Andrew 19/11 00:52): NÃO criar uma coluna de pastas nova dentro da tela. As contas de email entram no **sidebar atual do app**, com os MESMOS componentes, espaçamentos e ícones lucide dos itens existentes: cada conta aparece pelo nome, expansível/retrátil (chevron), e expandida mostra as pastas — "Caixa de Entrada" (com contador de não-lidas) e "Enviados". Dado um clique em "Caixa de Entrada" de uma conta, então abre a área de email com DUAS colunas: (a) lista de mensagens com botão "Nova mensagem" no topo — avatar com iniciais, remetente em peso forte, assunto, prévia de 1 linha, hora à direita, ponto de não-lida; (b) painel de leitura com cabeçalho (remetente, para/cc, data) e barra de ações: Responder, Responder a todos, Encaminhar, Apagar, Marcar como (não) lida. Estado expandido/recolhido de cada conta persiste. Tudo com tokens/cores do design system do app — a ESTRUTURA é a do Outlook desktop (não o web), zero asset/ícone/cor da Microsoft. Janela estreita (<900px): lista e leitura alternam (como o WhatsApp faz). Itens atuais do sidebar permanecem na mesma ordem e estilo.
- CA2 — Dado uma mensagem selecionada, então o corpo HTML renderiza SANITIZADO (sem script/iframe/form; imagens remotas bloqueadas por padrão com botão "Carregar imagens"); texto puro vira texto com links clicáveis (target externo no navegador).
- CA3 — Dado "Nova mensagem"/"Responder", então o composer abre (destinatários com chips, assunto, corpo, anexos locais); clicar Enviar envia pelo 42 SEM diálogo de confirmação; sucesso fecha e mostra na pasta Enviados; erro mantém o rascunho com o aviso. Responder preenche destinatário, "Re:" e citação.
- CA4 — Dado email novo (nunca da própria conta), então notificação nativa seguindo o contrato 40: título = remetente, corpo = assunto (≤140); clique abre o app na mensagem; janela em foco com aquela conta/INBOX aberta não notifica; app bloqueado notifica sem conteúdo ("Email de Fulano"); rajada ≥3 em 5 s agrupa ("3 emails de Fulano"). Interruptor `emailNotifications` (padrão true) em Configurações › Contas › Email — 4 lugares + índice.
- CA5 — Configurações › Contas › Email: adicionar conta em dois passos (email+senha → autoconfig do 42 preenche; "Configuração avançada" abre os campos manuais IMAP/POP3/SMTP), "Testar conexão" com resultado visível, lista com estado (conectada/erro), remover com confirmação.
- CA6 — Testes renderer (stores e formatação: prévia, hora, agrupamento de não-lidas, sanitização) + smoke com conta fake: screenshot `email` (três painéis com mensagens fake), `email-leitura`, `email-composer`, light e dark, passando nos gates de forma/cor do projeto.

## Invariantes
- Menu lateral: itens existentes intactos; tela WhatsApp intacta (reusar componentes só por extração, sem mudar comportamento).
- Nenhum canal IPC novo fora do padrão do 42.

## Fora de escopo
- OAuth (44), Assistente (45), arrastar-e-soltar de anexo, impressão.

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde, incluindo os screenshots novos.
