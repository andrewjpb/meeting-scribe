# Contrato 50 — Barra de menus do Mac melhorada

Parte 3 da implementação `aviso-reuniao` (branch `aviso-reuniao`). Depende dos Contratos 48 e 49 commitados. Mexe em `src/main/tray/menu.ts` (menu nativo, `buildTrayMenu` + `createTrayController`) e no que alimenta o estado dele em `src/main/index.ts`.

## Objetivo

Hoje o menu da barra tem: Abrir, Nova gravação, Bloquear, Automações, as 3 próximas tarefas, Pausar, Sair. Clicar abre a janela. A ideia é deixá-lo útil sem abrir o app, como os apps de reunião da barra do Mac.

## O que muda

1. **Clique**: o clique esquerdo abre o MENU (padrão do macOS), não a janela. "Abrir LAP Reuniões" segue como primeiro item.
2. **Gravando, na própria barra**: ao lado do ícone, o tempo da gravação (`tray.setTitle(' 12:03')`, fonte monoespaçada se disponível), atualizado a cada segundo só enquanto grava; sem gravação, nenhum texto. No menu: "Gravando · 12:03 — <título>", "Abrir gravação" (vai para a tela ao vivo) e "Encerrar".
3. **Próximas reuniões da agenda** (de hoje, até 3, das agendas já ligadas no app): cada uma vira um submenu com o título e a hora — "Gravar agora" (mesmo caminho de `recordFromCalendar(key)`) e "Entrar na reunião" (abre o link de Meet/Teams/Zoom do evento no navegador padrão com `shell.openExternal`, só http/https e só se o evento tiver link). Sem agenda ou sem eventos: "Nenhuma reunião hoje" desabilitado. Reunião acontecendo agora fica marcada ("Agora · …").
4. **Últimas reuniões gravadas** (3 mais recentes): cada uma abre o detalhe da reunião na janela principal. Submenu "Recentes".
5. **Aviso de reunião**: item com marca (checkbox) "Avisar quando uma reunião começar" que liga/desliga `meetingPrompt`.
6. **Plugins**: uma linha desabilitada de status — "Meet: conectado · Navegador: desconectado" — só mostra os plugins ligados; clique leva a Configurações › Plugins (se não der para clicar em item desabilitado, use item normal com o texto).
7. **Automações**: as próximas tarefas e "Pausar/Retomar" passam para um submenu "Automações" (o menu de cima fica mais curto).
8. **Bloqueado**: continua mostrando só Abrir, "Bloqueado" e Sair — nenhum título de reunião, agenda ou recente aparece com o app bloqueado (privacidade; mesma regra do `calendarNoticeText`).

Ordem final (desbloqueado):

```
Abrir LAP Reuniões
Nova gravação                      (ou o bloco "Gravando" com Abrir gravação / Encerrar)
—
Agora · Daily (10:00)          ▸   Gravar agora / Entrar na reunião
Planejamento · 14:00           ▸
—
Recentes                       ▸   3 últimas
—
✓ Avisar quando uma reunião começar
Meet: conectado
Automações                     ▸   próximas tarefas + Pausar
Bloquear
—
Sair
```

## Regras

- `buildTrayMenu` continua função pura (estado → template); toda a lógica nova (ordem, corte em 3, "Agora", bloqueado esconde tudo, rótulos) testável sem Electron. Rótulos de reunião cortados em 40 caracteres.
- Estado novo vem de fontes que já existem (agenda, lista de reuniões, configurações, estado do Meet e da ponte do navegador); reconstruir o menu quando qualquer uma muda, com debounce de 500 ms, e o título da gravação a cada 1 s sem reconstruir o menu inteiro.
- Nada de janela/popover nova: menu nativo.
- Ícone: manter os templates atuais (`trayTemplate`, `trayRunningTemplate`).

## Testes e gates

- `test/tray-*.test.ts`: menu desbloqueado com e sem gravação, com 0/1/5 reuniões (corte em 3, "Agora"), sem link não mostra "Entrar", recentes, checkbox reflete a configuração, plugins só os ligados, bloqueado não mostra título nenhum, submenu Automações.
- Handlers: "Entrar" só abre http/https; "Gravar agora" chama o mesmo caminho da agenda.
- Smoke: o check existente da bandeja (se houver) atualizado; senão, um check que monta o menu com fixtures e confere os ids.
- Rodar em sequência: três `tsc`; `vitest run` nos arquivos tocados; lint; smoke completo uma vez no fim com `SMOKE_NO_SANDBOX=1`.

## Telas de impacto no usuário

- Menu da barra do Mac reorganizado, com agenda, recentes, status dos plugins e o interruptor do aviso.
- Tempo da gravação visível na barra de menus.

## Fora de escopo

Popover com HTML; ações de WhatsApp/email no menu; atalho global de teclado.

## Critério de pronto

Gates e smoke verdes; teste manual do Andrew: clicar no ícone da barra mostra o menu novo; gravar mostra o tempo ao lado do ícone. Sem commit — quem coordena commita.
