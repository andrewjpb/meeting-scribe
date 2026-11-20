# Contrato 71 — Publicações (serviço, fila e agendador)

Feature `redes-instagram` · Wave 2 · Depende de: 69 e 70 (commitados) · Spec `../spec.md` (R4, R10, regras de negócio; CA5–CA9, CA15) · Plan `../plan.md` (decisões 2, 4, 5, 9). **Você não commita.** Worktree `/Users/andrew/Documents/GitHub/meeting-scribe-redes-instagram`. Sem UI neste contrato: tudo é provado por testes e pelo smoke via `api()`. A tela vem no 72.

## Pré-condições
Leia o 69 e o 70 (o que já existe: `shared/redes.ts`, `main/redes/{instagram-client,service,store,hosts,media-host,s3,fake-instagram,fake-s3}.ts`), a spec "Fatos da API" (publicação, cota, status, erros) e `main/schedules/` ou `shared/automations.ts` só para o padrão de tick (`SCHEDULER_TICK_MS`). Para gerar JPEG no smoke use `nativeImage.createFromBitmap(...).toJPEG(80)` do Electron; para os testes unitários (vitest, sem Electron) crie uma vez `apps/desktop/test/fixtures/redes/` com um JPEG 640×800 e um MP4 curto válido gerados por script (`sips`/`ffmpeg` se houver; senão um fixture mínimo gerado em Node) e commite-os como fixtures pequenos (< 200 KB cada).

## Superfície

### `shared/redes.ts` (acrescentar)
- `PUBLICATION_STATES = ['rascunho','agendada','publicando','publicada','erro'] as const`.
- `PUBLICATION_TYPES = ['imagem','carrossel','reels'] as const`.
- `interface PublicationMedia { id: string; kind: 'imagem' | 'video'; fileName: string; mimeType: 'image/jpeg' | 'video/mp4' | 'video/quicktime'; bytes: number; width: number; height: number; durationSeconds: number | null; altText: string; localPath: string; s3Key: string | null; containerId: string | null }`.
- `interface Publication { id: string; accountId: string; type: PublicationType; media: PublicationMedia[]; caption: string; scheduledAt: string | null; state: PublicationState; error: string | null; attempts: number; creationId: string | null; publishedMediaId: string | null; permalink: string | null; publishedAt: string | null; createdAt: string; updatedAt: string }`.
- `interface PublicationQuota { used: number; total: number; checkedAt: string }`.
- `interface MediaCandidate { path: string; fileName: string; ok: boolean; kind: 'imagem' | 'video' | null; mimeType: string | null; bytes: number; width: number | null; height: number | null; durationSeconds: number | null; problems: string[] }`.
- Limites: `CAPTION_MAX = 2200`, `CAPTION_HASHTAGS_MAX = 30`, `CAPTION_MENTIONS_MAX = 20`, `CAROUSEL_MIN = 2`, `CAROUSEL_MAX = 10`, `IMAGE_MAX_BYTES = 8 MiB`, `IMAGE_MIN_WIDTH = 320`, `IMAGE_RATIO_MIN = 0.8` (4:5), `IMAGE_RATIO_MAX = 1.91`, `VIDEO_MAX_BYTES = 300 MiB`, `VIDEO_MIN_SECONDS = 3`, `VIDEO_MAX_SECONDS = 900`, `CONTAINER_POLL_MS = 5000`, `CONTAINER_POLL_MAX_MS = 300000`, `PUBLISH_TICK_MS = 30000`, `QUOTA_POSTPONE_MS = 3600000`, `MEDIA_CLEANUP_AFTER_ERROR_MS = 48 h`.
- Funções puras: `captionStats(caption)` → `{ chars, hashtags, mentions, problems: string[] }`; `inferPublicationType(media)` → `PublicationType | { error: string }` (1 imagem → imagem; 2–10 imagens → carrossel; 1 vídeo → reels; vídeo + imagem, 2+ vídeos ou > 10 → erro em pt-BR).

### `main/redes/media-check.ts` (novo, puro, sem dependência)
`inspectMedia(path, readHead: (path, bytes) => Promise<Uint8Array>, size: number)` → `MediaCandidate`: JPEG pelos bytes `FF D8` e dimensões pelo marcador SOF0/SOF2; MP4/MOV pelo `ftyp` e duração pelo `mvhd` (`timescale`, `duration`), dimensões pelo `tkhd` da trilha de vídeo (ler os boxes necessários; se o `moov` estiver no fim, ler o arquivo em blocos). Problemas (pt-BR): "Só JPEG é aceito para imagem" (PNG/HEIC/WebP), "Imagem acima de 8 MB", "Largura mínima de 320 px", "Proporção fora de 4:5 a 1,91:1 (está em x:y)", "Vídeo acima de 300 MB", "Vídeo precisa ter entre 3 s e 15 min", "Formato de vídeo não reconhecido". Largura acima de 1440 px é aceita (a Meta reduz). Testes com os fixtures e com cabeçalhos sintéticos.

