# O cliente do neonize com o módulo `neonize` substituído: nenhum neonize instalado, nenhuma rede.
import os
import sys
import types

import pytest

import backend_neonize
from backend_neonize import NeonizeBackend, media_of


class Obj:
    def __init__(self, **fields):
        self.__dict__.update(fields)

    def HasField(self, name):  # noqa: N802 - nome do protobuf
        return name in self.__dict__


def jid(user, server):
    return Obj(User=user, Server=server)


class FakeClient:
    instances = []

    def __init__(self, name):
        self.name = name
        self.handlers = {}
        self.qr_handler = None
        self.connected = False
        self.sent = []
        self.logged_out = False
        FakeClient.instances.append(self)

    def qr(self, handler):
        self.qr_handler = handler

    def event(self, kind):
        def register(handler):
            self.handlers[kind] = handler

        return register

    def connect(self):
        self.connected = True

    def disconnect(self):
        self.connected = False

    def get_me(self):
        return Obj(JID=jid('5511900000000', 's.whatsapp.net'), PushName='Andrea')

    def send_message(self, to, text):
        self.sent.append((to, text))
        return Obj(ID='3EB0ABC')

    def PairPhone(self, phone, show_push_notification):  # noqa: N802
        return 'ABCD-EFGH'

    def logout(self):
        self.logged_out = True

    def get_group_info(self, chat):
        return Obj(GroupName=Obj(Name='Grupo do projeto'))

    @property
    def contact(self):
        return Obj(get_contact=lambda chat: Obj(FullName='Ana Souza', PushName='Ana'))


EVENTS = ['ChatPresenceEv', 'ConnectedEv', 'ConnectFailureEv', 'DisconnectedEv', 'HistorySyncEv', 'LoggedOutEv', 'MessageEv', 'PairStatusEv', 'TemporaryBanEv']


@pytest.fixture()
def fake_neonize(monkeypatch):
    root = types.ModuleType('neonize')
    client = types.ModuleType('neonize.client')
    client.NewClient = FakeClient
    events = types.ModuleType('neonize.events')
    for name in EVENTS:
        setattr(events, name, name)
    utils = types.ModuleType('neonize.utils')
    utils.build_jid = lambda user, server='s.whatsapp.net': jid(user, server)
    for name, module in {'neonize': root, 'neonize.client': client, 'neonize.events': events, 'neonize.utils': utils}.items():
        monkeypatch.setitem(sys.modules, name, module)
    FakeClient.instances = []
    yield


class RecordingBridge:
    def __init__(self):
        self.states = []
        self.qrs = []
        self.messages = []

    def on_state(self, state, me=None):
        self.states.append((state, me))

    def on_qr(self, code):
        self.qrs.append(code)

    def on_message(self, message, count_unread=True):
        self.messages.append((message, count_unread))

    def health(self):
        return {'me': {'name': 'Andrea', 'phone': '+5511900000000'}}


def started(tmp_path):
    bridge = RecordingBridge()
    backend = NeonizeBackend(str(tmp_path))
    backend.start(bridge)
    backend.thread.join(1)
    return backend, bridge, FakeClient.instances[-1]


def test_start_registers_events_and_connects_in_background(fake_neonize, tmp_path):
    backend, bridge, client = started(tmp_path)
    assert client.name == str(tmp_path / 'session.sqlite3')
    assert set(client.handlers) == set(EVENTS)
    assert client.connected and bridge.states[0] == ('pairing', None)
    client.qr_handler(client, b'2@qr-de-texto')
    assert bridge.qrs == ['2@qr-de-texto']
    client.handlers['ConnectedEv'](client, Obj())
    assert bridge.states[-1] == ('connected', {'name': 'Andrea', 'phone': '+5511900000000'})


def test_ban_and_failures(fake_neonize, tmp_path):
    _, bridge, client = started(tmp_path)
    client.handlers['TemporaryBanEv'](client, Obj())
    assert bridge.states[-1][0] == 'banned'
    client.handlers['ConnectFailureEv'](client, Obj(Reason=402))
    assert bridge.states[-1][0] == 'banned'
    client.handlers['ConnectFailureEv'](client, Obj(Reason=401))
    assert bridge.states[-1][0] == 'disconnected'
    client.handlers['LoggedOutEv'](client, Obj())
    assert bridge.states[-1][0] == 'disconnected'


