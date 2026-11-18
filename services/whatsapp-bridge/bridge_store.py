# Banco local do serviço (contrato 24, CA1): conversas e mensagens em SQLite, em `<data-dir>/messages.db`,
# nunca no repositório. Mídia fica como metadado (tipo, mime, tamanho, nome); nada é baixado sozinho. Contrato 37:
# imagem, vídeo e áudio guardam também a mensagem do WhatsApp serializada (`media_proto`, as chaves do download) e,
# o áudio, a duração; o download só acontece no clique, pela rota da mídia. Banco antigo ganha as colunas ao abrir
# (as mensagens de antes ficam sem as chaves e não baixam). As não lidas
# contam as mensagens recebidas desde a última vez que o app abriu a conversa; abrir não manda recibo de
# leitura ao WhatsApp (o serviço não envia nada sozinho).
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
COLUMNS = 'id, chat_id, author, from_me, at, kind, text, media_mime, media_size, media_name, media_proto IS NOT NULL, media_seconds'


class MediaGone(Exception):
    """A mídia não está mais disponível no WhatsApp (o endereço expirou ou o servidor recusou)."""


def _clip(value, limit):
    text = value if isinstance(value, str) else ''
    return text[:limit]


def media_proto_of(message):
    """A mensagem serializada que fica guardada (imagem, vídeo ou áudio, até 256 KB), ou `None`."""
    proto = message.get('mediaProto')
    if message.get('type') not in DOWNLOADABLE_KINDS or not isinstance(proto, (bytes, bytearray)) or not proto or len(proto) > MEDIA_PROTO_MAX:
        return None
    return bytes(proto)


def public_message(message):
    """A mensagem como sai do serviço (`/events`): sem as chaves do download, com `downloadable` na mídia."""
    result = {key: value for key, value in message.items() if key != 'mediaProto'}
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
        cursor = self.db.execute(
            'INSERT OR IGNORE INTO messages (id, chat_id, author, from_me, at, kind, text, media_mime, media_size, media_name, media_proto, media_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
        return [_row(row) for row in reversed(rows)]

    def search(self, query, limit=50):
        term = query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        with self.lock:
            rows = self.db.execute(
                "SELECT m.id, m.chat_id, m.author, m.from_me, m.at, m.kind, m.text, m.media_mime, m.media_size, m.media_name, m.media_proto IS NOT NULL, m.media_seconds, c.name FROM messages m JOIN chats c ON c.id = m.chat_id WHERE m.text LIKE ? ESCAPE '\\' ORDER BY m.at DESC LIMIT ?",
                (f'%{term}%', max(1, min(int(limit), 200))),
            ).fetchall()
        return [dict(_row(row[:12]), chatName=row[12] or row[1].split('@')[0]) for row in rows]


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


def _row(row):
    message_id, chat_id, author, from_me, at, kind, text, mime, size, name, has_proto, seconds = row
    media = None
    if kind != 'text':
        # Contrato 37: `downloadable` diz se o clique baixa (as chaves ficaram guardadas); o áudio leva a duração.
        media = {'kind': kind, 'mime': mime, 'size': size, 'name': name, 'downloadable': bool(has_proto)}
        if kind == 'audio' and seconds:
            media['seconds'] = seconds
    return {'id': message_id, 'chatId': chat_id, 'author': author, 'fromMe': bool(from_me), 'at': at, 'type': kind, 'text': text, 'media': media}
