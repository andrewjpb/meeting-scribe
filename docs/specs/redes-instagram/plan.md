---
status: em-aprovacao
feature: redes-instagram
data: 2026-11-20
semana: 2026-W47
---

# Plan: Redes sociais — Instagram

Spec: `spec.md`. Mockup: `mockups/RedesInstagram.dc.html`. Branch `redes-instagram` (worktree `~/Documents/GitHub/meeting-scribe-redes-instagram`, base 3b973e7 = 0.17.1). Sem release ao final: build local para teste conjunto.

## Decisões técnicas

1. **Token colado, não OAuth.** A Meta exige o `client_secret` na troca do código e manda não guardá-lo no dispositivo; o painel gera um token longo e o refresh dispensa o segredo. OAuth fica como possível contrato futuro, isolado em `main/redes/instagram-auth.ts` se vier.
2. **Cliente HTTP isolado.** `main/redes/instagram-client.ts`: funções puras sobre um `HttpFetch` injetado (`net.fetch` em produção, falso no smoke), com `allowedUrl` e a tabela de erros → pt-BR. Versão da API numa constante (`v27.0`). Trocar a montagem da Meta depois mexe só aqui.
3. **S3 SigV4 à mão.** `main/redes/s3.ts`: assinatura AWS SigV4 (`PUT`, `DELETE`, `HEAD`) com `crypto` do Node, sem dependência nova; compatível com R2 e S3. Testes unitários com os vetores oficiais da AWS.
4. **Fila e cache em JSON** em `userData/redes/instagram-<id>.json` (fila de publicações, mídias recentes, comentários, conversas, métricas em cache) com zod, escrita atômica, 0600, igual ao `email-store.ts`. Mídias locais ficam copiadas em `userData/redes/midia/<id>/` até a publicação terminar (o arquivo original pode sumir).
5. **Agendador no serviço** (`main/redes/service.ts`): tick de 30 s, estado por publicação, retomada ao abrir o app, respeita bloqueio e cota. Comentários/mensagens/métricas por consulta periódica (`redesPollMinutes`).
6. **Uma tela, quatro seções** por rota `/redes/:conta/:secao` (`publicacoes` padrão, `comentarios`, `mensagens`, `metricas`), componentes em `features/redes/`. Editor de publicação como painel da própria tela (não modal), seguindo o design.md.
7. **Nível Redes no sidebar** reaproveita `SidebarStack`/`sidebarLevels` (seção `redes`), com `rememberRedesPath` igual ao Email.
8. **Assistente** pelos dois mecanismos existentes: fonte `REDES.md` em `main/chat/sources.ts` e ferramentas em `main/redes/assistant-tools.ts`; cartão `instagram-rascunho` em `main/chat/actions.ts` e `shared/assistant.ts`.
9. **Smoke** com `main/redes/fake-instagram.ts` (HttpFetch falso respondendo a `graph.instagram.com`, `rupload.facebook.com` e ao endpoint S3 de teste) injetado em `createAppServices`, no padrão do `fake-google.ts`.

## Grafo de tarefas e waves

| Wave | Contrato | O que entrega | Depende de |
|---|---|---|---|
| 1 | **69 — Conta Instagram por token** | `shared/redes.ts` (tipos, estados), canais `scribe:redes-*` + `WHEN_LOCKED`, `main/redes/{instagram-client,store,service}.ts` (conta, `/me`, refresh diário, remover), vault `instagram.bin`, store `useRedes`, seção **Instagram** em Configurações › Contas, `fake-instagram.ts`, smoke CA1–CA3, CA16 + prints `contas-instagram` | — |
| 1 | **70 — Armazenamento de mídia (S3)** | `main/redes/s3.ts` (SigV4, put/delete/head, testes unitários), vault `media-host.bin`, seção **Armazenamento de mídia (S3)** em Contas com Testar, fake S3 no smoke, CA4 (parte), print `contas-midia-s3` | — |
| 2 | **71 — Publicações (serviço)** | modelo da fila, validação de mídia (`main/redes/media-check.ts`: JPEG/MP4, tamanho, proporção, duração via `ffprobe`? não: ler cabeçalhos JPEG e `mp4` box, sem dependência), upload S3 ou retomável, contêiner → publish, status, cota, erros pt-BR, agendador, retomada, canais e eventos; testes unitários; smoke CA5–CA9 sem UI (pelo `api()`) | 69, 70 |
| 2 | **72 — Tela Redes e nível no sidebar** | rota, item raiz, nível em pilha com contas/seções/badges, `RedesScreen` com `PageHeader`, seção **Publicações** (fila + editor), `EmptyState` sem conta, memória de destino, smoke CA13 + prints `sidebar-redes`, `redes-publicacoes`, `redes-editor`, `redes-publicacao-erro`, `redes-vazio` | 69, 71, mockup aprovado |
| 3 | **73 — Comentários** | polling, cache, lido/não lido, badge, responder/ocultar/excluir, tela, smoke CA10 + print | 72 |
| 3 | **74 — Mensagens** | polling de conversas, tela em duas colunas, enviar, janela de 24 h, degradação com `Note`, badge, smoke CA11 + prints | 72 |
| 3 | **75 — Métricas** | insights de conta e de mídia, períodos, cache por hora, tela, smoke CA12 + print | 72 |
| 4 | **76 — Assistente** | fonte `REDES.md` + interruptor, ferramentas, cartão `instagram-rascunho`, guia do app, smoke CA14 + prints | 71, 72 |
| 4 | **77 — Fechamento** | README, design.md, docs/telas (artboards), `expectedShots`, auditoria dos prints, spec → `_archive/redes-instagram/`, build local `.dmg` sem tag para o teste conjunto | todos |

Waves 1 e 3 têm contratos independentes entre si (podem rodar em paralelo, arquivos distintos). 71 e 72 são sequenciais. O contrato 72 só começa com o mockup aprovado pelo Andrew.

## Gates desta feature

`SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` (typecheck, lint, vitest, build, smoke, literais de cor, formas, pytest). Smoke novo em `redesChecks` com lista de checks obrigatórios; nenhum pedido externo (gate já existente). `test/lock-ipc.test.ts` obriga a classificar os canais novos.

## Fechamento

Teste conjunto com o Andrew no build local (conta real, bucket real); correções em contrato próprio se houver; teste navegado em sessão nova com `relatorio-teste-navegado`; docs e arquivamento (77); cofre: status arquivado. Release só quando o Andrew mandar.
