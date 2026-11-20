# Contrato 95 — `lock.json`, `links.json` e `aceite.json` com fila
Feature: arquitetura-seguranca · Wave: 2 · Depende de: 93 · Spec/Plan: `docs/specs/arquitetura-seguranca/spec.md`, `plan.md` (RASCUNHO, aguardam aprovação)

Fecha as corridas de R13 em três arquivos: `lock.json` (`lock/store.ts` não tem fila), e `whatsapp/links.json` e `whatsapp/aceite.json`, que hoje fazem ler-mudar-gravar sem serialização (`whatsapp/service.ts:543-546, 857-861, 895-899`): dois `setLink` ao mesmo tempo perdem um vínculo, duas aceitações ao mesmo tempo perdem uma. Tudo passa pelo helper do 93, com o formato em disco igual (N1, N3).

## Pré-condições
- Commit do 93 na branch (nomes do CA1 do 93).
- Ler antes: `src/main/lock/{store,service}.ts`, `src/main/whatsapp/service.ts` (cabeçalho, `writeAtomic` local em 247-252, `readRisk`/`readLinks` em 300-317, `startNow` em 418-436, `acceptRisk`, `link`, `setLink`, `meetingMaterial`, `removeMeeting`), `src/main/whatsapp/install.ts:14-27` (`WHATSAPP_PATHS`), o contrato 93 e os testes das Invariantes.

## Superfície (caminhos relativos a `apps/desktop/`)
| Arquivo | O que muda |
|---|---|
| `src/main/lock/store.ts` | `createJsonFile` por baixo de `read`/`write` (CA1); interface `LockStore` igual |
| `src/main/whatsapp/service.ts` | `aceite.json` e `links.json` por `createJsonFile` (CA2, CA3); o arquivo do token pelo `writeAtomic` do helper (CA4); sai o `writeAtomic` local, `readRisk`, `readLinks` e o `existsSync` |

Nenhum outro arquivo: `lock/service.ts`, `whatsapp/install.ts`, `index.ts`, testes e `smoke.ts` sem diff.

## Critérios de aceite
Âncoras: os testes existentes das Invariantes, e um script descartável do implementador (fora do repo, saída no relatório) para os CAs de concorrência, que chama o store e o serviço reais numa pasta temporária. Para o serviço do WhatsApp, o script monta `createWhatsAppService` como `test/whatsapp.test.ts` monta (serviço instalado falso, sem processo).

