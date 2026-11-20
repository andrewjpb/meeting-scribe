# Serviço HTTP com o cliente falso no lugar do neonize: token, rotas, envio, SSE, sair da conta e permissões.
import http.client
import json
import os
import socket
import subprocess
import sys
import threading
import time

import pytest

import backend_fake
import server
from backend_fake import FAKE_QR, SEED_CHATS, FakeBackend

TOKEN = 'a' * 48
ANA = SEED_CHATS[0][0]


@pytest.fixture()
def running(tmp_path):
    data = tmp_path / 'session'
    data.mkdir(mode=0o700)
    bridge = server.Bridge(str(data), FakeBackend(str(data)))
    httpd = server.ThreadingHTTPServer((server.HOST, 0), server.make_handler(bridge, TOKEN, 'id-da-instalacao'))
    httpd.daemon_threads = True
    bridge.backend.start(bridge)
    thread = threading.Thread(target=httpd.serve_forever, kwargs={'poll_interval': 0.05}, daemon=True)
    thread.start()
    yield bridge, httpd.server_address[1], data
    httpd.shutdown()
    bridge.store.close()


def call(port, method, path, body=None, token=TOKEN):
    conn = http.client.HTTPConnection(server.HOST, port, timeout=5)
    headers = {'Content-Type': 'application/json'}
    if token is not None:
        headers['Authorization'] = f'Bearer {token}'
    conn.request(method, path, body=None if body is None else json.dumps(body), headers=headers)
    response = conn.getresponse()
    payload = json.loads(response.read() or b'null')
    conn.close()
    return response.status, payload


def test_every_route_requires_the_token(running):
    _, port, _ = running
    # Sem token, `/health` só diz o id da instalação (o app confere antes de mandar o token).
    assert call(port, 'GET', '/health', token=None) == (200, {'id': 'id-da-instalacao'})
    assert call(port, 'GET', '/health', token='b' * 48) == (200, {'id': 'id-da-instalacao'})
    full = call(port, 'GET', '/health')[1]
    assert full['id'] == 'id-da-instalacao' and full['pid'] == os.getpid()
    for method, path in [('GET', '/pair'), ('GET', '/chats'), ('GET', f'/chats/{ANA}/messages'), ('GET', '/search?q=prazo'), ('GET', f'/chats/{ANA}/photo'), ('GET', f'/chats/{ANA}/messages/m1/media'), ('GET', '/events'), ('POST', '/logout'), ('POST', f'/chats/{ANA}/send')]:
        assert call(port, method, path, token=None)[0] == 401
        assert call(port, method, path, token='b' * 48)[0] == 401


def test_listens_only_on_loopback(running):
    _, port, _ = running
    assert server.HOST == '127.0.0.1'
    other = socket.gethostbyname(socket.gethostname())
    if other.startswith('127.'):
        pytest.skip('a máquina não tem outro endereço')
    with pytest.raises(OSError):
        socket.create_connection((other, port), timeout=1)


def test_pairing_then_chats_and_messages(running):
    _, port, _ = running
    status, health = call(port, 'GET', '/health')
    assert status == 200 and health['state'] == 'pairing' and health['version'] == server.VERSION
    assert call(port, 'GET', '/pair')[1] == {'state': 'pairing', 'qr': FAKE_QR, 'code': None}
    assert call(port, 'GET', '/pair?phone=5511900000000')[1]['code'] == 'SMKE-1234'
    assert call(port, 'GET', '/pair?phone=abc')[0] == 400
    call(port, 'POST', '/_fake/scan', {})
    health = call(port, 'GET', '/health')[1]
    assert health['state'] == 'connected' and health['me']['name'] == 'Andrea Teste'
    chats = call(port, 'GET', '/chats')[1]['chats']
    assert [chat['name'] for chat in chats] == ['Projeto Atlas', 'Ana Souza', 'Bruno Lima']
    atlas = chats[0]
    assert atlas['kind'] == 'group' and atlas['unread'] == 2 and atlas['lastMessage']['text'].startswith('O prazo')
    messages = call(port, 'GET', f"/chats/{atlas['id']}/messages")[1]['messages']
    # Contrato 37: a imagem do Atlas é de antes das chaves do download (só o chip).
    assert messages[0]['type'] == 'image' and messages[0]['media'] == {'kind': 'image', 'mime': 'image/jpeg', 'size': 122880, 'name': None, 'downloadable': False}
    # Abrir zera as não lidas; mais antigas com `before`.
    assert call(port, 'GET', '/chats')[1]['chats'][0]['unread'] == 0
    page = call(port, 'GET', f'/chats/{ANA}/messages?limit=2')[1]['messages']
    assert [m['id'] for m in page] == ['m2', 'm3']
    older = call(port, 'GET', f"/chats/{ANA}/messages?limit=2&before={page[0]['at']}")[1]['messages']
    # Contrato 32: antes da m1 vem o histórico da Ana, espalhado pelos últimos dias.
    assert [m['id'] for m in older] == ['h8', 'm1']
    found = call(port, 'GET', '/search?q=prazo')[1]['messages']
    assert len(found) == 1 and found[0]['chatName'] == 'Projeto Atlas'
    assert call(port, 'GET', '/search?q=a')[0] == 400
    assert call(port, 'GET', '/chats/nada/messages')[0] == 400


def test_cursor_keeps_messages_in_the_same_millisecond(running):
    bridge, port, _ = running
    for index in range(7):
        bridge.on_message({'id': f'x{index}', 'chatId': ANA, 'author': 'Ana', 'fromMe': False, 'at': 5000, 'type': 'text', 'text': str(index), 'media': None})
    seen = []
    page = call(port, 'GET', f'/chats/{ANA}/messages?limit=3')[1]['messages']
    while page:
        seen = [m['id'] for m in page] + seen
        oldest = page[0]
        page = call(port, 'GET', f"/chats/{ANA}/messages?limit=3&before={oldest['at']}&beforeId={oldest['id']}")[1]['messages']
    assert seen == [f'x{index}' for index in range(7)]
    assert call(port, 'GET', f'/chats/{ANA}/messages?beforeId=x1')[0] == 400


