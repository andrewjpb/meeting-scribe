# Contrato 04 — Transcrição e tradução ao vivo pela AssemblyAI
Feature: desktop-shell  ·  Wave: 4  ·  Depende de: 03

## Pré-condições
- Contratos 01, 02 e 03 aceitos; `apps/desktop/scripts/gates.sh` verde.
- Comportamento real já observado (`docs/fase0.md`, adendo da parte A2 e teste 12; pesquisa em `docs/fase0/fase0-asr-provedores.md`; cliente de referência em `prova/scripts/test-assemblyai.mjs`): `wss://streaming.assemblyai.com/v3/ws` com `sample_rate=16000`, `speech_model=universal-3-6-pro`, `speaker_labels=true`, `language_codes=pt`, `format_turns=true`; quadros binários PCM s16le de 100 ms em ritmo real; mensagens `Begin`, `SpeechStarted`, `Turn` (`turn_order`, `end_of_turn`, `transcript`, `words`, `speaker_label`), `SpeakerRevision`, `LLMGatewayResponse` (`turn_order`, `data.choices[0].message.content`), `Termination`; `llm_gateway={"model","prompt"}` com `{{turn}}`.
- Chave de teste em `prova/.env` (`ASSEMBLYAI_API_KEY`) e áudios de teste em `prova/out/*-16000hz-1ch.wav`. O valor da chave nunca é copiado para código, fixture, log, relatório ou print.

## Superfície
- `apps/desktop/src/main/assemblyai/token.ts` (token temporário), `src/main/assemblyai/gateway.ts` (tradução avulsa), `src/main/meetings/` (transcrição por reunião), `src/main/security.ts` (CSP), IPC, preload, `src/shared/`.
- `apps/desktop/src/renderer/src/transcription/`: `url.ts`, `session.ts`, `sink.ts`, `reducer.ts`, `speakers.ts`, `stitch.ts`, `store.ts`.
- `apps/desktop/src/renderer/src/features/live/` e `features/meetings/` (transcrição ao vivo, detalhe, copiar).
- `apps/desktop/scripts/aai-live-test.mjs`, fixtures de sessão gravada em `apps/desktop/test/fixtures/`.

