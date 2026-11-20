// Contrato 71 (CA5–CA9, CA15): a fila de publicações no serviço das redes, com o Instagram e o S3 falsos em memória e o
// relógio injetado: salvar (conferência e cópia das mídias), o token de clique, publicar (a imagem sobe e sai do
// armazenamento), a cota adiando 1 h, o agendador, o bloqueio pausando, o erro e a limpeza do armazenamento 48 h
// depois, a nova tentativa sem contêiner novo, a retomada ao abrir e o "Remover" levando a fila.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MEDIA_HOST_REQUIRED_MESSAGE, QUOTA_POSTPONED_MESSAGE, REDES_CLICK_MESSAGE, type Publication, type RedesPublicationsPayload } from '../src/shared/redes'
import type { HttpFetch } from '../src/main/accounts/http'
import { createEmailClickGuard } from '../src/main/email/service'
import type { SafeStorageLike } from '../src/main/secrets'
import { createFakeInstagram, SMOKE_IG_TOKEN, SMOKE_IG_USER_ID, type FakeInstagram } from '../src/main/redes/fake-instagram'
import { createFakeS3, type FakeS3 } from '../src/main/redes/fake-s3'
import { testMediaHost } from '../src/main/redes/media-host'
import { createRedesService, PUBLICATION_ERROR_STATE_MESSAGE, PUBLICATION_MAYBE_OUT_MESSAGE, type RedesService } from '../src/main/redes/service'

const T0 = Date.parse('2026-11-20T12:00:00.000Z')
const HOUR = 3_600_000
const FIXTURES = join(__dirname, 'fixtures', 'redes')
const S3 = { endpoint: 'http://127.0.0.1:9/s3', publicBaseUrl: 'http://127.0.0.1:9/publico', bucket: 'midia-teste', accessKeyId: 'AKTESTE0000', secretAccessKey: 'segredo-s3-de-teste-0000', region: 'auto' }
const WINDOW = 7

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`enc:${[...plain].reverse().join('')}`),
  decryptString: (data) => [...data.toString().slice(4)].reverse().join(''),
}

/** Um JPEG mínimo de `width`×`height` (o serviço só lê o cabeçalho). */
function jpeg(width: number, height: number): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x03, ...Array<number>(9).fill(0), 0xff, 0xd9])
}

