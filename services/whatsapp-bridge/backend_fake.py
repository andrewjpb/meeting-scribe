# Cliente falso do WhatsApp (contrato 24, CA7): as mesmas respostas do neonize, sem neonize e sem rede. Usado
# pelo smoke do app e pelos testes. Começa aguardando pareamento com um QR de texto fixo; `POST /_fake/scan`
# faz o papel do celular lendo o QR (conecta e semeia três conversas) e `POST /_fake/incoming` entrega uma
# mensagem nova. Os envios ficam só na memória (`POST /_fake/sent`): nada sai da máquina.
import os
import sqlite3
import threading

from bridge_store import now_ms

FAKE_QR = '2@smoke-qr-falso,AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/=,smoke-chave-publica-falsa,smoke-segredo-falso'
FAKE_PAIR_CODE = 'SMKE-1234'
FAKE_ME = {'name': 'Andrea Teste', 'phone': '+55 11 90000-0000'}
PAIRED_MARK = 'fake-paired'

SEED_CHATS = [
    ('5511911110000@s.whatsapp.net', 'Ana Souza', 'person'),
    ('120363000000000001@g.us', 'Projeto Atlas', 'group'),
    ('5511922220000@s.whatsapp.net', 'Bruno Lima', 'person'),
]


def seed_messages(base):
    """Mensagens das três conversas, com uma imagem só como metadado e um texto com marcas de HTML."""
    ana, atlas, bruno = (chat[0] for chat in SEED_CHATS)
    minute = 60_000
    return [
        {'id': 'm1', 'chatId': ana, 'author': 'Ana Souza', 'fromMe': False, 'at': base - 50 * minute, 'type': 'text', 'text': 'Oi! Conseguimos marcar a reunião de sexta?', 'media': None},
        {'id': 'm2', 'chatId': ana, 'author': 'Andrea Teste', 'fromMe': True, 'at': base - 48 * minute, 'type': 'text', 'text': 'Acho que sim, confirmo até amanhã.', 'media': None},
        {'id': 'm3', 'chatId': ana, 'author': 'Ana Souza', 'fromMe': False, 'at': base - 40 * minute, 'type': 'text', 'text': 'Combinado. <b>Não</b> esquece a pauta.', 'media': None},
        {'id': 'm4', 'chatId': atlas, 'author': 'Carla Dias', 'fromMe': False, 'at': base - 30 * minute, 'type': 'image', 'text': 'Quadro do cronograma', 'media': {'kind': 'image', 'mime': 'image/jpeg', 'size': 122_880, 'name': None}},
        {'id': 'm5', 'chatId': atlas, 'author': 'Bruno Lima', 'fromMe': False, 'at': base - 25 * minute, 'type': 'text', 'text': 'O prazo da entrega ficou para o dia 28.', 'media': None},
        {'id': 'm6', 'chatId': bruno, 'author': 'Bruno Lima', 'fromMe': False, 'at': base - 90 * minute, 'type': 'text', 'text': 'Mandei o contrato revisado por e-mail.', 'media': None},
    ]


class FakeBackend:
    def __init__(self, data_dir):
        self.data_dir = data_dir
        self.bridge = None
        self.sent = []
        self.lock = threading.Lock()
        self.counter = 0

    def _paired(self):
        return os.path.exists(os.path.join(self.data_dir, PAIRED_MARK))

    def start(self, bridge):
        self.bridge = bridge
        # Como o neonize: uma sessão em SQLite com WAL na pasta de dados (o teste confere as permissões).
        session = sqlite3.connect(os.path.join(self.data_dir, 'session.sqlite3'))
        session.execute('PRAGMA journal_mode=WAL')
        session.execute('CREATE TABLE IF NOT EXISTS sessao (id INTEGER PRIMARY KEY)')
        session.commit()
        self.session = session
        if self._paired():
            bridge.on_state('connected', dict(FAKE_ME))
        else:
            bridge.on_qr(FAKE_QR)

    def stop(self):
        session = getattr(self, 'session', None)
        if session is not None:
            session.close()

    def pair_phone(self, phone):
        return FAKE_PAIR_CODE

    def logout(self):
        pass

    def send_text(self, chat_id, text):
        with self.lock:
            self.counter += 1
            message_id = f'enviada-{self.counter}'
            self.sent.append({'id': message_id, 'chatId': chat_id, 'text': text})
        return message_id

    def control(self, action, body):
        if action == 'scan':
            with open(os.path.join(self.data_dir, PAIRED_MARK), 'w', encoding='utf-8') as mark:
                mark.write('1')
            for chat_id, name, kind in SEED_CHATS:
                self.bridge.on_chat(chat_id, name, kind)
            for message in seed_messages(now_ms()):
                self.bridge.on_message(message)
            self.bridge.on_state('connected', dict(FAKE_ME))
            return {'ok': True}
        if action == 'incoming':
            with self.lock:
                self.counter += 1
                message_id = f'recebida-{self.counter}'
            message = {
                'id': message_id,
                'chatId': str(body.get('chatId') or SEED_CHATS[0][0]),
                'author': str(body.get('author') or 'Ana Souza'),
                'fromMe': False,
                'at': now_ms(),
                'type': 'text',
                'text': str(body.get('text') or ''),
                'media': None,
            }
            self.bridge.on_message(message)
            return {'ok': True, 'id': message_id}
        if action == 'sent':
            with self.lock:
                return {'sent': list(self.sent)}
        if action == 'ban':
            self.bridge.on_state('banned')
            return {'ok': True}
        return {'ok': False}