## Critérios de aceite
- CA1: Dado `token.ts` com `fetch` injetado, quando o renderer pede um token, então o main chama o endpoint de token temporário da AssemblyAI com a chave no cabeçalho e devolve só `{token, expiresInSeconds}`; sem chave devolve erro tipado `no-key`; 401 devolve `key-rejected`. O relatório diz qual endpoint funcionou de verdade (`GET https://streaming.assemblyai.com/v3/token?expires_in_seconds=60` ou `POST https://token.assemblyai.com/v1/token`). Testes unitários.
- CA2: Dado `buildStreamingUrl({token, source, settings})`, então a URL tem `token`, `sample_rate=16000`, `speech_model=universal-3-6-pro`, `format_turns=true`, `language_codes=<origem>`; `speaker_labels=true` só para a fonte do sistema; `llm_gateway` só com `translationEnabled`, como JSON `{model: translationModel, prompt}` em que o prompt nomeia o idioma de origem e o de destino por extenso em inglês, pede só a tradução e contém `{{turn}}` exatamente uma vez. Testes unitários.
- CA3: Dado `AssemblyAiSink` (implementa o `FrameSink` do contrato 02) com WebSocket falso, então envia só os 3200 bytes de PCM de cada quadro (sem o cabeçalho de 8 bytes), como binário; com o socket ainda não aberto guarda até 50 quadros (5 s) e descarta os mais antigos contando a lacuna; pausado não envia nada. Testes unitários.
- CA4: Dado o redutor puro `applyMessage(state, msg)`, quando recebe as mensagens de uma sessão real gravada (fixture em JSON Lines, sem segredo), então: `Turn` com `end_of_turn=false` atualiza o trecho parcial; `end_of_turn=true` fecha o trecho; `LLMGatewayResponse` liga a tradução ao trecho pelo `turn_order`, mesmo chegando antes do final ou fora de ordem; `SpeakerRevision` corrige o falante de trechos já fechados; tipo desconhecido é ignorado sem erro. Testes unitários com a fixture e com casos montados.
- CA5: Dado `speakers.ts`, então a fonte microfone vira "Você"; na fonte do sistema o rótulo `A` vira "Participante A", `B` vira "Participante B"; sem rótulo ou pendente vira "Participantes". Testes unitários.
- CA6: Dado `stitch.ts`, quando uma sessão começa com o relógio da gravação em 14.000 ms e uma palavra começa em 2.500 ms da sessão, então o trecho tem `startMs=16500`. Vale para a segunda sessão depois de uma pausa. Testes unitários.
- CA7: Dado o ciclo de vida com sockets e relógio falsos: iniciar a gravação abre uma sessão por fonte ativa; pausar envia `Terminate` e fecha os sockets em até 2 s; retomar abre sessões novas com token novo e deslocamento novo; encerrar envia `Terminate`, espera `Termination` por até 3 s e então persiste. Testes unitários.
- CA8: Dado um fechamento inesperado, então a fonte tenta reconectar com espera de 1, 2, 4 e 8 s (4 tentativas), com token novo, mostrando "Reconectando…" naquela fonte; esgotadas, mostra aviso com "Tentar de novo" e a outra fonte segue. Uma sessão é trocada de forma planejada aos 170 minutos. Testes unitários.
- CA9: Dado um trecho final com a tradução ligada, quando o `LLMGatewayResponse` não chega em 5 s, então o main traduz aquele trecho por chamada direta a `/v1/chat/completions` (mesmo modelo e instrução) uma vez; se falhar, o trecho mostra "Tradução indisponível" com "Tentar de novo". Testes unitários.
- CA10: Dada uma gravação sem chave configurada, então níveis, cronômetro e registro funcionam como no contrato 02, nenhuma chamada de rede é feita e a área de transcrição mostra "Adicione sua chave da AssemblyAI para transcrever." com um botão que leva a Configurações, mais o link "Ver exemplo". Com chave, o link de exemplo não aparece.
- CA11: Dada uma gravação com chave, então a coluna de transcrição segue `design.md`: trecho parcial em `--text-muted` itálico, final substituindo o parcial sem pular a rolagem, tradução abaixo de cada trecho, rótulo de quem fala na cor da fonte, horário na calha; rola sozinha até o usuário subir, quando aparece "Ir para o fim".
- CA12: Dado "Encerrar", então a transcrição é salva de forma atômica em `userData/meetings/<id>.json` (por trecho: `id`, `source`, `speaker`, `startMs`, `endMs`, `text`, `translation`, `translationModel`); o detalhe da reunião mostra a transcrição salva; "Copiar transcrição" põe na área de transferência um Markdown com falante, horário, texto e tradução; excluir a reunião apaga o arquivo. Testes unitários do store e do gerador de Markdown.
- CA13: Dada a CSP de produção, então `connect-src` é `'self' wss://streaming.assemblyai.com` e nada mais. O smoke nunca conecta: as telas `gravacao-ao-vivo` e `detalhe` são renderizadas a partir da fixture da sessão gravada, e `externalRequests` continua `[]`.
- CA14: Dado `pnpm --filter @meeting-scribe/desktop test:aai <wav>` (fora dos gates; lê `ASSEMBLYAI_API_KEY` do ambiente), então o script usa o mesmo construtor de URL, o mesmo envio e o mesmo redutor do app, manda o WAV em ritmo real, e falha se não houver ao menos um trecho final com texto e, com tradução ligada, ao menos uma tradução. Imprime: tempo até o primeiro parcial, mediana do intervalo entre parciais durante a fala, atraso do trecho final após o fim da fala e atraso da tradução. O implementador roda com a chave de `prova/.env` e os WAVs de `prova/out/` e traz os números no relatório.
- CA15: O implementador mede o intervalo entre parciais com a configuração padrão (na fase 0 foi ≈ 3,5 s) e com as variações documentadas pela AssemblyAI que possam reduzi-lo, traz a tabela medida e adota a configuração que der mediana de até 1,5 s sem piorar o texto final; se nenhuma der, mantém a padrão e relata.
- CA16: O valor da chave não aparece em código, teste, fixture, log, `report.json` nem PNG (`grep -r` pelo valor em `apps/` não encontra nada), e não existe caminho pelo qual o renderer a obtenha.
- CA17: O implementador abriu os PNGs novos, comparou com `design.md` e listou no relatório os defeitos visuais encontrados e corrigidos.

