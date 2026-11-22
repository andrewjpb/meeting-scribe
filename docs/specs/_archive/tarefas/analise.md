---
status: em-analise
feature: tarefas
tipo: analise
data: 2026-11-21
semana: 2026-W47
base: main 6ce57bd (versão 0.20.1, funil-vendas arquivado)
---

# Análise: Tarefas ligadas a tudo (funil, reuniões, e-mail, WhatsApp, Assistente, Automações)

## Em uma frase

Uma lista única de **tudo que o usuário tem para fazer**, em que cada tarefa nasce de onde o trabalho acontece
(resumo da reunião, oportunidade do funil, e-mail, conversa do WhatsApp, Assistente) e continua ligada a essa
origem, com um único lugar onde "feito" existe.

## O que já é "tarefa" no app hoje (e por que não basta)

| Hoje | Onde | O que falta |
|---|---|---|
| Tarefas do resumo (`SummaryTask {task, owner, due}`) | `meetings/<id>.summary.json`, tabela só de leitura em Reunião › Resumo | sem id, sem estado "feita", sem edição; `due` é texto livre ("sexta"); "Gerar de novo" apaga a lista; nada junta as tarefas de várias reuniões |
| Próximo passo da oportunidade (`ProximoPasso {texto, data}`) | `funil.json`, `OportunidadeScreen`, cartão do kanban, `FUNIL.md`, alerta diário | um só por oportunidade; sem "concluído" (apagar o texto some sem histórico); sem responsável |
| Lembrete do Assistente (`ScheduledTask.reminder`) | `schedules.json`, Automações › Tarefas agendadas, notificação na hora | notificação solta: não liga a oportunidade, contato ou reunião; não é lista do que fazer |
| Post-its aberta/resolvida e "Perguntas em aberto" | `meetings/<id>.notes.json`, `analyses.json` | sem prazo nem responsável; são da reunião, não do usuário |
| Pendências/compromissos do WhatsApp, "pendente de resposta" do e-mail, `flagged` | insights e exports | só texto para o modelo; nada acionável |
| "Tarefas agendadas" das Automações | `ScheduledTask` = cron de agente | **não é to-do**; o nome conflita com o módulo novo |

Conclusão: existem cinco "meias-tarefas" desconectadas. O módulo não deve criar uma sexta: deve **absorver**
três delas (tarefas do resumo, próximo passo, lembretes) e **alimentar-se** das outras (sugestões).

## Proposta de produto

### 1. Modelo

`userData/tarefas.json` no padrão de `funil.json` (fila serial, escrita atômica, backup diário):

```
Tarefa {
  id, titulo (≤200), detalhe? (≤2000),
  status: 'aberta' | 'feita' | 'cancelada', feitaEm?,
  prazo?: 'AAAA-MM-DD', lembreteEm?: ISO (hora do aviso; padrão = prazo às 09:00, configurável),
  responsavel: 'eu' | { contatoId } | { nome },          // "eu" é o padrão; os outros só registram quem ficou de fazer
  origem: { tipo: 'reuniao'|'funil'|'email'|'whatsapp'|'assistente'|'automacao'|'manual', ref? },
  vinculos: { oportunidadeId?, contatoIds[], empresaId?, meetingId?, email? {accountId,id,assunto}, whatsappChatId? },
  criadaEm, atualizadaEm
}
```
Sem subtarefa, sem projeto, sem prioridade numérica (uma marca "importante" opcional basta), sem recorrência
(recorrente é Automação). Eventos de tarefa (criada, prazo mudou, feita, reaberta) entram na linha do tempo da
oportunidade e do contato como `ItemLinhaDoTempo` novo.

### 2. Ligações (o "tudo ligado")