- **CA1 — `lock.json`.** `createJsonFile` com `path = join(dir, LOCK_FILE)`, `indent: 2`, `version: LOCK_VERSION`, `serialize: (data) => ({ version: LOCK_VERSION, ...data })` (as chaves na ordem de hoje: `version, password, failures, retryAt, locked`), `parse` = `fileSchema` com os mesmos `.catch`, `defaults` e `fallback` = `{ ...EMPTY_LOCK_DATA }`, `cache: false`, quarentena `keep`, `onInvalid` com o mesmo `console.warn('[lock] lock.json inválido; vale como sem senha')` sem nada do conteúdo, `write.mkdir: false` (hoje não cria pasta). `read()` e `write()` passam pela fila do store.
- **CA2 — `aceite.json`.** `createJsonFile` com `path = root(WHATSAPP_PATHS.risk)`, `indent: 2`, **sem** `version` (o arquivo é `{ "acceptances": [...] }`), `parse` = `riskFileSchema`, inválido ou ausente vale `{ acceptances: [] }` sem aviso, quarentena `keep`, `cache: false`, `write.mkdir: { mode: 0o700 }` (o `mkdir(deps.root, …0o700)` de hoje). `acceptRisk` faz o append (`slice(-500)`) dentro de um `update`.
- **CA3 — `links.json`.** `createJsonFile` com `path = root(WHATSAPP_PATHS.links)`, `indent: 2`, sem `version` (o arquivo é um `Record<meetingId, link>` puro, sem envelope), `parse` = `linksFileSchema`, inválido ou ausente vale `{}`, quarentena `keep`, `cache: false`, `write.mkdir: { mode: 0o700 }`. `setLink` é um `update`; `removeMeeting` é um `run` que lê e, se o id não está lá (ou o arquivo não existe), **não grava nada** — o mesmo efeito do `existsSync` + `in` de hoje, sem fs síncrono. `link` e `meetingMaterial` usam `read()`.
- **CA4 — Token.** O arquivo `WHATSAPP_PATHS.token` passa a ser gravado com `writeAtomic(tokenFile, \`${saved.token}\n\`, { mode: 0o600 })` do helper (mesmos bytes, `0600`) e continua sendo apagado logo depois que o serviço sobe. Nada do token vai para log.
- **CA5 — Formato.** Depois de `acceptRisk({ purpose: 'install' })`, `setLink` de `r1` e `removeMeeting('r2')` (inexistente), os bytes de `aceite.json` e `links.json` são idênticos aos que o HEAD do 93 grava com a mesma sequência e o mesmo relógio (`cmp`); ambos `0600`; `links.json` continua sem `version`.
- **CA6 — Concorrência no WhatsApp.** Partindo de `links.json` ausente: 30 `setLink` simultâneos para `r1`…`r30` → `links.json` com as 30 chaves (hoje, perdem-se). 30 `acceptRisk` simultâneos (alternando `install`/`pair`) → `acceptances` com 30 itens. 20 `setLink` e 10 `removeMeeting` de ids já presentes, intercalados → o arquivo final é o mesmo da execução em série na ordem das chamadas. Nenhum `*.tmp-*` sobra em `whatsapp/`.
- **CA7 — Concorrência no `lock.json`.** 30 `write` simultâneos de `LockStore` com `failures` de 1 a 30 → o arquivo final tem `failures: 30` (a última chamada vence, na ordem de chegada), JSON válido, `0600`; um `read()` chamado depois do 30º `write` (sem `await` entre eles) devolve `failures: 30`.
- **CA8 — Nenhuma cópia local.** `grep -nE "from 'node:fs'|readFile|writeFile|rename\(|chmod" src/main/lock/store.ts` vazio; `grep -nE "function writeAtomic|existsSync|readFile\(|rename\(|writeFile\(|chmod\(" src/main/whatsapp/service.ts` vazio (ficam só `mkdir` da sessão e `rm` do token e das mensagens, que são do 103).

## Invariantes
- Testes verdes **sem alteração** (N3): `test/lock.test.ts` (inclusive o `0600` da linha 124), `test/lock-ipc.test.ts`, `test/whatsapp.test.ts` (aceite `0600` e conteúdo nas linhas 185-192; `setLink`/`removeMeeting` nas 260-263), `test/whatsapp-attach.test.ts`, `test/whatsapp-media.test.ts`, `test/whatsapp-interactions.test.ts`.
- Smoke sem alteração: lê `aceite.json` direto (`smoke.ts:5456-5464`, inclusive o modo `600`) e copia `lock.json` para uma pasta e abre um segundo `createFileLockStore` sobre a cópia (`smoke.ts:5288-5300`). Dois stores em pastas diferentes têm filas independentes, como hoje.
- `lock/service.ts` sem diff: ele já serializa as próprias chamadas (`service.ts:58-65`); a fila do store é a segunda barreira, para qualquer outro chamador (o smoke, o 102).
- "Esqueci a senha" continua: apagar `lock.json` com o app fechado vale como sem senha (sem cópia em memória no store).
- Quarentena, preservada até o 101: nenhum dos três renomeia; inválido vale vazio e o próximo save sobrescreve.
- "Remover" e "Sair da conta" do WhatsApp (`install.ts:181`) não apagam `links.json` nem `aceite.json`, como hoje.

## Fora de escopo
- Quarentena e `version` em `links.json`/`aceite.json` (101, R14/R15); `insights.json` e `transcripts.json` do WhatsApp (96); o `service.bin` (vault, F5); `mkdir`/`rm` restantes do serviço (103).

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde (8 passos; 9 se o 88 já entrou).
- `git diff --stat` só com os dois arquivos da Superfície; nenhum teste novo nem alterado; a saída do script de CA5–CA7 no relatório.
- Sem commit: quem coordena commita pelo agente de commits.

## Dúvidas para o coordenador
- **Q1 — A corrida do `lock.json` é teórica hoje.** Todo acesso de produção passa pela fila do `lock/service.ts`; a fila no store (R13) protege só de chamadores futuros. Mantido como a spec pede; o CA7 confere a ordem, não um bug atual.
