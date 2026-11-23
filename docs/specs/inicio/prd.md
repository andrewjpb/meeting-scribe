# PRD — Início (dashboard do dia)

**Feature:** `inicio` · **Status:** rascunho, aguardando aprovação do Andrew · **Data:** 22/11/2026

## Problema

O app abre na lista de Reuniões. O que o usuário precisa ao abrir o dia — o que tem na agenda,
o que vence hoje, o que ficou sem resposta — está espalhado em cinco telas (Reuniões, Tarefas,
WhatsApp, Email, Automações). Não existe um lugar que responda "o que eu tenho que fazer agora?".

## Proposta

Uma tela **Início**, primeira da barra lateral e tela inicial padrão do app: um dashboard
dinâmico, só de leitura, que espelha o dia e leva a cada módulo com um clique.

## Blocos (v1)

1. **Cabeçalho** — saudação com a data por extenso. Quando houver gravação em andamento,
   a faixa "Gravando agora — HH:mm" com o link para a tela de gravação.
2. **Agenda de hoje (espelhada)** — linha do tempo vertical com os eventos do dia, juntando:
   - as agendas conectadas (Google e Microsoft, módulo `calendar` existente);
   - o **Calendário do Mac**, pelo helper existente (`mac-calendar`: `status`, `request-access`,
     `calendars`, `find`) — mesma integração dos cartões de evento do Assistente.
   O evento em andamento fica destacado e ganha o botão **"Transcrever"** (mesmo fluxo do aviso
   de reunião). Evento já gravado ganha o link para a reunião. Abaixo do dia, a faixa compacta
   "Amanhã: N eventos". Dia vazio: "Sem eventos hoje".
   Evento duplicado entre fontes (mesmo horário e título equivalente) aparece uma vez só.
3. **Tarefas** — o número de vencidas em destaque e até 6 tarefas de Hoje, com o círculo de
   concluir (um clique, mesmo comportamento da tela Tarefas) e o link "Abrir Tarefas".
4. **Pendências** — uma linha por fonte, só quando houver:
   - WhatsApp: conversas sem resposta (módulo ligado);
   - Convites de agenda sem resposta;
   - Email: contagem de Pendentes da organização do Assistente (quando usada).
5. **Última reunião** — título, data e a primeira linha do resumo, com link para o detalhe.
6. **Automações** — só quando houver agendamento: a próxima execução e, se a última falhou,
   o aviso com link para o histórico.

## Regras de negócio

- A tela **só lê**. Toda ação é um clique explícito: concluir tarefa, abrir uma tela,
  iniciar a transcrição. Nada é enviado, aceito ou alterado a partir do Início.
- O Início **nunca cria, edita ou apaga evento** de nenhuma agenda.
- **Nenhuma rede nova**: só as fontes que o usuário já conectou. Bloco de fonte desligada
  ou não configurada simplesmente não aparece (sem convite para ligar).
- Calendário do Mac sem acesso concedido: a agenda mostra só as agendas conectadas e uma
  linha discreta "Calendário do Mac sem acesso — conceder", que dispara o `request-access`.
- Atualização dinâmica: os blocos escutam os eventos dos stores (IPC já existente); a agenda
  segue o ciclo de atualização do módulo de agendas; o destaque "agora" recalcula a cada minuto.
- Dado de exemplo sempre rotulado "Exemplo" e nunca salvo (regra geral do app).
- Respeita o bloqueio do app como as demais telas.
- **Configurações › Geral**, seção "Início": escolher a tela inicial (Início, padrão, ou
  Reuniões, comportamento atual) e ocultar blocos individualmente.

## Requisitos não funcionais

- Local-first: nenhum dado novo persistido além da preferência de configuração; os blocos
  leem os stores existentes (reuniões, tarefas, agendas, WhatsApp, email, automações).
- Primeira pintura com o que está em cache (< 1 s); as fontes remotas atualizam por cima.
- Tema claro e escuro, escala densa, alcance por teclado, pt-BR — padrões do design system.
- Gates de sempre: typecheck, lint zero avisos, testes, smoke com prints claro/escuro.

## Telas de impacto no usuário

- **Nova tela Início** (rota `/inicio`), item novo no topo da barra lateral, acima de Reuniões —
  vira a tela inicial padrão do app.
- **Configurações › Geral** ganha a seção "Início" (tela inicial e blocos visíveis).
- Nenhuma outra tela existente muda.

Há telas de impacto: depois da implementação dá para gerar a apresentação com prints reais
(perguntar antes de gerar).

## Fora de escopo (v1)

- Editar ou arrastar eventos e tarefas; visão de semana ou mês.
- Métricas de Funil e Redes no dashboard.
- Widgets do macOS (Central de Notificações).
- Escrever no Calendário do Mac a partir do Início.

## Mockups

`docs/specs/inicio/mockups/Inicio.dc.html` — artboards: `InicioDia` (dia cheio),
`InicioGravando` (gravação em andamento), `InicioVazio` (sem eventos e sem pendências).

## Próximos passos

1. Aprovação desta PRD pelo Andrew (com o mockup).
2. `plan.md` com as decisões técnicas, o grafo de tarefas e as waves.
3. Contratos por microtarefa (SDD), implementador → gates → revisor cego → commit.
