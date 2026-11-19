# Spec — desktop-shell (interface do app desktop, primeira fatia)

Data: 14/11/2026 (semana ISO 2026-W46). Spec de produto canônica: `docs/specs/meeting-scribe/spec-meeting-scribe-v1.2.md`. Provas da fase 0: `docs/fase0.md`. Linguagem visual: `docs/specs/desktop-shell/design.md`.

## Problema e objetivo

O Meeting Scribe ainda não tem código de produto; só o app de prova em `prova/`, sem desenho. O Andrew pediu que o sistema tenha uma tela bonita, com UI/UX de verdade. Esta fatia entrega o app desktop real (Electron + React) com a interface desenhada e a captura de áudio já provada na fase 0 funcionando dentro dela. A transcrição e a tradução ao vivo são feitas pela AssemblyAI, direto do app, com a chave do usuário (adendo v1.3 da spec de produto). Não há servidor próprio nesta versão.

## Requisitos

- R1. QUANDO o app abre, O SISTEMA DEVE mostrar uma janela nativa de macOS (barra de título embutida, barra lateral translúcida) com navegação entre Reuniões e Configurações, no tema claro ou escuro do sistema.
- R2. QUANDO não há reuniões, a tela Reuniões DEVE mostrar um estado vazio com a ação "Nova gravação". QUANDO há, DEVE listar as reuniões locais da mais recente para a mais antiga, agrupadas por dia, com título, data, hora e duração.
- R3. QUANDO o usuário aciona "Nova gravação" (botão ou ⌘N), O SISTEMA DEVE iniciar a captura do microfone e do áudio do sistema, abrir a tela de gravação e iniciar o cronômetro.
- R4. ENQUANTO grava, a tela DEVE mostrar uma fita de níveis ao vivo com as duas fontes (Você acima, Participantes abaixo), desenhada a partir do nível real de cada trilha.
- R5. QUANDO o usuário pausa, o cronômetro e a fita DEVEM parar sem encerrar as trilhas; QUANDO retoma, DEVEM continuar. QUANDO encerra, O SISTEMA DEVE parar as trilhas, salvar o registro da reunião e abrir o detalhe dela.
- R6. QUANDO a trilha do sistema encerra sozinha ou fica em silêncio absoluto por 3 s, O SISTEMA DEVE mostrar um aviso não bloqueante explicando a permissão "Gravação de Áudio do Sistema", com atalho para os Ajustes do Sistema; o aviso DEVE sumir quando o som voltar. QUANDO o microfone é negado, DEVE mostrar a instrução equivalente.
- R7. QUANDO uma fonte falha ao iniciar, a outra DEVE continuar funcionando e a tela DEVE indicar qual fonte está ausente.
- R8. ENQUANTO grava com chave configurada, a área de transcrição DEVE mostrar o texto ao vivo de cada fonte (parcial em destaque menor, final substituindo o parcial) e, com a tradução ligada, a tradução de cada fala logo abaixo dela. SEM chave, DEVE mostrar o convite para adicionar a chave e o link "Ver exemplo"; o exemplo aparece sempre rotulado como "Exemplo".
- R9. A tela Configurações DEVE permitir ajustar e persistir na hora: chave da AssemblyAI, microfone, cancelamento de eco, idioma de origem e de destino, tradução ao vivo ligada ou desligada, modelo de tradução e aparência.
- R10. O seletor de modelo DEVE listar os modelos do LLM Gateway da AssemblyAI, permitir busca por nome ou id, mostrar preço de entrada e saída por 1M de tokens e contexto, e validar na hora se o modelo escolhido está liberado na conta. Sem rede, DEVE mostrar erro com "Tentar de novo" e manter a seleção atual visível pelo id.
- R11. A barra lateral DEVE mostrar o estado das duas permissões: Microfone (estado real do macOS) e Áudio do sistema (desconhecido, ok ou sem áudio, conforme a última captura).
- R12. A janela DEVE rodar com `contextIsolation`, `sandbox`, sem `nodeIntegration`, CSP restritiva, origem `scribe://app` em produção, e só conceder `media` (áudio) e `display-capture` à própria origem.
- R13. QUANDO o macOS dispara `devicechange`, O SISTEMA DEVE atualizar a lista de dispositivos com debounce de 500 ms e NUNCA reiniciar a captura só por isso (achado da fase 0: nesta máquina o evento dispara a cada 3–8 s).
- R14. Toda ação DEVE ser alcançável por teclado, com foco visível, e os contrastes DEVEM cumprir os mínimos de `design.md`.