### `main/redes/publisher.ts` (novo, puro sobre o cliente)
`publishOnce({ client, token, igUserId, publication, mediaUrl: (m) => string | null, uploadReel: (containerUri, bytes) => Promise<void>, now, sleep })` executa a máquina de estados de UMA tentativa e devolve o `Publication` atualizado mais a lista de passos (para teste): (1) se `creationId` existe, pula para o status; (2) imagem: `POST /{v}/{ig}/media` `{ image_url, caption, alt_text? }`; carrossel: um `POST …/media` por filho `{ image_url, is_carousel_item: true, alt_text? }` guardando `containerId` em cada mídia (filhos já criados não se repetem), depois o pai `{ media_type: 'CAROUSEL', children: ids, caption }`; reels: `POST …/media` `{ media_type: 'REELS', upload_type: 'resumable', caption }` → `{ id, uri }`, depois `uploadReel(uri, bytes)` (POST na `uri` com cabeçalhos `Authorization: OAuth <token>`, `offset: 0`, `file_size: <n>`, corpo = bytes); (3) grava `creationId`; (4) `GET /{v}/{creationId}?fields=status_code,status` a cada `CONTAINER_POLL_MS` até `FINISHED` (máx. `CONTAINER_POLL_MAX_MS`); `ERROR`/`EXPIRED` → erro com `status` traduzido por `instagramErrorMessage` quando houver código; (5) `POST /{v}/{ig}/media_publish` `{ creation_id }` → `publishedMediaId`; (6) `GET /{v}/{mediaId}?fields=permalink,timestamp` → `permalink`, `publishedAt`; estado `publicada`. Idempotência: `creationId` só é criado se nulo; se o status voltar `PUBLISHED`, vai direto ao passo 6 usando `GET /{creationId}?fields=id` ou o `publishedMediaId` guardado. Erros viram `{ state: 'erro', error }` sem lançar.

### `main/redes/instagram-client.ts` (acrescentar)
`createContainer(token, igUserId, body)`, `containerStatus(token, id)`, `publishContainer(token, igUserId, creationId)`, `mediaInfo(token, mediaId, fields)`, `publishingLimit(token, igUserId)` → `PublicationQuota`, `uploadResumable(token, uri, bytes)` (host `rupload.facebook.com`). Todas via `HttpFetch`, Bearer.

### `main/redes/service.ts` (acrescentar)
- Fila por conta em `instagram-<id>.json` (`publications: Publication[]`), mídia copiada para `userData/redes/midia/<pubId>/<mediaId>.<ext>` ao salvar o rascunho (o original pode sumir); apagar a publicação apaga a pasta.
- `pickMedia()` abre o diálogo nativo (`dialog.showOpenDialog`, múltiplo, filtros JPEG/MP4/MOV) e devolve `MediaCandidate[]` sem salvar nada.
- `savePublication(input: { id?: string; accountId; caption; mediaPaths: string[] (ordem final; caminhos já copiados são aceitos); altTexts: Record<fileName, string>; scheduledAt: string | null })` → valida (`inspectMedia` em cada arquivo novo, `inferPublicationType`, `captionStats`); problemas → `{ ok: false, problems }`; ok → grava rascunho (ou `agendada` se `scheduledAt` futuro e vier do `schedule`).
- `schedulePublication(id, at, clickToken)` e `publishNow(id, clickToken)`: exigem token de clique válido (mesmo mecanismo de `emailSend`: evento `scribe:redes-click` do preload, método `redesPublish`/`redesSchedule` em `preload/index.ts`); `publishNow` põe em `publicando` e dispara `runPublication(id)` imediatamente.
- `unschedule(id)` → rascunho; `retry(id)` (só em `erro`) → `publicando` + `runPublication`; `deletePublication(id)` (não em `publicando`).
- `runPublication(id)`: cota (`publishingLimit`; `used >= total` → `agendada` com `scheduledAt = agora + 1 h`, `error = 'Cota de publicações das últimas 24 h esgotada; adiada por 1 hora'`), upload das imagens para o S3 (`uploadMedia` do 70, chave `instagram/<accountId>/<pubId>/<mediaId>.jpg`; sem armazenamento configurado → erro "Configure o armazenamento de mídia em Configurações › Contas"), `publishOnce`, persistência a cada passo (`creationId` antes de publicar), limpeza S3 em `publicada` (e em `erro` após 48 h pelo tick), `attempts++`. Uma publicação por conta por vez.
- Agendador: `setInterval(tick, PUBLISH_TICK_MS)` (`unref`), `tick()` ignora se `isLocked()`; pega `agendada` com `scheduledAt <= agora`; no `init()`, publicações em `publicando` são retomadas (`publishOnce` com `creationId`). `isLocked` injetado pelo `index.ts` (`lockService.isLocked`).
- `quota(accountId)` em cache de 5 min.
- Eventos: `scribe:redes-publications` `{ accountId, publications, quota }` a cada mudança.

