---
status: arquivado
arquivado_em: 2026-11-22
aprovado_em: 2026-11-22
feature: tarefas
tipo: prd
data: 2026-11-22
semana: 2026-W47
base: main 6ce57bd (versão 0.20.1)
---

# PRD: Tarefas ligadas a tudo

## Em uma frase

O LAP Reuniões ganha uma lista única do que o usuário tem para fazer, em que cada tarefa nasce de onde o
trabalho acontece (resumo da reunião, oportunidade do funil, e-mail, conversa do WhatsApp, Assistente) e
continua ligada a essa origem, com um só lugar onde "feito" existe.

## Por que existe

Depois do Funil de vendas, o app sabe quem é o cliente, em que etapa a venda está e o que foi combinado. Mas o
"o que eu tenho que fazer" continua espalhado em cinco lugares que não se falam: a tabela de tarefas do resumo
(só leitura, prazo em texto livre), o próximo passo da oportunidade (um só, sem "feito"), os lembretes do
Assistente (notificação solta nas Automações), os post-its abertos e as pendências que os insights do WhatsApp
e do e-mail enxergam mas ninguém aciona. O usuário acaba copiando tudo para um app de tarefas externo, e a
ligação com a reunião, a oportunidade e a conversa se perde no caminho.

A tese: **a lista de tarefas que se preenche a partir do trabalho e devolve o contexto com um clique.** Nenhum
app de tarefas sabe de qual reunião, e-mail ou negociação a tarefa veio; este sabe.

## Para quem

A mesma pessoa do funil: quem vende e entrega o próprio trabalho, faz reuniões, negocia por e-mail e WhatsApp e
não tem equipe. O Andrew é o usuário zero.

## Não é

- Não é gerenciador de projetos: sem subtarefa, projeto, kanban de tarefas, estimativa ou prioridade numérica.
- Não é ferramenta de equipe: registra quem ficou de fazer, mas não atribui nem avisa outra pessoa.
- Não substitui as Automações: tarefa recorrente continua sendo agendamento de agente.

## O que entra (visão de produto)

### 1. A tela Tarefas
Item novo na raiz da barra lateral, logo depois de Reuniões, com o número de tarefas vencidas ao lado (como o
não-lido do Email). Uma tela só: **Hoje** (vencidas e de hoje, a visão de abertura), **Próximas**, **Todas**,
**Feitas** e a aba **Sugestões**. Linhas densas com a caixa de feito, o título, de onde veio (ícone e nome da
reunião, da oportunidade ou do remetente), o prazo (vermelho se venceu) e quem ficou de fazer quando não é o
próprio usuário. Clicar abre o detalhe ao lado, no lugar: título editável, prazo, lembrete, responsável,
importante, detalhe, vínculos com link para a origem e um histórico curto. **Nova tarefa** é um formulário em
linha no topo da lista (⌘⇧T).

### 2. Tarefas nascem onde o trabalho acontece
- **Reunião › Resumo**: a tabela "Tarefas" deixa de ser só leitura. Cada linha ganha **Adicionar**; "Adicionar
  as minhas" cria de uma vez as que têm você como dono. O resumo passa a trazer a data real do prazo (além do
  "sexta" dito na conversa). Depois de criada, a linha mostra o estado da tarefa e permite marcar feita ali.
- **Funil › Oportunidade**: o "próximo passo" vira **a próxima tarefa aberta da oportunidade**. A oportunidade
  pode ter várias tarefas, cada uma com feito; o cartão do kanban, o `FUNIL.md` e o aviso diário passam a
  olhar para elas. Contatos e empresas ganham a lista de tarefas na ficha.
- **Email**: **+ Tarefa** ao lado do **+ Contato**, com o assunto como título e o e-mail como origem.
- **WhatsApp**: **+ Tarefa** no painel de detalhes; as pendências e compromissos que os insights já enxergam
  viram sugestões.
- **Assistente**: "me lembra de mandar a proposta na quinta" vira tarefa com lembrete; "o que tenho para
  hoje?" responde pela fonte Tarefas; cartões para criar, concluir e adiar. Os lembretes que já existem viram
  tarefas, sem o usuário perceber diferença no uso.
