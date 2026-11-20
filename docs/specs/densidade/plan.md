---
status: aprovado-antecipadamente
feature: densidade
data: 2026-11-20
semana: 2026-W47
---
# Plan: Densidade do sistema

Branch `densidade` (worktree `~/Documents/GitHub/meeting-scribe-densidade`, base 3b973e7). Ordem de junção ao final: main ← densidade ← redes-instagram (que antes recebe densidade para o 72 nascer denso) ← assistente-agenda.

## Decisões técnicas
1. Componentes primeiro (80): mudar `design/` cascateia para as telas; `.label` substitui `.caps`; constantes de altura (`--control-h: 32px`, `--row-h: 44px`, `--row-compact-h: 32px`, `--panel-head-h: 44px`) em `tokens.css` para o smoke e os artboards citarem.
2. Barra lateral (79) nesta branch, não na do Instagram.
3. Telas em dois contratos paralelos por conjunto de arquivos disjuntos: 81 (Reuniões, Detalhe, Gravação, Bloqueio, Aviso) e 82 (Assistente, Email, WhatsApp, Automações, Configurações). Smoke: cada um só mexe nos checks das suas telas; `layoutMetrics` é do 80.
4. Artefatos (83): gerador `scripts/export-tokens.mjs` (tokens.css → tokens.json) e regeneração dos artboards por script de substituição guiado + revisão visual; publicação pelo coordenador.

## Grafo
| Wave | Contrato | Depende |
|---|---|---|
| 1 | 80 componentes + tokens + `.label` + design.md + `layoutMetrics` | — |
| 1 | 79 barra lateral densa (arquivo em `contracts/79-barra-lateral-densa.md`) | — (arquivos disjuntos do 80: `app/Sidebar*`, `EmailNav`, `ChatHistory`, rodapé; smoke só os checks da barra) |
| 2 | 81 telas: Reuniões, Detalhe, Gravação, Bloqueio, Aviso | 80 |
| 2 | 82 telas: Assistente, Email, WhatsApp, Automações, Configurações | 80 |
| 3 | 83 docs/telas regenerados + DS no repo + auditoria de prints + arquivamento | 79–82 |

## Gates
`SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde a cada contrato.
