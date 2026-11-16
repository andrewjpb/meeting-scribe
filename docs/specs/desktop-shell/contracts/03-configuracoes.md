# Contrato 03 — Configurações, chave da AssemblyAI, modelo de tradução e permissões
Feature: desktop-shell  ·  Wave: 3  ·  Depende de: 02  ·  Revisado em 14/11/2026 (adendo v1.3: AssemblyAI direto no app)

## Pré-condições
- Contratos 01 e 02 aceitos; `apps/desktop/scripts/gates.sh` verde.
- Comportamento real da AssemblyAI já observado em `docs/fase0.md` (adendo da parte A2 e teste 12): `GET https://llm-gateway.assemblyai.com/v1/models` lista 60 modelos com `pricing` e `context_length`; `POST https://llm-gateway.assemblyai.com/v1/chat/completions` devolve 400 com `"Your account does not have access to this LLM Gateway model"` para modelo não liberado; autenticação pelo cabeçalho `authorization: <chave>`.
- Para conferir formatos reais, existe uma chave de teste em `prova/.env` (`ASSEMBLYAI_API_KEY`). Pode ser usada em chamadas reais de leitura durante o desenvolvimento. Nunca copie o valor para código, fixture, log, relatório ou print.
- Contrato 02b aceito: identidade LAP. Componentes base prontos em `apps/desktop/src/renderer/src/design/`: `Button` (`primary`, `secondary`, `danger`; ainda sem `disabled`), `TextField` e `Select` (`Field.tsx`), `Switch`, `Section`, `SettingRow`, `Note` (com `NOTE_ACTION_CLASS`), `RetryNotice` em `features/live/Notices.tsx`. Campo, seletor, alternador e seção ainda não foram renderizados em nenhuma tela: confira-os no primeiro smoke. Não existe componente para o painel de seleção de modelo.
- Referência visual aprovada pelo dono: `docs/specs/desktop-shell/mockups/Configuracoes.dc.html` (tela inteira de configurações) e o bloco "Permissões" da barra lateral em `mockups/Main.dc.html`, `mockups/ReunioesVazia.dc.html` e `mockups/AoVivoEscuro.dc.html`. Em dúvida entre `design.md` e mockup, vale o mockup.
- Formato real de `pricing` no gateway (conferido em 14/11/2026): `{"global": {"prompt": 0.1, "completions": 0.5, ...}}`, já em US$ por 1M de tokens; `context_length` em tokens; `name` é o nome de exibição.
- Padrões hoje lidos em `src/shared/settings-defaults.ts` (`DEFAULT_SETTINGS`), usados em `features/live/recordingStore.ts` e `features/live/ControlBar.tsx`; etiquetas em `features/live/labels.ts`. Estado do detector de silêncio em `CaptureState.silence.{mic,system}` (some ao fim da gravação: guarde o último valor para o bloco de permissões). Painéis de privacidade em `src/shared/privacy.ts`.

## Superfície
- `apps/desktop/src/main/settings/` (`schema.ts`, `store.ts`), `src/main/secrets.ts`, `src/main/assemblyai/gateway.ts` (catálogo e validação), `src/main/permissions.ts`, registro de IPC, `src/preload/index.ts`, `src/shared/`.
- `apps/desktop/src/renderer/src/features/settings/` (tela, campo da chave, seletor de modelo), `features/permissions/` (bloco da barra lateral), ligação de `echoCancellation`, `micDeviceId`, idiomas e tema no que já existe.
- `apps/desktop/src/main/smoke.ts` (telas de configurações com fixtures).

