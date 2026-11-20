# Contrato 92 — Atualização com raiz de confiança: a assinatura conferida antes de abrir o `.dmg`
Feature: arquitetura-seguranca · Wave: 3 · Depende de: 91 (e da D1, pela variante) · Spec/Plan: `docs/specs/arquitetura-seguranca/{spec,plan}.md` (RASCUNHO, aguardam aprovação)

Microtarefa S9 do plan, requisito **R6** (decisão técnica T7). Hoje o updater (contrato 14) baixa o `.dmg` e o `.sha256` **do mesmo release** (`updates/download.ts:141-216`), confere um contra o outro e abre o `.dmg` (`updates/service.ts:143`). Quem consegue publicar no release (conta do GitHub comprometida, token vazado) troca os dois juntos e o app abre o arquivo dele. A raiz de confiança passa a estar **no código do app**: um Team ID fixo (Variante A) ou uma chave pública fixa (Variante B). O `.sha256` continua, só como checagem de integridade do download.

Duas variantes, **a mesma do 91**: o coordenador entrega ao implementador só a que a D1 decidiu. A parte comum vale para as duas.

## Pré-condições
- O 91 commitado na `main`, na mesma variante. Na A, `src/shared/release-signing.ts` (`LAP_TEAM_ID`, `LAP_BUNDLE_ID`) existe e o `pack.sh` gera `.app` e `.dmg` assinados, notarizados e grampeados.
- Gates verdes na `main`.
- Ler antes: `src/main/updates/{release,download,service,transport}.ts` (inteiros), `src/shared/updates.ts`, `src/main/index.ts:1551-1566` (a ligação do serviço), `src/main/smoke-fixtures.ts:285-345` (`createSmokeUpdates`), o passo de atualização do smoke (`src/main/smoke.ts`, em torno de `:2530-2580`) e `test/updates.test.ts:343-378` (a fábrica `service()` dos testes).

## Superfície (caminhos relativos a `apps/desktop/`)
| Arquivo | O que muda | Variante |
|---|---|---|
| `src/main/updates/verify.ts` | **novo**: `UpdateVerifier`, os motivos de recusa e o verificador da variante (CA1; CA6–CA10 ou CA6B–CA9B) | comum |
| `src/main/updates/service.ts` | `UpdateServiceOptions.verify: UpdateVerifier` **obrigatório**; roda entre o download conferido e o `openPath` (CA2, CA3) | comum |
| `src/shared/updates.ts` | `UPDATE_SIGNATURE_MESSAGE` (CA3); o comentário do topo deixa de dizer "sem conta de desenvolvedor" na A | comum |
| `src/main/index.ts` | só a ligação de `verify` em `createUpdateService` (`:1551`), real fora do smoke e o do smoke dentro (CA4) | comum |
| `src/main/smoke-fixtures.ts`, `src/main/smoke.ts` | o caso "assinatura que não confere" no passo de atualização (CA4) | comum |
| `test/updates.test.ts` | a fábrica `service()` ganha `verify` (padrão: aceita); `describe('assinatura do .dmg (contrato 92)')` novo (CA5) | comum |
| `test/updates-verify-live.test.ts` | **novo**, só roda com `LAP_VERIFY_DMG_OK` e `LAP_VERIFY_DMG_BAD` (CA11) | A |
| `src/main/updates/release.ts` | `UpdateRelease.signatureUrl: string \| null` do asset `<dmg>.sig` (CA6B) | B |
| `src/main/updates/download.ts` | só exporta o leitor de asset pequeno que o `.sha256` já usa (`readSha256`, `:128-138`), para o `.sig` | B |
| `src/main/updates/update-key.ts` | **novo**: `UPDATE_PUBLIC_KEY` (SPKI, PEM, ed25519) | B |
| `scripts/update-key.mjs`, `scripts/sign-update.mjs` | **novos**: gerar a chave uma vez e assinar o `.dmg` no `release.sh` (CA10B) | B |
| `scripts/release.sh` | assina depois do `pack.sh` e põe o `.sig` no comando `gh release create` impresso (CA10B) | B |

