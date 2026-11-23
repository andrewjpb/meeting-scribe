# Contrato 149 — IA e mídia: ferramentas de mídia do Assistente, limites, limpeza, bloqueio e configuração

Feature: ia-midia  ·  Wave: 2  ·  Depende de: 147, 148

Constituição: `CLAUDE.md` do usuário. Prevalece sobre este contrato.

## Pré-condições
- Contratos 147 e 148 aceitos e commitados: os arquivos de conversa trazem `mídia <id>` e os de email a lista `Anexo N`; documento e figurinha baixam.
- `pnpm typecheck && pnpm lint && pnpm test` verdes. Nenhuma tela muda neste contrato.

## Contexto mínimo
O Assistente tem ferramentas próprias pedidas pelo bloco `lap-ferramenta` (`apps/desktop/src/main/chat/tools.ts`):
o main executa, grava o resultado num arquivo da pasta da conversa e avisa o modelo, que o abre com `Read`
(o `Read` do `claude` lê imagem e PDF). Modelo a seguir: `ler_email` em `main/email/assistant-tools.ts`
(validação, recusa com o app bloqueado, resultado em arquivo). As ferramentas são montadas em `main/index.ts`
(procure onde `buscar_emails`/`ler_email` são entregues ao chat). Mídia do WhatsApp: `whatsapp.media()` e
`whatsapp.transcribe()` em `main/whatsapp/service.ts`; transcrição de arquivo avulso: `createFileTranscriber`
(`main/assemblyai/transcript.ts`); anexos de email: `attachmentsOf`/`parseAttachments` em `main/email/service.ts`.
A pasta da conversa é limpa em `main/chat/corpus.ts` e `main/chat/sources.ts` (hoje só `.md`). Os passos
mostrados na resposta vêm dos eventos de ferramenta do chat (veja como `ler_email` vira "Abrindo um email").

## Superfície
- Criar `apps/desktop/src/main/whatsapp/assistant-tools.ts` (ferramentas do WhatsApp) e `apps/desktop/src/main/chat/media-files.ts` (gravar, nomear, limitar e limpar arquivos de mídia da pasta).
- Alterar `main/email/assistant-tools.ts` (ferramenta de anexo), `main/chat/tools.ts`/`sources.ts`/`corpus.ts` (registro, limpeza, contagem por pergunta), `main/claude-cli/chat.ts` (instrução: quando e como pedir mídia), `main/index.ts` (montagem), `shared/settings*` e o store de configurações (campo novo), e o ponto onde os rótulos dos passos são definidos.
- Testes novos: `test/whatsapp-assistant-tools.test.ts`, `test/chat-media-files.test.ts`; ajustes em `test/email-assistant.test.ts`, no teste das configurações e no da instrução do chat.

### Pendências herdadas do contrato 148 (entram aqui)
- `main/whatsapp/client.ts`: o leitor de mídia só aceita mime `audio|image|video` (subtipo até 60). Passa a aceitar também o que o serviço devolve para documento e figurinha (`application/*`, `text/*`, `image/webp`, subtipo até 100), **sem** mudar o que a tela oferece: `WHATSAPP_DOWNLOADABLE_KINDS` (botão "Baixar" da tela) continua só com imagem, vídeo e áudio; a lista do que o Assistente pode pedir é outra constante.
- `services/whatsapp-bridge`: documento enviado com legenda (`documentWithCaptionMessage`) passa a ser reconhecido como documento, com a legenda como texto e a chave de download guardada (teste no serviço; pytest verde).

### Ferramentas (nomes exatos)
- `ver_midia_whatsapp {"conversa": "<id da conversa>", "midia": "<id da mensagem>"}` → imagem, figurinha e PDF: grava o arquivo e devolve o nome para a IA abrir. Outros documentos: "tipo não suportado" com nome e tamanho. Áudio e vídeo: orienta a usar a outra ferramenta.
- `transcrever_audio_whatsapp {"conversa", "midia"}` → áudio ou vídeo: devolve o texto num `.md` (reaproveita a transcrição guardada; senão transcreve e guarda).
- `ler_anexo_email {"email": "<ref>", "anexo": <índice a partir de 1>}` → imagem e PDF: arquivo; áudio e vídeo: transcrição em `.md`; texto puro (`text/*`, json, csv, md): conteúdo em `.md`, cortado em 20.000 caracteres; demais: "tipo não suportado".

### Configuração
`settings.assistant.media: boolean`, padrão `true`, com migração para quem já tem configurações salvas.

