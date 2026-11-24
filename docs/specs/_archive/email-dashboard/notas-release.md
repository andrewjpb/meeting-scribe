---
feature: email-dashboard
versao: 0.25.0
data: 2026-11-23
semana: 2026-W48
---

# Notas da versão: Painel de e-mail (destaques para o release)

O Email do LAP Reuniões ganhou um **Painel**: a primeira tela ao clicar em Email, com as Caixas de Entrada de todas as contas lidas por IA e resumidas em três cartões. Nada acontece sem o seu clique: o Painel sugere, você decide.

- **Precisam de atenção**: os e-mails mais importantes dos últimos 7 dias, de todas as contas, com o motivo em uma linha. Um clique abre o e-mail.
- **Respostas sugeridas**: para quem espera resposta, um rascunho curto. "Abrir no Composer" leva o texto para a resposta já endereçada, com assinatura e citação; você revisa e só então envia. "Ignorar" tira a sugestão.
- **Sugestões de organização**: e-mails agrupados pela pasta para onde iriam (newsletters, avisos automáticos, arquivo), com "Mover" por linha ou "Mover todos" num clique; uma faixa com "Desfazer" devolve tudo.
- **Analisar agora** no topo, e uma análise automática por dia. O cabeçalho diz quando foi, quantos e-mails estão analisados e qual modelo leu.
- **Configurações › Email › Painel**: liga e desliga a análise por IA (ligada por padrão), escolhe entre Haiku (rápido e barato) e Sonnet (respostas melhores) e mostra a última análise com o custo. Desligada, o Painel continua mostrando os não lidos e pendentes, sem motivos nem sugestões.
- **Com o app bloqueado**, a análise não roda e os canais do Painel são recusados.
- **Privacidade**: só o cabeçalho e uma prévia de até 1.500 caracteres de cada e-mail recente vão ao modelo, no máximo 60 por conta e 150 por análise; nenhum assunto, remetente ou texto de e-mail vai para log; as sugestões ficam em `email/dashboard.json` no seu Mac e somem ao remover a conta.
