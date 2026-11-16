# Adendo v1.3 — AssemblyAI direto no app, sem servidor nesta versão

Data: 14/11/2026 (2026-W46). Decisão do Andrew: "vamos seguir com AssemblyAI". Este adendo prevalece sobre `spec-meeting-scribe-v1.2.md` onde houver conflito.

## O que muda

- **Um fornecedor no caminho ao vivo.** A AssemblyAI faz a transcrição (`universal-3-6-pro` em streaming) e a tradução na mesma conexão (`llm_gateway`, resposta em `LLMGatewayResponse`). Provado com chave real em 14/11/2026 (`docs/fase0.md`, teste 12 e adendo da parte A2).
- **Sem backend nesta versão.** O app desktop fala direto com a AssemblyAI. Saem do escopo da primeira versão: NestJS, PostgreSQL, Redis/BullMQ, gateway WebSocket próprio, login e contas. O desenho deles na v1.2 fica como referência para quando o produto tiver mais de um usuário ou sincronização.
- **Chave do usuário no próprio Mac.** O usuário cola a chave nas Configurações; o processo main a guarda cifrada com `safeStorage` (chave de cifragem no Chaveiro do macOS). O renderer nunca vê a chave: recebe só um token temporário de streaming emitido pelo main.
- **Histórico local.** Reuniões e transcrições ficam em JSON no `userData` do app.
- **Modelo de tradução.** Escolhido entre os modelos do LLM Gateway da AssemblyAI que a conta tem liberados (o padrão do provedor, `gemini-2.5-flash-lite`, não está liberado na conta de teste e falha em silêncio; o app valida o modelo na seleção). Padrão do app: `qwen3.5-4b-32k-fast`.
- **OpenRouter** deixa de ser o tradutor padrão. Fica como opção futura (segundo caminho de tradução, retradução de reunião antiga, resumo).
- **Custo esperado:** US$ 0,45/h por conexão + US$ 0,12/h de diarização na conexão do sistema, cobrados por tempo de conexão aberta, mais os tokens da tradução. Duas conexões por reunião (microfone e sistema): ≈ US$ 1,02/h. Pausar fecha as conexões.

## O que continua valendo da v1.2

Captura (microfone + Core Audio Tap pelo Chromium), formato do áudio (PCM s16le 16 kHz mono em quadros de 100 ms), mapeamento de falantes ("Você", "Participante A"), detecção de falha silenciosa, permissões, e as fases de detecção de reunião, janela flutuante e empacotamento.

## Pendências conhecidas

- Parciais chegaram a cada ≈ 3,5 s no teste real (documentação fala em ≈ 1 s): investigar no contrato 04 da `desktop-shell`.
- Sem fone, a fala dos participantes vaza para o microfone e pode aparecer duplicada: tratar em fatia própria.
