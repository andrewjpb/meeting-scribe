# Cliente falso do WhatsApp (contrato 24, CA7): as mesmas respostas do neonize, sem neonize e sem rede. Usado
# pelo smoke do app e pelos testes. Começa aguardando pareamento com um QR de texto fixo; `POST /_fake/scan`
# faz o papel do celular lendo o QR (conecta e semeia três conversas) e `POST /_fake/incoming` entrega uma
# mensagem nova. Os envios ficam só na memória (`POST /_fake/sent`): nada sai da máquina.
#
# Contrato 32: fotos de perfil determinísticas e pequenas (PNG de 8×8 de uma cor) para a Ana e o Projeto Atlas; o
# Bruno fica sem foto (o app mostra as iniciais). A Ana ganha também mensagens antigas espalhadas pelos últimos dias
# (o gráfico "Atividade" do painel Detalhes), como histórico: não contam como não lidas.
#
# Contrato 37: o Bruno ganha um áudio e uma imagem que baixam no clique (as "chaves" são rótulos `fake:<tipo>`); o
# download devolve o PNG, um WAV PCM curto gerado aqui e uns bytes rotulados `video/mp4` (ninguém dá play no vídeo
# falso). `fake:gone` faz o papel do arquivo que o WhatsApp não tem mais. A imagem do Atlas (m4) continua sem as
# chaves, como uma mensagem de antes desta versão.
#
# Contrato 148: o Bruno ganha também um documento PDF (uma página, gerado aqui) e uma figurinha WebP de 1×1 que baixam no
# clique, como histórico mais antigo que o áudio: a última mensagem e as não lidas do Bruno não mudam.
#
# Contrato 39: o envio de imagem e vídeo fica em `sent` (tipo, nome, tamanho e legenda, nunca os bytes) e o eco volta
# com as chaves falsas do tipo: baixar o eco devolve o PNG (ou o começo de MP4) acima, não o arquivo enviado.
# Contrato 34: o envio com `quote` guarda o `replyToId`; a reação (`send_reaction`) entra em `sent` como `{'type':
# 'reaction', ...}` e a presença (`send_presence`) fica em `presences` (`POST /_fake/presences`). `POST /_fake/incoming`
# aceita `replyToId` (a mensagem nova responde outra), `reaction: {messageId, emoji}` (alguém reage, ou tira com emoji
# vazio; nenhuma mensagem nova) e `presence: 'composing' | 'paused'` (alguém digitando; nenhuma mensagem nova).
# Contrato 144: `fromMe: true` entrega uma mensagem minha que não saiu do app (respondida no celular).
import base64
import math
import os
import sqlite3
import struct
import threading
import zlib

from bridge_store import MediaGone, now_ms

FAKE_QR = '2@smoke-qr-falso,AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/=,smoke-chave-publica-falsa,smoke-segredo-falso'
FAKE_PAIR_CODE = 'SMKE-1234'
FAKE_ME = {'name': 'Andrea Teste', 'phone': '+55 11 90000-0000'}
PAIRED_MARK = 'fake-paired'
FAKE_GROUP_SENDER = '5511944440000@s.whatsapp.net'

SEED_CHATS = [
    ('5511911110000@s.whatsapp.net', 'Ana Souza', 'person'),
    ('120363000000000001@g.us', 'Projeto Atlas', 'group'),
    ('5511922220000@s.whatsapp.net', 'Bruno Lima', 'person'),
]


def solid_png(rgb, size=8):
    """PNG de `size`×`size` de uma cor só, sempre os mesmos bytes."""

    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)

    row = b'\x00' + bytes(rgb) * size
    header = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(row * size, 9)) + chunk(b'IEND', b'')


def tone_wav(seconds=2, rate=8000):
    """WAV PCM de 16 bits, mono, com um tom baixo de 440 Hz: sempre os mesmos bytes."""
    frames = b''.join(struct.pack('<h', int(3000 * math.sin(2 * math.pi * 440 * index / rate))) for index in range(seconds * rate))
    header = b'RIFF' + struct.pack('<I', 36 + len(frames)) + b'WAVE'
    header += b'fmt ' + struct.pack('<IHHIIHH', 16, 1, 1, rate, rate * 2, 2, 16)
    return header + b'data' + struct.pack('<I', len(frames)) + frames


