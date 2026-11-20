---
tipo: spec
slug: arquitetura-seguranca
status: rascunho (aguarda aprovação do Andrew)
criado: 2026-11-20
semana: 2026-W47
assuntos: [Arquitetura e segurança]
---

# Spec — Arquitetura e segurança (de 7 para 9 de 10)

Fonte: duas auditorias somente leitura de 20/11/2026 (persistência e segurança), na main `73fac94`.
Caminhos relativos a `apps/desktop/`. Nota-índice: cofre Obsidian, `Implementacoes/arquitetura-seguranca/`.

## Problema e objetivo

O app está bem isolado (janelas em sandbox, CSP estrita, IPC com remetente conferido, segredos no
Chaveiro), mas tem dois tipos de fraqueza. **Estrutural:** não há camada única de armazenamento;
cada um dos ~19 stores reimplementa escrita atômica, fila e tratamento de arquivo corrompido, uns
10 serviços gravam direto no disco, e toda a ligação mora em ~1.500 linhas do `src/main/index.ts`.
**Segurança:** existe um caminho de email malicioso até execução de programa, o app é distribuído
sem proteção do macOS (hardened runtime, notarização) e a atualização confia só no próprio release.

Objetivo: fechar os caminhos de ataque reais, pôr todo acesso a disco atrás de uma camada única e
dar ao usuário uma tela que mostra o que está guardado e o estado de cada serviço. Trocar de banco
de dados **não** faz parte; a spec deixa a troca possível.

## Requisitos

### A. Segurança (fechar os caminhos de ataque)

- **R1 — Email em moldura isolada.** QUANDO um email em HTML é exibido, O SISTEMA DEVE renderizá-lo
  num `iframe` com `sandbox` sem `allow-scripts` e sem `allow-same-origin`, com CSP própria
  (`default-src 'none'`), de modo que o HTML do email nunca entre no DOM da janela que tem o preload.
  Hoje: `dangerouslySetInnerHTML` em `src/renderer/src/features/email/ReadingPane.tsx:433`. O
  sanitizador atual (`sanitize.ts`) continua como primeira barreira. Links e `mailto:` continuam
  funcionando (confirmação + `scribe:open-link`; compor).
- **R2 — Canais que executam programa exigem gesto.** QUANDO o renderer chama `scribe:claude-path-set`
  (`src/main/index.ts:2023`) ou `scribe:mcp-test` com `draft` (`index.ts:2085`), O SISTEMA DEVE
  exigir ativação do usuário e token de clique, no mesmo mecanismo dos 6 métodos de envio do preload
  (`src/preload/index.ts:37-90`). `claude-path-set` passa a aceitar só caminho escolhido no diálogo
  nativo de arquivo aberto pelo main, ou caminho digitado que seja arquivo regular executável do
  próprio usuário.
- **R3 — Validação central do IPC.** QUANDO um canal `invoke` ou `send` é registrado, O SISTEMA DEVE
  exigir um esquema zod de entrada no próprio registro (`src/main/ipc.ts:40-62`); payload inválido
  é recusado antes de chegar ao serviço. Canal sem esquema falha no typecheck ou num teste que
  percorre a allowlist de `src/shared/ipc.ts`. Migração em lotes, por área.
- **R4 — Servidores locais com segredo.** `navegador/server.ts` DEVE exigir token por instalação
  (gerado pelo app, entregue à extensão no pareamento) além do header atual, e conferir `Host`.
  `meet/server.ts` DEVE aceitar só o ID da extensão LAP (allowlist), não qualquer
  `chrome-extension://`, e conferir `Host`.
- **R5 — Distribuição protegida.** O `.dmg` DEVE sair assinado com Developer ID, com hardened
  runtime (`--options runtime`) e notarizado; fuses do Electron ajustados (`@electron/fuses`):
  `EnableNodeOptionsEnvironmentVariable` e `EnableNodeCliInspectArguments` desligados,
  `OnlyLoadAppFromAsar` e `EnableEmbeddedAsarIntegrityValidation` ligados. `RunAsNode` fica ligado
  enquanto o ACP depender dele (`src/main/acp/agent.ts:137`) — registrar como limitação conhecida.
  Depende de D1.
