// Teste 12 (OpenRouter): /key, /models/user filtrado e uma tradução estruturada com fallback
// nativo (models) e require_parameters. Uso: OPENROUTER_API_KEY=... node scripts/test-openrouter.mjs
// Node 22, sem dependências.
const chave = process.env.OPENROUTER_API_KEY;
if (!chave) { console.error('defina OPENROUTER_API_KEY'); process.exit(2); }

const BASE = 'https://openrouter.ai/api/v1';
const cabecalhos = {
  Authorization: `Bearer ${chave}`,
  'Content-Type': 'application/json',
  'X-OpenRouter-Title': 'meeting-scribe-prova',
};

async function chamar(metodo, caminho, corpo) {
  const t = performance.now();
  const r = await fetch(`${BASE}${caminho}`, { method: metodo, headers: cabecalhos, body: corpo && JSON.stringify(corpo) });
  const ms = performance.now() - t;
  const texto = await r.text();
  if (!r.ok) {
    console.error(`${metodo} ${caminho} -> HTTP ${r.status}\n${texto}`);
    process.exit(1);
  }
  return { json: JSON.parse(texto), ms };
}

// US$/token (string) -> US$/1M tokens; -1 = preço variável
const por1M = (v) => (Number(v) < 0 ? 'variável' : (Number(v) * 1e6).toFixed(3));

// 1) saldo e limites da própria chave (o label sai do print por conter parte da chave)
{
  const { json, ms } = await chamar('GET', '/key');
  const { label, ...dados } = json.data ?? json;
  console.log(`GET /key (${ms.toFixed(0)} ms):`, JSON.stringify(dados, null, 2));
}

// 2) modelos de saída texto com structured outputs, filtrados pelas preferências da conta
{
  const { json, ms } = await chamar('GET', '/models/user?output_modalities=text&supported_parameters=structured_outputs');
  const lista = json.data ?? [];
  console.log(`\nGET /models/user (${ms.toFixed(0)} ms): ${lista.length} modelos${json.total_count != null ? ` (total_count=${json.total_count})` : ''}; 10 primeiros (US$/1M entrada / saída):`);
  for (const m of lista.slice(0, 10)) {
    console.log(`  ${m.id.padEnd(48)} ${por1M(m.pricing?.prompt)} / ${por1M(m.pricing?.completion)}`);
  }
}

// 3) tradução pt -> en com schema {translations:[{id,text}]}
{
  const frases = [
    { id: '1', text: 'Bom dia a todos, vamos começar a reunião.' },
    { id: '2', text: 'O orçamento do próximo trimestre precisa ser aprovado até sexta-feira.' },
  ];
  const corpo = {
    models: ['anthropic/claude-haiku-5.5', 'openai/gpt-6-luna'],
    provider: { require_parameters: true },
    messages: [
      { role: 'system', content: 'Traduza cada item de português para inglês. Mantenha o id. Responda só com o JSON pedido.' },
      { role: 'user', content: JSON.stringify(frases) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'traducoes',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            translations: {
              type: 'array',
              items: {
                type: 'object',
                properties: { id: { type: 'string' }, text: { type: 'string' } },
                required: ['id', 'text'],
                additionalProperties: false,
              },
            },
          },
          required: ['translations'],
          additionalProperties: false,
        },
      },
    },
  };
  const { json, ms } = await chamar('POST', '/chat/completions', corpo);
  console.log(`\nPOST /chat/completions`);
  console.log(`  response.model = ${json.model}`);
  console.log(`  usage.cost     = ${json.usage?.cost}`);
  console.log(`  latência       = ${ms.toFixed(0)} ms`);
  console.log(`  usage          = ${JSON.stringify(json.usage)}`);
  const conteudo = json.choices?.[0]?.message?.content;
  try {
    console.log('  conteúdo (JSON) =', JSON.stringify(JSON.parse(conteudo), null, 2));
  } catch {
    console.log('  conteúdo NÃO é JSON válido:', conteudo);
  }
}
