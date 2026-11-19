# Banco local do serviço (contrato 24, CA1): conversas e mensagens em SQLite, em `<data-dir>/messages.db`,
# nunca no repositório. Mídia fica como metadado (tipo, mime, tamanho, nome); nada é baixado sozinho. Contrato 37:
# imagem, vídeo e áudio guardam também a mensagem do WhatsApp serializada (`media_proto`, as chaves do download) e,
# o áudio, a duração; o download só acontece no clique, pela rota da mídia. Banco antigo ganha as colunas ao abrir
# (as mensagens de antes ficam sem as chaves e não baixam). As não lidas
# contam as mensagens recebidas desde a última vez que o app abriu a conversa; abrir não manda recibo de
# leitura ao WhatsApp (o serviço não envia nada sozinho).
#
# Contrato 34: a mensagem que responde outra guarda o id da citada (`reply_to_id`) e um trecho dela (`reply_preview`, até
# 120 caracteres: o texto ou o rótulo da mídia), e o id de quem mandou (`sender`), que a resposta e a reação de verdade
# precisam citar. As reações ficam em `reactions` (uma por pessoa e mensagem; a sua com o autor `me`); a listagem junta
# por emoji (`[{emoji, count, mine}]`). Emoji recebido é só texto, cortado e sem caractere de controle.
import os
import sqlite3
import threading
import time

TEXT_MAX = 20_000
NAME_MAX = 200
MESSAGE_KINDS = ('text', 'image', 'video', 'audio', 'document', 'sticker', 'other')
# Contrato 37: os tipos que baixam no clique (documento e figurinha ficam de fora).
DOWNLOADABLE_KINDS = ('image', 'video', 'audio')
# A mensagem serializada que passa disso não fica guardada (a mensagem continua, sem o download).
MEDIA_PROTO_MAX = 256 * 1024
COLUMNS = 'id, chat_id, author, from_me, at, kind, text, media_mime, media_size, media_name, media_proto IS NOT NULL, media_seconds, reply_to_id, reply_preview'
# Contrato 34: o trecho da mensagem citada e o autor das suas reações.
REPLY_PREVIEW_MAX = 120
REACTION_ME = 'me'
REACTION_MAX = 16
MEDIA_PREVIEW_LABELS = {'image': 'Imagem', 'video': 'Vídeo', 'audio': 'Áudio', 'document': 'Documento', 'sticker': 'Figurinha', 'other': 'Mensagem'}


class MediaGone(Exception):
    """A mídia não está mais disponível no WhatsApp (o endereço expirou ou o servidor recusou)."""


class MissingFfmpeg(Exception):
    """Contrato 39: o envio de vídeo precisa do ffmpeg e do ffprobe (a duração e a miniatura saem deles)."""


def _clip(value, limit):
    text = value if isinstance(value, str) else ''
    return text[:limit]


def reply_preview_of(kind, text):
    """Contrato 34: o trecho da mensagem citada, numa linha só: o texto (a legenda) ou o rótulo da mídia."""
    line = ' '.join((text if isinstance(text, str) else '').split())
    if not line:
        line = MEDIA_PREVIEW_LABELS.get(kind, '') if kind != 'text' else ''
    return line[:REPLY_PREVIEW_MAX]


def clean_emoji(value):
    """Contrato 34: o emoji recebido como texto curto, sem caractere de controle; vazio é "tirou a reação"."""
    text = value if isinstance(value, str) else ''
    return ''.join(char for char in text if char.isprintable() or char in '\u200d\ufe0f')[:REACTION_MAX].strip()


def media_proto_of(message):
    """A mensagem serializada que fica guardada (imagem, vídeo ou áudio, até 256 KB), ou `None`."""
    proto = message.get('mediaProto')
    if message.get('type') not in DOWNLOADABLE_KINDS or not isinstance(proto, (bytes, bytearray)) or not proto or len(proto) > MEDIA_PROTO_MAX:
        return None
    return bytes(proto)


