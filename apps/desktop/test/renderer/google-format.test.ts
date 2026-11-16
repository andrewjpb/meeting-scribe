import { describe, expect, it } from 'vitest'
import { OAUTH_ERRORS, type GoogleAccountStatus } from '../../src/shared/accounts'
import { driveStatusLine, inDriveAfter } from '../../src/renderer/src/features/meetings/driveFormat'
import { accountLine, clientSaveErrorText, signInErrorText } from '../../src/renderer/src/features/settings/googleFormat'

const status = (patch: Partial<GoogleAccountStatus>): GoogleAccountStatus => ({ client: { configured: true, clientId: '123456•••rcontent.com' }, state: 'signed-out', profile: null, error: null, ...patch })

describe('linha "Google Drive" do detalhe (CA6)', () => {
  it('cada estado com o texto e a ação', () => {
    expect(driveStatusLine(null)).toBeNull()
    expect(driveStatusLine({ state: 'hidden' })).toBeNull()
    expect(driveStatusLine({ state: 'uploading', percent: 45 })).toEqual({ text: 'Enviando… 45%', action: null })
    expect(driveStatusLine({ state: 'done' })).toEqual({ text: 'No Drive', action: 'open' })
    expect(driveStatusLine({ state: 'offline' })).toEqual({ text: 'Aguardando internet', action: null })
    expect(driveStatusLine({ state: 'error', reason: 'quota' })).toEqual({ text: 'Erro: sem espaço no Drive', action: 'retry' })
  })

  it('a nuvem da lista só some quando a reunião sai do Drive', () => {
    expect(inDriveAfter(false, { state: 'done' })).toBe(true)
    expect(inDriveAfter(true, { state: 'uploading', percent: 10 })).toBe(true)
    expect(inDriveAfter(false, { state: 'uploading', percent: 10 })).toBe(false)
    expect(inDriveAfter(true, { state: 'hidden' })).toBe(false)
  })
})

describe('textos da conta Google (CA2)', () => {
  it('linha de apoio sem nenhum segredo', () => {
    expect(accountLine(status({ client: { configured: false, clientId: null } }))).toBe('Para guardar as reuniões no seu Google Drive.')
    expect(accountLine(status({}))).toBe('Cadastro 123456•••rcontent.com')
    expect(accountLine(status({ state: 'signing-in' }))).toBe('Continue no navegador…')
    expect(accountLine(status({ state: 'signed-in', profile: { name: 'A', email: 'a@example.com', photo: null } }))).toBe('a@example.com')
    expect(accountLine(status({ state: 'expired' }))).toBe('Sessão expirada. Entre de novo.')
  })

  it('todo erro do login tem texto, menos o cancelado', () => {
    for (const code of OAUTH_ERRORS) expect(signInErrorText(code) === null).toBe(code === 'cancelled')
    expect(signInErrorText(null)).toBeNull()
    expect(clientSaveErrorText('invalid-id')).toContain('.apps.googleusercontent.com')
  })
})
