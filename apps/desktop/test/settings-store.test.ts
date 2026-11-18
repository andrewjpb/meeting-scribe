import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseSettings, parseSettingsPatch } from '../src/main/settings/schema'
import { createFileSettingsStore, SETTINGS_FILE } from '../src/main/settings/store'
import { applySettingsPatch, DEFAULT_SETTINGS, type AppSettings } from '../src/shared/settings-defaults'

describe('esquema de configurações (CA1)', () => {
  it('padrões de N5', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      translationEnabled: true,
      translationModel: 'qwen3.5-4b-32k-fast',
      sourceLanguage: 'pt',
      targetLanguage: 'en',
      echoCancellation: false,
      removeEcho: true,
      theme: 'system',
      micDeviceId: null,
      translationEngine: 'assemblyai',
      claudeModel: 'haiku',
      chatModel: 'sonnet',
      claudePath: null,
      claudeTransport: 'acp',
      agentProfile: 'claude',
      saveToFolder: true,
      audioFolder: null,
      summarizeOnStop: true,
      liveCards: false,
      identifySpeakers: false,
      meetSpeakers: true,
      brandName: null,
      brandSubtitle: null,
      brandLogo: null,
      autoCheckUpdates: true,
      lockUseTouchId: false,
      lockAfterMinutes: 0,
      lockOnSystemLock: true,
      lockOnLaunch: false,
      saveToDrive: true,
      closeBehavior: 'tray',
      openAtLogin: false,
      scheduledRunsDailyLimit: 50,
      calendarAlerts: true,
      calendarLeadMinutes: 5,
      calendarNotRecordingAlert: true,
      calendarIds: { google: null, microsoft: null },
    })
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings([1, 2])).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('texto')).toEqual(DEFAULT_SETTINGS)
  })

  it.each(['system', 'light', 'dark'])('tema %s é aceito', (theme) => {
    expect(parseSettings({ theme }).theme).toBe(theme)
  })

  it.each(['pt', 'en', 'es', 'ja', 'ko', 'zh'])('idioma %s é aceito', (code) => {
    const other = code === 'pt' ? 'en' : 'pt'
    expect(parseSettings({ sourceLanguage: code, targetLanguage: other }).sourceLanguage).toBe(code)
    expect(parseSettings({ sourceLanguage: other, targetLanguage: code }).targetLanguage).toBe(code)
  })

  it('campo inválido cai no padrão daquele campo e os demais ficam', () => {
    const saved: AppSettings = {
      translationEnabled: false,
      translationModel: 'gpt-oss-120b',
      sourceLanguage: 'es',
      targetLanguage: 'ja',
      echoCancellation: true,
      removeEcho: false,
      theme: 'dark',
      micDeviceId: 'usb-1',
      translationEngine: 'claude-cli',
      claudeModel: 'sonnet',
      chatModel: 'opus',
      claudePath: '/opt/claude/bin/claude',
      claudeTransport: 'cli',
      agentProfile: 'claude',
      saveToFolder: false,
      audioFolder: '/Users/teste/Reuniões',
      summarizeOnStop: false,
      liveCards: true,
      identifySpeakers: true,
      meetSpeakers: false,
      brandName: 'Atas da Diretoria',
      brandSubtitle: '',
      brandLogo: 'logo-0123456789ab.png',
      autoCheckUpdates: false,
      lockUseTouchId: true,
      lockAfterMinutes: 15,
      lockOnSystemLock: false,
      lockOnLaunch: true,
      saveToDrive: false,
      closeBehavior: 'quit',
      openAtLogin: true,
      scheduledRunsDailyLimit: 10,
      calendarAlerts: false,
      calendarLeadMinutes: 10,
      calendarNotRecordingAlert: false,
      calendarIds: { google: ['primary', 'equipe@group.calendar.google.com'], microsoft: null },
    }
    expect(parseSettings(saved)).toEqual(saved)
    // Contrato 12: minutos fora da lista e uma lista de agendas inválida voltam ao padrão, sem perder a outra conta.
    expect(parseSettings({ ...saved, calendarLeadMinutes: 3 })).toEqual({ ...saved, calendarLeadMinutes: 5 })
    expect(parseSettings({ ...saved, calendarIds: { google: 'primary', microsoft: ['default'] } })).toEqual({ ...saved, calendarIds: { google: null, microsoft: ['default'] } })
    expect(parseSettings({ ...saved, calendarIds: 'tudo' })).toEqual({ ...saved, calendarIds: { google: null, microsoft: null } })
    // Contrato 23: valores fora da lista voltam ao padrão de cada campo.
    expect(parseSettings({ ...saved, closeBehavior: 'minimize' })).toEqual({ ...saved, closeBehavior: 'tray' })
    expect(parseSettings({ ...saved, scheduledRunsDailyLimit: 7 })).toEqual({ ...saved, scheduledRunsDailyLimit: 50 })
    expect(parseSettings({ ...saved, theme: 'sepia' })).toEqual({ ...saved, theme: 'system' })
    expect(parseSettings({ ...saved, sourceLanguage: 'fr' })).toEqual({ ...saved, sourceLanguage: 'pt' })
    expect(parseSettings({ ...saved, translationEnabled: 'sim' })).toEqual({ ...saved, translationEnabled: true })
    // Contrato 17: conexão desconhecida volta ao agente (padrão).
    expect(parseSettings({ ...saved, claudeTransport: 'grpc' })).toEqual({ ...saved, claudeTransport: 'acp' })
    expect(parseSettings({ ...saved, translationModel: '' })).toEqual({ ...saved, translationModel: 'qwen3.5-4b-32k-fast' })
    expect(parseSettings({ ...saved, echoCancellation: 1 })).toEqual({ ...saved, echoCancellation: false })
    expect(parseSettings({ ...saved, micDeviceId: 42 })).toEqual({ ...saved, micDeviceId: null })
    expect(parseSettings({ ...saved, micDeviceId: null })).toEqual({ ...saved, micDeviceId: null })
  })

  it('origem e destino iguais no arquivo: o destino volta ao padrão', () => {
    expect(parseSettings({ sourceLanguage: 'es', targetLanguage: 'es' })).toMatchObject({ sourceLanguage: 'es', targetLanguage: 'en' })
    expect(parseSettings({ sourceLanguage: 'en', targetLanguage: 'en' })).toMatchObject({ sourceLanguage: 'en', targetLanguage: 'pt' })
  })

  it('id de modelo no arquivo: até 128 caracteres ASCII imprimíveis', () => {
    expect(parseSettings({ translationModel: 'gpt-oss-120b' }).translationModel).toBe('gpt-oss-120b')
    expect(parseSettings({ translationModel: 'x'.repeat(129) }).translationModel).toBe(DEFAULT_SETTINGS.translationModel)
    expect(parseSettings({ translationModel: 'modelo com espaço' }).translationModel).toBe(DEFAULT_SETTINGS.translationModel)
    expect(parseSettings({ translationModel: 'modelo-é' }).translationModel).toBe(DEFAULT_SETTINGS.translationModel)
  })

  it('mudança vinda do renderer é validada sem correção e não troca o modelo', () => {
    expect(() => parseSettingsPatch({ translationModel: 'gpt-oss-120b' })).toThrow()
    expect(parseSettingsPatch({ theme: 'dark', micDeviceId: null })).toEqual({ theme: 'dark', micDeviceId: null })
    expect(() => parseSettingsPatch({ theme: 'sepia' })).toThrow()
    expect(() => parseSettingsPatch({ apiKey: 'x' })).toThrow()
    expect(() => parseSettingsPatch('x')).toThrow()
  })

  it('Claude CLI (contrato 05, CA1): motor, modelo e caminho com padrão próprio cada um', () => {
    // `settings.json` do contrato 04, sem os campos novos: carrega com os padrões deles e mantém o resto.
    const old = { translationEnabled: false, translationModel: 'gpt-oss-120b', sourceLanguage: 'es', targetLanguage: 'ja', echoCancellation: true, theme: 'dark', micDeviceId: null }
    expect(parseSettings(old)).toEqual({ ...old, removeEcho: true, translationEngine: 'assemblyai', claudeModel: 'haiku', chatModel: 'sonnet', claudePath: null, claudeTransport: 'acp', agentProfile: 'claude', saveToFolder: true, audioFolder: null, summarizeOnStop: true, liveCards: false, identifySpeakers: false, meetSpeakers: true, brandName: null, brandSubtitle: null, brandLogo: null, autoCheckUpdates: true, lockUseTouchId: false, lockAfterMinutes: 0, lockOnSystemLock: true, lockOnLaunch: false, saveToDrive: true, closeBehavior: 'tray', openAtLogin: false, scheduledRunsDailyLimit: 50, calendarAlerts: true, calendarLeadMinutes: 5, calendarNotRecordingAlert: true, calendarIds: { google: null, microsoft: null } })
    expect(parseSettings({ translationEngine: 'claude-cli', claudeModel: 'sonnet' })).toMatchObject({ translationEngine: 'claude-cli', claudeModel: 'sonnet' })
    // Fora da lista cai no padrão: só `haiku` e `sonnet`, só os dois motores.
    expect(parseSettings({ translationEngine: 'openai' }).translationEngine).toBe('assemblyai')
    expect(parseSettings({ claudeModel: 'opus' }).claudeModel).toBe('haiku')
    expect(parseSettings({ claudeModel: 'claude-haiku-5-5' }).claudeModel).toBe('haiku')
    // Caminho: absoluto, sem caractere de controle, até 1024 caracteres.
    expect(parseSettings({ claudePath: '/Users/a/.local/bin/claude' }).claudePath).toBe('/Users/a/.local/bin/claude')
    expect(parseSettings({ claudePath: 'claude' }).claudePath).toBeNull()
    expect(parseSettings({ claudePath: '/bin/claude\n--x' }).claudePath).toBeNull()
    expect(parseSettings({ claudePath: `/${'a'.repeat(1024)}` }).claudePath).toBeNull()
    expect(parseSettings({ claudePath: 42 }).claudePath).toBeNull()
  })

  it('Remover eco (contrato 06, CA1): padrão ligado; arquivo antigo e valor inválido voltam ao padrão', () => {
    // `settings.json` do contrato 05, sem o campo novo.
    const old = { ...DEFAULT_SETTINGS, translationEngine: 'claude-cli', claudeModel: 'sonnet' } as Record<string, unknown>
    delete old['removeEcho']
    expect(parseSettings(old)).toEqual({ ...DEFAULT_SETTINGS, translationEngine: 'claude-cli', claudeModel: 'sonnet', removeEcho: true })
    expect(parseSettings({ removeEcho: false }).removeEcho).toBe(false)
    expect(parseSettings({ removeEcho: 'nao' }).removeEcho).toBe(true)
    expect(parseSettings({ removeEcho: 0 }).removeEcho).toBe(true)
    expect(parseSettings({ removeEcho: null }).removeEcho).toBe(true)
    expect(parseSettingsPatch({ removeEcho: false })).toEqual({ removeEcho: false })
    expect(() => parseSettingsPatch({ removeEcho: 'nao' })).toThrow()
  })

  it('Arquivos da reunião (contrato 07, CA1): ligado por padrão, pasta padrão; arquivo antigo e valor inválido voltam ao padrão', () => {
    // `settings.json` do contrato 06, sem os campos novos.
    const old = { ...DEFAULT_SETTINGS, theme: 'dark', removeEcho: false } as Record<string, unknown>
    delete old['saveToFolder']
    delete old['audioFolder']
    expect(parseSettings(old)).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark', removeEcho: false, saveToFolder: true, audioFolder: null })
    expect(parseSettings({ saveToFolder: false }).saveToFolder).toBe(false)
    expect(parseSettings({ saveToFolder: 'sim' }).saveToFolder).toBe(true)
    expect(parseSettings({ audioFolder: '/Users/teste/Drive/Reuniões' }).audioFolder).toBe('/Users/teste/Drive/Reuniões')
    expect(parseSettings({ audioFolder: 'relativa/pasta' }).audioFolder).toBeNull()
    expect(parseSettings({ audioFolder: '/pasta\n/x' }).audioFolder).toBeNull()
    expect(parseSettings({ audioFolder: 42 }).audioFolder).toBeNull()
  })

  it('Arquivos da reunião pelo renderer: o interruptor passa; a pasta nunca (só o diálogo do main)', () => {
    expect(parseSettingsPatch({ saveToFolder: false })).toEqual({ saveToFolder: false })
    expect(() => parseSettingsPatch({ saveToFolder: 'nao' })).toThrow()
    expect(() => parseSettingsPatch({ audioFolder: '/tmp/qualquer' })).toThrow()
    expect(() => parseSettingsPatch({ audioFolder: null })).toThrow()
  })

  it('Resumir ao encerrar (contrato 08, CA3): ligado por padrão; arquivo antigo e valor inválido voltam ao padrão', () => {
    // `settings.json` do contrato 07, sem o campo novo.
    const old = { ...DEFAULT_SETTINGS, theme: 'dark', saveToFolder: false } as Record<string, unknown>
    delete old['summarizeOnStop']
    expect(DEFAULT_SETTINGS.summarizeOnStop).toBe(true)
    expect(parseSettings(old)).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark', saveToFolder: false, summarizeOnStop: true })
    expect(parseSettings({ summarizeOnStop: false }).summarizeOnStop).toBe(false)
    expect(parseSettings({ summarizeOnStop: 'sim' }).summarizeOnStop).toBe(true)
    expect(parseSettingsPatch({ summarizeOnStop: false })).toEqual({ summarizeOnStop: false })
  })

  it('Agenda (contrato 12, CA3): avisos ligados, 5 min, "não está gravando" ligado e a agenda principal; antigo carrega com os padrões', () => {
    const added = ['calendarAlerts', 'calendarLeadMinutes', 'calendarNotRecordingAlert', 'calendarIds']
    const old = Object.fromEntries(Object.entries({ ...DEFAULT_SETTINGS, theme: 'dark' }).filter(([name]) => !added.includes(name)))
    expect(parseSettings(old)).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark' })
    expect(DEFAULT_SETTINGS).toMatchObject({ calendarAlerts: true, calendarLeadMinutes: 5, calendarNotRecordingAlert: true, calendarIds: { google: null, microsoft: null } })
    expect(parseSettingsPatch({ calendarLeadMinutes: 1, calendarIds: { google: ['primary'], microsoft: [] } })).toEqual({ calendarLeadMinutes: 1, calendarIds: { google: ['primary'], microsoft: [] } })
    expect(() => parseSettingsPatch({ calendarLeadMinutes: 15 })).toThrow()
    expect(() => parseSettingsPatch({ calendarIds: { google: ['primary'] } })).toThrow()
    expect(() => parseSettingsPatch({ calendarIds: { google: ['linha\nquebrada'], microsoft: null } })).toThrow()
  })

  it('identifySpeakers: desligado por padrão, antigo carrega desligado, inválido volta ao padrão', () => {
    expect(DEFAULT_SETTINGS.identifySpeakers).toBe(false)
    expect(parseSettings({ theme: 'dark' }).identifySpeakers).toBe(false)
    expect(parseSettings({ identifySpeakers: true }).identifySpeakers).toBe(true)
    expect(parseSettings({ identifySpeakers: 'sim' }).identifySpeakers).toBe(false)
    expect(parseSettingsPatch({ identifySpeakers: true })).toEqual({ identifySpeakers: true })
    expect(() => parseSettingsPatch({ summarizeOnStop: 'nao' })).toThrow()
  })

  it('meetSpeakers (contrato 27, CA6): ligado por padrão, antigo carrega ligado, inválido volta ao padrão', () => {
    expect(DEFAULT_SETTINGS.meetSpeakers).toBe(true)
    expect(parseSettings({ theme: 'dark' }).meetSpeakers).toBe(true)
    expect(parseSettings({ meetSpeakers: false }).meetSpeakers).toBe(false)
    expect(parseSettings({ meetSpeakers: 'sim' }).meetSpeakers).toBe(true)
    expect(parseSettingsPatch({ meetSpeakers: false })).toEqual({ meetSpeakers: false })
    expect(() => parseSettingsPatch({ meetSpeakers: 'nao' })).toThrow()
  })

  it('Marca (contrato 09, CA1): padrões nulos; arquivo antigo carrega com os padrões; inválido volta ao padrão', () => {
    // `settings.json` do contrato 08, sem os campos novos.
    const old = { ...DEFAULT_SETTINGS, theme: 'dark', identifySpeakers: true } as Record<string, unknown>
    delete old['brandName']
    delete old['brandSubtitle']
    delete old['brandLogo']
    expect(parseSettings(old)).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark', identifySpeakers: true, brandName: null, brandSubtitle: null, brandLogo: null })

    // Nome: aparado, de 1 a 40 caracteres, numa linha só.
    expect(parseSettings({ brandName: '  Atas da Diretoria  ' }).brandName).toBe('Atas da Diretoria')
    expect(parseSettings({ brandName: 'x'.repeat(40) }).brandName).toBe('x'.repeat(40))
    expect(parseSettings({ brandName: 'x'.repeat(41) }).brandName).toBeNull()
    expect(parseSettings({ brandName: '   ' }).brandName).toBeNull()
    expect(parseSettings({ brandName: '' }).brandName).toBeNull()
    expect(parseSettings({ brandName: 'Duas\nlinhas' }).brandName).toBeNull()
    expect(parseSettings({ brandName: 'Com\rretorno' }).brandName).toBeNull()
    expect(parseSettings({ brandName: 42 }).brandName).toBeNull()

    // Subtítulo: aparado, de 0 a 40; vazio é "sem subtítulo" (não volta ao padrão).
    expect(parseSettings({ brandSubtitle: '' }).brandSubtitle).toBe('')
    expect(parseSettings({ brandSubtitle: '  Jurídico ' }).brandSubtitle).toBe('Jurídico')
    expect(parseSettings({ brandSubtitle: 'y'.repeat(41) }).brandSubtitle).toBeNull()
    expect(parseSettings({ brandSubtitle: 'a\nb' }).brandSubtitle).toBeNull()
    expect(parseSettings({ brandSubtitle: false }).brandSubtitle).toBeNull()

    // Logo: só o nome no formato gerado pelo main.
    expect(parseSettings({ brandLogo: 'logo-deadbeef.png' }).brandLogo).toBe('logo-deadbeef.png')
    expect(parseSettings({ brandLogo: '../settings.json' }).brandLogo).toBeNull()
    expect(parseSettings({ brandLogo: '/Users/x/logo-deadbeef.png' }).brandLogo).toBeNull()
    expect(parseSettings({ brandLogo: 'logo-DEADBEEF.png' }).brandLogo).toBeNull()
    expect(parseSettings({ brandLogo: 'logo-deadbee.png' }).brandLogo).toBeNull()
    expect(parseSettings({ brandLogo: 'logo-deadbeef.svg' }).brandLogo).toBeNull()
  })

  it('Marca pelo renderer: nome e subtítulo validados sem correção; o logo nunca (só o diálogo do main)', () => {
    expect(parseSettingsPatch({ brandName: ' Atas ', brandSubtitle: '' })).toEqual({ brandName: 'Atas', brandSubtitle: '' })
    expect(parseSettingsPatch({ brandName: null, brandSubtitle: null })).toEqual({ brandName: null, brandSubtitle: null })
    expect(() => parseSettingsPatch({ brandName: '' })).toThrow()
    expect(() => parseSettingsPatch({ brandName: 'x'.repeat(41) })).toThrow()
    expect(() => parseSettingsPatch({ brandName: 'a\nb' })).toThrow()
    expect(() => parseSettingsPatch({ brandSubtitle: 'y'.repeat(41) })).toThrow()
    expect(() => parseSettingsPatch({ brandLogo: 'logo-deadbeef.png' })).toThrow()
    expect(() => parseSettingsPatch({ brandLogo: null })).toThrow()
  })

  it('Modelo do chat (contrato 15, CA2): haiku, sonnet ou opus, padrão sonnet', () => {
    expect(parseSettings({}).chatModel).toBe('sonnet')
    for (const model of ['haiku', 'sonnet', 'opus']) expect(parseSettings({ chatModel: model }).chatModel).toBe(model)
    expect(parseSettings({ chatModel: 'claude-opus-5-5' }).chatModel).toBe('sonnet')
    expect(parseSettingsPatch({ chatModel: 'opus' })).toEqual({ chatModel: 'opus' })
    expect(() => parseSettingsPatch({ chatModel: 'gpt' })).toThrow()
  })

  it('Atualizações (contrato 14): "Procurar automaticamente" ligado por padrão, só booleano', () => {
    expect(parseSettings({}).autoCheckUpdates).toBe(true)
    expect(parseSettings({ autoCheckUpdates: false }).autoCheckUpdates).toBe(false)
    expect(parseSettings({ autoCheckUpdates: 'não' }).autoCheckUpdates).toBe(true)
    expect(parseSettingsPatch({ autoCheckUpdates: false })).toEqual({ autoCheckUpdates: false })
    expect(() => parseSettingsPatch({ autoCheckUpdates: 'sim' })).toThrow()
  })

  it('Bloqueio (contrato 22): padrões, minutos só do seletor e booleanos estritos no renderer', () => {
    expect(parseSettings({})).toMatchObject({ lockUseTouchId: false, lockAfterMinutes: 0, lockOnSystemLock: true, lockOnLaunch: false })
    for (const minutes of [0, 1, 5, 15, 30]) expect(parseSettings({ lockAfterMinutes: minutes }).lockAfterMinutes).toBe(minutes)
    expect(parseSettings({ lockAfterMinutes: 2 }).lockAfterMinutes).toBe(0)
    expect(parseSettings({ lockAfterMinutes: '5' }).lockAfterMinutes).toBe(0)
    expect(parseSettings({ lockOnSystemLock: 'não' }).lockOnSystemLock).toBe(true)
    expect(parseSettingsPatch({ lockAfterMinutes: 30, lockOnLaunch: true })).toEqual({ lockAfterMinutes: 30, lockOnLaunch: true })
    expect(() => parseSettingsPatch({ lockAfterMinutes: 10 })).toThrow()
    expect(() => parseSettingsPatch({ lockUseTouchId: 'sim' })).toThrow()
  })

  it('Claude CLI pelo renderer: motor e modelo validados; o caminho não passa por aqui', () => {
    expect(parseSettingsPatch({ translationEngine: 'claude-cli', claudeModel: 'sonnet' })).toEqual({ translationEngine: 'claude-cli', claudeModel: 'sonnet' })
    expect(() => parseSettingsPatch({ translationEngine: 'openai' })).toThrow()
    expect(() => parseSettingsPatch({ claudeModel: 'opus' })).toThrow()
    expect(() => parseSettingsPatch({ claudePath: '/tmp/claude' })).toThrow()
  })

  it('escolher para um lado o idioma do outro troca os dois (CA10)', () => {
    const base = { ...DEFAULT_SETTINGS }
    expect(applySettingsPatch(base, { targetLanguage: 'pt' })).toMatchObject({ sourceLanguage: 'en', targetLanguage: 'pt' })
    expect(applySettingsPatch(base, { sourceLanguage: 'en' })).toMatchObject({ sourceLanguage: 'en', targetLanguage: 'pt' })
    expect(applySettingsPatch(base, { sourceLanguage: 'ja' })).toMatchObject({ sourceLanguage: 'ja', targetLanguage: 'en' })
  })
})

