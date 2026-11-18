# Contrato 41 — Leitor do Microsoft Teams no plugin do Chrome
Feature: desktop-shell · Wave: 41 · Depende de: 27 · Pedido do Andrew (19/11/2026: "o mesmo plugin funciona com o teams na web?" → fazer)

## Pré-condições
- `extensions/meet/content.js`: `LEITOR_MEET` (seletores) + motor genérico `startEngine(leitor)` com interface `{id(): string|null, read(): {participantes, falando}}` — desenhado no 27 exatamente para um segundo leitor. `manifest.json`: matches/host_permissions só meet.google.com. O app/servidor/protocolo NÃO mudam (o nome da plataforma não viaja; nomes são nomes).
- NÃO tocar em `apps/desktop/src/main/meet/` nem no protocolo. A pasta pode ser renomeada? NÃO — manter `extensions/meet` (o pack do 31 copia dela); só conteúdo.

## Critérios de aceite
- CA1 — `manifest.json` ganha `https://teams.microsoft.com/*` e `https://teams.live.com/*` em matches e host_permissions; nome/descrição passam a citar Meet e Teams.
- CA2 — `content.js` ganha `LEITOR_TEAMS` (mesma interface): `id()` = identificador estável da reunião na URL/DOM do Teams web; `read()` = nomes visíveis dos participantes + quem fala (no Teams: realce/anel do tile e/ou atributos aria do indicador de voz — seletores MELHOR ESFORÇO, constantes no topo com comentários, multi-fallback como no Meet; `isSelf` pelo "(você)"/"(you)"/perfil). A escolha do leitor é por hostname (`location.hostname`); o motor e o `cleanName` (com o corte de duplicação) são compartilhados.
- CA3 — `README.md` da extensão e o manual da aba Plugins (contrato 31: `APP_PLUGINS`/descrições) passam a citar Teams web (ressalva: só no Chrome, não no app do Teams). Smoke: nenhum check novo obrigatório (o DOM do Teams não é verificável offline); os checks do Meet continuam passando.
- CA4 — Teste real: os seletores do Teams SÓ podem ser calibrados numa reunião Teams real do Andrew — fica como pendência declarada do contrato (igual foi o Meet em 18/11). Registrar no relatório o que é palpite.

## Fora de escopo
- Zoom; app desktop do Teams; mudanças no app/servidor.

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde (nada do app muda além dos textos do 31).

## Telas de impacto no usuário
- O mesmo plugin passa a funcionar em reuniões do Teams abertas no Chrome (após calibração real).