def test_message_event_becomes_a_message(fake_neonize, tmp_path):
    _, bridge, client = started(tmp_path)
    source = Obj(Chat=jid('120363000000000001', 'g.us'), Sender=jid('5511922220000', 's.whatsapp.net'), IsFromMe=False, IsGroup=True)
    info = Obj(MessageSource=source, ID='ABC1', Pushname='Bruno', Timestamp=1_763_300_000)
    image = Obj(caption='Quadro', mimetype='image/jpeg', fileLength=122_880)
    client.handlers['MessageEv'](client, Obj(Info=info, Message=Obj(conversation='', imageMessage=image)))
    message, count = bridge.messages[-1]
    assert count is True
    assert message == {
        'id': 'ABC1',
        'chatId': '120363000000000001@g.us',
        'chatName': 'Grupo do projeto',
        'chatKind': 'group',
        'author': 'Bruno',
        'fromMe': False,
        'at': 1_763_300_000_000,
        'type': 'image',
        'text': 'Quadro',
        'media': {'kind': 'image', 'mime': 'image/jpeg', 'size': 122_880, 'name': None},
        # Contrato 34: quem mandou (a resposta e a reação citam).
        'sender': '5511922220000@s.whatsapp.net',
    }
    # Status (broadcast) fica de fora.
    status = Obj(MessageSource=Obj(Chat=jid('status', 'broadcast'), Sender=jid('1', 's.whatsapp.net'), IsFromMe=False, IsGroup=False), ID='S', Pushname='', Timestamp=1)
    client.handlers['MessageEv'](client, Obj(Info=status, Message=Obj(conversation='oi')))
    assert len(bridge.messages) == 1


def test_history_sync_messages_do_not_count_as_unread(fake_neonize, tmp_path):
    _, bridge, client = started(tmp_path)
    web = Obj(key=Obj(ID='H1', fromMe=False, participant=''), message=Obj(conversation='Mensagem antiga'), messageTimestamp=1_763_000_000, pushName='Ana', participant='')
    conversation = Obj(ID='5511911110000@s.whatsapp.net', name='Ana Souza', displayName='', messages=[Obj(message=web)])
    newsletter = Obj(ID='123@newsletter', name='Canal', displayName='', messages=[Obj(message=web)])
    client.handlers['HistorySyncEv'](client, Obj(Data=Obj(conversations=[conversation, newsletter])))
    assert len(bridge.messages) == 1
    message, count = bridge.messages[0]
    assert count is False and message['chatName'] == 'Ana Souza' and message['text'] == 'Mensagem antiga' and message['author'] == 'Ana'


def test_send_pair_and_logout(fake_neonize, tmp_path):
    backend, _, client = started(tmp_path)
    assert backend.send_text('5511911110000@s.whatsapp.net', 'Olá') == '3EB0ABC'
    to, text = client.sent[0]
    assert (to.User, to.Server, text) == ('5511911110000', 's.whatsapp.net', 'Olá')
    assert backend.pair_phone('5511900000000') == 'ABCD-EFGH'
    backend.logout()
    assert client.logged_out


def test_media_of_document_and_unknown():
    document = Obj(conversation='', documentMessage=Obj(caption='', mimetype='application/pdf', fileLength=2048, fileName='contrato.pdf', title=''))
    assert media_of(document) == ('document', '', {'kind': 'document', 'mime': 'application/pdf', 'size': 2048, 'name': 'contrato.pdf'})
    assert media_of(Obj(conversation=''))[0] == 'other'
    assert media_of(Obj(conversation='', extendedTextMessage=Obj(text='com link'))) == ('text', 'com link', None)
    assert backend_neonize.TEMP_BANNED == 402


class BatchBridge(RecordingBridge):
    """Bridge com o caminho em lote do histórico e os nomes achados depois."""

    def __init__(self):
        super().__init__()
        self.batches = []
        self.names = {}
        self.unnamed = []

    def on_history(self, messages):
        self.batches.append(messages)

    def unnamed_chats(self):
        return self.unnamed

    def on_names(self, names):
        self.names.update(names)


def test_history_goes_in_one_batch_not_one_event_per_message(fake_neonize, tmp_path):
    bridge = BatchBridge()
    backend = NeonizeBackend(str(tmp_path))
    backend.start(bridge)
    client = FakeClient.instances[-1]
    webs = [Obj(message=Obj(key=Obj(ID=f'H{i}', fromMe=False, participant=''), message=Obj(conversation='oi'), messageTimestamp=1_763_000_000 + i, pushName='Ana', participant='')) for i in range(300)]
    conversation = Obj(ID='5511911110000@s.whatsapp.net', name='', displayName='', messages=webs)
    client.handlers['HistorySyncEv'](client, Obj(Data=Obj(conversations=[conversation])))
    assert len(bridge.batches) == 1 and len(bridge.batches[0]) == 300 and bridge.messages == []
    backend.stop()


def test_my_own_message_never_names_the_chat_after_me(fake_neonize, tmp_path):
    backend, bridge, client = started(tmp_path)
    backend.lookup_name = lambda *args, **kwargs: ''
    source = Obj(Chat=jid('5511922220000', 's.whatsapp.net'), Sender=jid('5511900000000', 's.whatsapp.net'), IsFromMe=True, IsGroup=False)
    info = Obj(MessageSource=source, ID='M1', Pushname='Andrea', Timestamp=1_763_300_000)
    client.handlers['MessageEv'](client, Obj(Info=info, Message=Obj(conversation='oi')))
    assert bridge.messages[0][0]['chatName'] is None
    # Sem nome ainda, nada fica guardado: o nome achado depois vale.
    assert '5511922220000@s.whatsapp.net' not in backend.names


