---
status: aprovada
feature: inicio-atualizar
tipo: plan
data: 2026-11-23
semana: 2026-W48
---

# Plan — Início: atualizar quando chega email e botão "Atualizar"

## Decisões técnicas
- D1. Não lidos vêm do store local do email (o mesmo que a tela Email usa), nunca de rede: respeita "o Início só lê" e o teste que proíbe `pendentesEmCache` de abrir sessão.
- D2. O aviso de email novo já chega ao serviço do Início (`inicioChanged` em `onMessagesChanged`, `main/index.ts`); falta só a view ter um dado que mude. Acrescenta-se um agrupamento por tempo (1 s) no `changed` do serviço.
- D3. Canal novo `scribe:inicio-atualizar` (`refused` com o app bloqueado): chama `calendar.refresh()`, invalida o dia do Mac, relê a lista de pastas do email e devolve a view com `{ falhou: boolean }`. Leituras concorrentes viram uma.
- D4. `atualizadoEm` é carimbado no main e viaja na view (`scribe:inicio-get`, `-changed`, `-atualizar`); o renderer só formata.
- D5. O desbloqueio dispara `inicioChanged()` no main (um ponto só, onde o app já trata o desbloqueio).
- D6. Botão no `<header>` atual do Início, no padrão do "Atualizar" de Redes (`Button variant="secondary" icon={RefreshCw}`); sem migrar para `PageHeader`.

## Grafo de tarefas
| # | Microtarefa | Arquivos que toca | Depende de | Wave |
|---|---|---|---|---|
| 145 | Não lidos na view, agrupamento, canal de atualizar, `atualizadoEm`, releitura no desbloqueio | `shared/inicio.ts`, `shared/ipc.ts`, `main/inicio/service.ts`, `main/inicio/ipc.ts`, `main/index.ts`, `main/email/service.ts` (só leitura da contagem), testes | — | 1 |
| 146 | Botão, "Atualizado às", linha de não lidos, smoke, guia, design.md | `features/inicio/*`, `main/smoke.ts`, `resources/assistente/guia-do-app.md`, `docs/specs/desktop-shell/design.md`, testes do renderer | 145, mockup aprovado | 2 |

## Gates
- 145: `pnpm typecheck && pnpm lint && pnpm test`, da raiz.
- 146: `SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates`, da raiz.

## Fechamento
Guia do app (frase "não se atualiza" do Início), `design.md` (seção Início), auditoria dos prints do Início,
spec para `docs/specs/_archive/inicio-atualizar/`.

## Ambiguidades
1. "Atualizado às HH:MM" em vez de "atualizado há X": hora fixa não exige relógio na tela.
2. O total de Pendentes só é relido no clique (uma conexão); a chegada de email não o relê (N2).