def test_send_validates_and_records(running):
    bridge, port, _ = running
    assert call(port, 'POST', f'/chats/{ANA}/send', {'text': 'oi'})[0] == 409
    call(port, 'POST', '/_fake/scan', {})
    assert call(port, 'POST', f'/chats/{ANA}/send', {'text': '   '})[0] == 400
    assert call(port, 'POST', f'/chats/{ANA}/send', {'text': 'x' * 4097})[0] == 400
    assert call(port, 'POST', '/chats/sem-arroba/send', {'text': 'oi'})[0] == 400
    status, body = call(port, 'POST', f'/chats/{ANA}/send', {'text': 'Confirmado para sexta.'})
    assert status == 200 and body['id'] == 'enviada-1'
    assert bridge.backend.sent == [{'id': 'enviada-1', 'chatId': ANA, 'text': 'Confirmado para sexta.'}]
    last = call(port, 'GET', f'/chats/{ANA}/messages')[1]['messages'][-1]
    assert last['fromMe'] and last['text'] == 'Confirmado para sexta.'
    # O envio não conta como não lida.
    assert next(c for c in call(port, 'GET', '/chats')[1]['chats'] if c['id'] == ANA)['unread'] == 0


def test_events_stream_new_messages(running):
    _, port, _ = running
    call(port, 'POST', '/_fake/scan', {})
    conn = http.client.HTTPConnection(server.HOST, port, timeout=5)
    conn.request('GET', '/events', headers={'Authorization': f'Bearer {TOKEN}'})
    response = conn.getresponse()
    assert response.status == 200 and response.getheader('Content-Type').startswith('text/event-stream')
    first = response.fp.readline()
    assert first == b'event: state\n'
    response.fp.readline()
    response.fp.readline()
    threading.Timer(0.1, lambda: call(port, 'POST', '/_fake/incoming', {'chatId': ANA, 'text': 'Chegou agora'})).start()
    assert response.fp.readline() == b'event: message\n'
    data = json.loads(response.fp.readline().decode()[len('data: '):])
    assert data['text'] == 'Chegou agora' and data['chatName'] == 'Ana Souza'
    conn.close()


def test_logout_erases_session_and_messages(running):
    bridge, port, data = running
    call(port, 'POST', '/_fake/scan', {})
    assert (data / 'fake-paired').exists()
    status, health = call(port, 'POST', '/logout', {})
    assert status == 200 and health['state'] == 'disconnected' and health['me'] is None
    assert not (data / 'fake-paired').exists()
    assert call(port, 'GET', '/chats')[1]['chats'] == []


def test_token_file_must_be_private(tmp_path):
    token = tmp_path / 'token'
    token.write_text(TOKEN)
    os.chmod(token, 0o644)
    with pytest.raises(SystemExit):
        server.read_token(str(token))
    os.chmod(token, 0o600)
    assert server.read_token(str(token)) == TOKEN
    token.write_text('curto')
    with pytest.raises(SystemExit):
        server.read_token(str(token))


def test_process_prints_ready_logs_no_message_text_and_dies_with_stdin(tmp_path):
    token = tmp_path / 'token'
    token.write_text(TOKEN)
    os.chmod(token, 0o600)
    data = tmp_path / 'session'
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    process = subprocess.Popen(
        [sys.executable, '-I', os.path.join(root, 'server.py'), '--data-dir', str(data), '--token-file', str(token), '--backend', 'fake', '--instance-id', 'abc'],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=str(tmp_path),
        env={'PATH': os.environ.get('PATH', ''), 'PYTHONPATH': root},
    )
    try:
        ready = json.loads(process.stdout.readline())
        assert ready['event'] == 'ready' and ready['port'] > 0 and ready['version'] == server.VERSION
        port = ready['port']
        call(port, 'POST', '/_fake/scan', {})
        assert call(port, 'POST', f'/chats/{ANA}/send', {'text': 'segredo-do-texto'})[0] == 200
        assert call(port, 'GET', '/health', token=None)[1] == {'id': 'abc'}
        assert call(port, 'GET', '/health')[1]['pid'] == process.pid
        # `umask(0o077)`: a sessão e o banco, com o -wal e o -shm, só para o dono.
        files = {name: oct(os.stat(data / name).st_mode & 0o777) for name in os.listdir(data)}
        for name in ('session.sqlite3', 'session.sqlite3-wal', 'session.sqlite3-shm', 'messages.db', 'messages.db-wal', 'messages.db-shm'):
            assert files.get(name) == '0o600', (name, files)
        # O app morreu: o stdin fecha e o serviço sai sozinho.
        process.stdin.close()
        assert process.wait(5) == 0
    finally:
        if process.poll() is None:
            process.kill()
    rest = process.stdout.read().decode() + process.stderr.read().decode()
    assert 'segredo-do-texto' not in rest
    assert '127.0.0.1' in rest
    assert oct(os.stat(data).st_mode & 0o777) == '0o700'


def test_store_batch_and_late_names(tmp_path):
    from bridge_store import Store

    store = Store(str(tmp_path / 'm.db'))
    batch = [{'id': f'X{i}', 'chatId': '5511944440000@s.whatsapp.net', 'chatName': None, 'chatKind': 'person', 'author': 'Bia', 'fromMe': False, 'at': 1000 + i, 'type': 'text', 'text': 'oi', 'media': None} for i in range(50)]
    assert store.add_messages(batch) == 50 and store.add_messages(batch) == 0
    assert store.chat('5511944440000@s.whatsapp.net')['unread'] == 0
    assert store.unnamed_chats() == [('5511944440000@s.whatsapp.net', 'person')]
    assert store.set_names({'5511944440000@s.whatsapp.net': 'Bia'}) == 1
    assert store.unnamed_chats() == [] and store.chat('5511944440000@s.whatsapp.net')['name'] == 'Bia'
    store.close()