def test_refresh_names_uses_the_address_book_and_groups(fake_neonize, tmp_path):
    bridge = BatchBridge()
    backend = NeonizeBackend(str(tmp_path))
    backend.start(bridge)
    bridge.unnamed = [('5511933330000@s.whatsapp.net', 'person'), ('120363000000000001@g.us', 'group')]
    backend.refresh_names()
    assert bridge.names == {'5511933330000@s.whatsapp.net': 'Ana Souza', '120363000000000001@g.us': 'Grupo do projeto'}
    backend.stop()


def test_phone_of_a_lid_chat_comes_from_get_pn_from_lid(fake_neonize, tmp_path):
    # Contrato 25: o cartão do Assistente mostra o número da conversa `@lid` quando o WhatsApp o dá.
    backend, _bridge, client = started(tmp_path)
    client.get_pn_from_lid = lambda lid: jid('5511944440000', 's.whatsapp.net') if lid.User == '123' else jid('', '')
    assert backend.phone_for('123@lid') == '+5511944440000'
    assert backend.phone_for('999@lid') == ''
    assert backend.phone_for('5511911110000@s.whatsapp.net') == ''
    backend.stop()


PNG = b'\x89PNG\r\n\x1a\n' + b'\x00' * 40


def test_photo_comes_from_get_profile_picture_and_is_cached_for_7_days(fake_neonize, tmp_path):
    # Contrato 32: a foto de perfil pelo neonize, só de https em *.whatsapp.net, guardada em `photos/` por 7 dias.
    backend, _bridge, client = started(tmp_path)
    asked = []
    client.get_profile_picture = lambda target: asked.append((target.User, target.Server)) or Obj(URL='https://pps.whatsapp.net/v/foto.jpg')
    fetched = []
    backend.fetch = lambda url: fetched.append(url) or PNG
    now = [1_000_000.0]
    backend.clock = lambda: now[0]
    ana = '5511911110000@s.whatsapp.net'
    photo = backend.photo(ana)
    assert photo == 'data:image/png;base64,' + backend_neonize.base64.b64encode(PNG).decode()
    assert asked == [('5511911110000', 's.whatsapp.net')] and fetched == ['https://pps.whatsapp.net/v/foto.jpg']
    files = list((tmp_path / 'photos').iterdir())
    assert len(files) == 1 and oct(files[0].stat().st_mode & 0o777) == '0o600'
    # Dentro dos 7 dias: do disco, sem perguntar de novo.
    now[0] += 6 * 24 * 3600
    assert backend.photo(ana) == photo and len(asked) == 1
    # Passou dos 7 dias: pergunta de novo.
    now[0] += 2 * 24 * 3600
    assert backend.photo(ana) == photo and len(asked) == 2
    backend.stop()


def test_photo_without_picture_too_big_or_failing_is_none(fake_neonize, tmp_path):
    backend, _bridge, client = started(tmp_path)
    backend.clock = lambda: 5_000_000.0
    client.get_profile_picture = lambda target: Obj(URL='')
    assert backend.photo('5511922220000@s.whatsapp.net') is None
    client.get_profile_picture = lambda target: Obj(URL='https://pps.whatsapp.net/grande.jpg')
    backend.fetch = lambda url: b'\xff\xd8\xff' + b'\x00' * backend_neonize.PHOTO_MAX
    assert backend.photo('5511933330000@s.whatsapp.net') is None
    backend.fetch = lambda url: b'<html>nao e imagem</html>'
    assert backend.photo('5511944440000@s.whatsapp.net') is None

    def private(target):
        raise RuntimeError('privacidade')

    client.get_profile_picture = private
    assert backend.photo('5511955550000@s.whatsapp.net') is None
    # A falha não fica guardada: da próxima vez pergunta de novo.
    client.get_profile_picture = lambda target: Obj(URL='https://pps.whatsapp.net/ok.jpg')
    backend.fetch = lambda url: PNG
    assert backend.photo('5511955550000@s.whatsapp.net').startswith('data:image/png;base64,')
    backend.stop()


def test_fetch_photo_only_goes_to_whatsapp_over_https():
    assert backend_neonize.fetch_photo('http://pps.whatsapp.net/x.jpg') is None
    assert backend_neonize.fetch_photo('https://exemplo.com/x.jpg') is None
    assert backend_neonize.fetch_photo('https://whatsapp.net.exemplo.com/x.jpg') is None
    assert backend_neonize.fetch_photo('') is None
    assert backend_neonize.image_mime(b'RIFF\x00\x00\x00\x00WEBPVP8 ') == 'image/webp'


