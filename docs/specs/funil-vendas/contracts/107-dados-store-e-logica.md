# Contrato 107: Dados, store e lógica pura do funil

Feature `funil-vendas` · Wave 1 · Depende de: nada · Spec `../spec.md` (Modelo de dados; R1 a R7; R27 no store; CA1 a CA4) · Plan `../plan.md` (D1, D2, D19, D20) · Mockup: nenhum (sem tela). **Você não commita.** Worktree `/Users/andrew/Documents/GitHub/meeting-scribe-funil-107` (branch `funil-107`, a partir da `funil-vendas` em dd106ce). Roda em paralelo com 108 e 109: você só cria os seis arquivos da Superfície.

## Pré-condições
- Leia na spec "Modelo de dados" (inclusive `Oportunidade.emails`, reunião apagada e `formatarBRL`) e R1 a R7 e R27; no plan D1, D2, D19 e D20.
- No código (relativo a `apps/desktop/`): `src/main/schedules/store.ts:40-120` (`fileSchema`, `serialQueue()` em 49-56, `atomicWrite()` em 58-62, `load()` com quarentena); um esquema com checagem `Same<>` (`src/shared/meeting-summary.ts` + `src/shared/meeting-summary-schema.ts`); `phoneOfChatId()` em `src/shared/assistant.ts:430`.
- Se o contrato 93 da frente `arquitetura-seguranca` (`src/main/storage/json-file.ts`) já estiver na main, use o helper no lugar da cópia (D19) e diga no relatório.

## Superfície

### `src/shared/funil.ts` (tipos e constantes)
- `Contato`, `Empresa`, `Etapa`, `Oportunidade` (com `emails: { accountId: string; id: string; assunto: string; de: string; data: number }[]`, **sem** `emailMessageIds`), `EventoFunil`, `Ignorado` exatamente como "Modelo de dados" da spec; `FunilState = { version: 1; contatos; empresas; oportunidades; etapas; eventos; ignorados; ultimoAvisoEm: number | null }`.
- Uniões exportadas `ContatoOrigem`, `OportunidadeOrigem`, `EtapaTipo`, `EventoFunilTipo`.
- Constantes: `FUNIL_FILE = 'funil.json'`, `FUNIL_VERSION = 1`, `FUNIL_BACKUPS_MAX = 7`, `FUNIL_CONTATOS_MAX = 10000`, `FUNIL_EMPRESAS_MAX = 2000`, `FUNIL_OPORTUNIDADES_MAX = 5000`, `FUNIL_EVENTOS_MAX = 50000`, `FUNIL_NOME_MAX = 200`, `FUNIL_EMAILS_MAX = 10`, `FUNIL_TELEFONES_MAX = 10`, `FUNIL_NOTAS_MAX = 20000`, `FUNIL_ETAPA_NOME_MAX = 60`, `FUNIL_OPORTUNIDADE_EMAILS_MAX = 200`, `FUNIL_DIAS_ESFRIAR_PADRAO = 7`, `PROVEDORES_PESSOAIS` (lista de R5).
- Entradas: `ContatoInput { id?; nome; emails: string[]; telefones: string[]; empresaId?: string | null; empresaNome?: string | null; cargo?: string | null; notas?: string; whatsappChatId?: string | null }`, `EmpresaInput { id?; nome; dominios: string[]; site?: string | null; notas?: string }`, `OportunidadeInput { id?; titulo; empresaId?: string | null; empresaNome?: string | null; contatoIds?: string[]; etapaId?: string; valor?: number | null; previsao?: string | null; proximoPasso?: { texto; data: string | null } | null; meetingIds?: string[]; whatsappChatIds?: string[]; emails?: Oportunidade['emails']; origem?: OportunidadeOrigem; motivoPerda?: string | null }`, `EtapaInput { id?; nome; tipo: EtapaTipo }`.
- `FunilErro = 'limite' | 'etapa-fixa' | 'etapa-em-uso' | 'empresa-em-uso' | 'nao-encontrado' | 'duplicado' | 'nao-fechada' | 'invalido'` e `FunilResult<T> = { ok: true; value: T; state: FunilState } | { ok: false; erro: FunilErro }`.

### `src/shared/funil-schema.ts`
`funilStateSchema` (zod 4) com os limites acima, `valor` inteiro `>= 0` ou `null`, datas `^\d{4}-\d{2}-\d{2}$` ou `null`, `ultimoAvisoEm` com `.catch(null)`; `Same<z.infer<typeof funilStateSchema>, FunilState>`.

