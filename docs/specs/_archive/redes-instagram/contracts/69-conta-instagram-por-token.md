# Contrato 69 — Conta Instagram por token

Feature `redes-instagram` · Wave 1 · Depende de: nada · Spec `../spec.md` (R1, R2, R10; CA1–CA3, CA15, CA16) · Plan `../plan.md` (decisões 1, 2, 4, 9) · Mockup `../mockups/RedesInstagram.dc.html` artboards 01 e 01b. **Você não commita.** Worktree: `/Users/andrew/Documents/GitHub/meeting-scribe-redes-instagram` (branch `redes-instagram`).

Roda em paralelo com o contrato 70 (S3). **Fronteira de arquivos:** o 70 só mexe em `apps/desktop/src/main/redes/s3.ts`, `main/redes/media-host.ts`, `main/redes/fake-s3.ts` e testes `test/redes-s3.test.ts`, `test/redes-media-host.test.ts`. Você cria `media-host.ts` só com a interface e um stub (abaixo) e NÃO toca nos outros três. Todo o resto do domínio é seu.

## Pré-condições

Leia antes: `spec.md` (seções "Fatos da API", R1, R2, R3, R10), o padrão de domínio no Email (`main/email/service.ts` só a montagem em `main/index.ts` ~`:913` `createAppServices` e `~:1168`; `shared/ipc.ts` `InvokeChannels`/`RendererEvents`/`WHEN_LOCKED`; `features/email/emailStore.ts`), o cofre `main/accounts/vault.ts` (`createVault`, `ACCOUNTS_DIR`), `main/accounts/http.ts` (`HttpFetch`, `allowedUrl`, `ACCOUNT_HOSTS`), `main/google/fake-google.ts` (padrão de `HttpFetch` falso), as seções `features/settings/MicrosoftSection.tsx` e `WhatsAppSection.tsx` (padrão de seção de conta na aba Contas) e `design/` (`Section`, `SettingRow`, `TextField`, `Button`, `Note`). Smoke: `main/smoke.ts` (helpers `api`, `waitFor`, `both`, `openSettingsTab`/`selectSettingsTab`, `expectedShots`, lista de checks obrigatórios) e `smoke-fixtures.ts`.

## Como é hoje

Não existe nada de redes. A aba Contas tem Google, Microsoft, Calendário e WhatsApp (`SettingsScreen.tsx:458`).

## Superfície

### `shared/redes.ts` (novo)
- `REDES = ['instagram'] as const`, `type RedeId`.
- `REDES_ACCOUNT_STATES = ['conectando','conectada','expirada','erro'] as const`.
- `interface RedesAccount { id: string; rede: RedeId; username: string; name: string | null; accountType: 'business' | 'creator' | 'desconhecido'; pictureUrl: string | null; followers: number | null; mediaCount: number | null; tokenExpiresAt: string; refreshedAt: string; connectedAt: string; state: RedesAccountState; error: string | null }` (ISO em todas as datas; `id` = `user_id` da conta profissional).
- `interface MediaHostConfig { endpoint: string; region: string; bucket: string; accessKeyId: string; publicBaseUrl: string; pathStyle: boolean }` e `interface MediaHostStatus { configured: boolean; config: MediaHostConfig | null; secretSet: boolean; lastTest: { ok: boolean; detail: string; at: string } | null }`.
- `interface RedesState { accounts: RedesAccount[]; mediaHost: MediaHostStatus }`.
- Schemas zod para tudo isso (o store e o cofre validam com eles).
- `INSTAGRAM_TOKEN_TTL_DAYS = 60`, `INSTAGRAM_REFRESH_AFTER_DAYS = 7`, `INSTAGRAM_REFRESH_MIN_AGE_HOURS = 24`.