def test_photo_download_never_follows_a_redirect():
    """Contrato 32: um 302 para fora não é seguido; vira erro (e `photo()` devolve `None`)."""
    import threading
    import urllib.error
    from http.server import BaseHTTPRequestHandler, HTTPServer

    hits = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 - assinatura da base
            hits.append(self.path)
            if self.path == '/foto':
                self.send_response(302)
                self.send_header('Location', '/fora')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            self.send_response(200)
            self.send_header('Content-Length', '2')
            self.end_headers()
            self.wfile.write(b'ok')

        def log_message(self, *args):
            pass

    httpd = HTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        # O opener do download de verdade (o endereço local só testa o redirecionamento; a conferência do host vem antes).
        with pytest.raises(urllib.error.HTTPError) as error:
            backend_neonize.PHOTO_OPENER.open(f'http://127.0.0.1:{httpd.server_address[1]}/foto', timeout=5)
        assert error.value.code == 302 and hits == ['/foto']
    finally:
        httpd.shutdown()
    assert not any(isinstance(handler, backend_neonize.HTTPRedirectHandler) and type(handler) is backend_neonize.HTTPRedirectHandler for handler in backend_neonize.PHOTO_OPENER.handlers)
    assert backend_neonize.whatsapp_https('https://pps.whatsapp.net/x') and not backend_neonize.whatsapp_https('https://pps.whatsapp.net.evil.com/x')


class Proto(Obj):
    """Mensagem com `SerializeToString`, como o `waE2E.Message` do neonize."""

    def SerializeToString(self):  # noqa: N802 - nome do protobuf
        return b'serializada:' + ','.join(sorted(name for name in self.__dict__ if name != 'conversation')).encode()


def test_media_messages_keep_the_serialized_message_and_audio_seconds(fake_neonize, tmp_path):
    # Contrato 37: imagem, vídeo e áudio guardam a mensagem serializada (as chaves do download); o áudio, a duração.
    # Contrato 148: documento e figurinha também.
    _, bridge, client = started(tmp_path)
    source = Obj(Chat=jid('5511922220000', 's.whatsapp.net'), Sender=jid('5511922220000', 's.whatsapp.net'), IsFromMe=False, IsGroup=False)
    info = Obj(MessageSource=source, ID='AUD1', Pushname='Bruno', Timestamp=1_763_300_000)
    audio = Obj(mimetype='audio/ogg; codecs=opus', fileLength=4096, seconds=12)
    client.handlers['MessageEv'](client, Obj(Info=info, Message=Proto(conversation='', audioMessage=audio)))
    message = bridge.messages[-1][0]
    assert message['mediaProto'] == b'serializada:audioMessage'
    assert message['media'] == {'kind': 'audio', 'mime': 'audio/ogg; codecs=opus', 'size': 4096, 'name': None, 'seconds': 12}
    # Contrato 148: documento e figurinha também guardam as chaves, e nada é baixado ao receber.
    def boom(message):
        raise AssertionError('baixou sem o clique')

    client.download_any = boom
    document = Obj(caption='', mimetype='application/pdf', fileLength=10, fileName='a.pdf', title='')
    client.handlers['MessageEv'](client, Obj(Info=Obj(MessageSource=source, ID='DOC1', Pushname='Bruno', Timestamp=1), Message=Proto(conversation='', documentMessage=document)))
    message = bridge.messages[-1][0]
    assert message['mediaProto'] == b'serializada:documentMessage'
    assert message['media'] == {'kind': 'document', 'mime': 'application/pdf', 'size': 10, 'name': 'a.pdf'}
    sticker = Obj(mimetype='image/webp', fileLength=26)
    client.handlers['MessageEv'](client, Obj(Info=Obj(MessageSource=source, ID='STK1', Pushname='Bruno', Timestamp=1), Message=Proto(conversation='', stickerMessage=sticker)))
    message = bridge.messages[-1][0]
    assert message['type'] == 'sticker' and message['mediaProto'] == b'serializada:stickerMessage'
    # Mensagem sem mídia nenhuma continua sem as chaves.
    client.handlers['MessageEv'](client, Obj(Info=Obj(MessageSource=source, ID='OTH1', Pushname='Bruno', Timestamp=1), Message=Proto(conversation='')))
    assert bridge.messages[-1][0]['type'] == 'other' and 'mediaProto' not in bridge.messages[-1][0]
    # Do histórico também.
    web = Obj(key=Obj(ID='H9', fromMe=False, participant=''), message=Proto(conversation='', imageMessage=Obj(caption='', mimetype='image/jpeg', fileLength=99)), messageTimestamp=1, pushName='Ana', participant='')
    conversation = Obj(ID='5511911110000@s.whatsapp.net', name='Ana Souza', displayName='', messages=[Obj(message=web)])
    client.handlers['HistorySyncEv'](client, Obj(Data=Obj(conversations=[conversation])))
    assert bridge.messages[-1][0]['mediaProto'] == b'serializada:imageMessage'


@pytest.fixture()
def fake_download(monkeypatch, fake_neonize):
    """`neonize.exc.DownloadError` e o `waE2E.Message` com `FromString`, sem neonize."""

    class DownloadError(Exception):
        pass

    class Message:
        @staticmethod
        def FromString(data):  # noqa: N802 - nome do protobuf
            return ('mensagem', data)

    exc = types.ModuleType('neonize.exc')
    exc.DownloadError = DownloadError
    names = ['neonize.proto', 'neonize.proto.waE2E', 'neonize.proto.waE2E.WAWebProtobufsE2E_pb2']
    for name in names:
        monkeypatch.setitem(sys.modules, name, types.ModuleType(name))
    sys.modules['neonize.proto.waE2E.WAWebProtobufsE2E_pb2'].Message = Message
    monkeypatch.setitem(sys.modules, 'neonize.exc', exc)
    return DownloadError


