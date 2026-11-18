// Avatar das conversas do WhatsApp (contrato 32): as iniciais (1 ou 2 letras) quando não há foto e a cor de fundo,
// escolhida pelo id entre as cores dos post-its (`--note-*`), sempre a mesma para a mesma conversa. Sem DOM: testado em
// test/renderer/whatsapp-details.test.ts.

export const AVATAR_TONES = ['blue', 'green', 'purple', 'orange', 'pink', 'yellow'] as const
export type AvatarTone = (typeof AVATAR_TONES)[number]

/** Fundo e texto de cada cor, em classes inteiras para o Tailwind achar. */
export const AVATAR_TONE_CLASSES: Readonly<Record<AvatarTone, string>> = {
  blue: 'bg-note-blue text-note-blue-text',
  green: 'bg-note-green text-note-green-text',
  purple: 'bg-note-purple text-note-purple-text',
  orange: 'bg-note-orange text-note-orange-text',
  pink: 'bg-note-pink text-note-pink-text',
  yellow: 'bg-note-yellow text-note-yellow-text',
}

/** "Ana Souza" → "AS"; "Projeto" → "P"; sem letra nenhuma (só o número), o primeiro caractere; vazio, "?". */
export function avatarInitials(name: string): string {
  const words = name
    .normalize('NFC')
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((word) => /\p{L}/u.test(word))
  const first = words[0]
  if (!first) return [...name.trim()][0]?.toLocaleUpperCase('pt-BR') ?? '?'
  const last = words.length > 1 ? words.at(-1) : undefined
  const letter = (word: string): string => ([...word].find((char) => /\p{L}/u.test(char)) ?? '').toLocaleUpperCase('pt-BR')
  return `${letter(first)}${last ? letter(last) : ''}`
}

/** A cor do avatar pelo id (FNV-1a de 32 bits): a mesma conversa tem sempre a mesma cor. */
export function avatarTone(id: string): AvatarTone {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length] as AvatarTone
}
