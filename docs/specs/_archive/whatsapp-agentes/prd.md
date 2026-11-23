---
status: aprovada
feature: whatsapp-agentes
tipo: prd
data: 2026-11-23
semana: 2026-W48
base: a0f683f (0.22.0)
contratos: 138 a 144 (ainda não escritos)
---

# PRD — Agentes de atendimento no WhatsApp

## Problema

O WhatsApp do app hoje só lê conversas e envia com clique. Quem usa quer deixar algumas
conversas por conta de um agente com regras próprias (um agente para a filha, outro para
clientes), sem que nenhuma outra conversa seja respondida por máquina.

Pedido do Andrew em 23/11/2026: "configurar um agente e colocar aquele agente para responder
algumas pessoas no WhatsApp, com as minhas regras", "sempre marcando na conversa para usar
aquele bot, sem antes marcar não pode usar", "responder depois de X minutos, para não parecer
bot", "quero colocar cada opção em cada conversa".

## Proposta

Dois conceitos novos:

1. **Agente de atendimento**: uma persona com nome e regras (instruções, tom, o que nunca
   pode dizer). É um tipo separado dos agentes das Automações: não lê reuniões, e-mail, funil
   nem arquivos, e não tem ferramenta nenhuma.
2. **Atendimento de uma conversa**: a marcação que liga uma conversa a um agente, com todas
   as opções daquela conversa. Sem marcação, nada responde.

## Blocos

### B1. Agentes de atendimento
Criar, editar, duplicar e excluir. Campos: nome, regras (texto livre, até 8.000 caracteres),
tom, "nunca diga ou prometa" e modelo (Haiku ou Sonnet). Botão "Testar": a pessoa digita uma
mensagem de exemplo e vê a resposta que o agente daria, sem enviar nada.

### B2. Atendimento por conversa
Na conversa aberta, um painel "Atendimento" com as opções **daquela conversa**:

| Opção | Valores | Padrão |
|---|---|---|
| Agente | um dos agentes de atendimento | (obrigatório) |
| Modo | Rascunho para eu aprovar · Responder sozinho | Rascunho |
| Responder depois de | de X a Y minutos (iguais = atraso fixo) | 2 a 5 min |
| Mostrar "digitando…" antes de enviar | sim · não | sim |
| Apresenta-se como assistente | sim · não | não |
| Quem é esta pessoa | texto livre (ex.: "minha filha, 12 anos") | vazio |
| Horário de atendimento | dias da semana e faixa de horas | sempre |
| Limite de respostas por hora | 1 a 30 | 6 |
| Pausar quando eu responder | minutos de pausa | 60 min |

### B3. Como o agente responde
- Lê só as últimas mensagens **daquela** conversa, as regras do agente e o campo "quem é
  esta pessoa".
- Espera o atraso configurado. Mensagens que chegam durante a espera entram na mesma resposta.
- Decide entre **responder** ou **passar para você**. Passa quando o assunto sai das regras,
  quando não sabe, quando chega áudio, imagem ou arquivo, e quando perguntam se é um robô.
- No modo Rascunho, a resposta aparece na conversa como proposta, com "Enviar" e "Descartar".

### B4. Controle
- **Você assume quando quiser**: respondeu na conversa (pelo app ou pelo celular), o agente
  cancela o que estava esperando e pausa naquela conversa.
- **Pausar todos os atendimentos**: um botão único que para tudo na hora.
- **Histórico**: o que cada agente fez em cada conversa (respondeu, propôs, passou, pausou,
  bateu no limite), com data e hora.
- **Aviso**: quando o agente passa a conversa para você, chega uma notificação do app.

## Regras de negócio

- RN1. Conversa não marcada nunca recebe resposta automática. Não existe "responder a todos".
- RN2. A exceção ao "nenhuma IA envia" vale só para conversa marcada em modo "Responder
  sozinho". Automações, tarefas agendadas, chat e Assistente continuam sem acesso ao envio.
- RN3. O agente de atendimento não tem ferramentas e só enxerga a conversa em que atua.
- RN4. O agente nunca nega ser um assistente: perguntado diretamente, passa para você.
- RN5. Só conversas individuais. Grupos ficam fora desta versão.
- RN6. Ligar o primeiro atendimento em modo "Responder sozinho" exige aceitar um aviso de
  risco (bloqueio do número).

## Requisitos não funcionais

- Tudo local: regras, marcações e histórico ficam no Mac, em `userData/whatsapp/`.
- O histórico guarda o que aconteceu, sem o texto das mensagens.
- Só funciona com o app aberto e o Mac acordado. Mensagem que chegou com o app fechado não é
  respondida depois.
- Nenhum pedido de rede novo além dos que já existem (o `claude` local e o serviço do WhatsApp).

## Telas de impacto no usuário

- **WhatsApp › conversa aberta**: painel "Atendimento", selo do agente no cabeçalho, proposta
  de resposta no modo Rascunho.
- **WhatsApp › lista de conversas**: selo nas conversas atendidas e botão "Pausar todos".
- **Automações**: aba nova "Atendimento" com os agentes e o histórico.
- **Aviso de risco** ao ligar o primeiro atendimento automático.

Dá para gerar a apresentação desta entrega depois da implementação, com prints reais.

## Fora de escopo

1. Grupos, listas de transmissão e status.
2. Responder a áudio, imagem ou arquivo (o agente passa para você).
3. Enviar mídia, reagir ou apagar mensagem.
4. Responder mensagens que chegaram com o app fechado.
5. Agente com acesso a agenda, reuniões, funil, e-mail ou internet.
6. Instagram e outras redes.
7. Iniciar conversa: o agente só responde, nunca manda a primeira mensagem.

## Mockups

A fazer antes dos contratos de interface (142 e 143): painel "Atendimento", aba dos agentes,
proposta de resposta e aviso de risco.

## Próximos passos

Aprovação desta PRD e da spec → mockups → contratos 138 a 144 → implementação por waves.
