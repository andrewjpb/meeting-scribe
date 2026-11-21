# Contrato 115: Alerta diário, `FUNIL.md` e agentes que leem o funil

Feature `funil-vendas` · Wave 4 · Depende de: 109, 110 e 112 commitados (e 107) · Spec `../spec.md` (R7 no alerta, R41 conteúdo de `FUNIL.md`, R44, R45) · Plan `../plan.md` (D14, D15, D16, D17) · Mockup: sem artboard (o Switch segue a linha "Pode pesquisar na internet" do `AgentForm`; a notificação segue o texto de R44). **Você não commita.** Worktree `/Users/andrew/Documents/GitHub/meeting-scribe-funil-115` (branch `funil-115`, a partir da ponta da `funil-vendas`). Roda em paralelo com 119: você **não** edita `src/main/smoke.ts`, `src/main/smoke-fixtures.ts`, `src/shared/ipc.ts`, `features/funil/**` nem `features/email/**`; **você é o único da wave 4 que edita `src/main/index.ts`**.

## Pré-condições
- Leia na spec R7, R41, R44 e R45; no plan D14 a D17; os contratos 107 (`FunilState.ultimoAvisoEm`, `setUltimoAviso`, `esfriada`, `passoVencido`, `formatarBRL`), 109 (`settings.funil`) e 110 (`FunilService.view()`, `FunilView.ultimas`).
- No código: `src/main/schedules/service.ts` (`AutomationsDeps` `:98-128`, `dueReminders` `:561`, `doTick` `:591-600`); `src/main/schedules/runner.ts` (`AgentRunnerDeps` `:33-57`, `agentSystemPrompt` `:111`, `prepare` `:162-187`, ramo `request.tools` `:168-172`, ramo `scope.kind === 'all'` `:180-183`); `src/shared/automations.ts:85-107` (`Agent`) e `:700-715` (agentes padrão); `src/shared/automations-schema.ts:75` (`web`); `src/renderer/src/features/agents/AgentForm.tsx:51` (agente vazio) e `:194-198` (linha "Pode pesquisar na internet"); `src/main/index.ts` (`createAutomationsService` `:1681-1685`, `createAgentRunner`, as funções de notificação `:378-560` e `sendWhenLoaded` `:351`); `src/main/chat/sources.ts:410-421` (`writeAtomic`, modelo de gravação 0600); `src/renderer/src/app/useMainNavigation.ts:20-24` (o 112 já mapeia `scribe:navigate` com `'funil'` para `/funil/oportunidades`).

## Superfície

### `src/main/funil/markdown.ts` (novo, puro)
`funilMarkdown({ view: FunilView; diasEsfriar: number; reunioes: ReadonlyMap<string, string> /* id → título */; now: number; timeZone: string }): string` (R41, D16), em pt-BR:
- `# Funil de vendas` e a data de geração.
- `## Etapas`: uma linha por etapa na ordem ("Contato (aberta)", …, "Ganho (final)", "Perdido (final)").
- `## Oportunidades abertas`: por oportunidade não arquivada em etapa `aberta`, `### <título> · id: <id>` e linhas Empresa, Contatos ("Nome <email>"), Etapa, Valor (`formatarBRL`), Previsão, Próximo passo (texto e data), Última interação (data e hora locais de `view.ultimas[id]`), a palavra **esfriada** quando `esfriada(…)` vale, Reuniões ("id · título").
- `## Ganhas e perdidas nos últimos 90 dias`: as de etapa final **não arquivadas** com `fechadoEm` nos últimos 90 dias (título, id, etapa, valor, data, motivo quando perdida). Arquivada nunca entra no `FUNIL.md` (R27).
- `## Contatos`: até **500**, por `atualizadoEm` decrescente, não arquivados ("id · nome · empresa · e-mails · telefones"); acima disso, a linha "lista truncada; peça pelo nome".