def test_photo_route_with_the_fake_backend(running):
    """Contrato 32: Ana e Atlas com foto (PNG pequeno, sempre o mesmo), Bruno sem; id inválido é 400."""
    _, port, _ = running
    call(port, 'POST', '/_fake/scan', {})
    status, body = call(port, 'GET', f'/chats/{ANA}/photo')
    assert status == 200 and body['photo'].startswith('data:image/png;base64,')
    assert call(port, 'GET', f'/chats/{ANA}/photo')[1] == body
    atlas = call(port, 'GET', f'/chats/{SEED_CHATS[1][0]}/photo')[1]['photo']
    assert atlas.startswith('data:image/png;base64,') and atlas != body['photo']
    assert call(port, 'GET', f'/chats/{SEED_CHATS[2][0]}/photo') == (200, {'photo': None})
    assert call(port, 'GET', '/chats/sem-arroba/photo')[0] == 400


def test_photo_route_drops_what_is_not_an_image_or_too_big(running):
    bridge, port, _ = running
    bridge.backend.photo = lambda chat_id: 'javascript:alert(1)'
    assert call(port, 'GET', f'/chats/{ANA}/photo')[1] == {'photo': None}
    bridge.backend.photo = lambda chat_id: 'data:image/png;base64,' + 'A' * server.PHOTO_URL_MAX
    assert call(port, 'GET', f'/chats/{ANA}/photo')[1] == {'photo': None}

    def broken(chat_id):
        raise RuntimeError('sem rede')

    bridge.backend.photo = broken
    assert call(port, 'GET', f'/chats/{ANA}/photo') == (200, {'photo': None})


def raw(port, path, token=TOKEN):
    """Pedido que pode voltar em bytes (a mídia): `(status, Content-Type, Content-Length, corpo)`."""
    conn = http.client.HTTPConnection(server.HOST, port, timeout=5)
    conn.request('GET', path, headers={'Authorization': f'Bearer {token}'})
    response = conn.getresponse()
    body = response.read()
    conn.close()
    return response.status, response.getheader('Content-Type'), response.getheader('Content-Length'), body


BRUNO = SEED_CHATS[2][0]
ATLAS = SEED_CHATS[1][0]


def test_media_is_listed_as_downloadable_only_with_the_keys(running):
    """Contrato 37: o áudio e a imagem do Bruno baixam (o áudio com a duração); a imagem do Atlas, de antes, não."""
    _, port, _ = running
    call(port, 'POST', '/_fake/scan', {})
    bruno = {m['id']: m for m in call(port, 'GET', f'/chats/{BRUNO}/messages')[1]['messages']}
    assert bruno['m7']['media'] == {'kind': 'audio', 'mime': 'audio/wav', 'size': len(backend_fake.FAKE_MEDIA['audio']), 'name': None, 'downloadable': True, 'seconds': 2}
    assert bruno['m8']['media']['downloadable'] is True and bruno['m6']['media'] is None
    assert 'mediaProto' not in bruno['m7']
    # As do Bruno são histórico: não contam como não lidas, e a última da conversa continua o texto.
    chat = next(c for c in call(port, 'GET', '/chats')[1]['chats'] if c['id'] == BRUNO)
    assert chat['unread'] == 0 and chat['lastMessage']['id'] == 'm6'
    found = call(port, 'GET', '/search?q=quadro')[1]['messages']
    assert {m['id']: m['media']['downloadable'] for m in found} == {'m4': False, 'm8': True}


def test_media_route_serves_bytes_and_caches_them(running):
    bridge, port, data = running
    call(port, 'POST', '/_fake/scan', {})
    status, mime, length, body = raw(port, f'/chats/{BRUNO}/messages/m8/media')
    assert status == 200 and mime == 'image/png' and int(length) == len(body) and body == backend_fake.FAKE_MEDIA['image']
    status, mime, _, body = raw(port, f'/chats/{BRUNO}/messages/m7/media')
    assert status == 200 and mime == 'audio/wav' and body[:4] == b'RIFF' and body[8:12] == b'WAVE'
    # No disco, em `media/`, só para o dono.
    files = list((data / 'media').iterdir())
    assert len(files) == 2 and all(oct(f.stat().st_mode & 0o777) == '0o600' for f in files)
    assert oct((data / 'media').stat().st_mode & 0o777) == '0o700'
    # A segunda vez vem do disco, sem pedir ao WhatsApp.
    def broken(kind, proto):
        raise RuntimeError('sem rede')

    bridge.backend.download_media = broken
    assert raw(port, f'/chats/{BRUNO}/messages/m8/media')[3] == backend_fake.FAKE_MEDIA['image']
    # Passados os 7 dias, pede de novo (e a falha vira 502).
    for item in files:
        os.utime(item, (time.time() - 8 * 24 * 3600, time.time() - 8 * 24 * 3600))
    status, mime, _, body = raw(port, f'/chats/{BRUNO}/messages/m8/media')
    assert status == 502 and json.loads(body) == {'error': 'failed'}
    # Sair da conta leva a mídia junto.
    call(port, 'POST', '/logout', {})
    assert not (data / 'media').exists()


def test_media_route_without_keys_too_big_and_gone(running, monkeypatch):
    _, port, _ = running
    call(port, 'POST', '/_fake/scan', {})
    # Mensagem de antes (sem as chaves), texto e mensagem que não existe: 404; id inválido: 400.
    assert raw(port, f'/chats/{ATLAS}/messages/m4/media')[0] == 404
    assert raw(port, f'/chats/{ANA}/messages/m1/media')[0] == 404
    assert raw(port, f'/chats/{ANA}/messages/nada/media')[0] == 404
    assert raw(port, f'/chats/{ANA}/messages/m%3Cb%3E/media')[0] == 400
    assert raw(port, '/chats/sem-arroba/messages/m1/media')[0] == 400
    # O WhatsApp não tem mais o arquivo: 410.
    gone = call(port, 'POST', '/_fake/incoming', {'chatId': ANA, 'type': 'audio', 'gone': True})[1]['id']
    status, _, _, body = raw(port, f'/chats/{ANA}/messages/{gone}/media')
    assert status == 410 and json.loads(body) == {'error': 'gone'}
    # Documento e figurinha nunca baixam; `downloadable: false` também não.
    document = call(port, 'POST', '/_fake/incoming', {'chatId': ANA, 'type': 'document', 'media': {'name': 'a.pdf'}})[1]['id']
    assert raw(port, f'/chats/{ANA}/messages/{document}/media')[0] == 404
    # Acima do limite: pelo tamanho que a mensagem diz (sem baixar) e pelo que veio.
    monkeypatch.setattr(server, 'MEDIA_MAX', 200)
    assert raw(port, f'/chats/{BRUNO}/messages/m8/media')[0] == 200
    status, _, _, body = raw(port, f'/chats/{BRUNO}/messages/m7/media')
    assert status == 413 and json.loads(body) == {'error': 'too-big'}
    monkeypatch.setattr(server, 'MEDIA_MAX', 50)
    unsized = call(port, 'POST', '/_fake/incoming', {'chatId': ANA, 'type': 'video'})[1]['id']
    assert raw(port, f'/chats/{ANA}/messages/{unsized}/media')[0] == 413