def tiny_pdf(text):
    """PDF de uma página com uma linha de texto (ASCII), com a tabela `xref` certa: sempre os mesmos bytes."""
    stream = f'BT /F1 18 Tf 72 720 Td ({text}) Tj ET'.encode('ascii')
    objects = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    data = b'%PDF-1.4\n'
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(data))
        data += f'{number} 0 obj\n'.encode() + body + b'\nendobj\n'
    table = len(data)
    data += f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode()
    data += b''.join(f'{offset:010d} 00000 n \n'.encode() for offset in offsets)
    data += f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{table}\n%%EOF\n'.encode()
    return data


# WebP sem perdas de 1×1 pixel transparente (o menor WebP válido).
TINY_WEBP = b'RIFF\x1a\x00\x00\x00WEBPVP8L\x0d\x00\x00\x00\x2f\x00\x00\x00\x10\x07\x10\x11\x11\x88\x88\xfe\x07\x00'

FAKE_AUDIO_SECONDS = 2
FAKE_MEDIA = {
    'image': solid_png((214, 120, 40), size=48),
    'audio': tone_wav(FAKE_AUDIO_SECONDS),
    # Só o começo de um MP4 (a caixa `ftyp`): ninguém dá play no vídeo falso.
    'video': b'\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom' + b'\x00' * 64,
    # Contrato 148.
    'document': tiny_pdf('Contrato revisado - versao 2'),
    'sticker': TINY_WEBP,
}

FAKE_MIME = {'image': 'image/png', 'audio': 'audio/wav', 'video': 'video/mp4', 'document': 'application/pdf', 'sticker': 'image/webp'}
FAKE_DOCUMENT_NAME = 'contrato-revisado.pdf'


def png_data_url(rgb):
    return 'data:image/png;base64,' + base64.b64encode(solid_png(rgb)).decode('ascii')


# Ana e Atlas com foto; Bruno sem.
FAKE_PHOTOS = {
    SEED_CHATS[0][0]: png_data_url((30, 91, 184)),
    SEED_CHATS[1][0]: png_data_url((31, 122, 69)),
}

DAY_MS = 86_400_000

# Histórico da Ana: (dias atrás, minutos, de mim?, texto). Nada com "prazo" (a busca do teste acha só o do Atlas).
ANA_HISTORY = [
    (9, 600, False, 'Bom dia! Você recebeu a proposta que mandei?'),
    (9, 610, True, 'Recebi, vou ler hoje com calma.'),
    (7, 720, False, 'Conseguiu olhar a proposta?'),
    (6, 540, True, 'Olhei. Gostei do escopo, só quero rever o valor da segunda fase.'),
    (6, 545, False, 'Tranquilo, posso ajustar.'),
    (4, 900, False, 'Mandei a versão ajustada da proposta.'),
    (3, 660, True, 'Perfeito, ficou ótima. Vou levar para a diretoria.'),
    (2, 780, False, 'Obrigada! Me avisa quando tiver retorno.'),
]


def history_messages(base):
    ana = SEED_CHATS[0][0]
    return [
        {
            'id': f'h{index + 1}',
            'chatId': ana,
            'author': 'Andrea Teste' if mine else 'Ana Souza',
            'fromMe': mine,
            'at': base - days * DAY_MS + (minute - 720) * 60_000,
            'type': 'text',
            'text': text,
            'media': None,
        }
        for index, (days, minute, mine, text) in enumerate(ANA_HISTORY)
    ]