- **Sugestões**: as tarefas do resumo com você como dono, os "a confirmar" da análise e as pendências do
  WhatsApp aparecem numa aba para **Adicionar** ou **Ignorar**, como as sugestões de contato. Nada entra sem
  clique.

### 3. Lembretes e o aviso "Hoje"
Toda tarefa com prazo pode avisar (por padrão às 09:00 do dia do prazo, configurável). O aviso diário do funil
vira **"Hoje"**: uma notificação só com as tarefas vencidas e de hoje e, se ligado, o funil esfriando.

### 4. Automações
Agentes ganham **Pode ler as tarefas** (recebem `TAREFAS.md`). "Tarefas agendadas" passa a se chamar
**Agendamentos**, para a palavra "Tarefas" significar uma coisa só.

## Telas de impacto no usuário

| Tela | O que muda |
|---|---|
| **Barra lateral** | Item novo **Tarefas** depois de Reuniões, com contador de vencidas. |
| **Tarefas** (nova) | Lista com Hoje · Próximas · Todas · Feitas, Sugestões, busca, agrupar por, Nova tarefa em linha, detalhe ao lado. |
| **Funil › Oportunidade** | O campo "Próximo passo" vira a seção **Tarefas** da oportunidade (várias, com feito, nova em linha). |
| **Funil › Oportunidades** (kanban) | Cartão mostra a próxima tarefa aberta; "Sem tarefa" quando não há. |
| **Funil › Contatos / Empresas** | Lista de tarefas na ficha e **Nova tarefa**. |
| **Reunião › Resumo** | Tabela de tarefas com **Adicionar** por linha, **Adicionar as minhas**, estado da tarefa e data real do prazo. |
| **Email › leitura** | **+ Tarefa** ao lado de **+ Contato**, com formulário em linha. |
| **WhatsApp › Detalhes** | **+ Tarefa** no bloco Contato. |
| **Assistente › Contexto** | Fonte nova **Tarefas** (ligada por padrão); cartões de tarefa; o cartão "tarefa" antigo vira "agendamento". |
| **Automações** | "Tarefas agendadas" vira **Agendamentos**; lembretes saem da lista (viraram tarefas); agente ganha **Pode ler as tarefas**. |
| **Configurações › Geral** | Seção **Tarefas**: hora do lembrete, lembrar no prazo, aviso diário "Hoje", sugerir tarefas das reuniões. |

Há telas novas e mudadas: a apresentação do cliente pode ser gerada **depois da implementação**, com prints
reais; será perguntado na hora.

## Fora de escopo desta versão

1. Sincronizar com o Lembretes/Calendário do Mac, Todoist, Notion ou Google Tasks (candidato à seguinte, pelo
   helper `lap-calendar`).
2. Subtarefas, projetos, kanban de tarefas, prioridade numérica, estimativa, controle de tempo.
3. Atribuir a outra pessoa com aviso por e-mail ou WhatsApp.
4. Recorrência (continua sendo Automação).
5. Sincronizar a bandeira (`flagged`) do IMAP.
6. Tarefas criadas automaticamente sem clique (inclusive "após a reunião").

## Métricas de sucesso (uso pessoal)

- Toda tarefa que sai de uma reunião comercial está na lista em até um clique, ligada à reunião e à oportunidade.
- "O que tenho para hoje?" tem resposta no app, na tela e no Assistente.
- Zero tarefas criadas sem ação humana (invariante).

## Riscos

- **Vocabulário**: "Tarefas agendadas" e o cartão "tarefa" das Automações confundiriam; renomear é parte da entrega.
- **Migração** do próximo passo e dos lembretes: um passo só, com backup, coberto pelo smoke.
- **Raiz da barra com 9 itens**: aceito; agrupar se crescer de novo.
- **Sugestões demais**: só reuniões e conversas dos últimos 30 dias, só dono "Você"; "Ignorar" é lembrado.

## Documentos

- Análise: `analise.md`. Spec: `spec.md`. Plan: `plan.md`. Contratos: `contracts/121-…` em diante.
