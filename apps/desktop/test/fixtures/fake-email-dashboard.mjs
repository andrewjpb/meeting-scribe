// Contrato 156 (D9): a resposta falsa da passada do Painel de e-mail, do `claude` falso do smoke e dos testes. Determinística
// e sem modelo: para cada `ref` do pedido (na ordem), importância cíclica 5, 4, 3, 2, 1; motivo fixo "Motivo de teste N";
// nos refs ímpares, resposta sugerida; nos pares, mover para a pasta "Newsletters" do bloco `<pastas>` (ou a primeira da
// lista, sem ela; sem pasta nenhuma, sem mover).
export const FAKE_EMAIL_DASHBOARD_REPLY = 'Olá, obrigado pela mensagem. Retorno ainda hoje.'

export function fakeEmailDashboard(input) {
  const refs = [...input.matchAll(/^ref: (\S+)$/gm)].map((match) => match[1])
  const block = /<pastas>\n([\s\S]*?)\n<\/pastas>/.exec(input)?.[1] ?? ''
  const folders = block.split('\n').filter(Boolean)
  const folder = folders.includes('Newsletters') ? 'Newsletters' : (folders[0] ?? null)
  const items = refs.map((ref, index) => {
    const n = index + 1
    const odd = n % 2 === 1
    return {
      ref,
      importance: 5 - (index % 5),
      reason: `Motivo de teste ${n}`,
      needsReply: odd,
      reply: odd ? FAKE_EMAIL_DASHBOARD_REPLY : null,
      move: !odd && folder ? { folder, reason: 'Newsletter' } : null,
    }
  })
  return JSON.stringify({ items })
}