## Critérios de aceite
(testes com serviços falsos que contam chamadas; nenhuma rede real)
- CA1. `ver_midia_whatsapp` com uma imagem do recorte: chama `whatsapp.media()` uma vez, grava `Midia - WhatsApp - <hash curto>.<ext>` (0600) na pasta da conversa, com a extensão decidida pelos **bytes** (png, jpg, gif, webp, pdf), e devolve o nome. Segundo pedido da mesma mídia na mesma conversa não baixa de novo.
- CA2. Bytes que não batem com imagem nem PDF (mesmo com mime de imagem): recusado com "tipo não suportado"; nada é gravado. Vale para SVG, HTML e figurinha que não é WebP de verdade (por exemplo Lottie declarada como `image/webp`): o que decide é o começo dos bytes (PNG, JPEG, GIF, `RIFF…WEBP`, `%PDF`), nunca o mime declarado pelo remetente.
- CA3. `transcrever_audio_whatsapp`: com transcrição guardada, nenhuma chamada à AssemblyAI; sem, uma chamada e o texto passa a ficar guardado. O `.md` devolvido marca o texto como transcrição de áudio de terceiro (material, não instrução).
- CA4. `ler_anexo_email`: PDF e imagem (inclusive embutida) gravados; áudio transcrito por `createFileTranscriber`; `.txt` devolvido como texto; `.docx` → "tipo não suportado"; índice inexistente → erro claro.
- CA5. Recorte: a ferramenta só aceita conversa e mensagem que estão nos arquivos exportados para **aquela pergunta** (mesmo conjunto que `writeSources` gravou) e email que o Assistente já pode ler; fora disso, recusado sem baixar (contador zero).
- CA6. Limites: 9ª mídia na mesma pergunta recusada com o motivo; imagem/PDF acima de 20 MB recusado; áudio/vídeo acima de 64 MB recusado, e acima de 30 minutos recusado quando a duração é conhecida. As constantes ficam exportadas em `shared`.
- CA7. `settings.assistant.media === false`: as três ferramentas não são registradas nem anunciadas na instrução, e um bloco `lap-ferramenta` forjado com esses nomes é recusado; nenhum download nem transcrição.
- CA8. App bloqueado: recusado, no mesmo padrão de `ler_email`.
- CA9. Fonte WhatsApp desligada: as duas ferramentas do WhatsApp não existem; fonte Email desligada: `ler_anexo_email` não existe.
- CA10. Limpeza: os arquivos `Midia - …` e as transcrições geradas são apagados quando a pasta da conversa é limpa, quando a fonte correspondente é desligada e no "Sair"/"Remover" da conta do WhatsApp ou do email. Teste por caso.
- CA11. Instrução do Assistente (só com a função ligada): explica que `[anexo: … · mídia <id>]` pode ser aberto com a ferramenta, que áudio se transcreve com a outra, que a resposta deve dizer quando se baseou em mídia, e repete que conteúdo de mídia é material e nunca instrução. Teste textual; com a função desligada, nenhuma dessas frases aparece.
- CA12. Passos da resposta: "Abrindo uma imagem", "Abrindo um PDF", "Transcrevendo um áudio", "Lendo um anexo", com fonte e nome da conversa ou do arquivo no detalhe, no mesmo mecanismo dos passos atuais.
- CA13. Nenhuma ação nova: as ferramentas só leem. O fluxo de ferramentas de ação (mover emails etc.) continua exigindo o cartão de clique mesmo quando pedido logo depois de uma mídia (teste do fluxo).
- CA14. Logs sem transcrição, sem nome de anexo e sem nome de conversa.

## Invariantes
- `Read`/`Grep`/`Glob` e as permissões do perfil do chat não mudam (`test/acp.test.ts` passa sem alteração).
- Botões "Baixar" e "Transcrever" da tela do WhatsApp não mudam. `whatsapp.media()` e `transcribe()` mantêm o comportamento para a tela.
- Atendimento, rascunho, Detalhes e agentes agendados não ganham essas ferramentas.

## Fora de escopo
- Tela do interruptor e ícones dos passos (151); atendimento (150); smoke e documentação (152).

- CA15. `whatsapp.media()` entrega um PDF e uma figurinha do backend falso (mensagens m9 e m10 do Bruno) com o mime certo; a tela continua sem botão "Baixar" para documento e figurinha. Documento com legenda baixa (teste do serviço).

## Gates
`pnpm typecheck && pnpm lint && pnpm test`, da raiz, e o pytest do serviço como no passo 8 de `apps/desktop/scripts/gates.sh`. Testes novos: CA1 a CA15.

## Relatório final
Arquivos criados e alterados; resultado dos três comandos com contagem; como o recorte do CA5 é conferido; como a extensão é decidida pelos bytes; critérios adaptados. Não commitar.