def test_new_media_message_event_says_downloadable_without_the_keys(running):
    _, port, _ = running
    call(port, 'POST', '/_fake/scan', {})
    conn = http.client.HTTPConnection(server.HOST, port, timeout=5)
    conn.request('GET', '/events', headers={'Authorization': f'Bearer {TOKEN}'})
    response = conn.getresponse()
    for _ in range(3):
        response.fp.readline()
    threading.Timer(0.1, lambda: call(port, 'POST', '/_fake/incoming', {'chatId': ANA, 'type': 'image', 'text': 'foto'})).start()
    assert response.fp.readline() == b'event: message\n'
    data = json.loads(response.fp.readline().decode()[len('data: '):])
    assert data['media']['downloadable'] is True and 'mediaProto' not in data
    conn.close()


def test_old_database_loads_and_keeps_its_messages_without_download(tmp_path):
    """Contrato 37: o banco de antes (sem `media_proto`) abre, ganha as colunas e as mensagens antigas não baixam."""
    import sqlite3

    from bridge_store import Store

    path = tmp_path / 'messages.db'
    old = sqlite3.connect(path)
    old.executescript(
        '''
        CREATE TABLE chats (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'person', unread INTEGER NOT NULL DEFAULT 0, last_at INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE messages (id TEXT NOT NULL, chat_id TEXT NOT NULL, author TEXT NOT NULL DEFAULT '', from_me INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'text', text TEXT NOT NULL DEFAULT '', media_mime TEXT, media_size INTEGER, media_name TEXT, PRIMARY KEY (chat_id, id));
        INSERT INTO chats (id, name, last_at) VALUES ('5511944440000@s.whatsapp.net', 'Bia', 10);
        INSERT INTO messages (id, chat_id, author, at, kind, text, media_mime, media_size) VALUES ('A1', '5511944440000@s.whatsapp.net', 'Bia', 10, 'audio', '', 'audio/ogg', 2048);
        '''
    )
    old.commit()
    old.close()
    store = Store(str(path))
    [message] = store.messages('5511944440000@s.whatsapp.net')
    assert message['media'] == {'kind': 'audio', 'mime': 'audio/ogg', 'size': 2048, 'name': None, 'downloadable': False}
    assert store.media_source('5511944440000@s.whatsapp.net', 'A1') is None
    audio = {'id': 'A2', 'chatId': '5511944440000@s.whatsapp.net', 'author': 'Bia', 'fromMe': False, 'at': 20, 'type': 'audio', 'text': '', 'media': {'kind': 'audio', 'mime': 'audio/ogg', 'size': 10, 'name': None, 'seconds': 7}, 'mediaProto': b'chaves'}
    # A mensagem serializada só fica para imagem, vídeo e áudio, e até 256 KB.
    sticker = dict(audio, id='A3', type='sticker', media={'kind': 'sticker', 'mime': 'image/webp', 'size': 10, 'name': None})
    huge = dict(audio, id='A4', mediaProto=b'x' * (256 * 1024 + 1))
    assert store.add_messages([audio, sticker, huge]) == 3
    assert store.media_source('5511944440000@s.whatsapp.net', 'A2') == ('audio', 'audio/ogg', 10, b'chaves')
    assert store.media_source('5511944440000@s.whatsapp.net', 'A3') is None and store.media_source('5511944440000@s.whatsapp.net', 'A4') is None
    listed = {m['id']: m['media'] for m in store.messages('5511944440000@s.whatsapp.net')}
    assert listed['A2']['downloadable'] is True and listed['A2']['seconds'] == 7 and listed['A4']['downloadable'] is False
    store.close()
    # Abrir de novo (já com as colunas) não muda nada.
    again = Store(str(path))
    assert len(again.messages('5511944440000@s.whatsapp.net')) == 4
    again.close()


def test_fake_history_is_spread_over_days_and_not_unread(running):
    _, port, _ = running
    call(port, 'POST', '/_fake/scan', {})
    ana = next(c for c in call(port, 'GET', '/chats')[1]['chats'] if c['id'] == ANA)
    assert ana['unread'] == 2
    messages = call(port, 'GET', f'/chats/{ANA}/messages')[1]['messages']
    # Dias atrás em relação à mais nova, arredondados: o histórico fica a ±3 h do horário de cada dia, então contar
    # pelo dia em UTC juntava dois dias perto da meia-noite UTC (~21 h em São Paulo) e o teste falhava conforme a hora.
    newest = max(m['at'] for m in messages)
    days = {round((newest - m['at']) / 86_400_000) for m in messages}
    assert len(messages) == 11 and len(days) >= 6


def test_stored_mime_with_a_newline_never_reaches_the_header(running):
    """Contrato 37: o mime vem do contato e vai para o cabeçalho; com `\\n` no fim (o `$` aceitaria), vale o padrão."""
    bridge, port, _ = running
    call(port, 'POST', '/_fake/scan', {})
    assert server.MEDIA_MIME.fullmatch('audio/ogg\n') is None and server.MEDIA_MIME.fullmatch('audio/ogg; codecs=opus')
    sent = call(port, 'POST', '/_fake/incoming', {'chatId': ANA, 'type': 'image', 'media': {'mime': 'image/png\nX-Injetado: 1'}})[1]['id']
    status, mime, _, _ = raw(port, f'/chats/{ANA}/messages/{sent}/media')
    assert status == 200 and mime == 'image/jpeg'
    newline = call(port, 'POST', '/_fake/incoming', {'chatId': ANA, 'type': 'audio', 'media': {'mime': 'audio/wav\n'}})[1]['id']
    assert raw(port, f'/chats/{ANA}/messages/{newline}/media')[1] == 'audio/ogg'