describe('store de configurações (CA2)', () => {
  let dir: string
  const onDisk = (): { version: number; settings: AppSettings } => JSON.parse(readFileSync(join(dir, SETTINGS_FILE), 'utf8'))

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'settings-store-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('sem arquivo valem os padrões e nada é criado', async () => {
    const store = createFileSettingsStore({ dir })
    expect(await store.get()).toEqual(DEFAULT_SETTINGS)
    expect(readdirSync(dir)).toEqual([])
  })

  it('atualizar regrava o arquivo de forma atômica (0600) e avisa', async () => {
    const onChange = vi.fn()
    const store = createFileSettingsStore({ dir, onChange })
    const next = await store.update({ theme: 'dark' })
    expect(next).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark' })
    expect(onDisk()).toEqual({ version: 1, settings: next })
    expect(statSync(join(dir, SETTINGS_FILE)).mode & 0o777).toBe(0o600)
    expect(onChange).toHaveBeenCalledWith(next)

    await Promise.all([store.update({ echoCancellation: true }), store.update({ micDeviceId: 'usb-2' }), store.update({ targetLanguage: 'ja' })])
    expect(readdirSync(dir)).toEqual([SETTINGS_FILE])
    expect(onDisk().settings).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark', echoCancellation: true, micDeviceId: 'usb-2', targetLanguage: 'ja' })
    expect(onChange).toHaveBeenCalledTimes(4)

    // Outra instância (app reaberto) lê o que foi gravado.
    expect(await createFileSettingsStore({ dir }).get()).toEqual(onDisk().settings)
  })

  it('o modelo só muda pela função interna, com id válido', async () => {
    const onChange = vi.fn()
    const store = createFileSettingsStore({ dir, onChange })
    await expect(store.update({ translationModel: 'gpt-oss-120b' })).rejects.toThrow()
    expect(readdirSync(dir)).toEqual([])
    expect(await store.setTranslationModel('gpt-oss-120b')).toEqual({ ...DEFAULT_SETTINGS, translationModel: 'gpt-oss-120b' })
    expect(onDisk().settings.translationModel).toBe('gpt-oss-120b')
    await expect(store.setTranslationModel('x'.repeat(129))).rejects.toThrow()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('o caminho do claude só muda pela função interna, com caminho absoluto (contrato 05)', async () => {
    const store = createFileSettingsStore({ dir })
    expect(await store.setClaudePath('/opt/claude/claude')).toEqual({ ...DEFAULT_SETTINGS, claudePath: '/opt/claude/claude' })
    expect(onDisk().settings.claudePath).toBe('/opt/claude/claude')
    await expect(store.setClaudePath('relativo/claude')).rejects.toThrow()
    await expect(store.update({ claudePath: '/tmp/claude' })).rejects.toThrow()
    expect(await store.setClaudePath(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('a pasta dos arquivos só muda pela função interna, com caminho absoluto (contrato 07)', async () => {
    const store = createFileSettingsStore({ dir })
    await expect(store.update({ audioFolder: '/tmp/x' })).rejects.toThrow()
    expect(readdirSync(dir)).toEqual([])
    expect(await store.setAudioFolder('/Users/teste/Reuniões')).toEqual({ ...DEFAULT_SETTINGS, audioFolder: '/Users/teste/Reuniões' })
    expect(onDisk().settings.audioFolder).toBe('/Users/teste/Reuniões')
    await expect(store.setAudioFolder('relativa')).rejects.toThrow()
    expect(await store.setAudioFolder(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('o logo só muda pela função interna, com nome no formato (contrato 09)', async () => {
    const store = createFileSettingsStore({ dir })
    await expect(store.update({ brandLogo: 'logo-deadbeef.png' })).rejects.toThrow()
    expect(readdirSync(dir)).toEqual([])
    expect(await store.setBrandLogo('logo-deadbeef01.png')).toEqual({ ...DEFAULT_SETTINGS, brandLogo: 'logo-deadbeef01.png' })
    expect(onDisk().settings.brandLogo).toBe('logo-deadbeef01.png')
    await expect(store.setBrandLogo('../logo-deadbeef.png')).rejects.toThrow()
    expect(await store.setBrandLogo(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('mudança inválida não grava nem avisa', async () => {
    const onChange = vi.fn()
    const store = createFileSettingsStore({ dir, onChange })
    await expect(store.update({ theme: 'sepia' })).rejects.toThrow()
    await expect(store.update({ sourceLanguage: 'en', targetLanguage: 'en' })).rejects.toThrow()
    expect(readdirSync(dir)).toEqual([])
    expect(onChange).not.toHaveBeenCalled()
  })

  it.each([
    ['JSON quebrado', '{"version":1,"settings":{'],
    ['vazio', ''],
    ['formato errado', '[1,2,3]'],
  ])('arquivo corrompido (%s) resulta nos padrões; ao gravar, o original é guardado', async (_label, content) => {
    writeFileSync(join(dir, SETTINGS_FILE), content)
    const store = createFileSettingsStore({ dir, now: () => Date.parse('2026-11-14T18:00:00.000Z') })
    expect(await store.get()).toEqual(DEFAULT_SETTINGS)
    await store.update({ theme: 'light' })
    expect(onDisk().settings).toEqual({ ...DEFAULT_SETTINGS, theme: 'light' })
    const kept = readdirSync(dir).filter((file) => file !== SETTINGS_FILE)
    if (content.startsWith('{') || content === '') expect(kept).toEqual(['settings.json.corrupt-2026-11-14T18-00-00-000Z'])
  })

  it('campo inválido no arquivo cai no padrão e mantém os demais', async () => {
    writeFileSync(join(dir, SETTINGS_FILE), JSON.stringify({ version: 1, settings: { theme: 'roxo', echoCancellation: true, targetLanguage: 'ko' } }))
    expect(await createFileSettingsStore({ dir }).get()).toEqual({ ...DEFAULT_SETTINGS, echoCancellation: true, targetLanguage: 'ko' })
  })
})

vi.mock('electron', () => ({ ipcMain: {} }))

describe('aviso de mudança (CA2)', () => {
  it('vai para todas as janelas que ainda existem', async () => {
    const { broadcast } = await import('../src/main/ipc')
    const window = (destroyed: boolean) => ({ webContents: { isDestroyed: () => destroyed, send: vi.fn() } })
    const windows = [window(false), window(false), window(true)]
    broadcast(windows as never, 'scribe:settings-changed', { ...DEFAULT_SETTINGS, theme: 'dark' })
    expect(windows[0]?.webContents.send).toHaveBeenCalledWith('scribe:settings-changed', { ...DEFAULT_SETTINGS, theme: 'dark' })
    expect(windows[1]?.webContents.send).toHaveBeenCalledTimes(1)
    expect(windows[2]?.webContents.send).not.toHaveBeenCalled()
  })
})