## Regras de negócio

- N1. O áudio só sai da máquina para a AssemblyAI, e só durante uma gravação com chave configurada (`streaming.assemblyai.com`, `llm-gateway.assemblyai.com`) ou numa transcrição de áudio do WhatsApp por clique (`api.assemblyai.com`, contrato 37). Fora isso, o app só fala com: `github.com`/`objects.githubusercontent.com` para a atualização (contrato 14); fotos e mídia do WhatsApp baixadas pela bridge local somente de `https://*.whatsapp.net`, sem redirecionamento (contratos 32 e 37); e os servidores MCP que a própria pessoa cadastrar (contrato 21). O Claude roda pelo CLI local. A extensão do Chrome fala só com `127.0.0.1`.
- N2. A chave da AssemblyAI fica só no processo main, cifrada em disco com `safeStorage`. Nunca vai para o renderer, para log, para arquivo de teste nem para print. O renderer recebe apenas token temporário.
- N3. Dado de exemplo sempre aparece rotulado "Exemplo" e nunca é salvo como reunião.
- N4. Registro de reunião: `id` (uuid), `title` (padrão "Reunião de DD/MM HH:mm"), `startedAt` (ISO), `durationMs` (sem contar pausas), `sources: {mic: boolean, system: boolean}`.
- N5. Padrões de configuração: `translationEnabled=true`, `translationModel=qwen3.5-4b-32k-fast`, `sourceLanguage=pt`, `targetLanguage=en`, `echoCancellation=false`, `theme=system`, `micDeviceId=null` (padrão do sistema).
- N6. Restrições de captura (fase 0): microfone com `noiseSuppression:false`, `autoGainControl:false`, `channelCount:1` e `echoCancellation` conforme a configuração; sistema com `video:false` e `audio:{restrictOwnAudio:true, echoCancellation:false, noiseSuppression:false, autoGainControl:false}`.
- N7. Electron fixo em `45.3.1`, sem `^`.

## Telas de impacto no usuário

Todas são novas: Reuniões (lista e estado vazio), Gravação ao vivo, Detalhe da reunião, Configurações (com seletor de modelo) e o bloco de permissões da barra lateral. Como há telas, dá para gerar a apresentação com prints reais depois da implementação; isso só é feito se o Andrew pedir.

## Fora de escopo

1. Backend próprio e login; OpenRouter; resumo da reunião; tratamento da fala duplicada quando o som dos participantes vaza para o microfone.
2. Janela flutuante (pill), detecção de reunião e addon nativo.
3. Buffer OPFS de contingência (só a checagem de que OPFS funciona na origem).
4. Empacotamento, assinatura, notarização e atualização automática.
5. Exportar arquivo de áudio ou de transcrição (há só "Copiar transcrição"); salvar áudio em disco.
6. Idiomas de interface além de pt-BR; Windows e Linux.
7. Qualquer mudança em `prova/`.

## Verificação end-to-end

1. `apps/desktop/scripts/gates.sh` termina com código 0 (typecheck, lint, testes, build e smoke com prints de cada tela nos dois temas).
2. Com `pnpm --filter @meeting-scribe/desktop dev`: abrir o app, conferir Reuniões vazia, acionar "Nova gravação" com som tocando, ver a fita reagir nas duas fontes, pausar, retomar, encerrar e ver a reunião na lista com a duração certa.
3. Em Configurações: salvar a chave da AssemblyAI, trocar o modelo de tradução pelo seletor, fechar e reabrir o app e ver a escolha mantida.
4. Gravar com som em português tocando e com fala no microfone: ver a transcrição ao vivo das duas fontes, a tradução abaixo de cada fala, pausar (conexões fecham), retomar, encerrar e ver a transcrição salva no detalhe.