def test_download_finishing_after_logout_saves_nothing(running):
    """Contrato 37: o "Sair da conta" no meio de um download: os bytes da conta que saiu não voltam ao disco."""
    bridge, port, data = running
    call(port, 'POST', '/_fake/scan', {})
    started = threading.Event()
    release = threading.Event()
    original = bridge.backend.download_media

    def slow(kind, proto):
        started.set()
        release.wait(5)
        return original(kind, proto)

    bridge.backend.download_media = slow
    result = {}
    worker = threading.Thread(target=lambda: result.setdefault('media', bridge.media(BRUNO, 'm8')))
    worker.start()
    assert started.wait(5)
    bridge.logout()
    release.set()
    worker.join(5)
    assert result['media'][0] == 'ok'
    assert not (data / 'media').exists()


def test_expired_media_takes_its_lock_along(running):
    bridge, port, data = running
    call(port, 'POST', '/_fake/scan', {})
    assert raw(port, f'/chats/{BRUNO}/messages/m7/media')[0] == 200
    [old] = list((data / 'media').iterdir())
    assert str(old) in bridge.media_locks
    os.utime(old, (time.time() - 8 * 24 * 3600, time.time() - 8 * 24 * 3600))
    assert raw(port, f'/chats/{BRUNO}/messages/m8/media')[0] == 200
    assert not old.exists() and str(old) not in bridge.media_locks
    assert len(bridge.media_locks) == 1


def send_media(port, chat_id, data, mime, name='foto.png', caption='', token=TOKEN, length=None):
    """Contrato 39: o POST binário do anexo. `(status, corpo JSON)`."""
    from urllib.parse import quote

    conn = http.client.HTTPConnection(server.HOST, port, timeout=5)
    headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/octet-stream', 'X-Media-Mime': mime, 'X-Media-Name': quote(name)}
    if caption:
        headers['X-Caption'] = quote(caption)
    if length is not None:
        headers['Content-Length'] = str(length)
        conn.putrequest('POST', f'/chats/{quote(chat_id)}/send-media')
        for key, value in headers.items():
            conn.putheader(key, value)
        conn.endheaders()
    else:
        conn.request('POST', f'/chats/{quote(chat_id)}/send-media', body=data, headers=headers)
    response = conn.getresponse()
    payload = json.loads(response.read() or b'null')
    conn.close()
    return response.status, payload


PNG = backend_fake.FAKE_MEDIA['image']
MP4 = backend_fake.FAKE_MEDIA['video']


def test_send_media_image_records_and_echoes_a_downloadable_message(running):
    bridge, port, _ = running
    assert send_media(port, ANA, PNG, 'image/png')[0] == 409
    assert send_media(port, ANA, PNG, 'image/png', token='b' * 48)[0] == 401
    call(port, 'POST', '/_fake/scan', {})
    conn = http.client.HTTPConnection(server.HOST, port, timeout=5)
    conn.request('GET', '/events', headers={'Authorization': f'Bearer {TOKEN}'})
    events = conn.getresponse()
    for _ in range(3):
        events.fp.readline()
    status, body = send_media(port, ANA, PNG, 'image/png', name='pasta/foto ação.png', caption='olha isso 👀')
    assert status == 200 and body == {'id': 'enviada-1'}
    assert bridge.backend.sent == [{'id': 'enviada-1', 'chatId': ANA, 'type': 'image', 'mime': 'image/png', 'name': 'foto ação.png', 'size': len(PNG), 'caption': 'olha isso 👀'}]
    # O eco pelo SSE: mídia sua, baixável, com a legenda como texto.
    assert events.fp.readline() == b'event: message\n'
    echo = json.loads(events.fp.readline().decode()[len('data: '):])
    conn.close()
    assert echo['fromMe'] and echo['type'] == 'image' and echo['text'] == 'olha isso 👀'
    assert echo['media'] == {'kind': 'image', 'mime': 'image/png', 'size': len(PNG), 'name': 'foto ação.png', 'downloadable': True}
    assert 'mediaProto' not in echo
    status, mime, _, data = raw(port, f'/chats/{ANA}/messages/enviada-1/media')
    assert status == 200 and mime == 'image/png' and data == PNG
    # Não conta como não lida (as 2 da Ana continuam as do celular).
    assert next(c for c in call(port, 'GET', '/chats')[1]['chats'] if c['id'] == ANA)['unread'] == 2


def test_send_media_video_without_caption(running):
    bridge, port, _ = running
    call(port, 'POST', '/_fake/scan', {})
    status, body = send_media(port, ANA, MP4, 'video/mp4', name='video.mp4')
    assert status == 200
    assert bridge.backend.sent[-1] == {'id': body['id'], 'chatId': ANA, 'type': 'video', 'mime': 'video/mp4', 'name': 'video.mp4', 'size': len(MP4), 'caption': ''}
    last = call(port, 'GET', f'/chats/{ANA}/messages')[1]['messages'][-1]
    assert last['id'] == body['id'] and last['type'] == 'video' and last['media']['downloadable'] is True and last['text'] == ''
    # QuickTime também passa.
    mov = b'\x00\x00\x00\x14ftypqt  \x00\x00\x00\x00qt  ' + b'\x00' * 32
    assert send_media(port, ANA, mov, 'video/quicktime', name='v.mov')[0] == 200