def test_download_media_rebuilds_the_message_and_maps_expired_to_gone(fake_download, tmp_path):
    backend, _bridge, client = started(tmp_path)
    asked = []
    client.download_any = lambda message: asked.append(message) or b'bytes do audio'
    assert backend.download_media('audio', b'chaves') == b'bytes do audio'
    assert asked == [('mensagem', b'chaves')]
    # Contrato 148: documento e figurinha pelo mesmo `download_any`.
    assert backend.download_media('document', b'pdf') == b'bytes do audio' and backend.download_media('sticker', b'webp') == b'bytes do audio'
    assert asked[1:] == [('mensagem', b'pdf'), ('mensagem', b'webp')]

    def expired(message):
        raise fake_download('download failed with status code 410')

    client.download_any = expired
    with pytest.raises(backend_neonize.MediaGone):
        backend.download_media('audio', b'chaves')

    def offline(message):
        raise RuntimeError('sem conexão')

    client.download_any = offline
    with pytest.raises(RuntimeError):
        backend.download_media('image', b'chaves')
    backend.stop()


@pytest.fixture()
def no_network(monkeypatch, fake_neonize):
    """Contrato 39: o proto do VideoMessage e o `MediaType` sem neonize, e qualquer ida à rede explode."""
    import socket
    import urllib.request

    def boom(*_args, **_kwargs):
        raise AssertionError('tentou ir à rede')

    requests = types.ModuleType('requests')
    requests.get = boom
    monkeypatch.setitem(sys.modules, 'requests', requests)
    monkeypatch.setattr(urllib.request, 'urlopen', boom)
    monkeypatch.setattr(socket, 'create_connection', boom)
    monkeypatch.setattr(socket.socket, 'connect', boom)

    class Message:
        def __init__(self, **fields):
            self.fields = fields

        def SerializeToString(self):  # noqa: N802 - nome do protobuf
            video = self.fields.get('videoMessage') or self.fields.get('imageMessage')
            return repr(sorted(getattr(video, 'fields', {}).items())).encode()

    class VideoMessage:
        def __init__(self, **fields):
            self.fields = fields

    names = ['neonize.proto', 'neonize.proto.waE2E', 'neonize.proto.waE2E.WAWebProtobufsE2E_pb2', 'neonize.utils.enum']
    for name in names:
        monkeypatch.setitem(sys.modules, name, types.ModuleType(name))
    sys.modules['neonize.proto.waE2E.WAWebProtobufsE2E_pb2'].Message = Message
    sys.modules['neonize.proto.waE2E.WAWebProtobufsE2E_pb2'].VideoMessage = VideoMessage
    sys.modules['neonize.utils.enum'].MediaType = types.SimpleNamespace(MediaVideo='video')
    return Message


JPEG_THUMB = b'\xff\xd8\xff\xe0miniatura'


def tools(monkeypatch, thumb=JPEG_THUMB, found=True):
    """ffmpeg e ffprobe falsos: a duração 3,4 s e a miniatura (ou a falha dela)."""
    calls = []
    monkeypatch.setattr(backend_neonize, 'find_tool', lambda name: f'/bin/{name}' if found else None)

    def run(args):
        calls.append(args)
        return b'3.4\n' if args[0].endswith('ffprobe') else thumb

    monkeypatch.setattr(backend_neonize, 'run_tool', run)
    return calls


def uploading(client):
    uploads = []

    def upload(data, media_type=None):
        uploads.append((data, media_type))
        return Obj(url='https://mmg.whatsapp.net/v', DirectPath='/v', FileEncSHA256=b'e', FileLength=len(data), FileSHA256=b's', MediaKey=b'k')

    client.upload = upload
    return uploads


def test_send_media_image_uses_build_image_message(no_network, tmp_path):
    """Contrato 39: a imagem pelo `build_image_message` (bytes locais), enviada pelo `send_message`."""
    backend, _bridge, client = started(tmp_path)

    class Built:
        def SerializeToString(self):  # noqa: N802 - nome do protobuf
            return b'imagem serializada'

    built = []
    client.build_image_message = lambda data, caption: built.append((data, caption)) or Built()
    assert backend.send_media('5511911110000@s.whatsapp.net', 'image', 'image/png', b'png', 'olha isso', 'foto.png') == ('3EB0ABC', b'imagem serializada')
    assert built == [(b'png', 'olha isso')]
    to, _message = client.sent[-1]
    assert (to.User, to.Server) == ('5511911110000', 's.whatsapp.net')
    backend.stop()