### `shared/ipc.ts` (acrescentar, todos `refused` bloqueado)
`scribe:redes-publications {accountId}`, `scribe:redes-media-pick {}`, `scribe:redes-publication-save`, `scribe:redes-publication-delete {id}`, `scribe:redes-publication-schedule {id, at, clickToken}`, `scribe:redes-publication-publish {id, clickToken}`, `scribe:redes-publication-unschedule {id}`, `scribe:redes-publication-retry {id}`, `scribe:redes-quota {accountId}`; evento `scribe:redes-publications`; `scribe:redes-click` nos eventos só do preload (`EMAIL_PRELOAD_ONLY_EVENTS` → generalize o nome se precisar, sem quebrar o email). Preload: `redesPublish(id)`, `redesSchedule(id, at)` com `navigator.userActivation.isActive`.

### Falsos (smoke)
`fake-instagram.ts` ganha: `POST /{v}/{ig}/media` (devolve `id` crescente; para `REELS` resumable também `uri` em `https://rupload.facebook.com/ig-api-upload/{v}/{id}`), `POST` na `uri` (exige `offset`, `file_size` e corpo do tamanho certo), `GET /{v}/{id}?fields=status_code` (IN_PROGRESS nas 2 primeiras consultas, depois FINISHED; `failNext(code)` para forçar ERROR com código configurável; `expireNext()`), `POST …/media_publish` (devolve `id` de mídia; recusa `creation_id` já publicado com 9007? não: devolve o mesmo id, para provar idempotência), `GET /{v}/{mediaId}?fields=permalink,timestamp`, `GET …/content_publishing_limit` (`quota` configurável: `setQuota(used,total)`), tudo registrando `calls`. `fake-s3` do 70 entra em `smoke-fixtures.ts` e é injetado no serviço como `fetch` do S3 (o serviço recebe um único `HttpFetch`: componha um roteador por host em `smoke-fixtures.ts`).

### Smoke (`redesChecks`, acrescentar; checks obrigatórios `['pubDraftInvalid','pubImage','pubCarousel','pubReel','pubScheduled','pubQuota','pubError','pubRetryIdempotent','pubLocked']`)
Tudo por `api()` (sem UI): JPEG de 640×800 e 1920×600 (fora da proporção) gerados por `nativeImage` em arquivos temporários do smoke; MP4 mínimo do fixture. `pubDraftInvalid` (PNG e proporção errada recusados com os textos); `pubImage` (salvar + `publishNow` com clickToken do preload… como não há UI, chame o canal com um token obtido por `evaluate` que simula `userActivation`? Se impossível sem clique real, use um canal `scribe:redes-publication-publish` aceitando `clickToken: 'smoke'` SÓ em modo smoke e documente); estado chega a `publicada` com `permalink`, objeto S3 apagado, `calls` sem token na URL); `pubCarousel` (3 imagens → 3 filhos + pai); `pubReel` (sem S3: ok; chamada em `rupload` com `file_size` certo); `pubScheduled` (agendar para agora + 1 s; forçar `tick` pelo canal de depuração do smoke do 69 → publicada); `pubQuota` (`setQuota(50,50)` → adiada 1 h com a mensagem); `pubError` (`failNext(36003)` → `erro` com "Proporção fora de 4:5 a 1,91:1"); `pubRetryIdempotent` (`retry` → não cria contêiner novo: contagem de `POST …/media` igual; termina `publicada`); `pubLocked` (bloquear pelo canal de lock existente, agendar vencida, `tick` não publica; desbloquear → publica). Sem prints novos (`expectedShots` igual), salvo se achar necessário algum: aí +2 e diga.

### Testes unitários
`redes-media-check.test.ts`, `redes-publisher.test.ts` (máquina de estados com cliente falso em memória: imagem, carrossel, reels, ERROR, EXPIRED, retomada com `creationId`, status `PUBLISHED`), `redes-caption.test.ts` (`captionStats`, `inferPublicationType`), `redes-service-publications.test.ts` (fila, cota adiando, agendador com relógio injetado, lock pausando, limpeza S3).

## Critérios de aceite
CA5–CA9 e CA15 (parte do agendador) pela via do serviço; nunca dois `creationId` para a mesma publicação; nenhum segredo/token em `calls`, logs ou estado; textos pt-BR; `lock-ipc.test.ts` verde; sem dependência nova.

## Invariantes
69 e 70 continuam verdes (seus checks e testes). Nada de UI. `expectedShots` inalterado salvo aviso.

## Fora de escopo
Tela (72), comentários/mensagens/métricas (73–75), Assistente (76), stories, menções, edição de post publicado, automações.

## Gates
`SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde no worktree.

## Relatório final (formato)
Arquivos (uma linha cada); gates (contagens); como resolveu o token de clique no smoke; diferenças em relação ao contrato e por quê; limitações conhecidas (ex.: leitura de `moov` no fim do arquivo).
