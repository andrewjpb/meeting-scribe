---
status: aprovado
feature: tarefas-pendencias
tipo: spec
data: 2026-11-22
semana: 2026-W47
base: main 71789f0 (versão 0.21.0)
---

# Spec — Fechar as pendências das Tarefas

## Problema e objetivo
A 0.21.0 saiu com cinco pendências anotadas no plan arquivado (`docs/specs/_archive/tarefas/plan.md`, "Pendências").
O Andrew pediu para fechá-las e não deixar nenhuma. Nenhuma muda o produto de forma visível além do descrito abaixo.

## Requisitos
- **R1 Sugestão da análise não volta.** QUANDO o usuário clica Adicionar numa sugestão vinda da análise da reunião
  (`toConfirm`), O SISTEMA DEVE criar a tarefa com `origem { tipo: 'analise', meetingId, texto }` (tipo novo no modelo e no
  schema; `TarefaOrigem` ganha o caso) e a sugestão não aparece mais, mesmo depois de recarregar, enquanto existir tarefa
  (qualquer status) com essa origem e esse texto. A regra `jaVirou`/`casaComResumo` passa a reconhecer `analise` além de
  `reuniao` e `whatsapp`. A origem aparece na lista como "Análise: <título da reunião>" e "Abrir reunião" leva à reunião.
- **R2 Código morto removido.** `createReminder` e `updateReminder` saem de `main/schedules/service.ts` (e da interface),
  os ramos de `task.reminder` saem de `features/schedules/SchedulesTab.tsx` (o filtro que esconde lembretes legados
  continua, porque o arquivo antigo pode ter um até a migração), `textoPassoDetalhe` sai de `features/funil/funilFormat.ts`
  e seus testes. `ScheduledTask.reminder` continua **opcional no tipo e no schema** só para ler arquivos antigos na migração;
  nenhum caminho novo o escreve. Testes e fixtures que usavam o que saiu são removidos ou ajustados.
- **R3 Filtro de lembretes do export de e-mails com teste.** A regra "só tarefas abertas com `lembreteEm > agora` e
  `lembreteDisparadoEm === null`" vira a função pura `lembretesFuturos(tarefas, agora)` em `shared/tarefas-logic.ts`, com
  teste unitário (vencido, disparado, feito, futuro), e `main/index.ts` passa a usá-la no `emailExport.reminders`.
- **R4 Seção Tarefas da oportunidade sem apertar as abas.** QUANDO a oportunidade tem mais de 3 tarefas abertas, O SISTEMA
  DEVE mostrar no cabeçalho só as 3 primeiras (ordem da R14 da spec arquivada) e uma linha de 28 px **"Ver todas as N
  tarefas"** que abre `/tarefas` agrupado por oportunidade (`TarefasNavigationState { agrupar: 'oportunidade' }`) com a
  visão Todas; a lista do cabeçalho deixa de rolar (sem `max-h`/`overflow`). Com 3 ou menos, nada muda. "Feitas N" continua
  recolhida e, aberta, mostra no máximo 3 com o mesmo "Ver todas". A Nova tarefa em linha continua.
- **R5 Remetente sem nome repetido.** QUANDO o remetente do e-mail já é contato e o nome do contato é igual ao nome do
  remetente (comparação sem acento, caixa e espaços duplos), O SISTEMA DEVE mostrar **só** o nome como link para a ficha
  (o `ContactLink` substitui o texto simples) e o endereço ao lado; quando os nomes diferem, mostra o nome do remetente e,
  ao lado, o link com o nome do contato, como hoje. "+ Contato" (sem contato) não muda.

## Telas de impacto no usuário
- Email › leitura: cabeçalho sem o nome duplicado quando o remetente é contato.
- Funil › Oportunidade: seção Tarefas com até 3 e "Ver todas as N tarefas".
- Tarefas › Sugestões: sugestão da análise some depois de adicionada; origem "Análise: …" na lista.
- Automações: nenhuma mudança visível (só código morto removido).

## Fora de escopo
Qualquer outra pendência da versão seguinte (sincronização externa, mesclar contatos, exportar, CRM via MCP).

## Critérios de aceite
- **CA1** Teste unitário: adicionar sugestão de análise cria tarefa `origem.tipo === 'analise'` e `sugestoesDeTarefa` não a
  devolve mais, inclusive com a tarefa `feita`; smoke: no bloco de Sugestões, se houver sugestão de análise na semente,
  Adicionar e recarregar não a traz de volta (se a semente não tiver, acrescentar uma `toConfirm` com dono "Você").
- **CA2** `grep -rn "createReminder\|updateReminder\|textoPassoDetalhe" apps/desktop/src` vazio; `SchedulesTab.tsx` sem
  `task.reminder` fora do filtro; vitest verde; smoke verde.
- **CA3** `lembretesFuturos` testada com os quatro casos; `index.ts` a usa; `EMAILS.md` do smoke não traz lembrete disparado.
- **CA4** Smoke: em `op-consultoria` com 5 abertas (criar 3 no check), o cabeçalho mostra 3 linhas e "Ver todas as 5 tarefas"
  (28 px); clicar leva a `/tarefas` em Todas agrupado por oportunidade com o grupo da oportunidade presente; com 2 abertas,
  nenhuma linha "Ver todas". Print `funil-oportunidade-*` regravado (sem print novo).
- **CA5** Smoke: no e-mail do contato cujo nome é igual ao do remetente, há exatamente um elemento com o nome no cabeçalho e
  ele é o link do contato; no e-mail de remetente sem contato, "+ Contato" continua; `emailMaisContato` e `emailTarefa`
  seguem verdes.
- **CA6** `pnpm gates` da raiz verde (256 prints, `failures: []`), nenhum literal de cor, `detail` só com números/booleanos.

## Verificação end-to-end
1. Tarefas › Sugestões: adicionar uma sugestão de análise; recarregar: não volta. 2. Oportunidade com 5 tarefas abertas:
cabeçalho com 3 e "Ver todas as 5 tarefas" → tela Tarefas agrupada. 3. E-mail de um contato: nome aparece uma vez, como
link. 4. Automações continuam iguais. 5. `pnpm gates` verde.