def test_send_media_video_is_built_here_without_the_network(no_network, monkeypatch, tmp_path):
    """Contrato 39: o vídeo nunca passa pelo `build_video_message` (que baixa da Wikimedia); duração e miniatura locais."""
    backend, _bridge, client = started(tmp_path)

    def never(*_args, **_kwargs):
        raise AssertionError('build_video_message não pode ser usado')

    client.build_video_message = never
    client.send_video = never
    uploads = uploading(client)
    calls = tools(monkeypatch)
    message_id, proto = backend.send_media('120363000000000001@g.us', 'video', 'video/mp4', b'mp4', 'o vídeo', 'v.mp4')
    assert message_id == '3EB0ABC' and proto
    _to, message = client.sent[-1]
    video = message.fields['videoMessage'].fields
    assert video['seconds'] == 3 and video['JPEGThumbnail'] == JPEG_THUMB and video['caption'] == 'o vídeo' and video['mimetype'] == 'video/mp4'
    assert video['URL'].startswith('https://mmg.whatsapp.net/') and uploads == [(b'mp4', 'video')]
    assert [args[0] for args in calls] == ['/bin/ffprobe', '/bin/ffmpeg']
    # O arquivo temporário sai depois.
    assert not [name for name in os.listdir(tmp_path) if name.startswith('envio-')]
    # Miniatura que falha (ou que não é JPEG): vai sem miniatura, e sem legenda quando ela é vazia.
    tools(monkeypatch, thumb=None)
    backend.send_media('120363000000000001@g.us', 'video', 'video/quicktime', b'mov', '', 'v.mov')
    video = client.sent[-1][1].fields['videoMessage'].fields
    assert 'JPEGThumbnail' not in video and 'caption' not in video and video['mimetype'] == 'video/quicktime'
    tools(monkeypatch, thumb=b'<svg>')
    backend.send_media('120363000000000001@g.us', 'video', 'video/mp4', b'mp4', '', 'v.mp4')
    assert 'JPEGThumbnail' not in client.sent[-1][1].fields['videoMessage'].fields
    backend.stop()


def test_send_media_video_without_ffmpeg_raises_before_uploading(no_network, monkeypatch, tmp_path):
    backend, _bridge, client = started(tmp_path)
    uploads = uploading(client)
    tools(monkeypatch, found=False)
    sent_before = len(client.sent)
    with pytest.raises(backend_neonize.MissingFfmpeg):
        backend.send_media('5511911110000@s.whatsapp.net', 'video', 'video/mp4', b'mp4', '', 'v.mp4')
    assert uploads == [] and len(client.sent) == sent_before
    backend.stop()


def test_video_details_with_the_real_ffmpeg(tmp_path):
    """Com o ffmpeg desta máquina (se houver): a duração e a miniatura de um MP4 gerado aqui, sem rede."""
    ffmpeg = backend_neonize.find_tool('ffmpeg')
    if not ffmpeg or not backend_neonize.find_tool('ffprobe'):
        pytest.skip('sem ffmpeg nesta máquina')
    out = tmp_path / 'v.mp4'
    import subprocess

    subprocess.run([ffmpeg, '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=160x120:rate=10', '-pix_fmt', 'yuv420p', str(out)], check=True, timeout=60)
    seconds, thumb = backend_neonize.video_details(out.read_bytes(), str(tmp_path))
    assert seconds == 2 and thumb[:3] == b'\xff\xd8\xff'


class ReactionBridge(BatchBridge):
    """Contrato 34: a bridge com as reações e a presença."""

    def __init__(self):
        super().__init__()
        self.reactions = []
        self.presences = []

    def on_reaction(self, *reaction):
        self.reactions.append(reaction)

    def on_reactions(self, items):
        self.reactions.extend(items)

    def on_presence(self, *presence):
        self.presences.append(presence)


def started_with(tmp_path, bridge):
    backend = NeonizeBackend(str(tmp_path))
    backend.start(bridge)
    return backend, FakeClient.instances[-1]


def test_reply_comes_from_the_context_info(fake_neonize, tmp_path):
    # Contrato 34: o id e o trecho da citada saem do `contextInfo` (texto, legenda ou o rótulo da mídia).
    _, bridge, client = started(tmp_path)
    source = Obj(Chat=jid('5511911110000', 's.whatsapp.net'), Sender=jid('5511911110000', 's.whatsapp.net'), IsFromMe=False, IsGroup=False)
    quoted = Obj(conversation='Conseguimos marcar a reunião de sexta?')
    reply = Obj(conversation='', extendedTextMessage=Obj(text='Sim!', contextInfo=Obj(stanzaID='Q1', participant='5511900000000@s.whatsapp.net', quotedMessage=quoted)))
    client.handlers['MessageEv'](client, Obj(Info=Obj(MessageSource=source, ID='R1', Pushname='Ana', Timestamp=1), Message=reply))
    message = bridge.messages[-1][0]
    assert (message['text'], message['replyToId'], message['replyPreview']) == ('Sim!', 'Q1', 'Conseguimos marcar a reunião de sexta?')
    # A legenda de uma imagem que responde um áudio: o rótulo do áudio.
    image = Obj(caption='olha', mimetype='image/jpeg', fileLength=1, contextInfo=Obj(stanzaID='Q2', quotedMessage=Obj(conversation='', audioMessage=Obj(mimetype='audio/ogg', fileLength=1))))
    client.handlers['MessageEv'](client, Obj(Info=Obj(MessageSource=source, ID='R2', Pushname='Ana', Timestamp=1), Message=Obj(conversation='', imageMessage=image)))
    assert bridge.messages[-1][0]['replyPreview'] == 'Áudio'
    # Sem `stanzaID` (o `contextInfo` das menções, por exemplo), não é resposta.
    plain = Obj(conversation='', extendedTextMessage=Obj(text='@Ana oi', contextInfo=Obj(stanzaID='')))
    client.handlers['MessageEv'](client, Obj(Info=Obj(MessageSource=source, ID='R3', Pushname='Ana', Timestamp=1), Message=plain))
    assert 'replyToId' not in bridge.messages[-1][0]
    assert backend_neonize.reply_of(None) == (None, '')