## Critérios de aceite
- CA1: Dado `schema.ts`, então o esquema tem os campos e padrões de N5 da spec (`translationEnabled`, `translationModel`, `sourceLanguage`, `targetLanguage`, `echoCancellation`, `theme`, `micDeviceId`); `theme` aceita `system`, `light`, `dark`; idiomas aceitam `pt`, `en`, `es`, `ja`, `ko`, `zh`. Um campo inválido cai no padrão daquele campo sem descartar os demais. Testes unitários.
- CA2: Dado o store, quando atualizo um campo, então `settings.json` no `userData` é regravado de forma atômica e todas as janelas recebem o evento de mudança. Arquivo ausente ou corrompido resulta nos padrões. Testes unitários em diretório temporário.
- CA3: Dado `secrets.ts` com `safeStorage` injetado, quando salvo a chave, então o que vai para o disco (`userData/secrets.bin`, modo 0600) é só o resultado de `encryptString`; se `isEncryptionAvailable()` for falso, salvar falha com erro tipado e nada é escrito. O renderer só consegue obter `{configured: boolean, last4: string | null, source: 'saved' | 'dev-env' | null}`; não existe canal IPC que devolva a chave. Em desenvolvimento (`!app.isPackaged`), sem chave salva, vale a variável de ambiente `ASSEMBLYAI_API_KEY` e `source` é `dev-env`. Testes unitários.
- CA4 (corrigido em 14/11/2026 depois da implementação: `GET /v1/models` é público e responde 200 até sem chave, então não serve para validar): Dado "Salvar" no campo da chave, então o main valida com `POST https://llm-gateway.assemblyai.com/v1/chat/completions` de corpo `{}` (tempo limite de 10 s, sem seguir redirecionamento): 401 ou 403 não salva e mostra "Chave recusada pela AssemblyAI"; 2xx, ou 400 cujo corpo traz `message: "invalid request body"`, salva e mostra "Chave válida"; qualquer outro resultado (outro 400, 404, 429, 5xx, rede, tempo esgotado) salva e mostra "Não foi possível verificar agora" com "Tentar de novo". Testes unitários com `fetch` injetado cobrem cada ramo. O comportamento do gateway não é documentado pela AssemblyAI e pode mudar.
- CA5: Dado o campo da chave, então é do tipo senha, nunca mostra a chave guardada (só "termina em ••••1234"), tem "Salvar" e "Remover" (com confirmação), a frase "Guardada cifrada neste Mac, protegida pelo Chaveiro do macOS." e o link "Criar chave", que abre `https://www.assemblyai.com/dashboard` no navegador padrão.
- CA6: Dado `gateway.ts` com `fetch` injetado e uma fixture tirada da resposta real de `/v1/models`, então cada modelo vira `{id, name, contextLength, promptPerM, completionPerM}`, com preços em US$ por 1M de tokens e `null` quando não houver preço fixo. Cache de 10 minutos; tempo limite de 10 s; erro tipado sem derrubar o main. O relatório registra o formato real do campo `pricing`. Testes unitários.
- CA7: Dado o seletor, quando escolho um modelo, então o main faz uma chamada mínima a `/v1/chat/completions` (`max_tokens` até 8): 200 define `translationModel`; 400 de modelo não liberado mantém a seleção anterior e marca a linha como "Não liberado na sua conta"; falha de rede mantém a anterior e mostra o erro com "Tentar de novo". Testes unitários com `fetch` injetado, usando o corpo de erro real.
- CA8: Dado o seletor, quando digito na busca, então a lista filtra por nome ou id sem diferenciar maiúsculas e acentos; cada linha mostra preço e contexto no formato de `design.md`; o modelo atual tem a marca de seleção. Sem chave configurada, o seletor mostra o convite para adicionar a chave. Sem rede, mostra o erro com "Tentar de novo" e a seleção atual pelo id.
- CA9: Dada a seção Áudio, então lista os microfones de `enumerateDevices()` mais "Padrão do sistema"; trocar grava `micDeviceId`; um `micDeviceId` salvo que não existe mais aparece como "Dispositivo indisponível" e a captura usa o padrão. O alternador "Cancelamento de eco" grava `echoCancellation`, e a próxima gravação usa o valor (via `buildMicConstraints`).
- CA10: Dada a seção Idiomas, então origem e destino não podem ser iguais (escolher o mesmo troca os dois), há o alternador "Traduzir ao vivo", e a etiqueta de idiomas e a do modelo na barra flutuante da gravação refletem a configuração (sem tradução: só o idioma de origem e nenhuma etiqueta de modelo).
- CA11: Dada a seção Aparência, quando escolho claro, escuro ou sistema, então o tema troca na hora e persiste.
- CA12: Dado o bloco de permissões da barra lateral, então "Microfone" mostra o estado de `systemPreferences.getMediaAccessStatus('microphone')` (concedido, negado, não pedido); em "não pedido" há "Permitir", que chama `askForMediaAccess`; em "negado" há link para `Privacy_Microphone`. "Áudio do sistema" mostra "não verificado" antes da primeira captura e depois "ok" ou "sem áudio" conforme o detector do contrato 02. O estado é relido quando a janela ganha foco.
- CA13: Dado o smoke, então gera `configuracoes` e `configuracoes-seletor` (seletor aberto, com um modelo marcado como não liberado) nos dois temas, usando fixtures e um estado de chave falso com `last4` inventado, sem nenhuma requisição externa (`externalRequests: []`) e com `consoleErrors: []`.
- CA14: Dado todo o código, os testes, as fixtures, o `report.json` e os PNGs, então o valor da chave de teste não aparece em nenhum deles (`grep -r` pelo valor em `apps/` não encontra nada).
- CA15: O implementador abriu os PNGs novos, comparou com `design.md` e listou no relatório os defeitos visuais encontrados e corrigidos.
- CA16: Dada a faixa arrastável de 52 px que fica por cima do topo da área principal, então nenhum controle da tela de configurações fica inalcançável: a área que rola começa abaixo da faixa (ou os controles sob ela têm `no-drag`), e o smoke clica com sucesso no primeiro controle da tela depois de rolar até o fim e voltar ao topo.
- CA17: Dado o seletor de microfone com um `micDeviceId` salvo que não existe mais, então a captura usa o microfone padrão (pendência do contrato 02). Teste unitário.
- CA18 (pendência da revisão do contrato 02b): Dado o passo de sombra, raio e pílula de `apps/desktop/scripts/gates.sh`, então ele também reprova estilo em linha do React (`boxShadow`, `borderRadius` acima de 6) e raio em `%` ou `rem` (`border-radius: 50%`, `rounded-[50%]`, `rounded-[1rem]`), e não reprova `box-shadow: none; }` escrito em uma linha. O relatório mostra os casos testados.
- CA19: Dado o modo smoke, então o `safeStorage` real nunca é chamado (usa-se um substituto em memória), para não disparar pedido do Chaveiro do macOS na máquina do usuário.

## Invariantes
- Critérios dos contratos 01 e 02 continuam passando (`gates.sh` inteiro).
- A chave nunca sai do processo main. Os gates não fazem chamada de rede.
- `prova/` e `docs/` não mudam.

## Fora de escopo desta tarefa
- Conexão de streaming, token temporário e transcrição ao vivo (contrato 04). OpenRouter. Login.

## Gates
- `apps/desktop/scripts/gates.sh`.
- Testes novos: CA1, CA2, CA3, CA4, CA6, CA7.
