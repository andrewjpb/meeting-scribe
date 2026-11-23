---
status: aprovada
feature: assistente-cria-atendimento
tipo: spec
data: 2026-11-23
semana: 2026-W48
---

# Spec — O Assistente cria agentes de atendimento do WhatsApp (cartão)

## Problema e objetivo
Na 0.23.0 os agentes de atendimento só se criam em Automações › Atendimento e só se ligam a uma conversa pelo
painel dela. Perguntado "consegue criar um agente para a conversa do Pedro?", o Assistente respondeu "não
existe um cartão para isso" e ditou os campos. Pedido do Andrew (23/11/2026): "quero poder criar agentes para
conversas do WhatsApp pelo Assistente também". Desenho aprovado por ele no mesmo dia ("ótimo, segue e faça a
implementação"): um cartão que a IA preenche e a pessoa revisa e clica; pode ligar o agente à conversa, sempre
em modo Rascunho; "Responder sozinho" continua só pelo painel, com o aviso de risco.

## Requisitos
- R1. O Assistente DEVE poder propor o cartão "Criar agente de atendimento" com nome, regras, tom, "nunca diga ou prometa" e modelo (Haiku ou Sonnet). Nada é criado sem o clique em "Criar agente".
- R2. O cartão DEVE mostrar as regras e o "nunca diga ou prometa" **inteiros** antes do clique (sem "ver mais" escondendo texto) e permitir editar todos os campos no próprio cartão.
- R3. O cartão PODE trazer uma conversa individual do WhatsApp: mostra "Atender a conversa com <nome> (<telefone>)" com uma caixa marcada. No clique, o agente é criado e a conversa passa a ser atendida por ele em modo **Rascunho**, com os padrões das opções. Desmarcada a caixa, só o agente é criado.
- R4. O modo é sempre Rascunho quando o atendimento nasce do cartão: o modelo não escolhe o modo, o pedido do clique não o carrega e o main o fixa.
- R5. QUANDO o nome já existe, a conversa é um grupo ou a conversa já é atendida por outro agente, O SISTEMA DEVE avisar no cartão antes do clique ("Já existe um agente com esse nome.", "Atendimento não funciona em grupos.", "Esta conversa já é atendida por <agente>; criar vai trocar o agente e voltar as opções ao padrão.") e, nos dois primeiros casos, impedir a parte correspondente.
- R6. Depois do clique o cartão mostra "Agente criado." ou "Agente criado e conversa marcada em modo Rascunho.", com os links "Abrir em Automações › Atendimento" e, havendo conversa, "Abrir a conversa". Se o agente foi criado e marcar a conversa falhou, o cartão mostra isso e "Tentar de novo" só marca a conversa (não cria outro agente).
- R7. O Assistente DEVE saber quais agentes de atendimento existem e quais conversas são atendidas (nome do agente, conversa, modo, ligado ou não), para não propor nome repetido e para responder perguntas sobre isso. Nunca as regras dos agentes.
- R8. A tela Automações › Atendimento e o painel da conversa DEVEM refletir o agente e o atendimento criados pelo cartão sem reiniciar o app.

## Regras
- N1. **Só no clique.** O cartão é proposta; quem grava é o canal chamado pelo clique, que revalida tudo no main.
- N2. **Só quando a pessoa pede.** A instrução do Assistente mantém a regra de que cartões só saem a pedido da própria pessoa, nunca por causa de algo lido numa mensagem, email, reunião ou mídia; e passa a dizer que as regras do agente proposto nunca copiam instruções vindas desse material.
- N3. **Nunca "Responder sozinho" pelo Assistente.** Nem criar, nem trocar o modo de um atendimento existente.
- N4. **Dados do app.** Nome e telefone da conversa mostrados no cartão vêm do app, não do texto do modelo; conversa desconhecida não gera cartão.
- N5. **App bloqueado:** nenhum cartão é proposto e o canal é recusado.
- N6. O cartão `abrir` passa a poder levar a Automações › Atendimento.

## Telas de impacto no usuário
- Assistente: cartão novo "Criar agente de atendimento" (proposto, em edição, criado, com falha). Mockup em `mockups/`.
- Guia do app: a seção do Assistente passa a listar o cartão.
Dá para gerar a apresentação depois da implementação, com prints reais.

## Critérios de aceite
- CA1. Pedido "crie um agente para a conversa do Pedro": o cartão aparece com os cinco campos e a linha da conversa com nome e telefone do app; nada existe no store antes do clique.
- CA2. Clique: o agente existe com os valores do cartão (editados, se houve edição) e a conversa tem atendimento `enabled: true`, `mode: 'draft'` e os padrões; a aba Atendimento e o painel mostram os dois sem reiniciar.
- CA3. Pedido do clique forjado com `mode: 'auto'` ou campo extra: recusado; o modo gravado é sempre `draft`, mesmo com o risco já aceito antes.
- CA4. Nome repetido (só caixa diferente): aviso no cartão antes do clique; clicado mesmo assim (corrida), o cartão vira falha com a frase e nada é criado.
- CA5. Conversa de grupo: o cartão sai sem a linha da conversa e com o aviso; só o agente é criado.
- CA6. Agente criado e marcação com falha: cartão em falha com "Tentar de novo"; o segundo clique não cria outro agente.
- CA7. Clique duplo: um agente só.
- CA8. App bloqueado: o bloco fica como texto e o canal é recusado.
- CA9. A fonte do Assistente lista os agentes de atendimento e as conversas atendidas (nome, conversa, modo, ligado), sem as regras, e some inteira quando não há nenhum.
- CA10. A instrução do Assistente descreve o tipo novo e as regras N2 e N3 (teste textual).
- CA11. Listas exaustivas do projeto (canais `scribe:chat-action-*`, `WHEN_LOCKED`, esquema de persistência do chat, histórico de cartões) incluem o tipo novo; os testes que as travam passam.

## Fora de escopo
1. Editar ou excluir agente pelo Assistente; mudar opções de um atendimento existente (atraso, horário, limites).
2. Modo "Responder sozinho" pelo Assistente.
3. Testar o agente dentro do cartão.
4. Grupos.

## Riscos
1. **Instrução escondida** em mensagem ou mídia sugerindo um agente com regras maliciosas: regras inteiras à vista no cartão, clique obrigatório, modo Rascunho fixo, N2.
2. **Conversa errada:** nome e telefone do app no cartão.
3. **Troca silenciosa de um atendimento existente:** aviso de R5.

## Verificação end-to-end
Com o smoke: pedir o agente para a conversa do Bruno; conferir o cartão; clicar; ver o agente na aba
Atendimento e o selo "<agente> · atendendo" na conversa em modo Rascunho; injetar uma mensagem e ver a
proposta de resposta; limpar tudo no fim.
