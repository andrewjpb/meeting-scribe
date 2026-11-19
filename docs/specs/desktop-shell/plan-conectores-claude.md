---
status: especificado
feature: desktop-shell
data: 2026-11-19
---

# Plan — Conectores do claude.ai no agente do app

## Decisões técnicas
- **Tirar `strictMcpConfig` só quando houver conector ligado.** É o único jeito de o `claude` carregar os conectores. Sem conector, a sessão fica exatamente como hoje (R4).
- **Bloquear pelo que NÃO foi ligado.** Sem o modo restrito, o `claude` sobe também os servidores de `~/.claude.json` e talvez os plugins sincronizados. Todo servidor que não foi ligado (conectores, servidores do `user` e plugins) entra em `disallowedTools` pelo prefixo `mcp__<servidor>`. Antes de construir o resto, o contrato 57 PROVA com o `claude` real que o prefixo bloqueia o servidor inteiro. Se não bloquear, a alternativa é listar as ferramentas uma a uma, depois de `mcpServerStatus`.
- **Manter `settingSources: []` e `--restricted`.** Os hooks, o `CLAUDE.md` e as permissões pessoais continuam fora.
- **Aprovação:** os conectores ligados entram em `permissions.ask` (`mcp__claude_ai_<Nome>`), e `mcpDecision` passa a reconhecer "servidor conector" (sem definição, com política e `allowAlways`). A rede de segurança fica: uma chamada que roda sem ter sido liberada cancela a resposta.
- **Lista:** vem só de `claude mcp list`, as linhas `claude.ai …` com o estado. O app não chama a API do claude.ai (N2).
- **Gravação:** em `settings`, `claudeConnectors: Record<nome, { enabled: boolean; tools: Record<ferramenta, 'ask'|'allow'|'deny'> }>`, nos 4 lugares e no índice, como no contrato 21.
- **Processos stdio do `~/.claude.json` que sobem sem o strict:** isso é aceito e documentado (eles sobem, mas as ferramentas ficam negadas). Ligar ou não ligar conector é escolha do Andrew. O aviso na tela diz isso.

## Grafo de tarefas
| # | Microtarefa | Arquivos | Depende | Wave |
|---|---|---|---|---|
| 57 | Sessão e aprovação: lista de conectores, strict condicional, bloqueio do que não foi ligado, `mcpDecision` para conector, prova com o `claude` real | `src/main/mcp/{cli,service}.ts`, `src/main/acp/{agent.ts,profiles/claude.ts}`, `src/shared/mcp.ts`, settings, testes | — | 1 |
| 58 | Tela: seção "Conectores do claude.ai" em Conexões (interruptor, estado, ferramentas e política, avisos), smoke e prints | `renderer/.../settings/ConnectionsSection.tsx`, `smoke.ts`, guia do app, README | 57 | 2 |

Uma wave por vez (pouca memória). Worktree próprio: `meeting-scribe-conectores`, branch `conectores-claude`, criado a partir da main.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde nos 8 passos, em cada contrato.
- O 57 tem também um teste MANUAL registrado com o `claude` real: dois conectores, um ligado e um desligado, conferindo que só o ligado aparece em `mcpServerStatus` e nas ferramentas da sessão.

## Fechamento
Teste navegado numa sessão nova, README atualizado e a spec arquivada em `docs/specs/_archive/`.