Nada no renderer: a mensagem nova chega pelo `download.message` que `UpdatesSection.tsx:62-65` já mostra em `[data-update-error]`.

## Critérios de aceite

### Comum
- **CA1 — Contrato do verificador.** `type UpdateVerifier = (input: { path: string; release: UpdateRelease; signal: AbortSignal }) => Promise<{ ok: true } | { ok: false; reason: UpdateVerifyReason }>`, com `UpdateVerifyReason` uma união fixa (A: `'mount' | 'no-app' | 'signature' | 'gatekeeper' | 'version' | 'timeout' | 'cancelled'`; B: `'no-signature' | 'signature' | 'timeout' | 'cancelled'`). Nunca lança: erro inesperado vira `signature`.
- **CA2 — Ordem.** Em `runDownload`: (1) download e SHA-256 como hoje (falha de hash continua `UPDATE_HASH_MISMATCH_MESSAGE`, sem chamar o verificador); (2) `verify`; (3) só com `ok: true`, o `openPath` de hoje e a fase `ready`. Enquanto verifica, a fase continua `downloading` com `percent: 100` (nenhuma fase nova na tela).
- **CA3 — Recusa.** `ok: false`: o `.dmg` baixado é apagado de Downloads (`rm` com `force`), `openPath` **não** é chamado, a fase vira `{ phase: 'failed', message: UPDATE_SIGNATURE_MESSAGE }` com `UPDATE_SIGNATURE_MESSAGE = 'A atualização baixada não tem a assinatura da LAP e não foi aberta.'`, e o log de desenvolvimento recebe só `[updates] assinatura recusada (<reason>)`. "Atualizar" de novo baixa outra vez (como depois de um hash errado). `cancelled` (saída do app) volta a fase a `idle`, como o download cancelado hoje.
- **CA4 — Smoke.** No passo de atualização, antes do download que dá certo, um caso com a assinatura errada: `[data-update-error]` mostra exatamente `UPDATE_SIGNATURE_MESSAGE`, nenhum `.dmg` fica em `Downloads` do smoke e `openedFiles` não cresce; depois o download normal termina em `ready` como hoje. Na A o smoke usa um verificador falso (`smokeFixtures.updates.badSignature` decide); na B, o verificador **real** com uma chave gerada pelo smoke (CA11B).
- **CA5 — Testes.** `describe('assinatura do .dmg (contrato 92)')`: CA2 (o verificador não roda com hash errado; roda antes do `openPath`), CA3 (arquivo apagado, mensagem exata, `openPath` com 0 chamadas, log sem chave nem caminho de chave), e os casos da variante abaixo. Os testes que já existem passam com a fábrica recebendo só `verify: overrides.verify ?? (() => Promise.resolve({ ok: true }))`.