def public_message(message):
    """A mensagem como sai do serviço (`/events`): sem as chaves do download, com `downloadable` na mídia."""
    # Contrato 34: o id de quem mandou fica só no banco (a resposta e a reação de verdade citam ele).
    result = {key: value for key, value in message.items() if key not in ('mediaProto', 'sender')}
    if not result.get('replyToId'):
        result.pop('replyToId', None)
        result.pop('replyPreview', None)
    if result.get('media'):
        result['media'] = dict(result['media'], downloadable=media_proto_of(message) is not None)
    return result


def now_ms():
    return int(time.time() * 1000)


def to_ms(timestamp):
    """Hora do WhatsApp em segundos ou milissegundos para milissegundos."""
    try:
        value = int(timestamp)
    except (TypeError, ValueError):
        return now_ms()
    if value <= 0:
        return now_ms()
    return value if value > 100_000_000_000 else value * 1000


class Store:
    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        fresh = not os.path.exists(path)
        self.db = sqlite3.connect(path, check_same_thread=False)
        if fresh:
            os.chmod(path, 0o600)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.executescript(
            '''
            CREATE TABLE IF NOT EXISTS chats (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL DEFAULT '',
              kind TEXT NOT NULL DEFAULT 'person',
              unread INTEGER NOT NULL DEFAULT 0,
              last_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS messages (
              id TEXT NOT NULL,
              chat_id TEXT NOT NULL,
              author TEXT NOT NULL DEFAULT '',
              from_me INTEGER NOT NULL DEFAULT 0,
              at INTEGER NOT NULL,
              kind TEXT NOT NULL DEFAULT 'text',
              text TEXT NOT NULL DEFAULT '',
              media_mime TEXT,
              media_size INTEGER,
              media_name TEXT,
              PRIMARY KEY (chat_id, id)
            );
            CREATE INDEX IF NOT EXISTS messages_by_chat ON messages (chat_id, at);
            '''
        )
        # Contrato 37: banco de antes ganha as colunas novas (vazias nas mensagens que já estavam lá).
        columns = {row[1] for row in self.db.execute('PRAGMA table_info(messages)').fetchall()}
        if 'media_proto' not in columns:
            self.db.execute('ALTER TABLE messages ADD COLUMN media_proto BLOB')
        if 'media_seconds' not in columns:
            self.db.execute('ALTER TABLE messages ADD COLUMN media_seconds INTEGER')
        # Contrato 34: a citação e quem mandou (as mensagens de antes ficam sem; responder a elas num grupo sai sem citação).
        for column in ('reply_to_id', 'reply_preview', 'sender'):
            if column not in columns:
                self.db.execute(f'ALTER TABLE messages ADD COLUMN {column} TEXT')
        self.db.execute(
            '''
            CREATE TABLE IF NOT EXISTS reactions (
              chat_id TEXT NOT NULL,
              msg_id TEXT NOT NULL,
              author TEXT NOT NULL,
              emoji TEXT NOT NULL,
              at INTEGER NOT NULL,
              PRIMARY KEY (chat_id, msg_id, author)
            )
            '''
        )
        self.db.commit()

    def close(self):
        with self.lock:
            self.db.close()

    def upsert_chat(self, chat_id, name=None, kind=None):
        with self.lock:
            self._upsert_chat(chat_id, name, kind)
            self.db.commit()

    def _upsert_chat(self, chat_id, name, kind):
        self.db.execute('INSERT OR IGNORE INTO chats (id) VALUES (?)', (chat_id,))
        if name:
            self.db.execute('UPDATE chats SET name = ? WHERE id = ?', (_clip(name, NAME_MAX), chat_id))
        if kind in ('person', 'group'):
            self.db.execute('UPDATE chats SET kind = ? WHERE id = ?', (kind, chat_id))

    def add_message(self, message, count_unread=True):
        """Grava a mensagem (repetida é ignorada). Devolve `True` quando ela é nova."""
        with self.lock:
            created = self._add_message(message, count_unread)
            self.db.commit()
            return created

    def add_messages(self, messages):
        """O histórico que o celular manda depois do pareamento: tudo numa transação só (milhares de mensagens),
        sem contar como não lidas. Devolve quantas eram novas."""
        created = 0
        with self.lock:
            for message in messages:
                created += 1 if self._add_message(message, False) else 0
            self.db.commit()
        return created

    def _add_message(self, message, count_unread):
        kind = message.get('type') if message.get('type') in MESSAGE_KINDS else 'other'
        media = message.get('media') or {}
        proto = media_proto_of(message)
        seconds = media.get('seconds') if kind == 'audio' else None
        self._upsert_chat(message['chatId'], message.get('chatName'), message.get('chatKind'))
        reply_to = _clip(message.get('replyToId'), 200) or None
        preview = reply_preview_of('text', message.get('replyPreview')) if reply_to else ''
        if reply_to and not preview:
            # Sem o trecho na mensagem: o da citada, se ela estiver guardada.
            quoted = self.db.execute('SELECT kind, text FROM messages WHERE chat_id = ? AND id = ?', (message['chatId'], reply_to)).fetchone()
            preview = reply_preview_of(quoted[0], quoted[1]) if quoted else ''
        cursor = self.db.execute(
            'INSERT OR IGNORE INTO messages (id, chat_id, author, from_me, at, kind, text, media_mime, media_size, media_name, media_proto, media_seconds, reply_to_id, reply_preview, sender) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (
                _clip(message['id'], 200),
                message['chatId'],
                _clip(message.get('author'), NAME_MAX),
                1 if message.get('fromMe') else 0,
                int(message['at']),
                kind,
                _clip(message.get('text'), TEXT_MAX),
                _clip(media.get('mime'), 100) or None,
                int(media['size']) if isinstance(media.get('size'), int) else None,
                _clip(media.get('name'), NAME_MAX) or None,
                proto,
                int(seconds) if isinstance(seconds, int) and 0 < seconds < 24 * 3600 else None,
                reply_to,
                preview or None,
                _clip(message.get('sender'), 200) or None,
            ),
        )
        created = cursor.rowcount == 1
        if created:
            self.db.execute('UPDATE chats SET last_at = MAX(last_at, ?) WHERE id = ?', (int(message['at']), message['chatId']))
            if count_unread and not message.get('fromMe'):
                self.db.execute('UPDATE chats SET unread = unread + 1 WHERE id = ?', (message['chatId'],))
        return created

    def unnamed_chats(self, limit=500):
        """Conversas sem nome de verdade (vazio ou só o número): `(id, tipo)`, as mais recentes primeiro."""
        with self.lock:
            rows = self.db.execute(
                "SELECT id, kind FROM chats WHERE name = '' OR name = substr(id, 1, instr(id, '@') - 1) ORDER BY last_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [(row[0], row[1]) for row in rows]

    def set_names(self, names):
        """Grava os nomes achados depois (agenda de contatos, grupos). Devolve quantos mudaram."""
        changed = 0
        with self.lock:
            for chat_id, name in names.items():
                if not name:
                    continue
                cursor = self.db.execute('UPDATE chats SET name = ? WHERE id = ? AND name != ?', (_clip(name, NAME_MAX), chat_id, _clip(name, NAME_MAX)))
                changed += cursor.rowcount
            self.db.commit()
        return changed

    def set_unread(self, chat_id, unread):
        with self.lock:
            self.db.execute('UPDATE chats SET unread = ? WHERE id = ?', (max(0, int(unread)), chat_id))
            self.db.commit()

    def chat(self, chat_id):
        with self.lock:
            row = self.db.execute('SELECT id, name, kind, unread FROM chats WHERE id = ?', (chat_id,)).fetchone()
        return None if row is None else {'id': row[0], 'name': row[1] or row[0].split('@')[0], 'kind': row[2], 'unread': row[3]}

    def chats(self, limit=500):
        with self.lock:
            rows = self.db.execute('SELECT id, name, kind, unread FROM chats ORDER BY last_at DESC LIMIT ?', (limit,)).fetchall()
            result = []
            for chat_id, name, kind, unread in rows:
                last = self.db.execute(
                    f'SELECT {COLUMNS} FROM messages WHERE chat_id = ? ORDER BY at DESC LIMIT 1',
                    (chat_id,),
                ).fetchone()
                result.append(
                    {
                        'id': chat_id,
                        'name': name or chat_id.split('@')[0],
                        'kind': kind,
                        'unread': unread,
                        'lastMessage': None if last is None else _row(last),
                    }
                )
        return result

    def messages(self, chat_id, before=None, limit=50, before_id=None):
        """
        Até `limit` mensagens antes do cursor (`before` em ms e, com `before_id`, o id: as do mesmo milissegundo com
        id menor também entram), da mais antiga para a mais nova.
        """
        limit = max(1, min(int(limit), 200))
        with self.lock:
            if before is not None and before_id is not None:
                rows = self.db.execute(
                    f'SELECT {COLUMNS} FROM messages WHERE chat_id = ? AND (at < ? OR (at = ? AND id < ?)) ORDER BY at DESC, id DESC LIMIT ?',
                    (chat_id, int(before), int(before), before_id, limit),
                ).fetchall()
            elif before is None:
                rows = self.db.execute(
                    f'SELECT {COLUMNS} FROM messages WHERE chat_id = ? ORDER BY at DESC, id DESC LIMIT ?',
                    (chat_id, limit),
                ).fetchall()
            else:
                rows = self.db.execute(
                    f'SELECT {COLUMNS} FROM messages WHERE chat_id = ? AND at < ? ORDER BY at DESC, id DESC LIMIT ?',
                    (chat_id, int(before), limit),
                ).fetchall()
            result = [_row(row) for row in reversed(rows)]
            # Contrato 34: as reações das mensagens desta página, juntas por emoji.
            grouped = self._reactions(chat_id, [message['id'] for message in result])
        for message in result:
            if grouped.get(message['id']):
                message['reactions'] = grouped[message['id']]
        return result

    def search(self, query, limit=50):
        term = query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        with self.lock:
            rows = self.db.execute(
                "SELECT m.id, m.chat_id, m.author, m.from_me, m.at, m.kind, m.text, m.media_mime, m.media_size, m.media_name, m.media_proto IS NOT NULL, m.media_seconds, m.reply_to_id, m.reply_preview, c.name FROM messages m JOIN chats c ON c.id = m.chat_id WHERE m.text LIKE ? ESCAPE '\\' ORDER BY m.at DESC LIMIT ?",
                (f'%{term}%', max(1, min(int(limit), 200))),
            ).fetchall()
        return [dict(_row(row[:14]), chatName=row[14] or row[1].split('@')[0]) for row in rows]


    def media_source(self, chat_id, message_id):
        """Contrato 37: `(tipo, mime, tamanho, mensagem serializada)` da mídia que baixa, ou `None` (sem as chaves)."""
        with self.lock:
            row = self.db.execute(
                'SELECT kind, media_mime, media_size, media_proto FROM messages WHERE chat_id = ? AND id = ? AND media_proto IS NOT NULL',
                (chat_id, message_id),
            ).fetchone()
        if row is None or row[0] not in DOWNLOADABLE_KINDS:
            return None
        return row[0], row[1], row[2], bytes(row[3])

    def reply_preview(self, chat_id, message_id):
        """Contrato 34: o trecho da citação guardado para a mensagem (o que a listagem mostra), ou `''`."""
        with self.lock:
            row = self.db.execute('SELECT reply_preview FROM messages WHERE chat_id = ? AND id = ?', (chat_id, message_id)).fetchone()
        return (row[0] or '') if row else ''

    def quoted(self, chat_id, message_id):
        """
        Contrato 34: o que a resposta e a reação precisam da mensagem citada, ou `None` (não guardada): `{fromMe, sender,
        kind, text, proto}` (`proto`: a mensagem serializada da mídia, quando há).
        """
        with self.lock:
            row = self.db.execute(
                'SELECT from_me, sender, kind, text, media_proto FROM messages WHERE chat_id = ? AND id = ?',
                (chat_id, message_id),
            ).fetchone()
        if row is None:
            return None
        return {'id': message_id, 'fromMe': bool(row[0]), 'sender': row[1] or '', 'kind': row[2], 'text': row[3] or '', 'proto': bytes(row[4]) if row[4] else None}

    def set_reaction(self, chat_id, message_id, author, emoji, at):
        """Contrato 34: grava ou tira (emoji vazio) a reação de uma pessoa. Devolve as reações da mensagem, juntas."""
        with self.lock:
            self._set_reaction(chat_id, message_id, author, emoji, at)
            self.db.commit()
            return self._reactions(chat_id, [message_id]).get(message_id, [])

    def set_reactions(self, items):
        """As reações do histórico, numa transação só: `(conversa, mensagem, autor, emoji, hora)`."""
        with self.lock:
            changed = sum(1 for item in items if self._set_reaction(*item))
            self.db.commit()
        return changed

    def _set_reaction(self, chat_id, message_id, author, emoji, at):
        emoji = clean_emoji(emoji)
        message_id = _clip(message_id, 200)
        author = _clip(author, 200)
        if not chat_id or not message_id or not author:
            return False
        at = int(at) if isinstance(at, int) and at > 0 else now_ms()
        # Fora de ordem (o histórico chega depois do evento ao vivo): a mais nova vale.
        current = self.db.execute('SELECT at FROM reactions WHERE chat_id = ? AND msg_id = ? AND author = ?', (chat_id, message_id, author)).fetchone()
        if current is not None and current[0] > at:
            return False
        if not emoji:
            return self.db.execute('DELETE FROM reactions WHERE chat_id = ? AND msg_id = ? AND author = ?', (chat_id, message_id, author)).rowcount > 0
        self.db.execute(
            'INSERT INTO reactions (chat_id, msg_id, author, emoji, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (chat_id, msg_id, author) DO UPDATE SET emoji = excluded.emoji, at = excluded.at',
            (chat_id, message_id, author, emoji, at),
        )
        return True

    def _reactions(self, chat_id, message_ids):
        """`{id: [{emoji, count, mine}]}`, o emoji mais usado primeiro (empate: o que chegou antes)."""
        grouped = {}
        for start in range(0, len(message_ids), 500):
            chunk = message_ids[start : start + 500]
            if not chunk:
                continue
            marks = ','.join('?' * len(chunk))
            rows = self.db.execute(
                f'SELECT msg_id, emoji, COUNT(*), MAX(author = ?), MIN(at) FROM reactions WHERE chat_id = ? AND msg_id IN ({marks}) GROUP BY msg_id, emoji ORDER BY msg_id, COUNT(*) DESC, MIN(at)',
                (REACTION_ME, chat_id, *chunk),
            ).fetchall()
            for message_id, emoji, count, mine, _first in rows:
                grouped.setdefault(message_id, []).append({'emoji': emoji, 'count': count, 'mine': bool(mine)})
        return grouped


def _row(row):
    message_id, chat_id, author, from_me, at, kind, text, mime, size, name, has_proto, seconds, reply_to, preview = row
    media = None
    if kind != 'text':
        # Contrato 37: `downloadable` diz se o clique baixa (as chaves ficaram guardadas); o áudio leva a duração.
        media = {'kind': kind, 'mime': mime, 'size': size, 'name': name, 'downloadable': bool(has_proto)}
        if kind == 'audio' and seconds:
            media['seconds'] = seconds
    result = {'id': message_id, 'chatId': chat_id, 'author': author, 'fromMe': bool(from_me), 'at': at, 'type': kind, 'text': text, 'media': media}
    # Contrato 34: só a mensagem que responde outra leva a citação.
    if reply_to:
        result['replyToId'] = reply_to
        result['replyPreview'] = preview or ''
    return result