def seed_messages(base):
    """Mensagens das três conversas, com uma imagem só como metadado e um texto com marcas de HTML."""
    ana, atlas, bruno = (chat[0] for chat in SEED_CHATS)
    minute = 60_000
    return [
        {'id': 'm1', 'chatId': ana, 'author': 'Ana Souza', 'fromMe': False, 'at': base - 50 * minute, 'type': 'text', 'text': 'Oi! Conseguimos marcar a reunião de sexta?', 'media': None},
        {'id': 'm2', 'chatId': ana, 'author': 'Andrea Teste', 'fromMe': True, 'at': base - 48 * minute, 'type': 'text', 'text': 'Acho que sim, confirmo até amanhã.', 'media': None},
        {'id': 'm3', 'chatId': ana, 'author': 'Ana Souza', 'fromMe': False, 'at': base - 40 * minute, 'type': 'text', 'text': 'Combinado. <b>Não</b> esquece a pauta.', 'media': None},
        {'id': 'm4', 'chatId': atlas, 'author': 'Carla Dias', 'fromMe': False, 'at': base - 30 * minute, 'type': 'image', 'text': 'Quadro do cronograma', 'media': {'kind': 'image', 'mime': 'image/jpeg', 'size': 122_880, 'name': None}, 'sender': '5511933330000@s.whatsapp.net'},
        {'id': 'm5', 'chatId': atlas, 'author': 'Bruno Lima', 'fromMe': False, 'at': base - 25 * minute, 'type': 'text', 'text': 'O prazo da entrega ficou para o dia 28.', 'media': None, 'sender': SEED_CHATS[2][0]},
        {'id': 'm6', 'chatId': bruno, 'author': 'Bruno Lima', 'fromMe': False, 'at': base - 90 * minute, 'type': 'text', 'text': 'Mandei o contrato revisado por e-mail.', 'media': None},
    ]


def media_messages(base):
    """Contrato 37: o áudio e a imagem do Bruno, com as chaves falsas do download (histórico: não contam como não lidas).
    Contrato 148: o documento PDF e a figurinha do Bruno, do mesmo jeito."""
    bruno = SEED_CHATS[2][0]
    minute = 60_000
    return [
        {
            'id': 'm7',
            'chatId': bruno,
            'author': 'Bruno Lima',
            'fromMe': False,
            'at': base - 96 * minute,
            'type': 'audio',
            'text': '',
            'media': {'kind': 'audio', 'mime': 'audio/wav', 'size': len(FAKE_MEDIA['audio']), 'name': None, 'seconds': FAKE_AUDIO_SECONDS},
            'mediaProto': b'fake:audio',
        },
        {
            'id': 'm8',
            'chatId': bruno,
            'author': 'Bruno Lima',
            'fromMe': False,
            'at': base - 94 * minute,
            'type': 'image',
            'text': 'Foto do quadro',
            'media': {'kind': 'image', 'mime': 'image/png', 'size': len(FAKE_MEDIA['image']), 'name': None},
            'mediaProto': b'fake:image',
        },
        # Contrato 148: o PDF e a figurinha, mais antigos que o áudio (a última do Bruno continua o texto m6).
        {
            'id': 'm9',
            'chatId': bruno,
            'author': 'Bruno Lima',
            'fromMe': False,
            'at': base - 100 * minute,
            'type': 'document',
            'text': '',
            'media': {'kind': 'document', 'mime': 'application/pdf', 'size': len(FAKE_MEDIA['document']), 'name': FAKE_DOCUMENT_NAME},
            'mediaProto': b'fake:document',
        },
        {
            'id': 'm10',
            'chatId': bruno,
            'author': 'Bruno Lima',
            'fromMe': False,
            'at': base - 99 * minute,
            'type': 'sticker',
            'text': '',
            'media': {'kind': 'sticker', 'mime': 'image/webp', 'size': len(FAKE_MEDIA['sticker']), 'name': None},
            'mediaProto': b'fake:sticker',
        },
    ]


