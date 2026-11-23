# Contrato 138 — Atendimento no WhatsApp: tipos, store, histórico e canais

Feature: whatsapp-agentes  ·  Wave: 1  ·  Depende de: —

Constituição: `CLAUDE.md` do usuário e `docs/specs/desktop-shell/design.md`. Prevalecem sobre este contrato.

## Pré-condições
- Base `a0f683f` (0.22.0). `pnpm typecheck && pnpm lint && pnpm test` verdes antes de começar.
- Nenhuma tela muda neste contrato.

## Contexto mínimo
Feature nova: agentes de atendimento que respondem conversas individuais do WhatsApp marcadas
uma a uma. Este contrato cria só a camada de dados e os canais IPC de configuração. Nada aqui
lê mensagens, chama modelo ou envia.

Siga os padrões existentes, sem inventar outro: store em JSON como `apps/desktop/src/main/agents/store.ts`
e `apps/desktop/src/main/funil/store.ts` (fila de gravação, temporário + `rename`, permissão 0600);
tipos em `src/shared`, esquema zod ao lado (como `shared/automations.ts` e `shared/automations-schema.ts`);
canais em `shared/ipc.ts` com entrada em `WHEN_LOCKED`; exposição no `preload/index.ts`; registro
dos handlers em `main/index.ts` do mesmo jeito que os canais `scribe:agents-*`.

## Superfície
- Criar `apps/desktop/src/shared/atendimento.ts`: tipos e constantes.
- Criar `apps/desktop/src/shared/atendimento-schema.ts`: esquemas zod.
- Criar `apps/desktop/src/main/whatsapp/atendimento/store.ts` e `log.ts`.
- Alterar `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/main/index.ts` (só instanciar o store/log e registrar handlers).
- Criar `apps/desktop/test/atendimento-store.test.ts`.

### Tipos (em `shared/atendimento.ts`)
```ts
type AtendimentoAgent = { id; name; instructions; tone; never; model: 'haiku' | 'sonnet'; createdAt; updatedAt }
type AtendimentoHours = { days: number[]; start: string; end: string }   // days 0..6 (0 = domingo), "HH:MM"
type AtendimentoBinding = {
  chatId; agentId; enabled: boolean; mode: 'draft' | 'auto'
  delayMinMinutes: number; delayMaxMinutes: number
  typing: boolean; identify: boolean; about: string
  hours: AtendimentoHours | null
  maxPerHour: number; pauseOnMyReplyMinutes: number
  pausedUntil: string | null; updatedAt: string
}
type AtendimentoState = { agents; bindings; pausedAll: boolean; riskAcceptedAt: string | null }
type AtendimentoLogAction = 'sent' | 'drafted' | 'draft-sent' | 'draft-discarded' | 'handed-off'
  | 'paused' | 'cancelled' | 'rate-limited' | 'out-of-hours' | 'failed'
type AtendimentoLogEntry = { at: string; chatId: string; agentId: string; action: AtendimentoLogAction; messageId?: string; reason?: string }
```
Limites (constantes exportadas): `name` 1 a 60; `instructions` 1 a 8.000; `tone` até 500; `never`
até 2.000; `about` até 1.000; atrasos 0 a 120 com `delayMax >= delayMin`; `maxPerHour` 1 a 30;
`pauseOnMyReplyMinutes` 0 a 1.440; `reason` até 200. Padrões de um atendimento novo
(`ATENDIMENTO_BINDING_DEFAULTS`): `enabled: true`, `mode: 'draft'`, atraso 2 a 5, `typing: true`,
`identify: false`, `about: ''`, `hours: null`, `maxPerHour: 6`, `pauseOnMyReplyMinutes: 60`,
`pausedUntil: null`.

### Arquivos em disco
- `userData/whatsapp/atendimento.json`: `{ version: 1, agents, bindings, pausedAll, riskAcceptedAt }`.
- `userData/whatsapp/atendimento-log.jsonl`: uma entrada por linha.

### Canais IPC (todos `refused` em `WHEN_LOCKED`)
`scribe:atendimento-state` (devolve `AtendimentoState`), `scribe:atendimento-agent-save`,
`scribe:atendimento-agent-delete`, `scribe:atendimento-binding-save`,
`scribe:atendimento-binding-delete`, `scribe:atendimento-pause-all` (`{ paused: boolean }`),
`scribe:atendimento-risk-accept`, `scribe:atendimento-log-list` (`{ limit?: number; chatId?: string }`).
Toda entrada validada com zod; resposta no formato `{ ok: true, ... } | { ok: false, error: <código> }`.

