---
feature: notificacoes-triagem
versao: 0.24.0
data: 2026-11-23
semana: 2026-W48
---

# Notas da versão: Notificações e triagem do WhatsApp por agente (destaques para o release)

O LAP Reuniões ganhou um lugar só para tudo o que você ainda não leu e um jeito de o WhatsApp se organizar sozinho. Na barra lateral, logo abaixo de Início, o novo item **Notificações** mostra quantos e-mails e mensagens do WhatsApp estão por ler; a tela lista cada conversa com não lidas e cada e-mail não lido da Entrada de todas as contas, e um clique abre onde a coisa está. No WhatsApp, a lista de conversas passou a ter abas **Todas · Não lidas · Urgentes · Pessoal · Profissional**, e quem etiqueta cada conversa é um agente das Automações, que só lê a conversa que recebeu a mensagem e só grava uma etiqueta: nunca envia, nunca apaga, nunca move nada.

- **Notificações**: conversas do WhatsApp com mensagens não lidas e e-mails não lidos num lugar só, em ordem de hora, com filtro por origem. E-mail tem "Marcar como lida" ali mesmo; a conversa do WhatsApp abre no clique. O Início ganhou o atalho "Ver notificações".
- **Abas de triagem no WhatsApp**: "Não lidas" é automática; "Urgentes", "Pessoal" e "Profissional" vêm da etiqueta da conversa. Uma conversa urgente e profissional aparece nas duas. Na conversa aberta, uma barra troca ou limpa a etiqueta com um clique, e "Triar agora" pede uma classificação na hora.
- **Agente de triagem do WhatsApp**: um modelo pronto nas Automações ("Triagem do WhatsApp"), com instruções editáveis e o gatilho novo "Quando chega mensagem do WhatsApp". Ele espera alguns segundos depois da última mensagem, classifica a conversa (urgente? pessoal ou profissional?) com uma chamada curta ao modelo escolhido (Haiku por padrão) e grava a etiqueta. Cada classificação aparece na aba Execuções. Só uma triagem fica ligada por vez, e ela pausa como qualquer agendamento.
- **Você manda na etiqueta**: o que você escolher à mão prevalece; o âmbito fixado por você o agente não altera, e responder a conversa tira o "Urgente". O interruptor "Triagem do WhatsApp por agente", em Configurações › Claude, desliga tudo.
- **Pelo Assistente**: "crie o agente de triagem", "marque a conversa com a Ana como urgente", "abrir notificações", "o que está urgente no WhatsApp?" e "o que ficou sem resposta?" funcionam com cartões que só agem com o seu clique.
- **Privacidade**: só as últimas mensagens da conversa que recebeu a mensagem vão ao modelo; as etiquetas ficam em `triagem.json` no seu Mac e saem ao remover o WhatsApp; nenhum texto de mensagem vai para log.