def test_send_media_refuses_a_lying_mime_and_bad_requests(running):
    bridge, port, _ = running
    call(port, 'POST', '/_fake/scan', {})
    jpeg = b'\xff\xd8\xff\xe0' + b'\x00' * 64
    # Bytes de PNG declarados como JPEG ou vídeo; texto declarado como imagem; HEIF (ftyp heic) como MP4; tipo fora da lista.
    assert send_media(port, ANA, PNG, 'image/jpeg') == (400, {'error': 'invalid'})
    assert send_media(port, ANA, PNG, 'video/mp4')[0] == 400
    assert send_media(port, ANA, b'ola, nao sou imagem' * 4, 'image/png')[0] == 400
    assert send_media(port, ANA, b'\x00\x00\x00\x18ftypheic' + b'\x00' * 32, 'video/mp4')[0] == 400
    # SVG disfarçado de QuickTime antigo ("free" nos bytes 4 a 8) e o QuickTime sem `ftyp`: recusados.
    assert send_media(port, ANA, b'<!--free--><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>', 'video/quicktime') == (400, {'error': 'invalid'})
    assert send_media(port, ANA, b'\x00\x00\x00\x08wide' + b'\x00' * 32, 'video/quicktime')[0] == 400
    assert server.sniff_media(b'<!--skip--><html></html>') is None
    assert send_media(port, ANA, jpeg, 'image/svg+xml')[0] == 400
    assert send_media(port, ANA, jpeg, 'application/pdf')[0] == 400
    assert send_media(port, 'sem-arroba', jpeg, 'image/jpeg')[0] == 400
    assert send_media(port, ANA, b'', 'image/jpeg')[0] == 400
    assert send_media(port, ANA, jpeg, 'image/jpeg', caption='x' * 4097)[0] == 400
    assert bridge.backend.sent == []
    # A falha do cliente vira 502, sem eco.
    def broken(*_args):
        raise RuntimeError('upload falhou')

    bridge.backend.send_media = broken
    assert send_media(port, ANA, jpeg, 'image/jpeg') == (502, {'error': 'failed'})
    # Sem o ffmpeg, o vídeo volta com o erro dele (o app explica como instalar).
    def no_ffmpeg(*_args):
        raise server.MissingFfmpeg()

    bridge.backend.send_media = no_ffmpeg
    assert send_media(port, ANA, MP4, 'video/mp4') == (503, {'error': 'ffmpeg'})
    assert all(m['type'] == 'text' for m in call(port, 'GET', f'/chats/{ANA}/messages')[1]['messages'])


def test_send_media_oversize_is_413(running, monkeypatch):
    bridge, port, _ = running
    call(port, 'POST', '/_fake/scan', {})
    monkeypatch.setattr(server, 'SEND_IMAGE_MAX', len(PNG) - 1)
    assert send_media(port, ANA, PNG, 'image/png') == (413, {'error': 'too-big'})
    # O vídeo tem o limite dele.
    assert send_media(port, ANA, MP4, 'video/mp4')[0] == 200
    monkeypatch.setattr(server, 'SEND_VIDEO_MAX', len(MP4) - 1)
    assert send_media(port, ANA, MP4, 'video/mp4') == (413, {'error': 'too-big'})
    # Imagem declarada acima de 16 MB: recusa sem ler o corpo (o limite do tipo decide antes do teto de 64 MB).
    monkeypatch.setattr(server, 'SEND_VIDEO_MAX', 64 * 1024 * 1024)
    monkeypatch.setattr(server, 'SEND_IMAGE_MAX', 16 * 1024 * 1024)
    assert send_media(port, ANA, None, 'image/png', length=16 * 1024 * 1024 + 1) == (413, {'error': 'too-big'})
    # Acima de 64 MB declarados: recusa sem ler o corpo.
    monkeypatch.setattr(server, 'SEND_VIDEO_MAX', 64 * 1024 * 1024)
    assert send_media(port, ANA, None, 'video/mp4', length=64 * 1024 * 1024 + 1) == (413, {'error': 'too-big'})
    assert [item['type'] for item in bridge.backend.sent] == ['video']


# Contrato 34: responder citando, reações e "digitando…".
ATLAS = SEED_CHATS[1][0]
THUMBS = '\U0001f44d'
HEART = '❤️'


def events_reader(port):
    """`/events` aberto, já depois do primeiro `state`; devolve `(conn, próximo evento)`."""
    conn = http.client.HTTPConnection(server.HOST, port, timeout=5)
    conn.request('GET', '/events', headers={'Authorization': f'Bearer {TOKEN}'})
    response = conn.getresponse()
    for _ in range(3):
        response.fp.readline()

    def next_event(skip=('message', 'chats')):
        while True:
            event = response.fp.readline().decode().strip()[len('event: '):]
            data = json.loads(response.fp.readline().decode()[len('data: '):])
            response.fp.readline()
            if event not in skip:
                return event, data

    return conn, next_event


def test_old_database_gains_the_reply_columns_and_the_reactions_table(tmp_path):
    import sqlite3

    from bridge_store import Store

    path = tmp_path / 'velho.db'
    old = sqlite3.connect(path)
    old.executescript(
        '''
        CREATE TABLE chats (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'person', unread INTEGER NOT NULL DEFAULT 0, last_at INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE messages (id TEXT NOT NULL, chat_id TEXT NOT NULL, author TEXT NOT NULL DEFAULT '', from_me INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'text', text TEXT NOT NULL DEFAULT '', media_mime TEXT, media_size INTEGER, media_name TEXT, PRIMARY KEY (chat_id, id));
        INSERT INTO messages (id, chat_id, at, text) VALUES ('antiga', '5511944440000@s.whatsapp.net', 1000, 'de antes');
        '''
    )
    old.commit()
    old.close()
    store = Store(str(path))
    columns = {row[1] for row in store.db.execute('PRAGMA table_info(messages)').fetchall()}
    assert {'reply_to_id', 'reply_preview', 'sender', 'media_proto', 'media_seconds'} <= columns
    assert store.db.execute("SELECT name FROM sqlite_master WHERE name = 'reactions'").fetchone()
    # A mensagem de antes continua, sem citação e sem reações.
    assert store.messages('5511944440000@s.whatsapp.net') == [
        {'id': 'antiga', 'chatId': '5511944440000@s.whatsapp.net', 'author': '', 'fromMe': False, 'at': 1000, 'type': 'text', 'text': 'de antes', 'media': None}
    ]
    store.close()