| Origem | Como nasce a tarefa | Onde aparece de volta |
|---|---|---|
| **Reunião › Resumo** | a tabela "Tarefas" vira acionável: cada linha com **Adicionar** (e "Adicionar as minhas" de uma vez); a tarefa nasce ligada à reunião e, se a reunião tem oportunidade, à oportunidade e seus contatos. O resumo passa a pedir ao modelo também `dueIso` (data real) além do `due` dito; "Gerar de novo" não apaga tarefas já criadas | na própria tabela, a linha mostra o estado (aberta/feita) e deixa de ser só leitura |
| **Funil › Oportunidade** | **próximo passo = a próxima tarefa aberta da oportunidade** (a de menor prazo). A aba "Próximo passo" vira **Tarefas** da oportunidade (várias, com feito). Migração: cada `proximoPasso` existente vira uma tarefa | cartão do kanban mostra a próxima tarefa (vencida em vermelho, como hoje); `FUNIL.md` lista as tarefas abertas por oportunidade; alerta diário conta tarefas vencidas; "esfriou" passa a considerar tarefa feita como interação |
| **Funil › Contato / Empresa** | botão **Nova tarefa** na ficha | lista "Tarefas" na ficha e na linha do tempo |
| **Email › leitura** | ação **+ Tarefa** ao lado do **+ Contato** (título pré-preenchido com o assunto; vínculo ao e-mail, ao contato e à oportunidade do contato) | a tarefa guarda a referência e abre o e-mail com um clique |
| **WhatsApp › Detalhes** | **+ Tarefa** no bloco Contato; `pendencias.minhas` e `compromissos` dos insights viram **sugestões** | a tarefa abre a conversa |
| **Assistente** | fonte **Tarefas** (`TAREFAS.md`, ligada por padrão: é pequena e pessoal) e cartões `tarefa-criar`, `tarefa-concluir`, `tarefa-adiar` pelo mesmo canal único do funil; o cartão `lembrete` passa a criar uma **tarefa com lembrete** (o mecanismo de aviso continua o tick de 30 s das Automações, lendo `tarefas.json`) | citação `[Tarefa · título]`; "o que tenho para hoje?" responde pela fonte |
| **Automações** | permissão **Pode ler as tarefas** (TAREFAS.md na pasta da execução); o aviso diário das 9h vira **"Hoje"**: tarefas vencidas e de hoje + funil, uma notificação só | agente pode propor tarefas via cartão; "Minhas tarefas" (modelo de agente) passa a ler a lista real |
| **Sugestões** (aba da tela Tarefas, como Contatos › Sugestões) | tarefas do resumo com dono "Você" ainda não adicionadas, `toConfirm` da análise com dono eu, pendências do WhatsApp; **Adicionar** / **Ignorar** (lembrado) | — |

Princípio mantido do funil: **nada entra sem clique**. A IA e os insights só sugerem.

### 3. Onde fica na interface

**Recomendação: item de raiz "Tarefas", logo depois de Reuniões** (ícone `CheckSquare`), sem nível em pilha.
Motivo: tarefa é pessoal e diária, não é "do funil" (vem também de reunião, e-mail e WhatsApp); pôr dentro do
Funil esconderia o que não é venda. A raiz vai a 9 itens (Reuniões, **Tarefas**, Assistente, Email, Funil, Redes*,
Automações, WhatsApp*, Configurações; * condicionais). Se crescer de novo, agrupar (já era o risco anotado no
PRD do funil).

Tela única com `PageHeader` "Tarefas", busca, `Segmented` **Hoje · Próximas · Todas · Feitas** (Hoje =
vencidas + de hoje, que é a visão de abertura), botão **Nova tarefa** (formulário inline, sem modal) e aba
**Sugestões** com contagem. Linhas de 44 px: caixa de feito, título, origem (ícone + "Reunião com a ABF" /
"Loja virtual" / remetente), prazo (vermelho se venceu), responsável quando não for "eu". Clique abre o
detalhe **no lugar** (painel à direita, como a ficha do contato): campos, vínculos com link, linha do tempo
curta. Agrupar por: Prazo (padrão), Oportunidade, Reunião, Contato.

Alternativas descartadas: quarta linha dentro do nível Funil (esconde tarefas não comerciais); tela "Hoje"
genérica (dashboard: fora do estilo denso do app; "Hoje" vira só o filtro padrão).