## Invariantes
- Critérios dos contratos 01, 02 e 03 continuam passando (`gates.sh` inteiro, sem rede).
- Áudio não é gravado em disco. Áudio só vai para `streaming.assemblyai.com`, e só durante gravação com chave.
- `prova/` e `docs/` não mudam.

## Fora de escopo desta tarefa
- OpenRouter, resumo, mais de um idioma de destino por gravação, exportar arquivo, buffer de contingência em disco, supressão da fala duplicada entre microfone e sistema, backend.

## Gates
- `apps/desktop/scripts/gates.sh`.
- Testes novos: CA1 a CA9 e CA12.
- `pnpm --filter @meeting-scribe/desktop test:aai <wav>` (manual, fora dos gates).

## Notas do coordenador (14/11/2026, ao abrir a wave 4)
- **Refatoração necessária antes da transcrição.** Em `apps/desktop/src/main/index.ts:61-76`, `createSettings(userData)` cria `createSecretStore(...)` e `createGatewayClient(...)` dentro dela e não os expõe. A transcrição e a tradução avulsa (CA1, CA9) precisam dos dois. Construa `secrets` e `gateway` uma vez em `main/index.ts`, passe-os para `createSettingsService` e para os novos registros de transcrição; não crie uma segunda instância do cofre nem um segundo cliente (o cache de 10 min do catálogo e o `safeStorage` não podem duplicar).
- **Gateway real (contrato 03):** `GET https://llm-gateway.assemblyai.com/v1/models` é público; a chave é validada por `POST /v1/chat/completions` com corpo `{}` (401 recusa, 200 ou 400 `"invalid request body"` aceita). O cliente já usa `redirect: 'error'` e distingue os 400. Reaproveite-o para a tradução direta do CA9.
- **Modelo de teste:** na conta de teste só `qwen3.5-4b-32k-fast` responde 200; os outros dão 400 "não liberado". É o `DEFAULT_SETTINGS.translationModel`, então as medições do CA14/CA15 usam exatamente ele. Aviso: se a conta recusar um modelo, o app deve continuar degradando como no CA7.
- **Áudios:** `prova/out/*-16000hz-1ch.wav` são os arquivos já convertidos para o teste `test:aai` (mic e sistema). Os `48000hz-2ch` são os brutos da fase 0; não use.
- **Smoke:** `main/smoke.ts` já tem `layoutMetrics()` para medir px lógicos (224/40/28/64/56/40); reutilize-a nas telas de transcrição e detalhe em vez de criar outra régua. A fixture da sessão gravada deve ficar em `apps/desktop/test/fixtures/` e ser a **mesma** usada pelo smoke e pelos testes do redutor (CA4), para não haver duas verdades.
- **Nada de commit** (o Andrew não pediu). `prova/` e `docs/` não mudam — inclusive este contrato.
- Entrega esperada no relatório, além dos CAs: números medidos do `test:aai` (CA14), tabela de variações de latência (CA15), endpoint de token que funcionou de verdade (CA1), custo estimado por hora de reunião com o modelo padrão (preço do catálogo), e a lista do CA17.