- **R6 — Atualização com raiz de confiança.** ANTES de abrir o `.dmg` baixado
  (`src/main/updates/service.ts:143`), O SISTEMA DEVE verificar a assinatura do app dentro dele
  (`codesign --verify` + Team ID fixo no código) ou uma assinatura destacada com chave pública
  embutida no app. O `.sha256` do mesmo release continua só como checagem de integridade. Depende de D1.
- **R7 — Anexos com quarentena.** QUANDO um anexo é salvo (`src/main/index.ts:2246`), O SISTEMA DEVE
  marcar o arquivo com o atributo de quarentena do macOS (`LSFileQuarantineEnabled` no
  `build/extendInfo.plist` ou xattr `com.apple.quarantine`), e gravar de forma atômica.
- **R8 — Imagens remotas sem brecha de DNS.** O download de imagem remota DEVE conectar ao IP já
  validado (sem resolver de novo) e recusar `http:` (`src/main/email/remote-images.ts:36, 49-81`).
- **R9 — Dependências auditadas.** `scripts/gates.sh` DEVE rodar `pnpm audit --prod` e falhar em
  vulnerabilidade alta ou crítica (com lista de exceções datada no repo).
- **R10 — Endurecimentos menores.** `devTools: false` em produção; `guardWebContents` aplicado por
  `app.on('web-contents-created')`; todas as pastas de dados criadas com `mode: 0o700`
  (`meetings/transcripts.ts:73`, `summaries.ts:39`, `notes.ts:51`, `analyses.ts:75`,
  `agents/store.ts:49`, `schedules/store.ts:100`); `scribe:open-link` só abre URL que o main
  consiga associar a conteúdo exibido (ou mantém a confirmação, agora feita pelo main com diálogo nativo).

### B. Camada única de armazenamento

- **R11 — Helper único de arquivo.** Um módulo `src/main/storage/json-file.ts` com: escrita atômica
  (tmp + rename, `chmod 0600`, remove o tmp se falhar), leitura validada por zod, fila serial por
  arquivo e quarentena configurável de arquivo inválido. Todos os stores e os serviços que hoje
  gravam direto passam a usá-lo. Fim das ~30 cópias de `writeAtomic`/fila.
- **R12 — Nenhum `fs` de dados fora da camada.** Depois da migração, regra de lint (ou teste de
  arquitetura) DEVE reprovar import de `node:fs` em `src/main/**` fora de `storage/` e de uma lista
  curta de exceções nomeadas (instalação, atualização, exportação para pasta do usuário).
- **R13 — Fim das corridas e do disco síncrono.** `lock/store.ts` ganha fila; `links.json` e
  `aceite.json` do WhatsApp (`whatsapp/service.ts:546, 861, 899`) ganham fila; `calendar-cache.json`
  (`calendar/service.ts:159-176`) e `drive-queue.json` (`google/drive-sync.ts:133-144`) deixam de
  usar `fs` síncrono.
- **R14 — Arquivo corrompido nunca some em silêncio.** Todo store DEVE mover o arquivo inválido
  para quarentena com nome padronizado (`<nome>.corrupt-<timestamp>`) e registrar o evento; hoje
  agents, schedules, chat, mcp, email e batches descartam ou ignoram. Os nomes antigos
  (`.invalid`, `.bad`) continuam sendo reconhecidos na leitura do diagnóstico.
- **R15 — Versão e migração de formato.** Todo arquivo de dados DEVE ter `version`; o helper aplica
  uma cadeia de migrações por store (`v1 → v2 → …`) na leitura e grava no formato novo. Faltam
  `version` em summaries, chat, runs, insights (a confirmar na implementação).
- **R16 — Raiz de composição.** `createAppServices` (hoje `src/main/index.ts:917-1789`) sai para
  `src/main/composition/` em módulos por área; a pasta de dados é resolvida num lugar só
  (`dataDir`), e os stores de email e convites deixam de ser criados dentro dos serviços
  (`email/service.ts:770`, `invites/service.ts:221`). Os `let` de módulo (`index.ts:145-219`) e o
  `mcpRef` viram dependências explícitas. `index.ts` fica só com ciclo de vida do app.
- **R17 — Desempenho do que cresce.** `meetings.json` ganha cópia em memória (hoje relê e regrava
  o arquivo inteiro a cada operação, `meetings/store.ts:1-4`); `chat.list` passa a usar um índice
  em vez de ler todos os `chats/*.json` (`chat/store.ts:402`).