### Variante A — Team ID fixo (`codesign`)
- **CA6 — Requisito fixo no código.** `verify.ts` exporta `UPDATE_REQUIREMENT`, montado de `LAP_TEAM_ID` e `LAP_BUNDLE_ID`: `anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] and certificate leaf[field.1.2.840.113635.100.6.1.13] and certificate leaf[subject.OU] = "<LAP_TEAM_ID>" and identifier "com.lap.reunioes"` (os dois OIDs exigem cadeia "Developer ID"; certificado de desenvolvimento do mesmo time não passa).
- **CA7 — Montar sem abrir.** `execFile('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', <pasta de mkdtemp>, <dmg>])`, sem shell, `stdin` ignorado, prazo 60 s (um `.dmg` com contrato de licença espera resposta e cai no prazo: `timeout`). Falha ao montar: `mount`.
- **CA8 — O app de dentro.** `<ponto>/LAP Reuniões.app` tem de existir e ser pasta de verdade (`lstat`, não link): senão `no-app`. Depois, em ordem, cada um com prazo de 60 s: `/usr/bin/codesign --verify --strict --deep -R=<UPDATE_REQUIREMENT> <app>` sai 0 (senão `signature`); `/usr/sbin/spctl --assess --type execute -vv <app>` sai 0 e o stderr contém `source=Notarized Developer ID` (senão `gatekeeper`); `/usr/bin/plutil -extract CFBundleShortVersionString raw -o - <app>/Contents/Info.plist` é igual a `release.version` (senão `version`: barra um `.dmg` antigo, legítimo, publicado com o nome da versão nova).
- **CA9 — Sempre desmonta.** Com sucesso, recusa, prazo ou exceção: `hdiutil detach <ponto>` e, se falhar, `hdiutil detach -force <ponto>`; a pasta temporária é apagada. *Teste:* com o `codesign` falso lançando, o `detach` é chamado uma vez e a pasta não existe depois.
- **CA10 — Testes com o executor falso.** `createCodesignVerifier({ run })` recebe o `execFile` injetado; casos: tudo certo → `ok`; `attach` falha → `mount`; sem o app → `no-app`; app como link → `no-app`; `codesign` sai 3 → `signature`; `spctl` sem `Notarized Developer ID` → `gatekeeper`; versão `0.18.0` para release `0.19.0` → `version`; prazo → `timeout`; os argumentos de cada chamada conferidos **exatamente** (inclusive o `-R=` com o requisito do CA6).
- **CA11 — Prova com `.dmg` de verdade (opcional nos gates, obrigatória antes de publicar).** `LAP_VERIFY_DMG_OK=<dmg do pack.sh> LAP_VERIFY_DMG_BAD=<dmg de LAP_ASSINATURA=adhoc> pnpm --filter @meeting-scribe/desktop exec vitest run test/updates-verify-live.test.ts`: o primeiro dá `ok`, o segundo `signature`. Sem as variáveis o arquivo é pulado (como os `*-live.test.ts` de hoje). Cobre o passo 5 da verificação end-to-end da spec.