### `src/main/funil/alerts.ts` (novo)
- Puro: `funilAlertaDevido({ view, settings: FunilSettings, now, timeZone }): { devido: boolean; esfriadas: number; vencidas: number }`: `devido` só com `avisarEsfriadas` ligado, hora local `>= 09:00` e `ultimoAvisoEm` nulo ou de um dia local anterior; `esfriadas` e `vencidas` contam oportunidades abertas não arquivadas (`esfriada` e `passoVencido`). Também `textoAlerta(esfriadas, vencidas)`: corpo "N oportunidades esfriaram, M com próximo passo vencido" (singular "1 oportunidade esfriou", "1 com próximo passo vencido"), título "Funil".
- `createFunilAlerts({ view: () => Promise<FunilView>; settings: () => Promise<{ funil: FunilSettings }>; marcar: (at: number) => Promise<void>; notify: (aviso: { title: string; body: string }) => void; timeZone: () => string; log? })` com `tick(at)`: quando `devido`, chama `marcar(at)` (uma verificação por dia, com ou sem aviso) e, se `esfriadas + vencidas > 0`, **uma** `notify` agrupada; erro de leitura vira linha de log, nunca lança.

### `src/main/schedules/service.ts`
`AutomationsDeps.onTick?: (at: number) => Promise<void>` (D15), chamado em `doTick` logo depois de `dueReminders` e **antes** da checagem de pausa, com `.catch` que só registra no `log`.

### `src/main/schedules/runner.ts` (R45, D17)
- `AgentRunnerDeps.funilMarkdown?: () => Promise<string | null>`.
- Em `prepare`: agente com `funil: true` e `deps.funilMarkdown` presente usa uma pasta própria da execução pelo mesmo caminho do ramo `request.tools` (`corpus.scopeMany(ids, key)`, com os ids do escopo do agente; "nenhuma reunião" vira lista vazia), nunca `corpus.dir` nem `emptyDir`; grava `FUNIL.md` nela (atômico, `0o600`); `funilMarkdown()` devolvendo `null` não grava. A pasta temporária é apagada no fim como as outras (`dropScope`).
- `agentSystemPrompt` ganha um parâmetro `funil = false`; com `true`, uma linha: "Na pasta há FUNIL.md com o funil de vendas (etapas, oportunidades abertas, ganhas e perdidas recentes e contatos). Só leia; não invente oportunidade nem contato."

### Agente (`src/shared/automations.ts`, `src/shared/automations-schema.ts`, `features/agents/AgentForm.tsx`)
- `Agent.funil: boolean` (comentário: contrato 115, "Pode ler o funil"); esquema `funil: z.boolean().default(false)` (agente salvo antes lê `false`); os agentes padrão (`automations.ts:~700`) e o agente vazio do formulário (`AgentForm.tsx:51`) com `funil: false`.
- `AgentForm.tsx`: `FormField` "Pode ler o funil" (`labelId="agent-funil"`, hint "Recebe FUNIL.md com as oportunidades e os contatos em cada execução.") com `Switch` dentro de `<div data-agent-funil>`, logo depois de "Pode pesquisar na internet".

### `src/main/index.ts`
- `createFunilAlerts` com `view: () => funil.view()`, `settings`, `marcar` pelo `setUltimoAviso` do store do funil (exponha pelo serviço, por exemplo `funil.marcarAviso(at)`, se o 110 não expôs), `notify` = `new Notification({ title, body })` cujo clique faz `sendWhenLoaded(showMainWindow(), 'scribe:navigate', 'funil')` (o renderer já leva `'funil'` a `/funil/oportunidades` pelo `useMainNavigation.ts` do 112; nada muda no renderer aqui); com `smokeFixtures` presente, não mostra e só registra uma linha de log.
- `createAutomationsService({ …, onTick: (at) => funilAlerts.tick(at) })` e `createAgentRunner({ …, funilMarkdown })`, onde `funilMarkdown` monta o texto com `funil.view()`, `settings.funil.diasEsfriar`, os títulos de `meetings.list()` e o fuso do Mac.