- **R18 — Porta para outro banco.** Cada store continua exposto só pela sua interface TS; nenhum
  serviço conhece caminho de arquivo. Com isso, uma implementação SQLite ou Postgres entra por
  store, sem tocar nos serviços. Implementar outro banco fica fora de escopo (F1).

### C. Controle e clareza

- **R19 — Tela Sistema.** Nova linha "Sistema" em Configurações mostrando: pasta de dados e tamanho
  total; por store: nome, tamanho, quantidade de itens, versão do formato, última gravação, arquivos
  em quarentena; por serviço (WhatsApp, Calendário do Mac, transcrição, Assistente/Claude, MCP,
  servidores locais do Meet e do navegador, email por conta): estado, porta quando houver, último
  erro. Ações: abrir a pasta de dados no Finder, exportar backup, restaurar backup.
- **R20 — Backup e restauração.** "Exportar backup" gera um `.zip` da pasta de dados (sem
  `secrets.bin`, sem `accounts/`, sem senhas cifradas, que só valem neste Mac) numa pasta escolhida
  pelo usuário. "Restaurar" valida versões, pede confirmação e reinicia o app.

## Regras de negócio

- **N1** Nenhum requisito muda o formato em disco sem migração automática; dado existente do
  usuário nunca é perdido nem exige passo manual.
- **N2** Os nomes de quarentena que os testes e o smoke já verificam (`.corrupt-`, `.invalid`,
  `.bad`) só mudam na microtarefa de uniformização, junto com os testes.
- **N3** Refatoração de armazenamento não muda comportamento visível: mesmo IPC, mesmas telas.
  Cada microtarefa de migração sai com os testes de store existentes verdes sem alteração.
- **N4** Segredo continua só no Chaveiro (`safeStorage`); a tela Sistema e o backup nunca mostram
  nem exportam segredo.
- **N5** Token de servidor local e chave de verificação de atualização nunca aparecem em log.
- **N6** Licença GPL-3.0-or-later: dependência nova precisa ser compatível.

## Telas de impacto no usuário

1. **Configurações › Sistema (nova)** — R19 e R20. Precisa de mockup aprovado antes do contrato de UI.
2. **Leitura de email** — o corpo passa a ficar numa moldura isolada (R1). Não deve mudar a
   aparência; mudam altura automática e foco por teclado, a conferir no mockup/smoke.
3. **Configurações › Claude e › Conexões (MCP)** — escolher o caminho do `claude` passa pelo
   diálogo de arquivo; "Testar" continua igual, só exige clique real (R2).
4. **Extensão do navegador** — pareamento único com o app (R4).
5. **Atualização** — mensagem nova quando a verificação da assinatura falha (R6).
6. **Instalação** — com notarização, some o aviso do macOS de "app de desenvolvedor não identificado" (R5).

Havendo telas, dá para gerar a apresentação depois da implementação, com prints reais; perguntar antes.

## Fora de escopo

- **F1** Implementar SQLite/Postgres ou servidor próprio. Só a porta (R18).
- **F2** Cifrar os dados em disco com a senha do bloqueio (o bloqueio continua sendo de interface).
- **F3** Trocar o sanitizador de email por DOMPurify (o iframe de R1 é a barreira principal).
- **F4** Confirmação por ação quando o Assistente move email (já há lote e Desfazer).
- **F5** Mexer no `secrets.bin` e no vault (binários, síncronos): só passam a ser listados na tela Sistema.
- **F6** Repositório SQLite da ponte do WhatsApp (Python).
- **F7** Remover a dependência de `RunAsNode` do ACP.

## Decisões pendentes do Andrew

- **D1 — Apple Developer ID.** R5 e R6 pedem conta Apple Developer (US$ 99/ano) e o certificado
  "Developer ID Application". O material de assinatura que existe hoje é da ABF, não serve para um
  produto da LAP. Sem a conta, R5 fica só com fuses e R6 usa assinatura destacada com chave própria.
- **D2 — Ordem.** Recomendo segurança primeiro (onda 1), camada de armazenamento depois, tela Sistema por último.
- **D3 — Pareamento da extensão (R4).** Muda o uso da extensão do navegador uma vez; confirmar.

## Verificação end-to-end

1. Abrir um email de teste com `<img onerror>`, `<script>`, `<form>` e CSS externo: nada executa,
   nada carrega, e o DOM da janela principal não contém nenhum nó do email.