def test_incoming_reply_keeps_the_quote_and_the_preview(running):
    _, port, _ = running
    call(port, 'POST', '/_fake/scan', {})
    conn, next_event = events_reader(port)
    threading.Timer(0.1, lambda: call(port, 'POST', '/_fake/incoming', {'chatId': ANA, 'text': 'Sobre isso: sim!', 'replyToId': 'm1'})).start()
    event, data = next_event(skip=('chats',))
    assert event == 'message' and data['replyToId'] == 'm1' and data['replyPreview'] == 'Oi! Conseguimos marcar a reunião de sexta?'
    assert 'sender' not in data
    conn.close()
    last = call(port, 'GET', f'/chats/{ANA}/messages')[1]['messages'][-1]
    assert last['replyToId'] == 'm1' and last['replyPreview'].startswith('Oi! Conseguimos')
    # Sem citação, a mensagem não leva os campos.
    assert 'replyToId' not in call(port, 'GET', f'/chats/{ANA}/messages')[1]['messages'][0]


def test_reply_preview_is_one_line_up_to_120_or_the_media_label(tmp_path):
    from bridge_store import Store, reply_preview_of

    assert reply_preview_of('text', 'linha um\n\nlinha   dois') == 'linha um linha dois'
    assert reply_preview_of('image', '') == 'Imagem' and reply_preview_of('audio', None) == 'Áudio'
    assert reply_preview_of('image', 'com legenda') == 'com legenda'
    assert len(reply_preview_of('text', 'x' * 500)) == 120
    store = Store(str(tmp_path / 'm.db'))
    chat = '5511944440000@s.whatsapp.net'
    store.add_message({'id': 'A1', 'chatId': chat, 'author': 'Bia', 'fromMe': False, 'at': 1, 'type': 'audio', 'text': '', 'media': {'kind': 'audio', 'mime': 'audio/ogg', 'size': 10, 'name': None}})
    store.add_message({'id': 'A2', 'chatId': chat, 'author': 'Bia', 'fromMe': False, 'at': 2, 'type': 'text', 'text': 'ouviu?', 'media': None, 'replyToId': 'A1'})
    store.add_message({'id': 'A3', 'chatId': chat, 'author': 'Bia', 'fromMe': False, 'at': 3, 'type': 'text', 'text': 'e isto', 'media': None, 'replyToId': 'SUMIU'})
    listed = {m['id']: m for m in store.messages(chat)}
    assert listed['A2']['replyPreview'] == 'Áudio'
    # A citada que não está guardada: o id fica, o trecho vazio.
    assert listed['A3']['replyToId'] == 'SUMIU' and listed['A3']['replyPreview'] == ''
    store.close()


def test_send_reply_quotes_the_stored_message_and_falls_back_without_it(running):
    bridge, port, _ = running
    call(port, 'POST', '/_fake/scan', {})
    status, body = call(port, 'POST', f'/chats/{ANA}/send', {'text': 'Conseguimos sim.', 'replyToId': 'm1'})
    assert status == 200
    assert bridge.backend.sent[-1] == {'id': body['id'], 'chatId': ANA, 'text': 'Conseguimos sim.', 'replyToId': 'm1'}
    echo = call(port, 'GET', f'/chats/{ANA}/messages')[1]['messages'][-1]
    assert echo['fromMe'] and echo['replyToId'] == 'm1' and echo['replyPreview'].startswith('Oi! Conseguimos')
    # Id que não está guardado: sai sem citação (e o eco também).
    status, body = call(port, 'POST', f'/chats/{ANA}/send', {'text': 'Sem citação.', 'replyToId': 'NAOEXISTE'})
    assert status == 200 and bridge.backend.sent[-1] == {'id': body['id'], 'chatId': ANA, 'text': 'Sem citação.'}
    assert 'replyToId' not in call(port, 'GET', f'/chats/{ANA}/messages')[1]['messages'][-1]
    # Num grupo, a citada sem quem mandou (de antes desta versão) também sai sem citação; com, cita.
    bridge.on_message({'id': 'velha', 'chatId': ATLAS, 'author': 'Carla', 'fromMe': False, 'at': 10, 'type': 'text', 'text': 'antiga', 'media': None})
    call(port, 'POST', f'/chats/{ATLAS}/send', {'text': 'ok', 'replyToId': 'velha'})
    assert 'replyToId' not in bridge.backend.sent[-1]
    call(port, 'POST', f'/chats/{ATLAS}/send', {'text': 'ok', 'replyToId': 'm5'})
    assert bridge.backend.sent[-1]['replyToId'] == 'm5'
    # Id malformado é pedido inválido.
    assert call(port, 'POST', f'/chats/{ANA}/send', {'text': 'oi', 'replyToId': 'a b'})[0] == 400
    assert call(port, 'POST', f'/chats/{ANA}/send', {'text': 'oi', 'replyToId': 5})[0] == 400


def test_reactions_upsert_remove_and_aggregate(tmp_path):
    from bridge_store import REACTION_ME, Store, clean_emoji

    store = Store(str(tmp_path / 'm.db'))
    chat = '120363000000000009@g.us'
    store.add_message({'id': 'R1', 'chatId': chat, 'author': 'Bia', 'fromMe': False, 'at': 1, 'type': 'text', 'text': 'oi', 'media': None})
    assert store.set_reaction(chat, 'R1', 'a@s.whatsapp.net', THUMBS, 100) == [{'emoji': THUMBS, 'count': 1, 'mine': False}]
    store.set_reaction(chat, 'R1', 'b@s.whatsapp.net', THUMBS, 101)
    store.set_reaction(chat, 'R1', REACTION_ME, HEART, 102)
    assert store.messages(chat)[0]['reactions'] == [{'emoji': THUMBS, 'count': 2, 'mine': False}, {'emoji': HEART, 'count': 1, 'mine': True}]
    # A mesma pessoa troca o emoji (uma reação por pessoa); a mais velha que chega depois não vale.
    store.set_reaction(chat, 'R1', 'a@s.whatsapp.net', HEART, 103)
    store.set_reaction(chat, 'R1', 'a@s.whatsapp.net', THUMBS, 50)
    assert store.messages(chat)[0]['reactions'] == [{'emoji': HEART, 'count': 2, 'mine': True}, {'emoji': THUMBS, 'count': 1, 'mine': False}]
    # Emoji vazio tira a reação.
    store.set_reaction(chat, 'R1', REACTION_ME, '', 104)
    store.set_reaction(chat, 'R1', 'a@s.whatsapp.net', '', 105)
    assert store.messages(chat)[0]['reactions'] == [{'emoji': THUMBS, 'count': 1, 'mine': False}]
    store.set_reaction(chat, 'R1', 'b@s.whatsapp.net', '', 106)
    assert 'reactions' not in store.messages(chat)[0]
    # O que chega é só texto: sem caractere de controle, curto.
    assert clean_emoji('\U0001f44d\n\x1b[31m') == '\U0001f44d[31m'[:16] and len(clean_emoji('x' * 99)) == 16 and clean_emoji(None) == ''
    assert store.set_reactions([(chat, 'R1', 'c@s.whatsapp.net', THUMBS, 200), (chat, 'R1', 'd@s.whatsapp.net', THUMBS, 201)]) == 2
    assert store.messages(chat)[0]['reactions'] == [{'emoji': THUMBS, 'count': 2, 'mine': False}]
    store.close()