### `src/shared/funil-logic.ts` (puro, sem Node nem Electron)
- `normalizarEmail(texto): string | null`: `trim` + minúsculas; `null` sem o formato `local@dominio.tld`.
- `normalizarTelefone(texto): string | null` (R3): remove tudo que não é dígito; remove um `0` de tronco inicial; 10 ou 11 dígitos recebem `+55`; 12 ou 13 dígitos começando com `55` recebem `+`; outro texto não vazio fica com os dígitos limpos; vazio vira `null`.
- `mesmoTelefone(a, b): boolean` (R3): iguais depois de normalizar ou, os dois em `+55` com o mesmo DDD, iguais sem o nono dígito (`+5511987654321` = `+551187654321`).
- `semAcento(texto)`, `dominioDe(email)`, `ehProvedorPessoal(dominio)`, `nomeEmpresaDoDominio(dominio)` (`acme.com.br` → `Acme`, `cliente.example` → `Cliente`, `mail.acme.com.br` → `Acme`), `empresaPorDominio(empresas, email)`.
- `etapasPadrao(newId): Etapa[]` (as 6 da spec, `ordem` 0 a 5).
- `ultimaInteracao({ oportunidade, reunioes: { startedAt: string }[], emails: { date: number }[], whatsapp: { at: number }[] }): number` (R7: o maior entre `movidoEm`, `atualizadoEm`, `Date.parse(startedAt)`, `date`, `at` e os `data` de `oportunidade.emails`).
- `esfriada(oportunidade, etapa, ultima, dias, now)`: só etapa `aberta`; `now - ultima > dias * 86_400_000`.
- `passoVencido(proximoPasso, hoje)`, `previsaoVencida(previsao, hoje)` (`< hoje`, `AAAA-MM-DD` local), `diasNaEtapa(movidoEm, now)`.
- `totaisDoFunil(state, now, timeZone): { abertas; emAberto; ganhoNoMes }` (centavos; ignora arquivadas).
- `formatarBRL(centavos: number | null): string`: `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })` sem casas decimais quando os centavos são zero (`R$ 38.000`) e com 2 casas nos outros casos (`R$ 1.250,50`); `null` devolve o caractere U+2014 (no código, a sequência de escape `\u2014`).

### `src/main/funil/store.ts`
`createFunilStore({ dir, now?, newId?, log? }): FunilStore`, com `serialQueue()` e `atomicWrite()` copiados de `schedules/store.ts:49-62` (`mode 0o600`). Toda mutação passa pela fila, grava o arquivo inteiro e devolve `FunilResult`.
- **Backup diário (R1)**: antes da primeira gravação de cada dia local, se `funil.json` existe e ainda não há `funil.json.bak-<AAAA-MM-DD>` do dia, copia o arquivo atual para esse nome (`0o600`) e apaga os `.bak-*` mais antigos até sobrarem 7.
- `read()`: arquivo ausente → estado vazio com `etapasPadrao` e `ultimoAvisoEm: null` (não grava); inválido → `rename` para `funil.json.corrupt-<Date.now()>`, uma linha em `log`, estado vazio (R2).
- `saveContato(input, origem)`: cria (sem `id`) ou edita. Normaliza e-mails e telefones (R3), descarta `null`, deduplica (telefones por `mesmoTelefone`). Criar exige `nome` (1 a 200) e ao menos um e-mail ou telefone (`invalido`). Criar com e-mail ou telefone (por `mesmoTelefone`) de outro contato **mescla** nele (R4: acrescenta e-mails e telefones até os limites; preenche `empresaId`, `cargo` e `whatsappChatId` só se vazios; nunca troca `nome` nem `notas`; **arquivado vira `false`**) e devolve `value: { contato, mesclado: true }`. Editar com e-mail ou telefone de outro contato → `duplicado`. Empresa: `empresaNome` acha por `semAcento(nome)` ou cria (D20); sem empresa, domínio não pessoal liga à empresa com esse domínio (R5).
- `arquivarContato(id)`, `saveEmpresa(input)` (domínios em minúsculas, sem `@`), `deleteEmpresa(id)` (`empresa-em-uso` com contato ou oportunidade ligada).
- `saveOportunidade(input)`: criar exige `titulo` (1 a 200); `etapaId` padrão = primeira `aberta`; entra no topo da coluna; `contatoIds`/`empresaId` precisam existir (`nao-encontrado`); `valor` inteiro `>= 0` ou `null`; eventos `criada`, `valor`, `proximo-passo`; `etapaId` diferente na edição aplica `moverOportunidade`. `meetingIds` guarda ids mesmo de reunião que não existe mais (o store não confere reuniões).
- `moverOportunidade({ id, etapaId, ordem, motivoPerda? })` (R6): `movidoEm = now`; evento `etapa` com `de`/`para`; destino final preenche `fechadoEm` (e `motivoPerda`); de final para `aberta` limpa os dois e cria `reaberta`; reordena origem e destino.
- `arquivarOportunidade(id)` (R27): só em etapa `ganho` ou `perdido` (senão `nao-fechada`); `arquivado = true`.
- `deleteOportunidade(id)` (com os eventos dela), `saveEtapas(lista)` (finais com os mesmos ids e tipos, senão `etapa-fixa`; tirar `aberta` com qualquer oportunidade → `etapa-em-uso`; ao menos uma aberta e nomes 1 a 60, senão `invalido`), `addEvento({ oportunidadeId, tipo: 'nota', texto })`, `ignorar(chave)`, `importarContatos(entradas, origem)` (uma escrita; cada entrada pela regra de `saveContato`; `{ criados, atualizados }`), `setUltimoAviso(at)`.
- Limites de "Modelo de dados": passar de qualquer um devolve `limite` e não grava.