def test_reaction_events_become_reactions_not_messages(fake_neonize, tmp_path):
    bridge = ReactionBridge()
    _backend, client = started_with(tmp_path, bridge)
    group = Obj(Chat=jid('120363000000000001', 'g.us'), Sender=jid('5511922220000', 's.whatsapp.net'), IsFromMe=False, IsGroup=True)
    reaction = Obj(reactionMessage=Obj(key=Obj(ID='ALVO1'), text='\U0001f44d', senderTimestampMS=1_763_300_000_123))
    client.handlers['MessageEv'](client, Obj(Info=Obj(MessageSource=group, ID='X1', Pushname='Bruno', Timestamp=1_763_300_000), Message=reaction))
    assert bridge.messages == []
    assert bridge.reactions == [('120363000000000001@g.us', 'ALVO1', '5511922220000@s.whatsapp.net', '\U0001f44d', 1_763_300_000_123)]
    # A sua (de outro aparelho) tem o autor `me`; texto vazio é tirar.
    mine = Obj(Chat=jid('5511911110000', 's.whatsapp.net'), Sender=jid('5511900000000', 's.whatsapp.net'), IsFromMe=True, IsGroup=False)
    removal = Obj(reactionMessage=Obj(key=Obj(ID='ALVO2'), text='', senderTimestampMS=0))
    client.handlers['MessageEv'](client, Obj(Info=Obj(MessageSource=mine, ID='X2', Pushname='Andrea', Timestamp=1_763_300_001), Message=removal))
    assert bridge.reactions[-1] == ('5511911110000@s.whatsapp.net', 'ALVO2', 'me', '', 1_763_300_001_000)
    assert bridge.messages == []


def test_history_reactions_go_in_one_batch(fake_neonize, tmp_path):
    bridge = ReactionBridge()
    _backend, client = started_with(tmp_path, bridge)
    reacted = Obj(
        key=Obj(ID='H1', fromMe=False, participant='5511922220000@s.whatsapp.net'),
        message=Obj(conversation='Prazo dia 28'),
        messageTimestamp=1_763_000_000,
        pushName='Bruno',
        participant='5511922220000@s.whatsapp.net',
        reactions=[Obj(key=Obj(fromMe=True, participant='', remoteJID='120363000000000001@g.us'), text='❤️', senderTimestampMS=1_763_000_100_000)],
    )
    as_message = Obj(key=Obj(ID='H2', fromMe=False, participant='5511933330000@s.whatsapp.net'), message=Obj(reactionMessage=Obj(key=Obj(ID='H1'), text='\U0001f602', senderTimestampMS=0)), messageTimestamp=1_763_000_200, pushName='Carla', participant='')
    conversation = Obj(ID='120363000000000001@g.us', name='Projeto Atlas', displayName='', messages=[Obj(message=reacted), Obj(message=as_message)])
    client.handlers['HistorySyncEv'](client, Obj(Data=Obj(conversations=[conversation])))
    assert [m['id'] for m in bridge.batches[0]] == ['H1'] and bridge.batches[0][0]['sender'] == '5511922220000@s.whatsapp.net'
    assert bridge.reactions == [
        ('120363000000000001@g.us', 'H1', 'me', '❤️', 1_763_000_100_000),
        ('120363000000000001@g.us', 'H1', '5511933330000@s.whatsapp.net', '\U0001f602', 1_763_000_200_000),
    ]


def test_chat_presence_becomes_typing_with_the_group_author(fake_neonize, tmp_path):
    bridge = ReactionBridge()
    backend, client = started_with(tmp_path, bridge)
    backend.contacts['5511922220000@s.whatsapp.net'] = 'Bruno Lima'
    group = Obj(Chat=jid('120363000000000001', 'g.us'), Sender=jid('5511922220000', 's.whatsapp.net'), IsFromMe=False, IsGroup=True)
    client.handlers['ChatPresenceEv'](client, Obj(MessageSource=group, State=1, Media=1))
    person = Obj(Chat=jid('5511911110000', 's.whatsapp.net'), Sender=jid('5511911110000', 's.whatsapp.net'), IsFromMe=False, IsGroup=False)
    client.handlers['ChatPresenceEv'](client, Obj(MessageSource=person, State=2, Media=1))
    # A sua presença e um estado desconhecido ficam de fora.
    client.handlers['ChatPresenceEv'](client, Obj(MessageSource=Obj(Chat=jid('5511911110000', 's.whatsapp.net'), Sender=jid('1', 's'), IsFromMe=True, IsGroup=False), State=1, Media=1))
    client.handlers['ChatPresenceEv'](client, Obj(MessageSource=person, State=9, Media=1))
    assert bridge.presences == [('120363000000000001@g.us', 'composing', 'Bruno Lima'), ('5511911110000@s.whatsapp.net', 'paused', None)]


