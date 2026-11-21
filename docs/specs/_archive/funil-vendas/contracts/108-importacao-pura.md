# Contrato 108: Importação de contatos (módulo puro CSV e vCard)

Feature `funil-vendas` · Wave 1 · Depende de: nada · Spec `../spec.md` (R14, R15, R16 parte pura; CA5; "Modelo de dados" limites de importação) · Plan `../plan.md` (D2) · Mockup: nenhum (sem tela; a prévia e os Selects são do 114). **Você não commita.** Worktree `/Users/andrew/Documents/GitHub/meeting-scribe-funil-108` (branch `funil-108`, a partir da ponta da `funil-vendas`). Roda em paralelo com 107 e 109: você só cria `src/shared/funil-import.ts`, `test/funil-import.test.ts` e `test/fixtures/funil/*`.

## Pré-condições
- Leia na spec R13 a R16, CA5 e os limites "Arquivo de importação ≤ 5 MB e ≤ 10 000 linhas".
- Precedente de módulo puro com teto de bytes: `src/shared/invite.ts` (`INVITE_ICS_MAX_BYTES`, leitura sem Node).
- Este módulo **não** importa `src/shared/funil.ts` (que nasce no 107, em paralelo): os tipos de saída são próprios e estruturalmente compatíveis com `ContatoInput` (`nome`, `emails`, `telefones`, `empresaNome`, `cargo`).

## Superfície

### `src/shared/funil-import.ts` (puro: recebe `Uint8Array` e texto, sem `fs`, sem Electron)
- Constantes: `IMPORT_BYTES_MAX = 5 * 1024 * 1024`, `IMPORT_LINHAS_MAX = 10000`, `IMPORT_PREVIA_LINHAS = 5`, `IMPORT_EXTENSOES = ['csv', 'vcf', 'txt'] as const`.
- Tipos: `CampoImport = 'nome' | 'email' | 'telefone' | 'empresa' | 'cargo' | 'ignorar'`; `EntradaImport { nome: string; emails: string[]; telefones: string[]; empresaNome: string | null; cargo: string | null }`; `LeituraImport = { ok: true; tipo: 'csv'; separador: ',' | ';' | '\t'; codificacao: 'utf-8' | 'latin1'; colunas: string[]; mapeamento: CampoImport[]; linhas: string[][]; previa: string[][] } | { ok: true; tipo: 'vcard'; codificacao: 'utf-8' | 'latin1'; entradas: EntradaImport[]; previa: EntradaImport[] } | { ok: false; erro: 'arquivo-grande' | 'linhas-demais' | 'formato' }`.
- `decodificar(bytes): { texto: string; codificacao: 'utf-8' | 'latin1' }`: UTF-8 com ou sem BOM (`EF BB BF` removido); se a decodificação UTF-8 estrita falhar (`TextDecoder('utf-8', { fatal: true })`), Latin-1 (`TextDecoder('latin1')`).
- `lerCsv(texto)`: separador detectado pela primeira linha (o de maior contagem entre `,` `;` `\t` fora de aspas); aspas duplas com `""` escapado e quebra de linha dentro de aspas; linhas vazias ignoradas; primeira linha é cabeçalho.
- `mapearCabecalho(colunas): CampoImport[]` (R14): compara `semAcento` + minúsculas + `trim` com as listas da spec: `nome|name|contato|full name|first name|last name` → `nome`; `email|e-mail|correio` → `email`; `telefone|phone|celular|whatsapp|mobile|tel` → `telefone`; `empresa|company|organizacao|organization` → `empresa`; `cargo|title|job title|funcao` → `cargo`; resto → `ignorar`. (Tenha uma função local `semAcento`, sem importar do 107.)
- `aplicarMapeamento(linhas, mapeamento): { entradas: EntradaImport[]; ignorados: number }`: várias colunas `nome` juntam com um espaço na ordem das colunas (`First name` + `Last name`); várias `email`/`telefone` acumulam; valores com `trim`, vazios descartados; linha sem nome **ou** sem nenhum e-mail e nenhum telefone conta em `ignorados` e não entra (R16).
- `lerVcard(texto)`: cartões `BEGIN:VCARD` a `END:VCARD`, versões 2.1, 3.0 e 4.0; desdobra linhas continuadas (começam com espaço ou tab); parâmetros ignorados (`EMAIL;TYPE=work:`), `ENCODING=QUOTED-PRINTABLE` decodificado; `FN` ou, sem ele, `N` (`Sobrenome;Nome` vira `Nome Sobrenome`); todos os `EMAIL` e `TEL`; `ORG` (primeiro componente antes de `;`) e `TITLE`; cartão sem nome ou sem e-mail e telefone não entra.
- `lerArquivo(bytes, nomeArquivo): LeituraImport`: `bytes.length > IMPORT_BYTES_MAX` → `arquivo-grande`; extensão `vcf` ou texto que começa com `BEGIN:VCARD` → vCard; senão CSV; mais de `IMPORT_LINHAS_MAX` linhas de dados (ou cartões) → `linhas-demais`; CSV sem cabeçalho ou vCard sem nenhum cartão → `formato`; `previa` = as 5 primeiras linhas (ou entradas).