class FakeBackend:
    def __init__(self, data_dir):
        self.data_dir = data_dir
        self.bridge = None
        self.sent = []
        self.presences = []
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

    def send_text(self, chat_id, text, quote=None):
        with self.lock:
            self.counter += 1
            message_id = f'enviada-{self.counter}'
            item = {'id': message_id, 'chatId': chat_id, 'text': text}
            if quote:
                item['replyToId'] = quote['id']
            self.sent.append(item)
        return message_id

    def send_reaction(self, chat_id, target, emoji):
        """Contrato 34: a reação fica só na memória (`emoji` vazio: tirou a sua)."""
        with self.lock:
            self.sent.append({'type': 'reaction', 'chatId': chat_id, 'messageId': target['id'], 'emoji': emoji})

    def send_presence(self, chat_id, state):
        with self.lock:
            self.presences.append({'chatId': chat_id, 'state': state})

    def send_media(self, chat_id, kind, mime, data, caption, name):
        """Contrato 39: `(id, chaves do download)`; o envio só fica na memória, sem os bytes."""
        with self.lock:
            self.counter += 1
            message_id = f'enviada-{self.counter}'
            self.sent.append({'id': message_id, 'chatId': chat_id, 'type': kind, 'mime': mime, 'name': name, 'size': len(data), 'caption': caption})
        return message_id, f'fake:{kind}'.encode()

    def download_media(self, kind, proto):
        """Contrato 37: os bytes falsos do tipo; `fake:gone` é o arquivo que o WhatsApp não tem mais."""
        if proto == b'fake:gone':
            raise MediaGone()
        return FAKE_MEDIA[kind]

    def photo(self, chat_id):
        """Foto de perfil falsa (contrato 32): a mesma para Ana e Atlas; as outras conversas sem foto."""
        return FAKE_PHOTOS.get(chat_id)

    def control(self, action, body):
        if action == 'scan':
            with open(os.path.join(self.data_dir, PAIRED_MARK), 'w', encoding='utf-8') as mark:
                mark.write('1')
            for chat_id, name, kind in SEED_CHATS:
                self.bridge.on_chat(chat_id, name, kind)
            base = now_ms()
            for message in history_messages(base) + media_messages(base):
                self.bridge.on_message(message, count_unread=False)
            for message in seed_messages(base):
                self.bridge.on_message(message)
            self.bridge.on_state('connected', dict(FAKE_ME))
            return {'ok': True}
        if action == 'incoming' and (isinstance(body.get('reaction'), dict) or body.get('presence') in ('composing', 'paused')):
            # Contrato 34: a reação de alguém ou o "digitando…", sem mensagem nova.
            chat_id = str(body.get('chatId') or SEED_CHATS[0][0])
            author = str(body.get('author') or 'Ana Souza')
            if 'presence' in body:
                self.bridge.on_presence(chat_id, body['presence'], author if chat_id.endswith('@g.us') else None)
                return {'ok': True}
            reaction = body['reaction']
            self.bridge.on_reaction(chat_id, str(reaction.get('messageId') or ''), f'fake:{author}', str(reaction.get('emoji') or ''), now_ms())
            return {'ok': True}
        if action == 'incoming':
            with self.lock:
                self.counter += 1
                message_id = f'recebida-{self.counter}'
            # Contrato 37: `type` e `media` entregam uma mídia; imagem, vídeo e áudio (contrato 148: documento e figurinha
            # também) baixam (com `gone: true`, o arquivo já não existe no WhatsApp), a não ser com `downloadable: false`.
            kind = body.get('type') if body.get('type') in ('image', 'video', 'audio', 'document', 'sticker') else 'text'
            given = body.get('media') if isinstance(body.get('media'), dict) else {}
            media = None
            if kind != 'text':
                media = {
                    'kind': kind,
                    'mime': given.get('mime') or FAKE_MIME.get(kind),
                    'size': given.get('size') if isinstance(given.get('size'), int) else None,
                    'name': given.get('name') or None,
                }
                if isinstance(given.get('seconds'), int):
                    media['seconds'] = given['seconds']
            # Contrato 144: `fromMe: true` faz o papel de uma resposta minha escrita no celular (não saiu do app).
            mine = body.get('fromMe') is True
            message = {
                'id': message_id,
                'chatId': str(body.get('chatId') or SEED_CHATS[0][0]),
                'author': FAKE_ME['name'] if mine else str(body.get('author') or 'Ana Souza'),
                'fromMe': mine,
                'at': now_ms(),
                'type': kind,
                'text': str(body.get('text') or ''),
                'media': media,
            }
            # Contrato 34: quem mandou (num grupo, um número falso fixo), que a resposta e a reação citam.
            message['sender'] = FAKE_GROUP_SENDER if message['chatId'].endswith('@g.us') else message['chatId']
            if isinstance(body.get('replyToId'), str):
                message['replyToId'] = body['replyToId']
            if kind in FAKE_MEDIA and body.get('downloadable') is not False:
                message['mediaProto'] = b'fake:gone' if body.get('gone') else f'fake:{kind}'.encode()
            self.bridge.on_message(message)
            return {'ok': True, 'id': message_id}
        if action == 'sent':
            with self.lock:
                return {'sent': list(self.sent)}
        if action == 'presences':
            with self.lock:
                return {'presences': list(self.presences)}
        if action == 'ban':
            self.bridge.on_state('banned')
            return {'ok': True}
        return {'ok': False}