def test_incoming_reaction_goes_to_events_not_as_a_message(running):
    _, port, _ = running
    call(port, 'POST', '/_fake/scan', {})
    before = len(call(port, 'GET', f'/chats/{ANA}/messages')[1]['messages'])
    conn, next_event = events_reader(port)
    threading.Timer(0.1, lambda: call(port, 'POST', '/_fake/incoming', {'chatId': ANA, 'reaction': {'messageId': 'm2', 'emoji': HEART}})).start()
    event, data = next_event()
    assert event == 'reactions' and data == {'chatId': ANA, 'messageId': 'm2', 'reactions': [{'emoji': HEART, 'count': 1, 'mine': False}]}
    threading.Timer(0.1, lambda: call(port, 'POST', '/_fake/incoming', {'chatId': ANA, 'reaction': {'messageId': 'm2', 'emoji': ''}})).start()
    assert next_event() == ('reactions', {'chatId': ANA, 'messageId': 'm2', 'reactions': []})
    conn.close()
    assert len(call(port, 'GET', f'/chats/{ANA}/messages')[1]['messages']) == before


def test_react_route_sends_only_the_fixed_emojis(running):
    bridge, port, _ = running
    path = f'/chats/{ANA}/messages/m1/react'
    assert call(port, 'POST', path, {'emoji': THUMBS})[0] == 409
    call(port, 'POST', '/_fake/scan', {})
    status, body = call(port, 'POST', path, {'emoji': THUMBS})
    assert status == 200 and body == {'reactions': [{'emoji': THUMBS, 'count': 1, 'mine': True}]}
    assert bridge.backend.sent[-1] == {'type': 'reaction', 'chatId': ANA, 'messageId': 'm1', 'emoji': THUMBS}
    assert call(port, 'GET', f'/chats/{ANA}/messages')[1]['messages'][-3]['reactions'] == [{'emoji': THUMBS, 'count': 1, 'mine': True}]
    # Vazio tira a sua.
    status, body = call(port, 'POST', path, {'emoji': ''})
    assert status == 200 and body == {'reactions': []} and bridge.backend.sent[-1]['emoji'] == ''
    # Fora da lista fixa, sem emoji ou para uma mensagem que não está guardada: nada sai.
    sent = len(bridge.backend.sent)
    assert call(port, 'POST', path, {'emoji': '\U0001f525'})[0] == 400
    assert call(port, 'POST', path, {})[0] == 400
    assert call(port, 'POST', path, {'emoji': 'x'})[0] == 400
    assert call(port, 'POST', f'/chats/{ANA}/messages/NAOEXISTE/react', {'emoji': THUMBS})[0] == 404
    assert call(port, 'POST', f'/chats/{ANA}/messages/a%20b/react', {'emoji': THUMBS})[0] == 400
    assert call(port, 'POST', f'/chats/{ANA}/messages/m1/react', {'emoji': THUMBS}, token=None)[0] == 401
    assert len(bridge.backend.sent) == sent
    # Num grupo, com quem mandou guardado, a reação sai.
    assert call(port, 'POST', f'/chats/{ATLAS}/messages/m5/react', {'emoji': HEART})[0] == 200
    for emoji in server.REACTION_EMOJIS:
        assert call(port, 'POST', path, {'emoji': emoji})[0] == 200


def test_presence_goes_to_events_and_the_route_only_sends_composing_or_paused(running):
    bridge, port, _ = running
    call(port, 'POST', '/_fake/scan', {})
    conn, next_event = events_reader(port)
    threading.Timer(0.1, lambda: call(port, 'POST', '/_fake/incoming', {'chatId': ANA, 'presence': 'composing'})).start()
    assert next_event() == ('presence', {'chatId': ANA, 'state': 'composing', 'author': None})
    threading.Timer(0.1, lambda: call(port, 'POST', '/_fake/incoming', {'chatId': ATLAS, 'presence': 'composing', 'author': 'Carla Dias'})).start()
    assert next_event() == ('presence', {'chatId': ATLAS, 'state': 'composing', 'author': 'Carla Dias'})
    conn.close()
    # Estado desconhecido ou conversa inválida não vão ao app.
    bridge.on_presence(ANA, 'recording')
    bridge.on_presence('nada', 'composing')
    assert call(port, 'POST', f'/chats/{ANA}/presence', {'state': 'composing'}) == (200, {'ok': True})
    assert call(port, 'POST', f'/chats/{ANA}/presence', {'state': 'paused'})[0] == 200
    assert call(port, 'POST', f'/chats/{ANA}/presence', {'state': 'available'})[0] == 400
    assert call(port, 'POST', '/chats/nada/presence', {'state': 'paused'})[0] == 400
    assert call(port, 'POST', f'/chats/{ANA}/presence', {'state': 'paused'}, token=None)[0] == 401
    assert call(port, 'POST', '/_fake/presences', {})[1] == {'presences': [{'chatId': ANA, 'state': 'composing'}, {'chatId': ANA, 'state': 'paused'}]}
    # A presença não é mensagem: nada entra em `sent`.
    assert all(item.get('type') != 'presence' for item in bridge.backend.sent)