## Critérios de aceite
- **CA1** (R41, R27) `test/funil-markdown.test.ts`: dado um `FunilView` com uma oportunidade aberta cuja última interação foi há 8 dias e `diasEsfriar: 7`, então o texto contém "esfriada" na seção dela; com 6 dias, não contém; uma ganha com `fechadoEm` há 100 dias não aparece, uma de 10 dias aparece e uma de 10 dias **arquivada** não aparece; valores saem por `formatarBRL`; com 501 contatos, a seção Contatos tem 500 linhas e "lista truncada; peça pelo nome".
- **CA2** (R44) `test/funil-alerts.test.ts`: às 08:59 locais, `devido` é falso; às 09:01 com `ultimoAvisoEm` nulo, 2 esfriadas e 1 vencida, `tick` chama `notify` uma vez com corpo "2 oportunidades esfriaram, 1 com próximo passo vencido" e chama `marcar`; um segundo `tick` no mesmo dia não chama nada; no dia seguinte às 09:01, chama de novo.
- **CA3** (R44) Com `avisarEsfriadas: false`, `tick` não chama `notify` nem `marcar`; com `devido` e nenhuma esfriada nem vencida, chama `marcar` e não chama `notify`.
- **CA4** (D15) `test/automations-service.test.ts`: com as tarefas pausadas, cada `tick()` do serviço chama `onTick` uma vez com o `at` do relógio falso; `onTick` rejeitando não impede `dueReminders` nem lança.
- **CA5** (R45) `test/automations-runner.test.ts`: agente com `funil: true` e escopo "todas as reuniões" roda numa pasta diferente de `corpus.dir` que contém `FUNIL.md` com o texto de `funilMarkdown`, e a instrução de sistema tem a linha do `FUNIL.md`; agente com `funil: false` roda como hoje (mesma pasta, sem `FUNIL.md`, instrução igual à atual).
- **CA6** (R45) Dado um `agents.json` antigo sem `funil`, quando lido pelo esquema, então `funil === false`; o formulário mostra `[data-agent-funil]` com o Switch desligado e salvar com o Switch ligado grava `funil: true` (teste do esquema; a tela é conferida no smoke do 117).
- **CA7** Nenhum aviso sai no smoke (`smokeFixtures` presente): leitura do diff de `index.ts`.

## Invariantes
- Lembretes, limite diário, pausa e execuções das Automações continuam como hoje (`test/automations-*.test.ts` existentes verdes); agentes sem `funil` têm pasta e instrução idênticas às de hoje.
- `smoke.ts` não muda; nenhum print novo (o `expectedShots` da wave 4 é o do 119).
- Nenhum canal IPC novo; `sources.ts` do Assistente não muda nesta tarefa (é do 117).
- Nenhum literal de cor fora de `tokens.css` no `AgentForm`.

## Fora de escopo desta tarefa
Fonte Funil do Assistente e cartões (117); smoke do "Pedir agora" com o funil (117); envio de e-mail pelo agente (já regulado pelo contrato 51, sem mudança).

## Gates
Ajuste mecânico liberado (plan, Gates): testes existentes que quebrarem só porque `Agent` ganhou `funil` recebem `funil: false` nos objetos montados, sem mudar a asserção; liste cada arquivo no relatório.

`cd /Users/andrew/Documents/GitHub/meeting-scribe-funil-115/apps/desktop && SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde. Testes: `test/funil-markdown.test.ts` e `test/funil-alerts.test.ts` (novos), casos novos em `test/automations-service.test.ts` e `test/automations-runner.test.ts`.

## Relatório final (formato)
Arquivos; gates (contagens); um exemplo de `FUNIL.md` gerado no teste (até 30 linhas); linhas mexidas em `index.ts`; diferenças em relação ao contrato e por quê.