## Critérios de aceite
- CA1. Dado um diretório vazio, quando o store é criado e lido, então o estado é
  `{ agents: [], bindings: [], pausedAll: false, riskAcceptedAt: null }` e nenhum agente de exemplo é criado.
- CA2. Dado um agente salvo, quando o store é recriado sobre o mesmo diretório, então o agente volta igual; o arquivo `atendimento.json` tem modo 0600.
- CA3. Dado um agente "Recados", quando outro é salvo com o nome "recados" (só caixa diferente), então a resposta é `{ ok: false, error: 'name-taken' }` e nada é gravado.
- CA4. Quando um atendimento é salvo com `chatId` terminando em `@g.us`, então `{ ok: false, error: 'group-not-allowed' }`.
- CA5. Quando um atendimento é salvo com `agentId` inexistente, então `{ ok: false, error: 'agent-not-found' }`.
- CA6. Dado `riskAcceptedAt: null`, quando um atendimento é salvo com `mode: 'auto'` e `enabled: true`, então `{ ok: false, error: 'risk-required' }` e nada é gravado; depois de `risk-accept`, o mesmo pedido grava.
- CA7. Com `mode: 'draft'`, o atendimento é gravado mesmo sem aceite de risco.
- CA8. Quando `delayMaxMinutes < delayMinMinutes`, ou qualquer campo fora dos limites, então `{ ok: false, error: 'invalid' }`.
- CA9. Há no máximo um atendimento por `chatId`: salvar de novo substitui.
- CA10. Dado um agente usado por dois atendimentos, quando o agente é excluído, então os dois atendimentos ficam com `enabled: false` (não são apagados) e o agente some da lista.
- CA11. `pause-all` com `true` grava `pausedAll: true`; com `false`, volta.
- CA12. O store expõe `setPausedUntil(chatId, iso | null)` (uso interno do contrato 141), gravando só esse campo.
- CA13. O histórico grava uma linha JSON por evento; com 5.001 eventos gravados, a leitura devolve os 5.000 mais recentes e o arquivo é compactado para esse teto; `log-list` devolve do mais recente para o mais antigo, com `limit` padrão 200 e máximo 1.000, e filtra por `chatId` quando informado.
- CA14. Arquivo `atendimento.json` corrompido: o store sobe com o estado vazio e preserva o arquivo ruim com outro nome, no mesmo padrão dos outros stores do app.
- CA15. Os oito canais existem em `shared/ipc.ts`, estão em `WHEN_LOCKED` como `refused`, estão expostos no preload e registrados no main; um pedido com entrada inválida devolve `{ ok: false, error: 'invalid' }` sem lançar.

## Invariantes
- Nenhum arquivo de `main/agents`, `main/schedules` ou `main/tray` importa de `main/whatsapp/atendimento`. `apps/desktop/test/tray-automations.test.ts` passa sem alteração.
- Nenhum caminho de envio do WhatsApp muda: `main/whatsapp/send-guard.ts`, `service.ts` e `client.ts` ficam intocados.
- Nenhum log do app contém `instructions`, `never` ou `about`.
- Nenhuma tela muda; nenhum pedido de rede novo.

## Fora de escopo
- Ler mensagens, agendar, chamar modelo, enviar, notificar (contratos 139 a 141).
- Qualquer componente React ou store do renderer (contratos 142 e 143).
- Smoke (contrato 144).

## Gates
`pnpm typecheck && pnpm lint && pnpm test`, da raiz do repositório. O smoke completo não roda neste contrato.
Testes novos: um caso por critério CA1 a CA14 em `atendimento-store.test.ts`; CA15 coberto pelo typecheck (a tabela `WHEN_LOCKED` é exaustiva) e por um teste de validação dos handlers, se o padrão do projeto tiver um equivalente para os canais `scribe:agents-*`.

## Relatório final
Arquivos criados e alterados; resultado dos três comandos de gate (com a contagem de testes); qualquer critério não cumprido ou adaptado e por quê; desvios dos padrões citados. Não commitar.