@pytest.fixture()
def fake_proto(monkeypatch, fake_neonize):
    """Contrato 34: o `waE2E` (Message, ExtendedTextMessage, ContextInfo) e o `ChatPresence` sem neonize."""

    class Proto:
        def __init__(self, **fields):
            self.fields = fields

        @classmethod
        def FromString(cls, data):  # noqa: N802 - nome do protobuf
            return cls(refeita=data)

    names = ['neonize.proto', 'neonize.proto.waE2E', 'neonize.proto.waE2E.WAWebProtobufsE2E_pb2', 'neonize.utils.enum']
    for name in names:
        monkeypatch.setitem(sys.modules, name, types.ModuleType(name))
    pb = sys.modules['neonize.proto.waE2E.WAWebProtobufsE2E_pb2']
    pb.Message = type('Message', (Proto,), {})
    pb.ExtendedTextMessage = type('ExtendedTextMessage', (Proto,), {})
    pb.ContextInfo = type('ContextInfo', (Proto,), {})
    sys.modules['neonize.utils.enum'].ChatPresence = types.SimpleNamespace(CHAT_PRESENCE_COMPOSING='composing', CHAT_PRESENCE_PAUSED='paused')
    sys.modules['neonize.utils.enum'].ChatPresenceMedia = types.SimpleNamespace(CHAT_PRESENCE_MEDIA_TEXT='text')
    return pb


def test_send_text_with_a_quote_builds_the_context_info(fake_proto, tmp_path):
    backend, _bridge, client = started(tmp_path)
    group = '120363000000000001@g.us'
    backend.send_text(group, 'Combinado', {'id': 'Q1', 'fromMe': False, 'sender': '5511922220000@s.whatsapp.net', 'kind': 'text', 'text': 'Prazo dia 28', 'proto': None})
    to, message = client.sent[-1]
    assert (to.User, to.Server) == ('120363000000000001', 'g.us')
    extended = message.fields['extendedTextMessage'].fields
    context = extended['contextInfo'].fields
    assert extended['text'] == 'Combinado'
    assert context['stanzaID'] == 'Q1' and context['participant'] == '5511922220000@s.whatsapp.net'
    assert context['quotedMessage'].fields == {'conversation': 'Prazo dia 28'}
    # A sua mensagem citada leva o seu id; a mídia é refeita da mensagem guardada; na conversa a dois, a outra pessoa.
    backend.send_text('5511911110000@s.whatsapp.net', 'ok', {'id': 'Q2', 'fromMe': True, 'sender': '', 'kind': 'image', 'text': '', 'proto': b'imagem'})
    context = client.sent[-1][1].fields['extendedTextMessage'].fields['contextInfo'].fields
    assert context['participant'] == '5511900000000@s.whatsapp.net' and context['quotedMessage'].fields == {'refeita': b'imagem'}
    backend.send_text('5511911110000@s.whatsapp.net', 'ok', {'id': 'Q3', 'fromMe': False, 'sender': '', 'kind': 'text', 'text': 'oi', 'proto': None})
    assert client.sent[-1][1].fields['extendedTextMessage'].fields['contextInfo'].fields['participant'] == '5511911110000@s.whatsapp.net'
    # Sem citação, o texto puro de antes.
    backend.send_text('5511911110000@s.whatsapp.net', 'simples')
    assert client.sent[-1][1] == 'simples'


def test_send_reaction_and_presence(fake_proto, tmp_path):
    backend, _bridge, client = started(tmp_path)
    built = []
    client.build_reaction = lambda chat, sender, message_id, emoji: built.append((f'{chat.User}@{chat.Server}', f'{sender.User}@{sender.Server}', message_id, emoji)) or 'reacao'
    backend.send_reaction('120363000000000001@g.us', {'id': 'M5', 'fromMe': False, 'sender': '5511922220000@s.whatsapp.net'}, '\U0001f44d')
    backend.send_reaction('5511911110000@s.whatsapp.net', {'id': 'M2', 'fromMe': True, 'sender': ''}, '')
    assert built == [
        ('120363000000000001@g.us', '5511922220000@s.whatsapp.net', 'M5', '\U0001f44d'),
        ('5511911110000@s.whatsapp.net', '5511900000000@s.whatsapp.net', 'M2', ''),
    ]
    assert [message for _to, message in client.sent[-2:]] == ['reacao', 'reacao']
    presences = []
    client.send_chat_presence = lambda chat, state, media: presences.append((chat.User, state, media))
    backend.send_presence('5511911110000@s.whatsapp.net', 'composing')
    backend.send_presence('5511911110000@s.whatsapp.net', 'paused')
    assert presences == [('5511911110000', 'composing', 'text'), ('5511911110000', 'paused', 'text')]