## Critérios de aceite
- **CA1** (CA1 da spec) Dado o store vazio num diretório temporário, quando `saveContato({ nome: 'Ana', emails: ['Ana@ACME.com.br '], telefones: ['(11) 98765-4321'] }, 'manual')`, então `contatos[0].emails = ['ana@acme.com.br']` e `telefones = ['+5511987654321']`; quando `saveContato({ nome: 'Ana Souza', emails: ['ana@acme.com.br'], telefones: [] }, 'importacao')`, então `mesclado === true`, `contatos.length === 1` e o nome continua `'Ana'` (`test/funil-store.test.ts`).
- **CA2** (R4) Dado um contato arquivado com telefone `+5511987654321`, quando `saveContato` cria outro com telefone `(11) 8765-4321`, então mescla nele (`mesclado: true`) e `arquivado === false`.
- **CA3** (R5) Dado uma empresa com `dominios: ['acme.com.br']`, quando cria contato com `y@acme.com.br`, então `empresaId` é o dela; com `y@gmail.com`, fica `null`.
- **CA4** (CA2 da spec, R2) Dado `funil.json` com `{quebrado`, quando `read()`, então existe `funil.json.corrupt-*` com o conteúdo `{quebrado`, o estado tem 6 etapas e `log` recebeu uma linha.
- **CA5** (CA2 da spec) `saveEtapas` sem `Ganho` → `etapa-fixa`; sem `Contato` com oportunidade nela → `etapa-em-uso`; com `Contato` vazia, ela some e as abertas ficam com `ordem` 0 a 2.
- **CA6** (CA3 da spec) Dada uma oportunidade em `Proposta`, quando move para `Perdido` sem motivo, então `ok: true`, `fechadoEm` preenchido e evento `etapa` (`de: 'Proposta'`, `para: 'Perdido'`); de volta para `Proposta`, `fechadoEm === null`, `motivoPerda === null` e o último evento é `reaberta`.
- **CA7** (R27) `arquivarOportunidade` de uma aberta → `nao-fechada`; de uma em `Ganho` → `arquivado: true`.
- **CA8** (R1) Com `now` injetado no dia D, a primeira mutação cria `funil.json.bak-D` com o conteúdo de antes; a segunda mutação no mesmo dia não cria outro; com 7 backups de dias anteriores, a primeira mutação de um dia novo deixa exatamente 7 (o mais antigo sai).
- **CA9** Limite: com 10 000 contatos, criar mais um → `limite` e o arquivo não muda. Fila: duas mutações sem `await` entre elas aparecem as duas no arquivo final, modo `0o600`. Editar B com e-mail de A → `duplicado`. Nova oportunidade sem `etapaId` entra em `Contato` com `ordem: 0` e as outras descem.
- **CA10** (CA4 da spec) `test/funil-logic.test.ts`: `ultimaInteracao` devolve o maior de cada fonte (inclusive `oportunidade.emails[].data`); `esfriada` com 7 dias é `true` para 8 e `false` para 6; em `ganho` é `false` com 30 dias.
- **CA11** (R3) `normalizarTelefone`: `'+55 (11) 3333-4444'` → `'+551133334444'`; `'1133334444'` → `'+551133334444'`; `'011 98765-4321'` → `'+5511987654321'`; `'5511987654321'` → `'+5511987654321'`; `'12345'` → `'12345'`; `'  '` → `null`. `mesmoTelefone('+5511987654321', '+551187654321') === true`, `mesmoTelefone('+5511987654321', '+5521987654321') === false`.
- **CA12** `formatarBRL(3800000)` = o formatador com `maximumFractionDigits: 0` aplicado a `38000`; `formatarBRL(125050)` = o formatador padrão aplicado a `1250.5`; `formatarBRL(null)` é o caractere U+2014; `normalizarEmail('sem-arroba') === null`; `nomeEmpresaDoDominio('acme.com.br') === 'Acme'`; `totaisDoFunil` ignora arquivadas e soma o ganho do mês.

## Invariantes
- Só os seis arquivos da Superfície mudam; `src/main/schedules/store.ts` não muda.
- Nenhum outro store, canal ou tela é tocado; `funil.json` só é gravado por mutação.

## Fora de escopo desta tarefa
Serviço, IPC, sugestões, linha do tempo e importação de arquivo (110, 108); configurações (109); telas; detecção (111). Restaurar backup pela interface.

## Gates
`cd /Users/andrew/Documents/GitHub/meeting-scribe-funil-107 && SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde. Testes novos: `test/funil-store.test.ts` (CA1 a CA9) e `test/funil-logic.test.ts` (CA10 a CA12), com diretório temporário e `now`/`newId` injetados.

## Relatório final (formato)
Arquivos (uma linha cada); gates (contagens, testes novos); se usou o helper do 93 ou a cópia; assinaturas exportadas de `store.ts` e `funil-logic.ts`; diferenças em relação ao contrato e por quê.