Outros toques: contador de vencidas ao lado de "Tarefas" na barra (como o não-lido do Email); atalho
**⌘⇧T** para nova tarefa (livre hoje; conferir no contrato); **Configurações › Geral › Tarefas**: hora do
lembrete padrão (09:00), incluir tarefas no aviso diário (ligado), sugerir tarefas das reuniões (ligado).

### 4. Renomeações obrigatórias (conflito de vocabulário)

- Automações › **Tarefas agendadas** → **Agendamentos** (texto, guia do app, `AUTOMACOES.md`; o tipo
  `ScheduledTask` pode ficar no código).
- Cartão do Assistente `tarefa` (abre o formulário das Automações) → `agendamento`.
- Lembrete continua se chamando lembrete para o usuário; por baixo vira tarefa com `lembreteEm`.

### 5. Migração e compatibilidade

- `proximoPasso` de cada oportunidade → tarefa `origem funil`, `vinculos.oportunidadeId`, prazo = data; o campo
  `proximoPasso` continua existindo no schema como **cache derivado** (próxima tarefa aberta) para o kanban,
  o `FUNIL.md` e os cartões `oportunidade-proximo-passo` (que passam a criar tarefa).
- Lembretes existentes em `schedules.json` → tarefas com `lembreteEm` (o `ScheduledTask` com `reminder` é
  removido ao migrar; uma vez, na primeira abertura, com backup).
- Resumos antigos sem `dueIso`: a sugestão oferece a data pelo texto quando for inequívoca (não resolve
  "sexta" sem a data da reunião: resolve, porque a reunião tem data).

### 6. Fora de escopo (primeira versão)

1. Sincronizar com o Lembretes/Calendário do Mac ou com Todoist/Notion (candidato à versão seguinte via
   helper `lap-calendar`, que já cria evento).
2. Subtarefas, projetos, kanban de tarefas, prioridade numérica, estimativa de tempo.
3. Atribuir tarefa a outra pessoa **e avisá-la** (e-mail/WhatsApp): só registro de quem ficou de fazer.
4. Recorrência (continua sendo Automação).
5. Sincronizar `flagged` do IMAP.

### 7. Riscos

- **Mexer no `summaryContentSchema`** (campo `dueIso` opcional): compatível para trás; só resumos novos trazem.
- **Migração do próximo passo e dos lembretes**: um passo só, com backup, testado no smoke com fixtures.
- **Raiz da barra com 9 itens**: aceito agora; agrupar depois se precisar.
- **Explosão de sugestões** em quem tem muitas reuniões: só reuniões dos últimos 30 dias e dono "Você".

### 8. Tamanho (estimativa para o plan)

Nove contratos, 121 a 129, em ~6 waves: 121 dados/store/lógica/migração · 122 serviço, IPC, lembretes
unificados e aviso "Hoje" · 123 tela Tarefas (navegação, lista, filtros, nova, detalhe, Sugestões) · 124 funil
(próximo passo derivado, kanban, aba Tarefas da oportunidade, fichas, `FUNIL.md`) · 125 reunião (`dueIso`,
tabela acionável, Adicionar) · 126 e-mail e WhatsApp (+ Tarefa, sugestões dos insights) · 127 Assistente
(`TAREFAS.md`, cartões, renomear `tarefa`→`agendamento`) · 128 Automações (permissão, Agendamentos,
configurações) · 129 fechamento (README, guia, docs/telas, auditoria de prints). Prints novos: ~14 (×2 temas).

## Decisões que precisam do Andrew

1. **Lugar**: item de raiz "Tarefas" depois de Reuniões (recomendado) ou dentro do Funil.
2. **Próximo passo**: vira tarefa (derivado; recomendado) ou continua campo próprio espelhado.
3. **Lembretes**: migram para tarefas (recomendado) ou continuam só nas Automações.
4. **Renomear "Tarefas agendadas" para "Agendamentos"** (recomendado; sem isso o nome confunde).
