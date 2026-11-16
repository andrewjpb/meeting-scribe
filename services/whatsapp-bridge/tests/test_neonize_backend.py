# O cliente do neonize com o módulo `neonize` substituído: nenhum neonize instalado, nenhuma rede.
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


EVENTS = ['ConnectedEv', 'ConnectFailureEv', 'DisconnectedEv', 'HistorySyncEv', 'LoggedOutEv', 'MessageEv', 'PairStatusEv', 'TemporaryBanEv']


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