### `test/fixtures/funil/`
`contatos-ponto-e-virgula-bom.csv` (UTF-8 com BOM, `;`, cabeçalho `Nome;E-mail;Telefone;Empresa`, 4 linhas: 3 completas e 1 sem e-mail nem telefone), `contatos-first-last.csv` (`First name,Last name,Email`, 2 linhas), `contatos-latin1.csv` (bytes Latin-1 com "João" e "Organização"), `contatos-3.0.vcf` (2 cartões vCard 3.0, 2 `EMAIL` cada, um com linha dobrada), `contatos-2.1.vcf` (1 cartão 2.1 com `N` e `QUOTED-PRINTABLE`). Arquivos pequenos e fictícios (domínios `.example`).

## Critérios de aceite
- **CA1** (CA5 da spec) Dado `contatos-ponto-e-virgula-bom.csv`, quando `lerArquivo` e `aplicarMapeamento(linhas, mapeamento)`, então `separador === ';'`, `codificacao === 'utf-8'`, `colunas[0] === 'Nome'` (sem BOM), `mapeamento = ['nome','email','telefone','empresa']`, `entradas.length === 3` e `ignorados === 1`.
- **CA2** (CA5 da spec) Dado `contatos-first-last.csv`, quando aplicado o mapeamento automático, então `mapeamento = ['nome','nome','email']` e `entradas[0].nome` é `'<First> <Last>'` da primeira linha.
- **CA3** (CA5 da spec) Dado `contatos-3.0.vcf`, quando `lerArquivo`, então `tipo === 'vcard'`, `entradas.length === 2` e cada uma tem `emails.length === 2`; a linha dobrada vira um valor só.
- **CA4** (CA5 da spec) Dado um `Uint8Array` de `5 * 1024 * 1024 + 1` bytes, quando `lerArquivo`, então `{ ok: false, erro: 'arquivo-grande' }`; com exatamente `5 * 1024 * 1024` bytes de um CSV válido, não devolve `arquivo-grande`.
- **CA5** Dado `contatos-latin1.csv`, quando `lerArquivo`, então `codificacao === 'latin1'`, a prévia contém `'João'` e o cabeçalho `'Organização'` mapeia para `empresa`.
- **CA6** Dado um CSV com 10 001 linhas de dados, quando `lerArquivo`, então `linhas-demais`; dado um arquivo vazio, `formato`.
- **CA7** Dado `contatos-2.1.vcf`, quando `lerArquivo`, então o nome vem de `N` na ordem "Nome Sobrenome" e o texto `QUOTED-PRINTABLE` sai decodificado.
- **CA8** Dado um CSV com campo entre aspas contendo `;` e quebra de linha, quando `lerCsv`, então o campo fica inteiro numa célula e o número de linhas não aumenta.
- **CA9** Dada uma coluna `Celular` e outra `WhatsApp`, quando mapeadas, então as duas são `telefone` e a entrada tem os dois telefones.

## Invariantes
- Só os arquivos da Superfície mudam. Nenhuma dependência nova no `package.json` (nada de biblioteca de CSV ou vCard).
- O módulo não normaliza e-mail nem telefone (isso é do store, R3, contrato 107) e não grava nada.

## Fora de escopo desta tarefa
Diálogo de arquivo e canais (110); tela de prévia e Selects (114); mescla com contatos existentes (107/110); exportação.

## Gates
`cd /Users/andrew/Documents/GitHub/meeting-scribe-funil-108 && SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde. Teste novo `test/funil-import.test.ts` com CA1 a CA9 (as fixtures geradas no próprio teste quando forem grandes, como CA4 e CA6).

## Relatório final (formato)
Arquivos; gates (contagens); assinaturas exportadas; casos de CSV ou vCard que ficaram de fora e por quê.
