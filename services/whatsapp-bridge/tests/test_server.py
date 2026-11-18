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
    for method, path in [('GET', '/pair'), ('GET', '/chats'), ('GET', f'/chats/{ANA}/messages'), ('GET', '/search?q=prazo'), ('GET', f'/chats/{ANA}/photo'), ('GET', '/events'), ('POST', '/logout'), ('POST', f'/chats/{ANA}/send')]:
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
    assert messages[0]['type'] == 'image' and messages[0]['media'] == {'kind': 'image', 'mime': 'image/jpeg', 'size': 122880, 'name': None}
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


def test_fake_history_is_spread_over_days_and_not_unread(running):
    _, port, _ = running
    call(port, 'POST', '/_fake/scan', {})
    ana = next(c for c in call(port, 'GET', '/chats')[1]['chats'] if c['id'] == ANA)
    assert ana['unread'] == 2
    messages = call(port, 'GET', f'/chats/{ANA}/messages')[1]['messages']
    days = {m['at'] // 86_400_000 for m in messages}
    assert len(messages) == 11 and len(days) >= 6
