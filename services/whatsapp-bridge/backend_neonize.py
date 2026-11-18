# Cliente do WhatsApp pelo neonize (biblioteca Python sobre o whatsmeow, cliente NÃO OFICIAL do WhatsApp
# multi-dispositivo). Traduz os eventos do neonize para o serviço: QR, conectado, desconectado, número bloqueado,
# mensagens novas e o histórico que o celular manda depois do pareamento. Mídia vira metadado (tipo, mime,
# tamanho, nome); nada é baixado sozinho. Escrito contra a API do neonize 0.10.0 (`requirements.txt`); os testes trocam
# o módulo `neonize` por um substituto, então o caminho real só roda no Mac de quem instalou e pareou.
#
# Contrato 32: a foto de perfil da conversa (`photo`), pelo `get_profile_picture` do neonize e o endereço que ele
# devolve (só `https://*.whatsapp.net`, sem seguir redirecionamento), guardada em `<data-dir>/photos/` por 7 dias. Foto acima de 512 KB, sem foto
# ou falha: `None` (o app mostra as iniciais).
#
# Contrato 37: imagem, vídeo e áudio guardam a mensagem do WhatsApp serializada (`mediaProto`, com as chaves do
# download) e o áudio, a duração; `download_media` reconstrói a mensagem e baixa pelo `download_any` do neonize, só
# quando a pessoa clica no app. `DownloadError` (endereço expirado, arquivo apagado e também falha passageira, que o
# whatsmeow não distingue) vira `MediaGone`; o app mostra o aviso e deixa clicar de novo.
import base64
import hashlib
import json
import os
import threading
import time
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from bridge_store import DOWNLOADABLE_KINDS, MediaGone, to_ms

# Motivos de `ConnectFailure` do whatsmeow: 402 é a suspensão temporária; 401, 403 e 406 são sessão encerrada.
TEMP_BANNED = 402
LOGGED_OUT = (401, 403, 406)
# Foto de perfil (contrato 32): até 512 KB, guardada por 7 dias; "sem foto" vale por 1 dia (a pessoa pode pôr uma).
PHOTO_MAX = 512 * 1024
PHOTO_TTL_S = 7 * 24 * 3600
NO_PHOTO_TTL_S = 24 * 3600
PHOTO_TIMEOUT_S = 10
PHOTO_DIR = 'photos'


def image_mime(data):
    """O tipo da imagem pelos primeiros bytes (JPEG, PNG ou WebP); `None` para qualquer outra coisa."""
    if data[:3] == b'\xff\xd8\xff':
        return 'image/jpeg'
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return 'image/png'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    return None


def photo_data_url(data):
    """A imagem como data URL, se for JPEG/PNG/WebP de até 512 KB; senão `None`."""
    if not data or len(data) > PHOTO_MAX:
        return None
    mime = image_mime(data)
    if mime is None:
        return None
    return f'data:{mime};base64,{base64.b64encode(data).decode("ascii")}'