function plainFiles(dir: string): string {
  const out: string[] = []
  const walk = (path: string): void => {
    for (const name of readdirSync(path)) {
      const full = join(path, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (!name.endsWith('.bin')) out.push(readFileSync(full, 'latin1'))
    }
  }
  walk(dir)
  return out.join('\n')
}

describe('publicações no serviço das redes (contrato 71)', () => {
  let dir: string
  let files: string
  let fake: FakeInstagram
  let s3: FakeS3
  let clock: number
  let locked: boolean
  let events: RedesPublicationsPayload[]
  let service: RedesService
  let click: () => string
  /** O S3 recusando (500) os `DELETE`, ou o `PUT` de número `failPutAt` (1, 2…). */
  let s3Faults: { deletes: boolean; failPutAt: number | null; puts: number }
  /** Chamado na espera do contêiner (a tentativa está no meio). */
  let onSleep: (() => Promise<void>) | null
  /** Contrato 72: o `media_publish` sai na Meta mas a resposta se perde; a consulta do status do contêiner falha. */
  let metaFaults: { losePublish: boolean; statusFails: boolean }

  const make = (): RedesService => {
    const guard = createEmailClickGuard(() => clock)
    click = () => {
      const token = crypto.randomUUID()
      guard.register(WINDOW, token)
      return token
    }
    const fetch: HttpFetch = async (url, init) => {
      const failed = { status: 500, header: () => null, text: () => Promise.resolve('{"error":{"code":2}}'), bytes: () => Promise.resolve(new Uint8Array(0)) }
      if (metaFaults.statusFails && new URL(url).searchParams.get('fields')?.includes('status_code')) return failed
      if (metaFaults.losePublish && new URL(url).pathname.endsWith('/media_publish')) {
        metaFaults.losePublish = false
        await fake.fetch(url, init)
        return failed
      }
      if (new URL(url).host !== '127.0.0.1:9') return fake.fetch(url, init)
      if (init.method === 'PUT') s3Faults.puts++
      const refused = (init.method === 'DELETE' && s3Faults.deletes) || (init.method === 'PUT' && s3Faults.puts === s3Faults.failPutAt)
      if (refused) return Promise.resolve({ status: 500, header: () => null, text: () => Promise.resolve(''), bytes: () => Promise.resolve(new Uint8Array(0)) })
      return s3.fetch(url, init)
    }
    return createRedesService({
      userData: dir,
      safeStorage,
      fetch,
      onState: () => undefined,
      now: () => clock,
      testMediaHost,
      isLocked: () => locked,
      clickGuard: guard,
      pickFiles: () => Promise.resolve([join(files, 'larga.jpg'), join(FIXTURES, 'imagem-640x800.jpg')]),
      onPublications: (payload) => events.push(payload),
      sleep: () => (onSleep ? onSleep() : Promise.resolve()),
    })
  }
  const queue = (): Publication[] => events.at(-1)?.publications ?? []
  const find = (id: string): Publication | undefined => queue().find((item) => item.id === id)
  /** Espera a publicação sair de `publicando` (a publicação roda sem ser esperada). */
  const settled = async (id: string): Promise<Publication> => {
    for (let index = 0; index < 200; index++) {
      const current = find(id)
      if (current && current.state !== 'publicando') return current
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    throw new Error('a publicação não terminou')
  }
  const draft = async (paths: string[], caption = 'Legenda #lap'): Promise<Publication> => {
    const result = await service.savePublication({ accountId: SMOKE_IG_USER_ID, caption, mediaPaths: paths, altTexts: {}, scheduledAt: null })
    if (!result.ok) throw new Error(result.problems.join('; '))
    return result.publication
  }
  const mediaPosts = (): number => fake.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/media')).length

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'redes-pub-'))
    files = mkdtempSync(join(tmpdir(), 'redes-pub-arquivos-'))
    writeFileSync(join(files, 'larga.jpg'), jpeg(1920, 600))
    writeFileSync(join(files, 'foto.jpg'), jpeg(1080, 1350))
    writeFileSync(join(files, 'imagem.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array<number>(24).fill(0)]))
    fake = createFakeInstagram({ now: () => clock })
    s3 = createFakeS3({ ...S3, strictSignature: true })
    fake.mediaFetch = s3.fetch
    clock = T0
    locked = false
    s3Faults = { deletes: false, failPutAt: null, puts: 0 }
    onSleep = null
    metaFaults = { losePublish: false, statusFails: false }
    events = []
    service = make()
    await service.init()
    expect((await service.connect({ token: SMOKE_IG_TOKEN })).ok).toBe(true)
    const saved = await service.mediaHostSave({ config: { endpoint: S3.endpoint, region: S3.region, bucket: S3.bucket, accessKeyId: S3.accessKeyId, publicBaseUrl: S3.publicBaseUrl, pathStyle: true }, secretAccessKey: S3.secretAccessKey })
    expect(saved.ok).toBe(true)
  })
  afterEach(() => {
    service.dispose()
    rmSync(dir, { recursive: true, force: true })
    rmSync(files, { recursive: true, force: true })
  })

  it('salvar: PNG e proporção errada recusados com a razão por arquivo; nada gravado', async () => {
    const result = await service.savePublication({ accountId: SMOKE_IG_USER_ID, caption: 'x', mediaPaths: [join(files, 'imagem.png'), join(files, 'larga.jpg')], altTexts: {}, scheduledAt: null })
    expect(result).toEqual({ ok: false, problems: ['imagem.png: Só JPEG é aceito para imagem', 'larga.jpg: Proporção fora de 4:5 a 1,91:1 (está em 3,2:1)'] })
    const eleven = await service.savePublication({ accountId: SMOKE_IG_USER_ID, caption: 'x', mediaPaths: Array<string>(11).fill(join(files, 'foto.jpg')), altTexts: {}, scheduledAt: null })
    expect(eleven).toEqual({ ok: false, problems: ['Carrossel aceita no máximo 10 imagens'] })
    const long = await service.savePublication({ accountId: SMOKE_IG_USER_ID, caption: 'a'.repeat(2201), mediaPaths: [join(files, 'foto.jpg')], altTexts: {}, scheduledAt: null })
    expect(long).toEqual({ ok: false, problems: ['Legenda acima de 2.200 caracteres'] })
    expect((await service.publications({ accountId: SMOKE_IG_USER_ID })).publications).toEqual([])
    expect(existsSync(join(dir, 'redes', 'midia'))).toBe(false)
  })

  it('o diálogo devolve os arquivos conferidos, sem salvar nada', async () => {
    const candidates = await service.pickMedia()
    expect(candidates.map((item) => [item.fileName, item.ok])).toEqual([
      ['larga.jpg', false],
      ['imagem-640x800.jpg', true],
    ])
    expect((await service.publications({ accountId: SMOKE_IG_USER_ID })).publications).toEqual([])
  })

  it('salvar copia a mídia (0600, pasta 0700), guarda a fila no arquivo e a edição reaproveita a cópia', async () => {
    const publication = await draft([join(files, 'foto.jpg')])
    expect(publication).toMatchObject({ state: 'rascunho', type: 'imagem', attempts: 0, creationId: null })
    const [copy] = publication.media
    expect(copy?.localPath.startsWith(join(dir, 'redes', 'midia', publication.id))).toBe(true)
    expect(statSync(copy?.localPath ?? '').mode & 0o777).toBe(0o600)
    expect(statSync(join(dir, 'redes', 'midia', publication.id)).mode & 0o777).toBe(0o700)
    // O original pode sumir: a cópia vale.
    rmSync(join(files, 'foto.jpg'))
    const edited = await service.savePublication({ id: publication.id, accountId: SMOKE_IG_USER_ID, caption: 'Outra', mediaPaths: [copy?.localPath ?? '', join(FIXTURES, 'imagem-640x800.jpg')], altTexts: { [copy?.localPath ?? '']: 'Equipe na sala' }, scheduledAt: null })
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    expect(edited.publication).toMatchObject({ id: publication.id, type: 'carrossel', caption: 'Outra' })
    expect(edited.publication.media[0]).toMatchObject({ id: copy?.id, altText: 'Equipe na sala' })
    // Reaberto do disco: a mesma fila.
    service.dispose()
    events = []
    service = make()
    await service.init()
    expect((await service.publications({ accountId: SMOKE_IG_USER_ID })).publications.map((item) => item.id)).toEqual([publication.id])
    // Tirar uma mídia apaga a cópia dela.
    const removed = await service.savePublication({ id: publication.id, accountId: SMOKE_IG_USER_ID, caption: 'Outra', mediaPaths: [edited.publication.media[1]?.localPath ?? ''], altTexts: {}, scheduledAt: null })
    expect(removed.ok).toBe(true)
    expect(existsSync(copy?.localPath ?? '')).toBe(false)
  })

  it('"Publicar agora" sem o token de clique é recusado; com ele, publica, apaga do armazenamento e nada vaza', async () => {
    const publication = await draft([join(files, 'foto.jpg')])
    expect(await service.publishNow(WINDOW, { id: publication.id, clickToken: crypto.randomUUID() })).toEqual({ ok: false, error: REDES_CLICK_MESSAGE })
    const token = click()
    expect(await service.publishNow(WINDOW + 1, { id: publication.id, clickToken: token })).toEqual({ ok: false, error: REDES_CLICK_MESSAGE })
    expect(find(publication.id)?.state).toBe('rascunho')
    const started = await service.publishNow(WINDOW, { id: publication.id, clickToken: click() })
    expect(started).toMatchObject({ ok: true, publication: { state: 'publicando' } })
    const done = await settled(publication.id)
    expect(done).toMatchObject({ state: 'publicada', attempts: 1, error: null })
    expect(done.permalink).toMatch(/^https:\/\/www\.instagram\.com\/p\//)
    expect(done.media[0]?.s3Key).toBeNull()
    // Subiu para `instagram/<conta>/<publicação>/<mídia>.jpg` e foi apagada depois.
    const s3Paths = s3.calls.map((call) => `${call.method} ${call.path}`)
    expect(s3Paths).toContain(`PUT /s3/${S3.bucket}/instagram/${SMOKE_IG_USER_ID}/${publication.id}/${publication.media[0]?.id}.jpg`)
    expect(s3Paths).toContain(`DELETE /s3/${S3.bucket}/instagram/${SMOKE_IG_USER_ID}/${publication.id}/${publication.media[0]?.id}.jpg`)
    expect(s3.objects().size).toBe(0)
    expect(fake.calls.filter((call) => call.host === 'graph.instagram.com').every((call) => call.bearer && !call.tokenInQuery)).toBe(true)
    const plain = plainFiles(dir)
    for (const secret of [...fake.tokens(), S3.secretAccessKey]) {
      expect(plain).not.toContain(secret)
      expect(JSON.stringify(events)).not.toContain(secret)
    }
    // A cota lida fica no cache (e conta a publicação).
    expect(await service.quota({ accountId: SMOKE_IG_USER_ID })).toMatchObject({ ok: true, quota: { used: 1, total: 50 } })
  })

  it('cota esgotada: adia 1 h com o aviso, sem criar contêiner nem gastar tentativa', async () => {
    fake.setQuota(50, 50)
    const publication = await draft([join(files, 'foto.jpg')])
    await service.publishNow(WINDOW, { id: publication.id, clickToken: click() })
    const postponed = await settled(publication.id)
    expect(postponed).toMatchObject({ state: 'agendada', error: QUOTA_POSTPONED_MESSAGE, attempts: 0, scheduledAt: new Date(T0 + HOUR).toISOString() })
    expect(mediaPosts()).toBe(0)
    // Uma hora depois, com a cota de volta, o agendador publica.
    fake.setQuota(10, 50)
    clock += HOUR
    await service.tick()
    expect(find(publication.id)).toMatchObject({ state: 'publicada', error: null })
  })

  it('agendador: "Agendar" com o token, nada antes da hora, publica no tick seguinte; bloqueado não publica (CA15)', async () => {
    const publication = await draft([join(files, 'foto.jpg')])
    expect(await service.schedulePublication(WINDOW, { id: publication.id, at: new Date(T0 + 60_000).toISOString(), clickToken: crypto.randomUUID() })).toEqual({ ok: false, error: REDES_CLICK_MESSAGE })
    expect(await service.schedulePublication(WINDOW, { id: publication.id, at: new Date(T0 - 1000).toISOString(), clickToken: click() })).toEqual({ ok: false, error: 'Escolha um horário no futuro' })
    expect(await service.schedulePublication(WINDOW, { id: publication.id, at: new Date(T0 + 60_000).toISOString(), clickToken: click() })).toMatchObject({ ok: true, publication: { state: 'agendada' } })
    await service.tick()
    expect(find(publication.id)?.state).toBe('agendada')
    clock += 61_000
    locked = true
    await service.tick()
    expect(find(publication.id)?.state).toBe('agendada')
    expect(mediaPosts()).toBe(0)
    locked = false
    await service.tick()
    expect(find(publication.id)?.state).toBe('publicada')
    // Volta a rascunho só a agendada.
    expect(await service.unschedule({ id: publication.id })).toMatchObject({ ok: false })
  })

  it('agendada volta a rascunho; apagar tira a fila e as cópias (não em `publicando`)', async () => {
    const publication = await draft([join(files, 'foto.jpg')])
    await service.schedulePublication(WINDOW, { id: publication.id, at: new Date(T0 + 60_000).toISOString(), clickToken: click() })
    expect(await service.unschedule({ id: publication.id })).toMatchObject({ ok: true, publication: { state: 'rascunho' } })
    expect(await service.deletePublication({ id: publication.id })).toEqual({ ok: true })
    expect(find(publication.id)).toBeUndefined()
    expect(existsSync(join(dir, 'redes', 'midia', publication.id))).toBe(false)
  })

  it('sem armazenamento: imagem vira erro com o aviso; o Reels publica pelo upload da Meta', async () => {
    await service.mediaHostClear()
    const image = await draft([join(files, 'foto.jpg')])
    await service.publishNow(WINDOW, { id: image.id, clickToken: click() })
    expect(await settled(image.id)).toMatchObject({ state: 'erro', error: MEDIA_HOST_REQUIRED_MESSAGE })
    const reel = await draft([join(FIXTURES, 'video-4s.mp4')])
    expect(reel.type).toBe('reels')
    await service.publishNow(WINDOW, { id: reel.id, clickToken: click() })
    expect(await settled(reel.id)).toMatchObject({ state: 'publicada' })
    const size = statSync(join(FIXTURES, 'video-4s.mp4')).size
    expect(fake.uploads).toEqual([expect.objectContaining({ offset: '0', fileSize: String(size), bodyBytes: size, oauth: true })])
  })

  it('contêiner em ERROR: mensagem em pt-BR, a imagem fica 48 h no armazenamento; "Tentar de novo" troca o contêiner morto uma vez', async () => {
    fake.failNext(36003)
    const publication = await draft([join(files, 'foto.jpg')])
    await service.publishNow(WINDOW, { id: publication.id, clickToken: click() })
    const failed = await settled(publication.id)
    expect(failed).toMatchObject({ state: 'erro', error: 'Proporção fora de 4:5 a 1,91:1', attempts: 1 })
    expect(failed.creationId).not.toBeNull()
    expect(s3.objects().size).toBe(1)
    clock += 47 * HOUR
    await service.tick()
    expect(s3.objects().size).toBe(1)
    clock += HOUR
    await service.tick()
    expect(s3.objects().size).toBe(0)
    expect(find(publication.id)?.media[0]?.s3Key).toBeNull()

    const posts = mediaPosts()
    expect(await service.retry({ id: publication.id })).toMatchObject({ ok: true, publication: { state: 'publicando' } })
    const done = await settled(publication.id)
    expect(done).toMatchObject({ state: 'publicada', attempts: 2 })
    expect(done.creationId).not.toBe(failed.creationId)
    expect(mediaPosts() - posts).toBe(1)
    expect(fake.published()).toEqual([{ mediaId: done.publishedMediaId, creationId: done.creationId }])
    expect(await service.retry({ id: publication.id })).toMatchObject({ ok: false })
  })

  it('"Tentar de novo" depois de uma falha transitória no media_publish: o mesmo contêiner, sem `POST …/media` novo', async () => {
    fake.failPublishNext()
    const publication = await draft([join(files, 'foto.jpg')])
    await service.publishNow(WINDOW, { id: publication.id, clickToken: click() })
    const failed = await settled(publication.id)
    expect(failed).toMatchObject({ state: 'erro', error: 'Limite de chamadas do Instagram; tente mais tarde' })
    const posts = mediaPosts()
    await service.retry({ id: publication.id })
    const done = await settled(publication.id)
    expect(done).toMatchObject({ state: 'publicada', attempts: 2, creationId: failed.creationId })
    expect(mediaPosts()).toBe(posts)
    expect(fake.published()).toHaveLength(1)
  })

  it('salvar enquanto o agendador começa a publicar: a edição é recusada e nada da publicação é apagado', async () => {
    const publication = await draft([join(files, 'foto.jpg')], 'Original')
    await service.schedulePublication(WINDOW, { id: publication.id, at: new Date(T0 + 60_000).toISOString(), clickToken: click() })
    clock += 61_000
    const original = publication.media[0]?.localPath ?? ''
    const saving = service.savePublication({ id: publication.id, accountId: SMOKE_IG_USER_ID, caption: 'Editada', mediaPaths: [original, join(FIXTURES, 'imagem-640x800.jpg')], altTexts: {}, scheduledAt: null })
    const ticking = service.tick()
    const [saved] = await Promise.all([saving, ticking])
    expect(saved).toEqual({ ok: false, problems: ['A publicação começou a ser publicada; não dá para editar agora'] })
    const done = await settled(publication.id)
    expect(done).toMatchObject({ state: 'publicada', caption: 'Original', type: 'imagem' })
    expect(existsSync(original)).toBe(true)
    expect(readdirSync(join(dir, 'redes', 'midia', publication.id))).toEqual([basename(original)])
  })

  it('"Remover" a conta no meio da tentativa: a tentativa para antes do media_publish e não grava nada', async () => {
    const publication = await draft([join(files, 'foto.jpg')])
    let removed: Promise<{ ok: boolean }> | null = null
    onSleep = () => {
      removed ??= service.remove({ accountId: SMOKE_IG_USER_ID })
      return removed.then(() => undefined)
    }
    await service.publishNow(WINDOW, { id: publication.id, clickToken: click() })
    for (let index = 0; index < 100 && !removed; index++) await new Promise((resolve) => setTimeout(resolve, 2))
    expect(await removed).toEqual({ ok: true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fake.calls.some((call) => call.path.endsWith('/media_publish'))).toBe(false)
    expect((await service.publications({ accountId: SMOKE_IG_USER_ID })).publications).toEqual([])
    expect(existsSync(join(dir, 'redes', `instagram-${SMOKE_IG_USER_ID}.json`))).toBe(false)
    expect(existsSync(join(dir, 'redes', 'midia', publication.id))).toBe(false)
  })

  it('armazenamento: o item do carrossel parcial fica com o `s3Key`; a publicada cujo DELETE falhou é limpa pelo agendador', async () => {
    s3Faults.failPutAt = 2
    const carousel = await draft([join(files, 'foto.jpg'), join(files, 'foto.jpg')])
    await service.publishNow(WINDOW, { id: carousel.id, clickToken: click() })
    const partial = await settled(carousel.id)
    expect(partial.state).toBe('erro')
    expect(partial.media.map((item) => item.s3Key !== null)).toEqual([true, false])
    expect(s3.objects().size).toBe(1)
    clock += 48 * HOUR
    await service.tick()
    expect(s3.objects().size).toBe(0)

    s3Faults.deletes = true
    const image = await draft([join(files, 'foto.jpg')])
    await service.publishNow(WINDOW, { id: image.id, clickToken: click() })
    const published = await settled(image.id)
    expect(published.state).toBe('publicada')
    expect(published.media[0]?.s3Key).not.toBeNull()
    await service.tick()
    expect(find(image.id)?.media[0]?.s3Key).not.toBeNull()
    s3Faults.deletes = false
    await service.tick()
    expect(find(image.id)?.media[0]?.s3Key).toBeNull()
    expect(s3.objects().size).toBe(0)
  })

  it('retomada com o `publishedMediaId` gravado: não sobe nada nem exige armazenamento, só lê o permalink', async () => {
    const publication = await draft([join(files, 'foto.jpg')])
    await service.publishNow(WINDOW, { id: publication.id, clickToken: click() })
    const done = await settled(publication.id)
    await service.mediaHostClear()
    service.dispose()
    const file = join(dir, 'redes', `instagram-${SMOKE_IG_USER_ID}.json`)
    const stored = JSON.parse(readFileSync(file, 'utf8')) as { publications: Publication[] }
    stored.publications = stored.publications.map((item) => ({ ...item, state: 'publicando' as const, permalink: null }))
    writeFileSync(file, JSON.stringify(stored))
    const s3Calls = s3.calls.length
    const posts = mediaPosts()
    events = []
    service = make()
    await service.init()
    expect(await settled(publication.id)).toMatchObject({ state: 'publicada', publishedMediaId: done.publishedMediaId, permalink: done.permalink, error: null })
    expect(s3.calls.length).toBe(s3Calls)
    expect(mediaPosts()).toBe(posts)
  })

  it('logo depois de terminar (a tentativa ainda fechando): apagar a adiada e tentar de novo a com erro valem na hora', async () => {
    fake.setQuota(50, 50)
    const postponed = await draft([join(files, 'foto.jpg')])
    await service.publishNow(WINDOW, { id: postponed.id, clickToken: click() })
    expect((await settled(postponed.id)).state).toBe('agendada')
    expect(await service.deletePublication({ id: postponed.id })).toEqual({ ok: true })
    fake.setQuota(0, 50)
    fake.failNext(36003)
    const failing = await draft([join(files, 'foto.jpg')])
    await service.publishNow(WINDOW, { id: failing.id, clickToken: click() })
    expect((await settled(failing.id)).state).toBe('erro')
    expect(await service.retry({ id: failing.id })).toMatchObject({ ok: true })
    expect(await settled(failing.id)).toMatchObject({ state: 'publicada', attempts: 2 })
  })

  it('ao abrir, a publicação que ficou em `publicando` é retomada pelo primeiro tick', async () => {
    const publication = await draft([join(files, 'foto.jpg')])
    service.dispose()
    const file = join(dir, 'redes', `instagram-${SMOKE_IG_USER_ID}.json`)
    const stored = JSON.parse(readFileSync(file, 'utf8')) as { publications: Publication[] }
    stored.publications = stored.publications.map((item) => ({ ...item, state: 'publicando' as const }))
    writeFileSync(file, JSON.stringify(stored))
    events = []
    service = make()
    await service.init()
    expect(await settled(publication.id)).toMatchObject({ state: 'publicada' })
  })

  it('"Remover" a conta leva a fila e as cópias das mídias', async () => {
    const publication = await draft([join(files, 'foto.jpg')])
    expect(await service.remove({ accountId: SMOKE_IG_USER_ID })).toEqual({ ok: true })
    expect(existsSync(join(dir, 'redes', 'midia', publication.id))).toBe(false)
    expect((await service.publications({ accountId: SMOKE_IG_USER_ID })).publications).toEqual([])
  })

  it('contrato 72: a com erro pode ser editada; volta a rascunho sem o contêiner e sem a imagem no armazenamento', async () => {
    fake.failNext(36003)
    const publication = await draft([join(files, 'foto.jpg')])
    await service.publishNow(WINDOW, { id: publication.id, clickToken: click() })
    const failed = await settled(publication.id)
    expect(failed.state).toBe('erro')
    expect(s3.objects().size).toBe(1)
    const edited = await service.savePublication({ id: publication.id, accountId: SMOKE_IG_USER_ID, caption: 'Legenda nova', mediaPaths: failed.media.map((item) => item.localPath), altTexts: {}, scheduledAt: null })
    expect(edited).toMatchObject({ ok: true, publication: { state: 'rascunho', caption: 'Legenda nova', creationId: null, error: null } })
    if (!edited.ok) return
    expect(edited.publication.media.map((item) => [item.id, item.s3Key, item.containerId])).toEqual(failed.media.map((item) => [item.id, null, null]))
    expect(s3.objects().size).toBe(0)
    const posts = mediaPosts()
    await service.publishNow(WINDOW, { id: publication.id, clickToken: click() })
    expect(await settled(publication.id)).toMatchObject({ state: 'publicada' })
    expect(mediaPosts() - posts).toBe(1)
  })

  it('contrato 72: a miniatura só de uma cópia salva ou de um arquivo do diálogo, e só JPEG', async () => {
    const asked: string[] = []
    service.dispose()
    service = createRedesService({
      userData: dir,
      safeStorage,
      fetch: fake.fetch,
      onState: () => undefined,
      now: () => clock,
      testMediaHost,
      pickFiles: () => Promise.resolve([join(files, 'larga.jpg')]),
      thumbnail: (path) => {
        asked.push(basename(path))
        return Promise.resolve('data:image/jpeg;base64,AA==')
      },
    })
    await service.init()
    expect(await service.thumbnail({ path: join(files, 'foto.jpg') })).toBeNull()
    await service.pickMedia()
    expect(await service.thumbnail({ path: join(files, 'larga.jpg') })).toBe('data:image/jpeg;base64,AA==')
    const saved = await service.savePublication({ accountId: SMOKE_IG_USER_ID, caption: 'x', mediaPaths: [join(files, 'foto.jpg')], altTexts: {}, scheduledAt: null })
    if (!saved.ok) throw new Error(saved.problems.join('; '))
    const copy = saved.publication.media[0]?.localPath ?? ''
    expect(await service.thumbnail({ path: copy })).toBe('data:image/jpeg;base64,AA==')
    expect(await service.thumbnail({ path: join(copy, '..', '..', '..', '..', 'outro.jpg') })).toBeNull()
    expect(await service.thumbnail({ path: join(FIXTURES, 'video-4s.mp4') })).toBeNull()
    expect(await service.thumbnail({ path: 42 })).toBeNull()
    expect(asked).toEqual(['larga.jpg', basename(copy)])
  })

  it('contrato 72: com erro e o contêiner já publicado (a resposta se perdeu), a edição é recusada; "Tentar de novo" só marca como publicada', async () => {
    metaFaults.losePublish = true
    const publication = await draft([join(files, 'foto.jpg')])
    await service.publishNow(WINDOW, { id: publication.id, clickToken: click() })
    const failed = await settled(publication.id)
    expect(failed).toMatchObject({ state: 'erro' })
    expect(failed.creationId).not.toBeNull()
    expect(fake.published()).toHaveLength(1)
    const edited = await service.savePublication({ id: publication.id, accountId: SMOKE_IG_USER_ID, caption: 'Outra', mediaPaths: failed.media.map((item) => item.localPath), altTexts: {}, scheduledAt: null })
    expect(edited).toEqual({ ok: false, problems: [PUBLICATION_MAYBE_OUT_MESSAGE] })
    expect(find(publication.id)).toMatchObject({ state: 'erro', creationId: failed.creationId })
    // Pelo clique com a edição junto, a mesma recusa (o token já foi gasto, nada sai).
    expect(await service.publishNow(WINDOW, { id: publication.id, clickToken: click(), save: { id: publication.id, accountId: SMOKE_IG_USER_ID, caption: 'Outra', mediaPaths: failed.media.map((item) => item.localPath), altTexts: {}, scheduledAt: null } })).toEqual({ ok: false, error: PUBLICATION_MAYBE_OUT_MESSAGE, problems: [PUBLICATION_MAYBE_OUT_MESSAGE] })
    const posts = mediaPosts()
    await service.retry({ id: publication.id })
    expect(await settled(publication.id)).toMatchObject({ state: 'publicada', creationId: failed.creationId })
    expect(mediaPosts()).toBe(posts)
    expect(fake.published()).toHaveLength(1)
  })

  it('contrato 72: com erro e a consulta do contêiner falhando, a edição é recusada e nada muda', async () => {
    fake.failNext(36003)
    const publication = await draft([join(files, 'foto.jpg')])
    await service.publishNow(WINDOW, { id: publication.id, clickToken: click() })
    const failed = await settled(publication.id)
    metaFaults.statusFails = true
    const edited = await service.savePublication({ id: publication.id, accountId: SMOKE_IG_USER_ID, caption: 'Outra', mediaPaths: failed.media.map((item) => item.localPath), altTexts: {}, scheduledAt: null })
    expect(edited).toEqual({ ok: false, problems: [PUBLICATION_MAYBE_OUT_MESSAGE] })
    expect(find(publication.id)).toMatchObject({ state: 'erro', creationId: failed.creationId, caption: failed.caption })
    expect(s3.objects().size).toBe(1)
  })

  it('contrato 72: "Publicar agora" e "Agendar" com a edição junto salvam depois do token; direto na com erro, a mensagem própria', async () => {
    const input = { accountId: SMOKE_IG_USER_ID, caption: 'Nova pelo clique', mediaPaths: [join(files, 'foto.jpg')], altTexts: { [join(files, 'foto.jpg')]: 'Foto da equipe' }, scheduledAt: null }
    // Sem token, nada é salvo.
    expect(await service.publishNow(WINDOW, { clickToken: 'inventado', save: input })).toEqual({ ok: false, error: REDES_CLICK_MESSAGE })
    expect(queue()).toHaveLength(0)
    const started = await service.publishNow(WINDOW, { clickToken: click(), save: input })
    expect(started).toMatchObject({ ok: true, publication: { state: 'publicando', caption: 'Nova pelo clique' } })
    if (!started.ok) return
    expect(started.publication.media[0]?.altText).toBe('Foto da equipe')
    expect(await settled(started.publication.id)).toMatchObject({ state: 'publicada' })
    const scheduled = await service.schedulePublication(WINDOW, { at: new Date(clock + HOUR).toISOString(), clickToken: click(), save: { ...input, caption: 'Agendada pelo clique' } })
    expect(scheduled).toMatchObject({ ok: true, publication: { state: 'agendada', caption: 'Agendada pelo clique' } })
    // A com erro, sem a edição: a mensagem própria.
    fake.failNext(36003)
    const failing = await draft([join(files, 'foto.jpg')])
    await service.publishNow(WINDOW, { id: failing.id, clickToken: click() })
    await settled(failing.id)
    expect(await service.publishNow(WINDOW, { id: failing.id, clickToken: click() })).toEqual({ ok: false, error: PUBLICATION_ERROR_STATE_MESSAGE })
    expect(await service.schedulePublication(WINDOW, { id: failing.id, at: new Date(clock + HOUR).toISOString(), clickToken: click() })).toEqual({ ok: false, error: PUBLICATION_ERROR_STATE_MESSAGE })
  })
})
