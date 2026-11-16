# Contrato 06 — Remover o eco do alto-falante na trilha "Você"
Feature: desktop-shell  ·  Wave: 6  ·  Depende de: 04 e 05 (aceitos em 14/11/2026)

## Pré-condições
- Contratos 04 e 05 aceitos; `apps/desktop/scripts/gates.sh` verde (432 testes).
- Problema visto pelo Andrew em 14/11/2026 23:35, gravando sem fone: a fala dos participantes sai no alto-falante, entra no microfone e aparece **duas vezes** — em "Você" (mic) e em "Participantes" (sistema). A fase 0 (item 8 de `docs/fase0.md`) já mediu o vazamento: ≈ 11 dB abaixo do sistema (−32 contra −21 dBFS).
- Exemplo real do print (mesma fala, nas duas trilhas):
  - mic 00:31 "Em julho, por exemplo, eu conversei com alguns analistas da Finclass e eu investi R$1 milhão no LV B11. No mês seguinte, agosto, eu já recebi mais de R$8 mil direto na minha conta."
  - sistema 00:34 "e eu investi R$1 milhão no LV B11. No mês seguinte, agosto, eu já recebi mais de R$8 mil direto na minha conta bancária."
  - Os cortes de trecho **não** batem entre as trilhas (o mic começou antes, o sistema terminou com "bancária"), e o tempo difere em alguns segundos. A comparação tem de tolerar isso.
- O sistema tem diarização ligada (decisão do Andrew): o trecho final do sistema chega ≈ 3 s depois do equivalente no mic. A decisão de eco precisa poder ser tomada **depois** que o trecho do mic já apareceu.
- O "Cancelamento de eco" do Chromium (`echoCancellation`) não serve aqui: ele só cancela o som que a própria página toca, não o áudio de outros apps. Fica como está.

## Superfície
- `apps/desktop/src/renderer/src/transcription/` — módulo puro novo `echo.ts` (comparação) e uso no `reducer.ts`/`store.ts`.
- `src/shared/settings-defaults.ts`, `src/main/settings/schema.ts`, `features/settings/SettingsScreen.tsx` (uma linha nova).
- `features/live/` (exibir/ocultar), `transcription/fallback.ts` e o caminho do Claude CLI (não traduzir eco).
- `src/main/smoke.ts` + fixtures (um caso de eco).

## Critérios de aceite
- CA1: `AppSettings` ganha `removeEcho: boolean` (padrão `true`). `settings.json` antigo carrega com o padrão; valor inválido volta ao padrão. Testes do schema.
- CA2: `echo.ts` exporta uma função pura que, dado um trecho **final** do mic e os trechos do sistema (finais e parciais), diz se o do mic é eco. Regra (revista em 15/11/2026 depois da revisão: a regra antiga, por saco de palavras numa janela de ±4 s, apagava respostas reais suas logo depois de um turno longo dos participantes):
  - normalizar os dois textos: minúsculas, sem acento, sem pontuação, números mantidos;
  - **tempo:** considerar só trechos do sistema que **se sobrepõem** a `[mic.startMs − 1000, mic.endMs + 1000]` (eco acontece ao mesmo tempo; não há folga de 4 s);
  - **ordem:** juntar o texto desses trechos em ordem de tempo e medir a fração das palavras do mic **cobertas por sequências de pelo menos 4 palavras seguidas** que aparecem, na mesma ordem e contíguas, no texto do sistema (cada palavra do mic conta uma vez; sequências podem se sobrepor);
  - eco se essa fração ≥ 0,6 **e** o mic tiver ≥ 4 palavras;
  - mic com 1–3 palavras: eco só se o texto inteiro do mic aparece contíguo no texto do sistema **e** um trecho do sistema cobre pelo menos metade da duração do trecho do mic.
  - Constantes nomeadas e exportadas (`ECHO_SLACK_MS=1000`, `ECHO_MIN_RUN=4`, `ECHO_MIN_FRACTION=0.6`, `ECHO_MIN_WORDS=4`).
  - Testes obrigatórios — **é eco:** o exemplo real acima; sistema cortado em dois trechos. **Não é eco:** fala sua metade sobreposta ao eco; "sim"/"ok" em momentos distintos; texto igual fora da janela; e os casos do revisor, com um turno do participante de 0 a 15 s (~35 palavras, ex.: "…eu não sei se a equipe tem tempo para isso agora, a gente precisa ver o cronograma com o cliente… Eu acho que não dá.") e o mic de 16 a 18 s: "Eu não sei se é isso.", "Eu acho que dá sim, a gente faz.", "Não, eu acho que é isso mesmo.", "Pois é, eu acho que o cliente quer isso"; e "não sei" dito no meio da fala do participante quando o participante não disse "não sei" ali. O relatório traz a fração de cada caso.