class NoRedirect(HTTPRedirectHandler):
    """Não segue redirecionamento nenhum: o 3xx vira erro (a foto fica `None`), e o pedido nunca sai de `*.whatsapp.net`."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: PLR0913 - assinatura da base
        return None


# Sem o tratador de redirecionamento padrão do urllib.
PHOTO_OPENER = build_opener(NoRedirect)


def whatsapp_https(url):
    parts = urlsplit(url or '')
    host = (parts.hostname or '').lower()
    return parts.scheme == 'https' and (host == 'whatsapp.net' or host.endswith('.whatsapp.net'))


def fetch_photo(url):
    """Baixa a foto do endereço que o WhatsApp deu: só https em `*.whatsapp.net`, sem seguir redirecionamento, até
    512 KB (maior é `None`)."""
    if not whatsapp_https(url):
        return None
    with PHOTO_OPENER.open(Request(url, headers={'User-Agent': 'whatsapp-bridge'}), timeout=PHOTO_TIMEOUT_S) as response:  # https conferido acima
        data = response.read(PHOTO_MAX + 1)
    return data if len(data) <= PHOTO_MAX else None


def jid_text(jid):
    if jid is None or not getattr(jid, 'User', ''):
        return ''
    return f'{jid.User}@{jid.Server}'


def contact_name(info):
    """O nome que a pessoa salvou na agenda; senão o nome que o contato mostra no WhatsApp."""
    if info is None:
        return ''
    if getattr(info, 'Found', True) is False:
        return ''
    return getattr(info, 'FullName', '') or getattr(info, 'FirstName', '') or getattr(info, 'PushName', '') or getattr(info, 'BusinessName', '') or ''


def media_of(message):
    """(tipo, texto, mídia) de uma mensagem do WhatsApp (`waE2E.Message`)."""
    if message is None:
        return 'other', '', None
    if getattr(message, 'conversation', ''):
        return 'text', message.conversation, None
    has = getattr(message, 'HasField', None)

    def present(field):
        try:
            return bool(has and has(field))
        except ValueError:
            return False

    if present('extendedTextMessage'):
        return 'text', message.extendedTextMessage.text, None
    for field, kind in (('imageMessage', 'image'), ('videoMessage', 'video'), ('audioMessage', 'audio'), ('documentMessage', 'document'), ('stickerMessage', 'sticker')):
        if present(field):
            part = getattr(message, field)
            caption = getattr(part, 'caption', '') or ''
            name = getattr(part, 'fileName', '') or getattr(part, 'title', '') or None
            size = getattr(part, 'fileLength', 0) or None
            media = {'kind': kind, 'mime': getattr(part, 'mimetype', '') or None, 'size': int(size) if size else None, 'name': name}
            seconds = getattr(part, 'seconds', 0) if kind == 'audio' else 0
            if isinstance(seconds, int) and seconds > 0:
                media['seconds'] = seconds
            return kind, caption, media
    return 'other', '', {'kind': 'other', 'mime': None, 'size': None, 'name': None}


def media_proto(kind, message):
    """Contrato 37: a mensagem serializada (as chaves do download) da imagem, do vídeo ou do áudio; senão `None`."""
    if kind not in DOWNLOADABLE_KINDS or message is None:
        return None
    serialize = getattr(message, 'SerializeToString', None)
    if serialize is None:
        return None
    try:
        data = serialize()
    except Exception:  # noqa: BLE001 - sem as chaves, a mensagem fica sem download
        return None
    return data if isinstance(data, (bytes, bytearray)) and data else None


def with_proto(message, kind, source):
    """A mensagem do serviço com `mediaProto`, quando há o que baixar."""
    proto = media_proto(kind, source)
    if proto is not None:
        message['mediaProto'] = bytes(proto)
    return message


class NeonizeBackend:
    def __init__(self, data_dir):
        self.data_dir = data_dir
        self.client = None
        self.bridge = None
        self.names = {}
        self.thread = None
        self.contacts = {}
        # Contrato 25: o número das conversas `@lid` (o cartão do Assistente mostra o número, não só o nome).
        self.phones = {}
        self.timers = []
        # Contrato 32: quem baixa a foto (os testes trocam) e o relógio da validade do cache.
        self.fetch = fetch_photo
        self.clock = time.time
        self.photo_lock = threading.Lock()

    def start(self, bridge):
        from neonize.client import NewClient
        from neonize.events import (
            ConnectedEv,
            ConnectFailureEv,
            DisconnectedEv,
            HistorySyncEv,
            LoggedOutEv,
            MessageEv,
            PairStatusEv,
            TemporaryBanEv,
        )

        self.bridge = bridge
        client = NewClient(os.path.join(self.data_dir, 'session.sqlite3'))
        self.client = client

        def on_qr(_client, data):
            bridge.on_qr(data.decode('utf-8', 'replace') if isinstance(data, (bytes, bytearray)) else str(data))

        client.qr(on_qr)

        @client.event(ConnectedEv)
        def on_connected(_client, _event):
            bridge.on_state('connected', self.me())
            # A agenda de contatos chega aos poucos depois de conectar: procura os nomes algumas vezes.
            for delay in (5, 30, 120):
                self.later(delay, self.refresh_names)

        @client.event(PairStatusEv)
        def on_pair(_client, event):
            if getattr(event, 'Error', ''):
                bridge.on_state('pairing')

        @client.event(LoggedOutEv)
        def on_logged_out(_client, _event):
            bridge.on_state('disconnected')

        @client.event(DisconnectedEv)
        def on_disconnected(_client, _event):
            bridge.on_state('disconnected')

        @client.event(TemporaryBanEv)
        def on_ban(_client, _event):
            bridge.on_state('banned')

        @client.event(ConnectFailureEv)
        def on_failure(_client, event):
            reason = int(getattr(event, 'Reason', 0) or 0)
            bridge.on_state('banned' if reason == TEMP_BANNED else 'disconnected')

        @client.event(MessageEv)
        def on_message(_client, event):
            message = self.from_event(event)
            if message:
                bridge.on_message(message)

        @client.event(HistorySyncEv)
        def on_history(_client, event):
            messages = self.from_history(event)
            if hasattr(bridge, 'on_history'):
                bridge.on_history(messages)
            else:
                for message in messages:
                    bridge.on_message(message, count_unread=False)
            self.later(3, self.refresh_names)

        bridge.on_state('pairing')
        # `connect` só volta quando o cliente para: roda numa linha à parte.
        self.thread = threading.Thread(target=client.connect, name='neonize', daemon=True)
        self.thread.start()

    def later(self, delay, job):
        timer = threading.Timer(delay, self.safe, args=(job,))
        timer.daemon = True
        timer.start()
        self.timers = [t for t in self.timers if t.is_alive()] + [timer]

    @staticmethod
    def safe(job):
        try:
            job()
        except Exception:  # noqa: BLE001
            pass

    def stop(self):
        for timer in self.timers:
            timer.cancel()
        if self.client is not None:
            try:
                self.client.disconnect()
            except Exception:  # noqa: BLE001
                pass

    def me(self):
        try:
            device = self.client.get_me()
        except Exception:  # noqa: BLE001
            return None
        user = getattr(getattr(device, 'JID', None), 'User', '')
        return {'name': getattr(device, 'PushName', '') or '', 'phone': f'+{user}' if user else ''}

    def pair_phone(self, phone):
        return self.client.PairPhone(phone, show_push_notification=True)

    def logout(self):
        if self.client is not None:
            self.client.logout()

    def send_text(self, chat_id, text):
        from neonize.utils import build_jid

        user, server = chat_id.split('@', 1)
        response = self.client.send_message(build_jid(user, server), text)
        return getattr(response, 'ID', '') or ''

    def download_media(self, kind, proto):
        """Contrato 37: os bytes da mídia, pela mensagem guardada. Expirada ou apagada no WhatsApp: `MediaGone`."""
        from neonize.exc import DownloadError
        from neonize.proto.waE2E.WAWebProtobufsE2E_pb2 import Message

        if self.client is None:
            raise RuntimeError('sem cliente')
        message = Message.FromString(proto)
        try:
            return self.client.download_any(message)
        except DownloadError as error:
            raise MediaGone() from error

    def lookup_name(self, chat_id, chat_jid=None, group=None):
        """Nome de verdade da conversa: o do grupo ou o da agenda de contatos (também para ids `@lid`, pelo número).
        Vazio quando ainda não se sabe; nunca devolve o número como nome."""
        from neonize.utils import build_jid

        user, _, server = chat_id.partition('@')
        group = server == 'g.us' if group is None else group
        if chat_jid is None:
            chat_jid = build_jid(user, server)
        try:
            if group:
                return self.client.get_group_info(chat_jid).GroupName.Name or ''
            targets = [chat_jid]
            if server == 'lid':
                try:
                    phone = self.client.get_pn_from_lid(chat_jid)
                    if getattr(phone, 'User', ''):
                        targets.insert(0, phone)
                except Exception:  # noqa: BLE001
                    pass
            for target in targets:
                known = self.contacts.get(jid_text(target))
                if known:
                    return known
                contact = self.client.contact.get_contact(target)
                name = contact_name(contact)
                if name:
                    return name
        except Exception:  # noqa: BLE001
            return ''
        return ''

    def phone_for(self, chat_id):
        """Número de uma conversa `@lid` (`+5511…`), pelo `get_pn_from_lid`; vazio quando o WhatsApp não diz."""
        if chat_id in self.phones:
            return self.phones[chat_id]
        user, _, server = chat_id.partition('@')
        if server != 'lid' or self.client is None:
            return ''
        phone = ''
        try:
            from neonize.utils import build_jid

            found = self.client.get_pn_from_lid(build_jid(user, server))
            digits = getattr(found, 'User', '') or ''
            phone = f'+{digits}' if digits.isdigit() else ''
        except Exception:  # noqa: BLE001
            phone = ''
        if phone:
            self.phones[chat_id] = phone
        return phone

    def _photo_file(self, chat_id):
        digest = hashlib.sha256(chat_id.encode('utf-8')).hexdigest()[:32]
        return os.path.join(self.data_dir, PHOTO_DIR, f'{digest}.json')

    def _cached_photo(self, path):
        """(achou, foto) do cache em disco: vale 7 dias (sem foto, 1 dia); arquivo estragado não vale."""
        try:
            with open(path, encoding='utf-8') as handle:
                saved = json.load(handle)
            at = float(saved['at'])
            photo = saved['photo']
        except (OSError, ValueError, KeyError, TypeError):
            return False, None
        if photo is not None and not (isinstance(photo, str) and photo.startswith('data:image/')):
            return False, None
        ttl = PHOTO_TTL_S if photo else NO_PHOTO_TTL_S
        if self.clock() - at > ttl:
            return False, None
        return True, photo

    def _save_photo(self, path, photo):
        os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
        temp = f'{path}.tmp-{os.getpid()}-{threading.get_ident()}'
        with open(temp, 'w', encoding='utf-8') as handle:
            json.dump({'at': self.clock(), 'photo': photo}, handle)
        os.chmod(temp, 0o600)
        os.replace(temp, path)

    def photo(self, chat_id):
        """Foto de perfil da pessoa ou do grupo como data URL, ou `None` (sem foto, grande demais ou falha)."""
        if self.client is None:
            return None
        path = self._photo_file(chat_id)
        with self.photo_lock:
            found, photo = self._cached_photo(path)
        if found:
            return photo
        try:
            from neonize.utils import build_jid

            user, _, server = chat_id.partition('@')
            info = self.client.get_profile_picture(build_jid(user, server))
            url = getattr(info, 'URL', '') or ''
            photo = photo_data_url(self.fetch(url)) if url else None
        except Exception:  # noqa: BLE001 - falha (rede, privacidade): sem foto agora, tenta de novo depois
            return None
        with self.photo_lock:
            try:
                self._save_photo(path, photo)
            except OSError:
                pass
        return photo

    def chat_name(self, chat_id, chat_jid, group, fallback):
        """Nome da conversa para a mensagem: o achado (guardado) ou o que veio na mensagem; `None` se nenhum."""
        if chat_id in self.names:
            return self.names[chat_id]
        name = self.lookup_name(chat_id, chat_jid, group)
        if name:
            self.names[chat_id] = name
            return name
        return fallback or None

    def refresh_names(self):
        """Dá nome às conversas que ainda aparecem só com o número: agenda de contatos e informações dos grupos."""
        if self.client is None or self.bridge is None or not hasattr(self.bridge, 'unnamed_chats'):
            return
        try:
            for item in self.client.contact.get_all_contacts():
                name = contact_name(item.Info)
                if name:
                    self.contacts[jid_text(item.JID)] = name
        except Exception:  # noqa: BLE001
            pass
        found = {}
        for chat_id, _kind in self.bridge.unnamed_chats():
            name = self.lookup_name(chat_id)
            if name:
                self.names[chat_id] = name
                found[chat_id] = name
        if found:
            self.bridge.on_names(found)

    def from_event(self, event):
        info = event.Info
        source = info.MessageSource
        chat_id = jid_text(source.Chat)
        if not chat_id or chat_id.endswith('@broadcast'):
            return None
        kind, text, media = media_of(event.Message)
        group = bool(source.IsGroup)
        me = self.bridge.health().get('me') or {}
        author = (me.get('name') or 'Você') if source.IsFromMe else (info.Pushname or jid_text(source.Sender).split('@')[0])
        message = {
            'id': info.ID,
            'chatId': chat_id,
            # O nome de quem mandou só vale para a conversa quando não é você (senão a conversa ganharia o seu nome).
            'chatName': self.chat_name(chat_id, source.Chat, group, None if group or source.IsFromMe else info.Pushname),
            'chatKind': 'group' if group else 'person',
            'author': author,
            'fromMe': bool(source.IsFromMe),
            'at': to_ms(info.Timestamp),
            'type': kind,
            'text': text,
            'media': media,
        }
        return with_proto(message, kind, event.Message)

    def from_history(self, event):
        data = getattr(event, 'Data', None)
        if data is None:
            return []
        result = []
        for conversation in getattr(data, 'conversations', []):
            chat_id = conversation.ID
            if not chat_id or chat_id.endswith('@broadcast') or chat_id.endswith('@newsletter'):
                continue
            group = chat_id.endswith('@g.us')
            name = getattr(conversation, 'name', '') or getattr(conversation, 'displayName', '')
            if name:
                self.names.setdefault(chat_id, name)
            for item in getattr(conversation, 'messages', []):
                web = item.message
                kind, text, media = media_of(web.message)
                from_me = bool(web.key.fromMe)
                author = 'Você' if from_me else (web.pushName or (web.participant or web.key.participant or chat_id).split('@')[0])
                message = {
                    'id': web.key.ID,
                    'chatId': chat_id,
                    'chatName': name or None,
                    'chatKind': 'group' if group else 'person',
                    'author': author,
                    'fromMe': from_me,
                    'at': to_ms(web.messageTimestamp),
                    'type': kind,
                    'text': text,
                    'media': media,
                }
                result.append(with_proto(message, kind, web.message))
        return result