### Variante B — assinatura destacada (ed25519)
- **CA6B — O asset `.sig`.** Cada release leva `LAP-Reunioes-<versão>-arm64.dmg.sig`: o base64 de 64 bytes da assinatura ed25519 de `LAP-Reunioes-update-v1\n<nome do dmg>\n<versão>\n<sha256 em hex minúsculo>\n` (nome, versão e hash amarrados: um `.sig` antigo não vale para outro release). `evaluateRelease` preenche `signatureUrl` com o asset quando ele existe e é do repositório (`isReleaseDownloadUrl`); sem ele, `null` (o release continua `available`, e a recusa vem do verificador, com mensagem na tela).
- **CA7B — Verificação.** O verificador baixa o `.sig` pelo mesmo leitor do `.sha256` (até 4 096 bytes, prazo de 60 s, só do repositório e dos redirecionamentos aceitos), recalcula o SHA-256 do arquivo já baixado e chama `crypto.verify(null, mensagem, createPublicKey(UPDATE_PUBLIC_KEY), assinatura)`. `signatureUrl` nulo → `no-signature`; base64 inválido, tamanho ≠ 64 ou `verify` falso → `signature`.
- **CA8B — Chave pública no código, privada fora.** `UPDATE_PUBLIC_KEY` é a única chave aceita no app empacotado; no smoke, `index.ts` usa a chave que `createSmokeUpdates` gera, e só quando `isSmokeRun`. A chave privada **nunca** está no repositório: `scripts/update-key.mjs generate` cria o par, guarda a privada (PKCS#8 DER em base64) no **chaveiro de login** como senha genérica `-s lap-reunioes-update -a lap` e imprime só a pública em PEM para colar em `update-key.ts`, com o aviso de guardar uma cópia da privada no gerenciador de senhas do Andrew (perdida a chave, as instalações antigas não aceitam mais atualização e precisam de instalação manual).
- **CA9B — Testes.** Com um par gerado no teste e injetado: assinatura certa → `ok`; mensagem com outra versão, outro nome ou outro hash → `signature`; `.sig` com 63 bytes ou base64 quebrado → `signature`; sem `signatureUrl` → `no-signature`; `.sig` de 5 000 bytes → `signature` sem ler tudo; e um teste que `UPDATE_PUBLIC_KEY` é ed25519 (`asymmetricKeyType === 'ed25519'`) e diferente da chave do smoke.
- **CA10B — Release sem chave não sai.** `release.sh`, depois do `pack.sh`: `node scripts/sign-update.mjs dist/<dmg>` lê a privada com `security find-generic-password -s lap-reunioes-update -a lap -w` (saída capturada, nunca impressa), escreve `dist/<dmg>.sig` e o confere contra `UPDATE_PUBLIC_KEY` antes de terminar; sem a chave no chaveiro ou com a conferência falhando, sai 1 com `release.sh: falta a chave de assinatura da atualização (node scripts/update-key.mjs generate)` ou `release.sh: a chave do chaveiro não é a de update-key.ts`. O `gh release create` impresso no fim leva `dist/*.sig`.
- **CA11B — Smoke com cripto de verdade.** `createSmokeUpdates` gera um par, serve o `.sig` do `.dmg` falso como asset do release e tem `wrongSignature` (assina outra versão); o passo do CA4 liga `wrongSignature` para o caso de recusa.

## Invariantes
- **Atualização legítima continua igual para quem usa:** mesmo aviso, mesmo "Baixando… N%", mesmo `ready` com `UPDATE_INSTALL_INSTRUCTION`, mesmo `.dmg` aberto no Finder. Âncora: o passo de atualização do smoke, sem mudança nas checagens que já existem.
- Os testes de `test/updates.test.ts` que já existem passam só com a fábrica alterada (CA5); `transport.ts` sem diff.
- O `.sha256` continua conferido **antes** e com a mesma mensagem; o verificador nunca roda num arquivo com hash errado.
- **N5:** nem a chave pública, nem a privada, nem o caminho da privada, nem a saída do `security` aparecem em log, mensagem de erro, estado (`UpdateState`) ou relatório de teste. Na A, o log não leva a saída do `codesign`/`spctl`, só o motivo.
- Nada de rede além de hoje (A: nenhuma; o `spctl` pode consultar a Apple, como qualquer abertura de app); nada é executado de dentro do `.dmg` (montado só leitura, `-noautoopen`, sem `open` no app de dentro).

## Fora de escopo
- O app se substituir sozinho (Squirrel/ShipIt, `autoUpdater`): a pessoa continua arrastando para Aplicativos.
- Rotação de chave (B) e revogação de certificado (A) com mais de uma chave aceita: limitação conhecida, registrada no cofre.
- A versão já instalada (0.18.x) não ganha a verificação: ela vale a partir da primeira versão que inclui este contrato.
- Assinar o `latest.json`; F1–F7 da spec.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde em todos os passos.
- `describe('assinatura do .dmg (contrato 92)')` verde; na A, o CA11 rodado à mão com os dois `.dmg` e a saída no relatório.
- `rg -n "openPath\(" apps/desktop/src/main/updates` mostra uma chamada só, depois do `verify`.
- `git diff --stat` só com os arquivos da Superfície da variante. Sem commit: quem coordena commita pelo agente de commits.

## Dúvidas para o coordenador
- **D-92a — Variante B e a "assinatura do app dentro dele".** A spec (R6) fala em conferir a assinatura **do app dentro do `.dmg`**; na B não há assinatura de app que sirva (ad-hoc), então a B confere o `.dmg` inteiro pela assinatura destacada, o que dá a mesma garantia de origem. Confirmar que atende ao R6.
- **D-92b — `spctl` na A.** O `spctl --assess` pode consultar a Apple e demorar (ou falhar sem internet, apesar do grampo). Se o Andrew preferir não depender dele, o CA8 fica só com `codesign -R` (que já exige Developer ID e o Team ID) e a versão; a notarização continua conferida pelo Gatekeeper na primeira abertura.
- **D-92c — Senha genérica pelo argumento (B).** O `security add-generic-password -w <valor>` do `update-key.mjs` põe a chave na linha de comando por um instante (visível a um `ps` do mesmo usuário). A alternativa é o `-w` sem valor, que pede no terminal e obriga o Andrew a colar a chave. Recomendo o argumento (só roda uma vez, na máquina dele); confirmar.