2. Do console do renderer (build de teste), chamar `scribe:mcp-test` com `draft` e
   `scribe:claude-path-set` sem gesto: ambos recusados.
3. `curl` em `GET /comandos` do servidor do navegador sem token: 401. Com `Origin` de outra
   extensão no servidor do Meet: recusado.
4. `codesign -dv --verbose=4` no app mostra `flags=0x10000(runtime)` e Team ID; `spctl -a -vv` aceita;
   `npx @electron/fuses read` mostra os fuses de R5.
5. Trocar o `.dmg` do release por um não assinado com `.sha256` coerente: a atualização recusa.
6. Salvar um anexo e conferir `xattr -l` com `com.apple.quarantine`.
7. `grep` de `node:fs` em `src/main` fora de `storage/` e das exceções: vazio; regra de lint ativa.
8. Corromper `agents.json` à mão: o app sobe, o arquivo vai para quarentena e a tela Sistema mostra.
9. Instalar por cima de uma pasta de dados da 0.17.1: tudo aparece, sem passo manual.
10. Exportar backup, apagar a pasta de dados, restaurar: reuniões, conversas e email voltam; contas pedem login de novo.
11. Gates 8/8 verdes, mais `pnpm audit`.

## Correções depois dos contratos (20/11/2026)

Os contratos 84–106 foram escritos lendo o código da main `bf9ceba`. Onde divergem do texto acima, **vale o contrato**:

- **R1 / T1:** "medir num render oculto" viola o próprio R1 (põe o HTML do email no DOM da janela); sobra a moldura com rolagem própria. O estilo do corpo precisa de folha servida por `scribe://app` ou hash na CSP, e o link pode exigir `allow-popups` (contrato 84, Dúvidas).
- **R3:** são 200 canais `invoke` + 14 eventos (216 com os 2 do contrato 85), não ~197. O esquema fica num registro central tipado, não como parâmetro do `handle` (contrato 89, E1). O IPC confere a forma do pedido; a regra de negócio continua no serviço.
- **R4:** a extensão do Meet não tem `"key"` no manifest, então o ID muda por instalação; a allowlist exige chave fixa e uma reinstalação da extensão do Meet (contrato 86). A D3 passa a cobrir as duas extensões.
- **R5:** sem Developer ID (variante B) **não** dá para ligar o hardened runtime: com assinatura ad-hoc o app não abre. O `ElectronAsarIntegrity` já existe no `Info.plist`; falta só o fuse. Com Developer ID, a primeira versão pede de novo Chaveiro, microfone, áudio e Calendário (contrato 91).
- **R6:** na variante B confere-se o `.dmg` inteiro (assinatura destacada), não o app de dentro (contrato 92).
- **R7:** `LSFileQuarantineEnabled` quebraria a ponte do WhatsApp, o ACP e o helper do Calendário; usa-se `xattr` só no anexo (contrato 87).
- **R8:** a dupla resolução de DNS está em `remote-images.ts:118-119` e `index.ts:558`.
- **R9:** `pnpm audit` roda **sem** `--prod`, porque o Electron está em `devDependencies`; os gates passam a exigir rede (contrato 88).
- **R13:** o Drive tem um teste que lê o estado sem `await` logo após criar o serviço; a carga assíncrona exige uma linha a mais nesse teste, exceção declarada à N3 (contrato 96, Q1).
- **R15:** summaries já tem `version`. Faltam em `chats/`, `schedule-runs/`, `insights.json`, `transcripts.json`, `links.json` e `aceite.json`; os três do WhatsApp precisam ser embrulhados, e a 0.18.0 não lê o formato novo (sem downgrade) (contrato 101).
- **R16:** `index.ts` tem 2.557 linhas e 16 `let` de módulo. Meta do contrato 102: 700 linhas movendo avisos, bandeja e diálogos para `src/main/shell/`; sem isso, ~1.050.
- **R17:** o smoke regrava `meetings.json` e `chats/` com o app aberto, então a cópia em memória é validada por `stat`, não pura (contratos 98, 99).
- **R12:** a lista real de exceções do lint tem 28 arquivos (contrato 103).
- **R19:** "último erro" não existe hoje para transcrição, Meet e navegador; a tela mostra vazio nesses (contrato 104).
- **R20:** o backup exige `password: null` aceito no esquema de contas de email (escopo a mais, contrato 106 CA6); `lock.json` fica fora; dependência nova proposta: `fflate` (MIT).
