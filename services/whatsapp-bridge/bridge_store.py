# Banco local do serviço (contrato 24, CA1): conversas e mensagens em SQLite, em `<data-dir>/messages.db`,
# nunca no repositório. Mídia fica só como metadado (tipo, mime, tamanho, nome); nada é baixado. As não lidas
# contam as mensagens recebidas desde a última vez que o app abriu a conversa; abrir não manda recibo de
# leitura ao WhatsApp (o serviço não envia nada sozinho).
import os
import sqlite3
import threading
import time

TEXT_MAX = 20_000
NAME_MAX = 200
MESSAGE_KINDS = ('text', 'image', 'video', 'audio', 'document', 'sticker', 'other')


def _clip(value, limit):
    text = value if isinstance(value, str) else ''
    return text[:limit]


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
        self._upsert_chat(message['chatId'], message.get('chatName'), message.get('chatKind'))
        cursor = self.db.execute(
            'INSERT OR IGNORE INTO messages (id, chat_id, author, from_me, at, kind, text, media_mime, media_size, media_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
                    'SELECT id, chat_id, author, from_me, at, kind, text, media_mime, media_size, media_name FROM messages WHERE chat_id = ? ORDER BY at DESC LIMIT 1',
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
                    'SELECT id, chat_id, author, from_me, at, kind, text, media_mime, media_size, media_name FROM messages WHERE chat_id = ? AND (at < ? OR (at = ? AND id < ?)) ORDER BY at DESC, id DESC LIMIT ?',
                    (chat_id, int(before), int(before), before_id, limit),
                ).fetchall()
            elif before is None:
                rows = self.db.execute(
                    'SELECT id, chat_id, author, from_me, at, kind, text, media_mime, media_size, media_name FROM messages WHERE chat_id = ? ORDER BY at DESC, id DESC LIMIT ?',
                    (chat_id, limit),
                ).fetchall()
            else:
                rows = self.db.execute(
                    'SELECT id, chat_id, author, from_me, at, kind, text, media_mime, media_size, media_name FROM messages WHERE chat_id = ? AND at < ? ORDER BY at DESC, id DESC LIMIT ?',
                    (chat_id, int(before), limit),
                ).fetchall()
        return [_row(row) for row in reversed(rows)]

    def search(self, query, limit=50):
        term = query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        with self.lock:
            rows = self.db.execute(
                "SELECT m.id, m.chat_id, m.author, m.from_me, m.at, m.kind, m.text, m.media_mime, m.media_size, m.media_name, c.name FROM messages m JOIN chats c ON c.id = m.chat_id WHERE m.text LIKE ? ESCAPE '\\' ORDER BY m.at DESC LIMIT ?",
                (f'%{term}%', max(1, min(int(limit), 200))),
            ).fetchall()
        return [dict(_row(row[:10]), chatName=row[10] or row[1].split('@')[0]) for row in rows]


def _row(row):
    message_id, chat_id, author, from_me, at, kind, text, mime, size, name = row
    media = None if kind == 'text' else {'kind': kind, 'mime': mime, 'size': size, 'name': name}
    return {'id': message_id, 'chatId': chat_id, 'author': author, 'fromMe': bool(from_me), 'at': at, 'type': kind, 'text': text, 'media': media}
