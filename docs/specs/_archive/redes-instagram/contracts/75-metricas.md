# Contrato 75 — Métricas

Feature `redes-instagram` · Wave 3 · Depende de: 72 · Spec `../spec.md` (R7; CA12) · Mockup artboard 07 · Densidade: 79. **Você não commita.** Paralelismo como 73/74: arquivos próprios `main/redes/insights.ts`, `features/redes/MetricsSection.tsx` (+ `Metrics*`), `test/redes-insights*.test.ts`; compartilhados só com blocos `// 75: métricas`.

## Superfície
- `shared/redes.ts`: `METRIC_PERIODS = [7, 28, 90] as const`; `AccountInsights { period; since; until; followers: number | null; reach; views; accountsEngaged; totalInteractions; likes; comments; saves; shares; followsAndUnfollows: { follows; unfollows } | null; profileLinksTaps; fetchedAt }` (cada métrica `number | null`); `MediaInsights { mediaId; caption; permalink; timestamp; mediaType; views; reach; likes; comments; saved; shares; totalInteractions; fetchedAt }`; `RedesMetricsState { account: Record<period, AccountInsights | null>; media: MediaInsights[]; error: string | null; updatedAt }`; `METRICS_CACHE_MS = 1 h`.
- `instagram-client.ts`: `accountInsights(token, igUserId, since, until)` (`GET /{ig}/insights?metric=reach,views,accounts_engaged,total_interactions,likes,comments,saves,shares,follows_and_unfollows,profile_links_taps&period=day&metric_type=total_value&since&until`; métrica ausente/recusada → `null`, não erro), `mediaInsights(token, mediaId, mediaType)` (`GET /{media}/insights?metric=views,reach,likes,comments,saved,shares,total_interactions`; para `VIDEO`/Reels igual; `CAROUSEL_ALBUM` sem `views` se a API recusar → `null`), `followersCount` via `/me?fields=followers_count`.
- `main/redes/insights.ts`: `loadMetrics(client, token, account, period, store, now)` com cache de 1 h por período e por mídia (25 recentes, reaproveitando `recentMedia` do 73 se existir; senão própria chamada), tolerante a métricas individuais recusadas (código 100 com `metric` inválida → tenta sem ela).
- `service.ts`: `metricsState(accountId, period)`, `refreshMetrics`; atualização ao abrir a seção e a cada hora; evento `scribe:redes-metrics`.
- IPC (`refused`): `scribe:redes-metrics {accountId, period}`, `scribe:redes-metrics-refresh {accountId, period}`.
- Tela (`MetricsSection.tsx`, artboard 07, densidade 79): `PageHeader` "@user · Métricas" + "Atualizar" + `Segmented` 7/28/90 dias; bloco **Conta** em grade de cartões de número (rótulo 11 px apagado, valor 20 px tabular, sem ícone): Seguidores (agora), Alcance, Visualizações, Contas engajadas, Interações, Curtidas, Comentários, Salvamentos, Compartilhamentos, Seguidores ganhos/perdidos ("+12 · −3"), Toques em links; nota 11 px "Dados do Instagram com até 48 h de atraso · atualizado há N min"; valor `null` → "—"; bloco **Publicações**: tabela densa (linhas 28 px) com miniatura 24×24 (mesmo mecanismo do 73), legenda em 1 linha, data, Visualizações, Alcance, Curtidas, Comentários, Salvamentos, Compartilhamentos, ordenável por coluna (clique no cabeçalho, seta), formato pt-BR (`1.284`, `12,3 mil` acima de 10.000). Erro em `Note`; `EmptyState` sem publicações.
- Ganchos: `[data-redes-period="7|28|90"]`, `[data-redes-metric="<nome>"]`, `[data-redes-metrics-updated]`, `[data-redes-metrics-table]`, `[data-redes-metrics-sort="<col>"]`, `[data-redes-metrics-refresh]`.
- `fake-instagram.ts`: insights de conta por período e de mídia com valores determinísticos; `denyMetric('views')` para simular recusa de uma métrica.
- Smoke (`redesUiChecks` += `metricsAccount`, `metricsPeriods`, `metricsTable`, `metricsSort`, `metricsPartial`): valores formatados; trocar período refaz a consulta (calls) e muda os números; tabela com 25 linhas; ordenar por Curtidas; métrica recusada mostra "—" sem erro. Print `both('redes-metricas')`; `expectedShots += 2`.
- Testes: `redes-insights.test.ts` (parse de `total_value`, períodos since/until em UNIX, cache de 1 h, formatação pt-BR, tolerância a métrica recusada).

## Critérios de aceite
CA12; nenhuma cor literal (cartões de número usam tokens); pt-BR; sem gráfico nesta fase (só números).

## Fora de escopo
Demografia, gráficos, exportação, comparação entre períodos, stories.

## Gates / Relatório
Idem 73.

## Aviso do revisor do 71 (obrigatório)
`main/redes/store.ts` grava o `instagram-<id>.json` por `writeFileOf`, que serializa só `version`, `account` e `publications`. Ao acrescentar os seus campos (comentários/mensagens/métricas em cache) nesse arquivo, inclua-os no `writeFileOf` e no schema, senão cada gravação da fila apaga os seus dados (e vice-versa). Prefira um arquivo próprio por domínio (`instagram-<id>.comments.json`, `.messages.json`, `.metrics.json`) com a mesma fila de escrita por conta, para os três contratos não disputarem o mesmo arquivo.
