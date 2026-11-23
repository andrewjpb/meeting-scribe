# Contrato 140 — Atendimento no WhatsApp: agendador

Feature: whatsapp-agentes  ·  Wave: 2  ·  Depende de: 138

Constituição: `CLAUDE.md` do usuário. Prevalece sobre este contrato.

## Pré-condições
- Contrato 138 aceito e commitado (tipos em `apps/desktop/src/shared/atendimento.ts`).
- `pnpm typecheck && pnpm lint && pnpm test` verdes.

## Contexto mínimo
Um agente de atendimento responde uma conversa do WhatsApp depois de um atraso configurado por
conversa, "para não parecer robô". Este contrato cria só a lógica de tempo: quando responder,
quando reagendar, quando não responder. É um módulo puro, com relógio, temporizador e sorteio
injetados. Não lê o store, não chama modelo e não envia: quem liga tudo é o contrato 141.

## Superfície
- Criar `apps/desktop/src/main/whatsapp/atendimento/scheduler.ts`.
- Criar `apps/desktop/test/atendimento-scheduler.test.ts`.

### Interface
```ts
type SchedulerDeps = {
  now: () => number                                   // ms
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  random: () => number                                // [0, 1)
  onDue: (chatId: string, pendingIds: string[]) => void
}
type IncomingResult =
  | { status: 'scheduled'; dueAt: number }
  | { status: 'skipped'; reason: 'disabled' | 'paused' | 'paused-all' | 'out-of-hours' | 'rate-limited' | 'group' }

createAtendimentoScheduler(deps): {
  onIncoming(input: { chatId: string; messageId: string; binding: AtendimentoBinding; pausedAll: boolean }): IncomingResult
  cancel(chatId: string): string[]                    // devolve os ids pendentes cancelados
  cancelAll(): string[]                               // devolve os chatIds cancelados
  recordSent(chatId: string): void
  canSend(chatId: string, maxPerHour: number): boolean
  pending(chatId: string): { dueAt: number; messageIds: string[] } | null
  dispose(): void
}
isWithinHours(hours: AtendimentoHours | null, at: Date): boolean
```
Constantes exportadas: `GLOBAL_MAX_PER_HOUR = 30`.

## Critérios de aceite
- CA1. Dado um atendimento ligado, atraso 2 a 5 min e `random()` = 0, quando chega uma mensagem, então `status: 'scheduled'` com `dueAt = now + 2 min`; com `random()` = 0,999…, `dueAt` fica abaixo de `now + 5 min`; com `delayMin = delayMax = 3`, `dueAt = now + 3 min` exatos.
- CA2. Com atraso 0 a 0, `onDue` é chamado pelo temporizador com 0 ms (nunca de forma síncrona dentro de `onIncoming`).
- CA3. Quando o temporizador dispara, `onDue(chatId, pendingIds)` é chamado uma vez com todos os ids pendentes na ordem de chegada, e `pending(chatId)` passa a ser `null`.
- CA4. Dada uma resposta pendente, quando chega outra mensagem da mesma conversa, então o temporizador anterior é limpo, o novo `dueAt` é sorteado a partir de agora e os dois ids ficam pendentes.
- CA5. O reagendamento nunca passa de `primeiraMensagem + 2 × delayMax`: com atraso 2 a 5 e mensagens chegando a cada minuto, `onDue` dispara no máximo aos 10 min da primeira, uma única vez. Com `delayMax = 0`, o teto é 0.
- CA6. Conversas diferentes têm filas e temporizadores independentes.
- CA7. `binding.enabled: false` → `skipped: 'disabled'`. `pausedAll: true` → `skipped: 'paused-all'`. `binding.pausedUntil` no futuro → `skipped: 'paused'`; `pausedUntil` no passado é ignorado. `chatId` terminando em `@g.us` → `skipped: 'group'`. Nenhum desses casos cria temporizador.
- CA8. `isWithinHours(null, ...)` é sempre verdadeiro. Com `{ days: [1,2,3,4,5], start: '09:00', end: '18:00' }`: segunda 09:00 dentro; segunda 18:00 fora (fim exclusivo); sábado 10:00 fora. Faixa que cruza a meia-noite (`start: '22:00'`, `end: '06:00'`, `days: [5]`): sexta 23:00 dentro, sábado 05:00 dentro (pertence à faixa que começou na sexta), sábado 23:00 fora. Usa a hora local do `Date` recebido.
- CA9. Mensagem fora do horário → `skipped: 'out-of-hours'`, sem temporizador.
- CA10. `recordSent` e `canSend`: depois de 6 `recordSent` da mesma conversa em menos de 60 min, `canSend(chatId, 6)` é falso; 60 min depois do primeiro, volta a ser verdadeiro (janela deslizante). Depois de 30 `recordSent` somando todas as conversas em 60 min, `canSend` é falso para qualquer conversa.
- CA11. `onIncoming` com `canSend` falso → `skipped: 'rate-limited'`, sem temporizador.
- CA12. `cancel(chatId)` limpa o temporizador e devolve os ids pendentes; chamado sem pendência, devolve `[]`. `cancelAll()` limpa todos e devolve os `chatId` que tinham pendência.
- CA13. `dispose()` limpa todos os temporizadores; depois dele, nenhum `onDue` é chamado.
- CA14. O módulo não importa `electron`, `fs`, o store nem nada de `main/whatsapp` fora da própria pasta; não usa `Date.now`, `setTimeout` nem `Math.random` diretamente (só os injetados).

## Invariantes
- Nenhum arquivo existente muda.
- `main/agents`, `main/schedules` e `main/tray` não importam de `main/whatsapp/atendimento`.

## Fora de escopo
- Ler o store, gravar histórico, chamar o modelo, enviar, notificar, pausar por resposta do dono (contrato 141).
- Persistir pendências entre execuções do app (a spec manda descartar ao fechar).

## Gates
`pnpm typecheck && pnpm lint && pnpm test`, da raiz. Testes novos: um caso por critério CA1 a CA13, com relógio e temporizador falsos; CA14 por um teste que lê o arquivo-fonte, no estilo dos testes de invariante de `tray-automations.test.ts`.

## Relatório final
Arquivos criados; resultado dos gates com contagem de testes; critérios não cumpridos ou adaptados. Não commitar.
