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
    days = {m['at'] // 86_400_000 for m in messages}
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