- CA3: a decisão é reavaliada sempre que chega ou muda um trecho do sistema, e quando um trecho do mic fica final. Um trecho do mic marcado como eco **pode deixar de ser** se o texto do sistema mudar (ex.: correção do final). Parciais do mic nunca são marcados (só finais). Testes do reducer com a ordem real: mic final primeiro, sistema final 3 s depois.
- CA4: com `removeEcho` ligado, o trecho do mic marcado como eco some da transcrição ao vivo (sem animação nem aviso), não entra em `persistableSegments` (não vai para a reunião salva) e não é traduzido: com o motor `claude-cli` não vai para a fila; se já estava na fila ou traduzido, a tradução é descartada sem erro. Com o motor `assemblyai` a tradução da conexão chega igual (não dá para evitar) e é simplesmente ignorada. Testes.
- CA5: com `removeEcho` desligado, comportamento idêntico ao contrato 05 (nada marcado, nada oculto). Teste.
- CA6: o trecho do sistema **nunca** é removido nem alterado por esta regra. Teste.
- CA7: Configurações ganha a linha "Remover eco do alto-falante" (interruptor, mesmo componente do "Cancelamento de eco"), com a ajuda curta "Some com a fala dos participantes que vaza para o seu microfone quando você não usa fone." Mudar na hora vale para a gravação em curso (reavalia os trechos já existentes). Segue `design.md`.
- CA8: o smoke ganha um caso com fixture de eco (o exemplo real) e confere que a tela ao vivo mostra o trecho só uma vez (em "Participantes"); PNG `gravacao-eco-light.png`. Layout de Configurações continua passando.
- CA9: custo: a comparação roda em memória, sem rede, e cada avaliação olha só os trechos da janela de tempo (não a reunião inteira). Teste de desempenho simples: 2 000 trechos de cada lado avaliados em < 200 ms no total.

## Invariantes
- Critérios dos contratos 01 a 05 continuam passando (`gates.sh` inteiro, sem rede, sem `claude` real).
- Áudio não muda: a captura, o envio à AssemblyAI e o `speaker_labels=true` do sistema ficam como estão.
- `prova/` e `docs/` não mudam (exceto este contrato, pelo coordenador).

## Fora de escopo
- Cancelamento de eco no áudio (AEC nativo do macOS / voice processing), comparação por energia ou correlação do sinal, aviso "use fone", desfazer manual de um trecho oculto.

## Gates
- `apps/desktop/scripts/gates.sh` (o smoke precisa de `--no-sandbox` no shell do Kiro).
- Testes novos: CA1 a CA7 e CA9.

## Telas de impacto no usuário
- Gravação ao vivo: sem fone, a fala dos participantes deixa de aparecer repetida em "Você".
- Reunião salva: sem os trechos repetidos.
- Configurações: nova linha "Remover eco do alto-falante" (ligada por padrão).

## Notas do coordenador
- Os limiares (0,6, 4 palavras seguidas e 1 s) vêm de um exemplo só. O relatório deve trazer os números de cada teste do CA2 (fração medida) para o Andrew ajustar depois com reuniões reais.
- Nada de commit (o Andrew não pediu).