### `shared/ipc.ts`
Canais invoke (todos `WHEN_LOCKED: 'refused'`):
- `scribe:redes-state` → `RedesState`.
- `scribe:redes-connect` `{ token: string }` → `{ ok: true; account: RedesAccount } | { ok: false; error: string }`.
- `scribe:redes-refresh` `{ accountId: string }` → mesmo formato.
- `scribe:redes-remove` `{ accountId: string }` → `{ ok: boolean }`.
- `scribe:redes-media-host-save` `{ config: MediaHostConfig; secretAccessKey: string | null }` (`null` mantém o segredo atual) → `MediaHostStatus`.
- `scribe:redes-media-host-test` `{}` → `MediaHostStatus` (chama `testMediaHost` de `media-host.ts`).
- `scribe:redes-media-host-clear` `{}` → `MediaHostStatus`.
Evento renderer `scribe:redes-state` (payload `RedesState`, `RENDERER_EVENTS_WHEN_LOCKED: 'ignored'`), emitido a cada mudança. `test/lock-ipc.test.ts` precisa continuar verde.

### `main/redes/instagram-client.ts` (novo, funções puras sobre `HttpFetch`)
- `INSTAGRAM_API_VERSION = 'v27.0'`, `INSTAGRAM_GRAPH = 'https://graph.instagram.com'`, `INSTAGRAM_HOSTS = ['graph.instagram.com', 'rupload.facebook.com']`.
- `createInstagramClient(fetch: HttpFetch)` com `me(token)` (`GET /{v}/me?fields=user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count`) → perfil tipado; `refreshToken(token)` (`GET /refresh_access_token?grant_type=ig_refresh_token&access_token=`) → `{ accessToken, expiresInSeconds }`.
- O token vai sempre no cabeçalho `Authorization: Bearer`, nunca na URL (para não vazar em log); se a API recusar o cabeçalho em algum endpoint, documente e use `access_token` na query só ali.
- `instagramErrorMessage(error: { code?: number; error_subcode?: number; message?: string }): string` em pt-BR: 190 → "Token recusado pelo Instagram", 4/17/80002 → "Limite de chamadas do Instagram; tente mais tarde", 10/200 → "Permissão não concedida ao app", 9004/2207052 → "O Instagram não conseguiu baixar a mídia", 9007/2207027 → "Mídia ainda não está pronta", 36003/2207009 → "Proporção fora de 4:5 a 1,91:1", 36000/2207004 → "Imagem acima de 8 MB", 352/2207026 → "Formato de vídeo não aceito", 24/2207008 → "Publicação expirou antes de concluir", 25/2207050 → "Conta restrita pelo Instagram", 4/2207051 → "Bloqueado pelo Instagram como spam", 9/2207042 → "Cota de publicações das últimas 24 h esgotada"; padrão "Instagram respondeu com erro <code>". Mesmo não usados agora, os de publicação ficam aqui para o contrato 71.
- Toda URL passa por `allowedUrl` com `INSTAGRAM_HOSTS` (reutilize `accounts/http.ts` se a assinatura permitir hosts extras; senão, `redesAllowedUrl(url, hosts)` em `main/redes/hosts.ts`, que o 70 também usará para o endpoint S3 e a URL pública).

### `main/redes/media-host.ts` (novo, SÓ interface + stub; o 70 implementa)
```ts
export interface MediaHostTestResult { ok: boolean; detail: string }
export type MediaHostTester = (config: MediaHostConfig, secretAccessKey: string, fetch: HttpFetch) => Promise<MediaHostTestResult>
export const testMediaHost: MediaHostTester = async () => ({ ok: false, detail: 'Teste do armazenamento ainda não disponível' })
```

### `main/redes/store.ts` (novo)
`userData/redes/` (0700) com `instagram-<id>.json` (0600, escrita atômica, zod; por enquanto só o perfil em cache e `removedAt` nunca: remover apaga o arquivo) e `media-host.json` (config sem segredo + `lastTest`). Padrão de `email-store.ts`.

