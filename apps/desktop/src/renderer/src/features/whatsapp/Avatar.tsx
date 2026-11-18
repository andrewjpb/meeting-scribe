import { Users } from 'lucide-react'
import { Icon } from '../../design/Icon'
import { AVATAR_TONE_CLASSES, avatarInitials, avatarTone } from './avatar-tone'

interface AvatarProps {
  /** Id que escolhe a cor (a conversa, ou o autor num grupo). */
  id: string
  name: string
  /** Data URL da foto; `null` ou ausente: as iniciais (ou o ícone de grupo). */
  photo?: string | null | undefined
  group?: boolean
  size?: 8 | 10
}

/**
 * Foto de perfil quadrada com o raio dos controles (contrato 32; nada de círculo nem pílula, como as fotos das
 * contas): a foto, as iniciais sobre a cor do id ou, num grupo sem foto, o ícone de grupo.
 */
export function Avatar({ id, name, photo, group = false, size = 8 }: AvatarProps) {
  const box = size === 10 ? 'size-10 text-13' : 'size-8 text-12'
  const px = size === 10 ? 40 : 32
  if (photo) {
    return <img data-wa-avatar="photo" src={photo} alt="" width={px} height={px} draggable={false} className={`${box} shrink-0 rounded-[var(--radius-control)] object-cover`} />
  }
  if (group) {
    return (
      <span data-wa-avatar="group" aria-hidden="true" className={`${box} flex shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-bg-sunken text-text-muted`}>
        <Icon icon={Users} />
      </span>
    )
  }
  return (
    <span data-wa-avatar="initials" aria-hidden="true" className={`${box} flex shrink-0 items-center justify-center rounded-[var(--radius-control)] font-bold ${AVATAR_TONE_CLASSES[avatarTone(id)]}`}>
      {avatarInitials(name)}
    </span>
  )
}
