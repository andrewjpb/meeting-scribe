# Contrato 70 — Armazenamento de mídia (S3 compatível)

Feature `redes-instagram` · Wave 1 · Depende de: nada (roda em paralelo com o 69) · Spec `../spec.md` (R3, R10; CA4 parte do serviço) · Plan `../plan.md` (decisão 3). **Você não commita.** Worktree: `/Users/andrew/Documents/GitHub/meeting-scribe-redes-instagram`.

**Fronteira de arquivos (obrigatória):** você só cria/edita `apps/desktop/src/main/redes/s3.ts`, `apps/desktop/src/main/redes/media-host.ts`, `apps/desktop/src/main/redes/fake-s3.ts`, `apps/desktop/test/redes-s3.test.ts` e `apps/desktop/test/redes-media-host.test.ts`. Nada de `shared/`, `index.ts`, `smoke.ts`, renderer. Os tipos `MediaHostConfig` e `HttpFetch` vêm de `shared/redes.ts` e `main/accounts/http.ts` (o 69 cria `shared/redes.ts`; se ainda não existir quando você começar, declare os tipos localmente em `s3.ts` com os mesmos nomes e campos abaixo e deixe um `// TODO 69: importar de shared/redes` que o revisor vai conferir; se já existir, importe).

```ts
interface MediaHostConfig { endpoint: string; region: string; bucket: string; accessKeyId: string; publicBaseUrl: string; pathStyle: boolean }
type HttpFetch = (url: string, init: HttpRequest) => Promise<HttpResponse>   // accounts/http.ts
```

## Pré-condições
Leia `main/accounts/http.ts` (formato de `HttpRequest`/`HttpResponse`, `allowedUrl`), `main/google/drive.ts` (como o app faz upload com `HttpFetch`), `main/google/fake-google.ts` (padrão de falso), e a documentação da assinatura AWS SigV4 que você já conhece (não precisa de rede).

## Superfície

### `s3.ts`
- `signS3Request({ method, url, headers, payloadHash, accessKeyId, secretAccessKey, region, service = 's3', now })` → cabeçalhos assinados (`Authorization`, `x-amz-date`, `x-amz-content-sha256`, `host`). SigV4 completo com `crypto` do Node: canonical request (URI codificado por segmento, query ordenada, headers assinados em minúsculas, `host;x-amz-content-sha256;x-amz-date` no mínimo), string to sign, chave derivada, assinatura hex. Função pura e determinística dado `now`.
- `createS3Client(fetch: HttpFetch, config: MediaHostConfig, secretAccessKey: string)` com:
  - `put(key, bytes: Uint8Array, contentType)` → `{ ok: true; url: string } | { ok: false; error: string }` (PUT com `x-amz-content-sha256` do payload; sem ACL; o bucket é público pela URL base configurada).
  - `delete(key)` → `{ ok: boolean; error?: string }` (DELETE; 204/200 e 404 contam como ok).
  - `head(key)` → `{ exists: boolean }`.
  - `objectUrl(key)`: path-style `endpoint/bucket/key` ou virtual-host `https://bucket.host/key` conforme `pathStyle`.
  - `publicUrl(key)`: `publicBaseUrl` + `/` + key com cada segmento codificado.
- Chaves de objeto: só `[a-z0-9/_.-]`; função `safeKey(parts: string[])` que normaliza.
- Erros HTTP → texto pt-BR curto: 403 "Chaves ou permissões recusadas pelo armazenamento", 404 "Bucket não encontrado", 301/307 "Região ou endpoint errado", rede "Não foi possível falar com o armazenamento", padrão "Armazenamento respondeu <status>". Nunca inclua chaves ou assinatura na mensagem.
- Hosts: toda URL passa pela checagem de host contra `new URL(config.endpoint).host` e `new URL(config.publicBaseUrl).host` (use `redesAllowedUrl(url, hosts)` de `main/redes/hosts.ts` se o 69 já tiver criado; senão, implemente localmente `assertHost(url, hosts)` em `s3.ts`).

### `media-host.ts` (substitui o stub do 69 mantendo a assinatura)
```ts
export interface MediaHostTestResult { ok: boolean; detail: string }
export type MediaHostTester = (config: MediaHostConfig, secretAccessKey: string, fetch: HttpFetch) => Promise<MediaHostTestResult>
export const testMediaHost: MediaHostTester
```
`testMediaHost`: valida a config (URLs https, bucket e região não vazios; aceita `http://` só para `127.0.0.1`/`localhost`, que é o que o smoke usa), faz `put` de 1 byte em `instagram/_teste/<uuid>.txt` com `text/plain`, faz `GET` em `publicUrl` do mesmo objeto (sem assinatura) e exige 200 com o mesmo byte, faz `delete`. Resultado: `{ ok: true, detail: 'Upload e leitura pública ok' }` ou `{ ok: false, detail }` com o passo que falhou ("Upload falhou: …", "O endereço público não devolveu o arquivo (status …): confira a URL pública base e o acesso público do bucket", "Não consegui apagar o arquivo de teste: …"). Também exporte `uploadMedia(client, key, bytes, contentType)` e `removeMedia(client, key)` finos, que o contrato 71 vai usar.

### `fake-s3.ts`
`createFakeS3({ endpoint, bucket, publicBaseUrl, accessKeyId, secretAccessKey })` → `HttpFetch` em memória que: valida o cabeçalho `Authorization` (prefixo `AWS4-HMAC-SHA256 Credential=<accessKeyId>/`), e, quando `strictSignature: true`, recalcula a assinatura com `signS3Request` e recusa 403 se diferir; guarda objetos em `Map`; responde PUT 200, GET público em `publicBaseUrl/<key>` 200 com o corpo (404 se não existir), DELETE 204, HEAD 200/404; `calls` registrados sem segredos; `objects()` para inspeção. Será injetado no smoke pelo contrato 71.

### Testes
- `redes-s3.test.ts`: (a) vetor oficial da AWS "get-vanilla" (`AKIDEXAMPLE` / `wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY`, `20150830T123600Z`, região `us-east-1`, serviço `service`, `GET /`, host `example.amazonaws.com`) → assinatura `5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31`; (b) PUT com payload: a canonical request contém o sha256 do corpo e o `fake-s3` em `strictSignature` aceita; (c) chave com espaço/acentos é normalizada; (d) `publicUrl` e `objectUrl` nos dois modos; (e) host fora da lista é recusado antes de chamar `fetch`; (f) erros 403/404/301 viram os textos.
- `redes-media-host.test.ts`: teste completo ok com o `fake-s3`; falha no GET público (fake sem o objeto público) → texto do passo; config inválida (http em host remoto) → recusa sem chamar `fetch`; o objeto de teste é apagado ao fim.

## Critérios de aceite
Testes acima verdes; `typecheck` e `lint` verdes no worktree; nenhuma dependência nova; nenhum segredo em mensagens de erro; só os cinco arquivos tocados.

## Invariantes
Não alterar nada fora dos cinco arquivos. Não rodar o smoke (é do 69).

## Fora de escopo
UI, IPC, cofre, agendamento, upload retomável da Meta (71).

## Gates
`cd /Users/andrew/Documents/GitHub/meeting-scribe-redes-instagram/apps/desktop && pnpm -s typecheck && pnpm -s lint && pnpm -s vitest run test/redes-s3.test.ts test/redes-media-host.test.ts` (ajuste o comando do vitest ao script existente em `package.json`).

## Relatório final (formato)
Arquivos (uma linha cada), resultado dos testes (contagem), se precisou declarar tipos localmente (TODO 69), diferenças em relação ao contrato e por quê.