### `main/redes/service.ts` (novo)
`createRedesService({ userData, safeStorage, fetch, onState, now = () => Date.now(), testMediaHost })`:
- Cofres: `createVault` em `accounts/instagram.bin` (`{ tokens: { [accountId]: { token, tokenExpiresAt, refreshedAt } } }`) e `accounts/media-host.bin` (`{ secretAccessKey }`).
- `init()`: carrega, emite estado, agenda `refreshDue()` logo e a cada 24 h (`setInterval`, `unref`).
- `connect(token)`: `me(token)`; sucesso → grava conta com `state: 'conectada'`, `connectedAt = refreshedAt = agora`, `tokenExpiresAt = agora + 60 d`; erro → `{ ok: false, error }` sem gravar nada. Token repetido para a mesma conta substitui o anterior.
- `refresh(accountId)`: `refreshToken`; sucesso → novo token, `refreshedAt = agora`, `tokenExpiresAt = agora + expires_in`, `state: 'conectada'`, `error: null`; falha 190 ou token vencido → `state: 'expirada'`, `error: 'Token vencido: gere um novo no painel da Meta'`; outra falha → `state: 'erro'` com a mensagem, token mantido.
- `refreshDue()`: para cada conta com `agora - refreshedAt >= 7 d` e `agora < tokenExpiresAt`, chama `refresh`; se `agora >= tokenExpiresAt`, marca `expirada` sem chamar a API.
- `remove(accountId)`: apaga token, arquivo e emite.
- `mediaHostSave/Test/Clear`: salva config + segredo (vault), chama `testMediaHost` injetado e grava `lastTest`.
- `state()`, `dispose()`. Nunca devolve token nem segredo pelo IPC; `MediaHostStatus.secretSet` é booleano.
- Montagem em `main/index.ts` `createAppServices` (injetando `fetch: netHttp` ou o falso do smoke) e handlers `handle('scribe:redes-*', …)` com `.catch` tipado como os do email; broadcast de `scribe:redes-state` só desbloqueado; `applyLockStatus` reenvia ao desbloquear; `dispose()` na saída.

### Renderer
- `features/redes/redesStore.ts`: `useRedes` (estado, `load()`, `watchRedes()`, `connect`, `refresh`, `remove`, `saveMediaHost`, `testMediaHost`, `clearMediaHost`).
- `features/settings/InstagramSection.tsx` (artboard 01): `Section` "Instagram" com descrição; `Note` de pré-requisito ("A conta precisa ser profissional (Business ou Creator) e pública."); bloco "Como gerar o token" em 4 passos numerados (painel developers.facebook.com › seu app › Instagram › API setup with Instagram login › Generate token; copiar o token que começa com IGAA); `TextField` "Token de acesso" (tipo password, cola) + `Button` **Conectar** (desabilitado vazio; estado "Conectando…"); erro em `Note` de erro abaixo do campo. Lista de contas conectadas: foto (quadrada, raio 4; `LapSymbol` se não houver), `@username`, nome, "Conta Business/Creator", seguidores formatados pt-BR, "Token válido até <dd/mm/aaaa>" ou "Token vencido" (expirada, em cor de erro) ou a mensagem de erro; botões **Renovar agora** e **Remover** (confirmação inline "Remover @x? Publicações, comentários e mensagens guardados neste Mac serão apagados." Sim/Não). Sem token colado em lugar nenhum da tela depois de conectar (campo limpa).
- `features/settings/MediaHostSection.tsx` (artboard 01b): `Section` "Armazenamento de mídia (S3)" com descrição ("Imagens e carrosséis precisam de um endereço público para o Instagram buscar. Compatível com Cloudflare R2 e qualquer S3. Vídeos não precisam."); campos Endpoint, Região, Bucket, Chave de acesso, Chave secreta (password; placeholder "••••• guardada" quando `secretSet`), URL pública base, `Switch` "Endereço no caminho (path-style)" ligado por padrão; botões **Salvar**, **Testar** (desabilitado sem config salva), **Remover**; resultado do último teste em `Note` (ok ou erro, com data/hora).
- `SettingsScreen.tsx`: as duas seções entram no painel `contas` DEPOIS de `WhatsAppSection` (ordem do mockup: após Email… **confira**: a aba Contas hoje não tem a seção Email; coloque após WhatsApp). Busca de Configurações (`settings-search`) indexa os títulos e descrições novos pelo mecanismo existente.

### Ganchos de DOM
`[data-redes-token]` (input), `[data-redes-connect]`, `[data-redes-account="<id>"]`, `[data-redes-account-state]`, `[data-redes-refresh]`, `[data-redes-remove]`, `[data-redes-remove-confirm]`, `[data-redes-error]`, `[data-media-host-field="endpoint|region|bucket|accessKeyId|secretAccessKey|publicBaseUrl"]`, `[data-media-host-save]`, `[data-media-host-test]`, `[data-media-host-clear]`, `[data-media-host-result]`.

### Smoke
- `main/redes/fake-instagram.ts`: `createFakeInstagram({ profile, validToken, now })` → `HttpFetch` que responde `GET /v27.0/me` (200 com o perfil para o token válido no Bearer; 400 `{error:{code:190,…}}` para outro), `GET /refresh_access_token` (200 `{access_token: '<novo>', token_type:'bearer', expires_in: 5183944}` para token válido; 400 190 para `revogado`) e 404 para o resto; registra `calls` (método, caminho sem token). Constantes `SMOKE_IG_TOKEN`, `SMOKE_IG_USERNAME = 'lap.teste'`. Injetado em `smoke-fixtures.ts` e passado ao serviço.
- `redesChecks(ctx, …)` em `smoke.ts`, chamado antes de `lockChecks`, com checks obrigatórios `['connectInvalid','connect','refresh','expired','remove','mediaHostForm']`:
  - `connectInvalid`: token errado → `[data-redes-error]` com "Token recusado pelo Instagram"; nenhuma conta.
  - `connect`: token válido → `[data-redes-account]` com `@lap.teste`, "Conta Business", "Token válido até" com data = hoje + 60 d; campo limpo; `report.json` e `settings.json` sem o token (confira com `grep` no `userData` do smoke: o token só pode existir em `accounts/instagram.bin`, que é cifrado).
  - `refresh`: `api('scribe:redes-refresh')` → `refreshedAt` muda e a validade avança; a chamada ao falso aconteceu sem token na URL.
  - `expired`: fixture `now` adiantado 61 d (exponha um setter no falso ou chame `refreshDue` via canal de teste `scribe:redes-debug-tick` que só existe em modo smoke) → estado `expirada`, texto "Token vencido".
  - `remove`: confirmação inline → conta some; arquivo `redes/instagram-<id>.json` apagado.
  - `mediaHostForm`: preencher e Salvar → `secretSet=true`, campos persistem após `load()`; Testar mostra o resultado do stub ("ainda não disponível") sem erro de tela; Remover limpa.
  - Prints `both('contas-instagram')` com a conta conectada e `both('contas-midia-s3')`; `expectedShots += 4`.
- Canais bloqueados: `refusedChannels` já cobre os novos por estarem `refused`.

### Testes unitários (`test/redes-*.test.ts`)
`redes-client.test.ts` (me/refresh parse, erros → mensagens, host recusado), `redes-service.test.ts` (connect, refresh, refreshDue com relógio injetado: 6 d não renova, 7 d renova, 60 d expira; remove; segredo nunca no estado), `redes-store.test.ts` (arquivo inválido vale vazio, permissões).

## Critérios de aceite
CA1, CA2, CA3, CA15, CA16 da spec, mais: o `RedesState` nunca contém token ou segredo; `scribe:redes-*` todos `refused`; sem dependência nova; textos pt-BR; nenhuma cor literal; `lock-ipc.test.ts` verde.

## Invariantes
Nada muda em Email, Google, Microsoft, WhatsApp. `expectedShots` bate. Nenhuma chamada externa real no smoke (o gate `externalRequests` reprova).

## Fora de escopo
OAuth; publicar; rota/tela/nível Redes (72); S3 real (70); `redesPollMinutes` (73).

## Gates
`cd /Users/andrew/Documents/GitHub/meeting-scribe-redes-instagram && SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde. Se o 70 ainda não tiver terminado quando você rodar, o stub de `media-host.ts` basta para o seu smoke.

## Como o revisor verifica
Lê `git diff` + este contrato; confere a tabela de erros, o Bearer, a classificação de bloqueio, o cofre, o relógio do refresh, a ausência de segredos no estado e nos prints, e a fronteira de arquivos com o 70.

## Relatório final (formato)
Arquivos criados/alterados (uma linha cada); gates (contagens); o que ficou diferente do contrato e por quê; dúvidas resolvidas sozinho; se `me` aceitou Bearer no falso é trivial, então diga explicitamente que a produção usa Bearer e onde cairia para query se preciso.
