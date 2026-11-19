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
#
# Contrato 39: `send_media` envia imagem ou vídeo pelo `send_message`; a mensagem montada volta serializada para o eco do
# serviço baixar depois, como uma recebida. A imagem sai do `build_image_message` do neonize (só bytes locais e o PIL). O
# vídeo NÃO usa o `build_video_message`: quando a miniatura falha, ele baixa uma imagem da Wikimedia (um destino de rede
# fora do WhatsApp). Aqui a duração e a miniatura saem do ffprobe e do ffmpeg locais, num arquivo temporário 0600 da pasta
# de dados, e o VideoMessage é montado à mão com o `upload` do neonize; miniatura que falha vai sem miniatura, nunca pela
# rede. Sem o ffmpeg ou o ffprobe, `MissingFfmpeg` (o app explica como instalar).
#
# Contrato 34: a mensagem que responde outra traz o id e o trecho da citada (o `contextInfo` do `waE2E.Message`) e o id de
# quem mandou (`sender`). A reação chega como uma mensagem (`reactionMessage`, com o id da reagida; texto vazio é "tirou") e
# vira `on_reaction`, nunca mensagem; no histórico, também pelas `reactions` de cada mensagem. "Digitando…" chega pelo
# `ChatPresenceEv` e vira `on_presence`. Enviar: a resposta é um ExtendedTextMessage com o `contextInfo` montado aqui (o id,
# quem mandou e a mensagem citada, refeita do que ficou guardado); a reação, pelo `build_reaction`; a presença, pelo
# `send_chat_presence` (só quando o app pede, com o interruptor ligado). O "digitando…" dos outros pode não chegar enquanto a
# conta não estiver marcada como disponível; o serviço não marca (isso muda o "online" e as notificações do celular).
import base64
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from bridge_store import DOWNLOADABLE_KINDS, REACTION_ME, MediaGone, MissingFfmpeg, reply_preview_of, to_ms

# Motivos de `ConnectFailure` do whatsmeow: 402 é a suspensão temporária; 401, 403 e 406 são sessão encerrada.
TEMP_BANNED = 402
LOGGED_OUT = (401, 403, 406)
# Foto de perfil (contrato 32): até 512 KB, guardada por 7 dias; "sem foto" vale por 1 dia (a pessoa pode pôr uma).
PHOTO_MAX = 512 * 1024
PHOTO_TTL_S = 7 * 24 * 3600
NO_PHOTO_TTL_S = 24 * 3600
PHOTO_TIMEOUT_S = 10
PHOTO_DIR = 'photos'
# Contrato 39: o ffmpeg e o ffprobe do PATH ou do Homebrew (o app aberto pelo Finder tem um PATH curto).
FFMPEG_DIRS = ('/opt/homebrew/bin', '/usr/local/bin')
FFMPEG_TIMEOUT_S = 60
VIDEO_THUMB_MAX = 64 * 1024


def find_tool(name):
    """O caminho do ffmpeg ou do ffprobe, ou `None`."""
    found = shutil.which(name)
    if found:
        return found
    for folder in FFMPEG_DIRS:
        path = os.path.join(folder, name)
        if os.access(path, os.X_OK):
            return path
    return None


def run_tool(args):
    """Roda o ffmpeg/ffprobe sem shell, com prazo; a saída em bytes, ou `None` na falha."""
    try:
        done = subprocess.run(args, capture_output=True, timeout=FFMPEG_TIMEOUT_S, check=False)  # noqa: S603 - caminho e argumentos fixos
    except (OSError, subprocess.TimeoutExpired):
        return None
    return done.stdout if done.returncode == 0 else None


def video_details(data, folder):
    """(segundos, miniatura JPEG ou `None`) do vídeo, pelo ffprobe e pelo ffmpeg locais. Sem eles, `MissingFfmpeg`."""
    ffmpeg, ffprobe = find_tool('ffmpeg'), find_tool('ffprobe')
    if not ffmpeg or not ffprobe:
        raise MissingFfmpeg()
    handle, path = tempfile.mkstemp(prefix='envio-', suffix='.bin', dir=folder)
    try:
        with os.fdopen(handle, 'wb') as file:
            file.write(data)
        os.chmod(path, 0o600)
        probed = run_tool([ffprobe, '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path])
        try:
            seconds = max(0, int(float((probed or b'').decode('ascii', 'replace').strip() or 0)))
        except ValueError:
            seconds = 0
        thumb = run_tool([ffmpeg, '-v', 'error', '-i', path, '-frames:v', '1', '-vf', 'scale=200:-2', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1'])
        if not thumb or thumb[:3] != b'\xff\xd8\xff' or len(thumb) > VIDEO_THUMB_MAX:
            thumb = None
        return seconds, thumb
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


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


def _present(message, field):
    has = getattr(message, 'HasField', None)
    try:
        return bool(has and has(field))
    except ValueError:
        return False


CONTEXT_FIELDS = ('extendedTextMessage', 'imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage')


def reply_of(message):
    """Contrato 34: `(id da citada, trecho)` quando a mensagem responde outra; senão `(None, '')`."""
    if message is None:
        return None, ''
    for field in CONTEXT_FIELDS:
        if not _present(message, field):
            continue
        part = getattr(message, field)
        if not _present(part, 'contextInfo'):
            return None, ''
        context = part.contextInfo
        stanza = getattr(context, 'stanzaID', '') or ''
        if not stanza:
            return None, ''
        quoted = context.quotedMessage if _present(context, 'quotedMessage') else None
        kind, text, _media = media_of(quoted) if quoted is not None else ('text', '', None)
        return stanza[:200], reply_preview_of(kind, text)
    return None, ''


def reaction_of(message):
    """Contrato 34: `(id da mensagem reagida, emoji, hora em ms)` de um `reactionMessage`; senão `None`."""
    if message is None or not _present(message, 'reactionMessage'):
        return None
    reaction = message.reactionMessage
    target = getattr(getattr(reaction, 'key', None), 'ID', '') or ''
    if not target:
        return None
    at = getattr(reaction, 'senderTimestampMS', 0) or 0
    return target, getattr(reaction, 'text', '') or '', to_ms(at) if at else None


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
            ChatPresenceEv,
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
            # Contrato 34: a reação não é mensagem nova.
            reaction = self.reaction_from_event(event)
            if reaction is not None:
                if hasattr(bridge, 'on_reaction'):
                    bridge.on_reaction(*reaction)
                return
            message = self.from_event(event)
            if message:
                bridge.on_message(message)

        @client.event(HistorySyncEv)
        def on_history(_client, event):
            reactions = []
            messages = self.from_history(event, reactions)
            if hasattr(bridge, 'on_history'):
                bridge.on_history(messages)
            else:
                for message in messages:
                    bridge.on_message(message, count_unread=False)
            if reactions and hasattr(bridge, 'on_reactions'):
                bridge.on_reactions(reactions)
            self.later(3, self.refresh_names)

        @client.event(ChatPresenceEv)
        def on_presence(_client, event):
            presence = self.presence_from_event(event)
            if presence is not None and hasattr(bridge, 'on_presence'):
                bridge.on_presence(*presence)

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

    def send_text(self, chat_id, text, quote=None):
        """Envia o texto; com `quote` (contrato 34, a mensagem guardada), como resposta citando ela."""
        from neonize.utils import build_jid

        user, server = chat_id.split('@', 1)
        message = self.reply_message(chat_id, text, quote) if quote else text
        response = self.client.send_message(build_jid(user, server), message)
        return getattr(response, 'ID', '') or ''

    def own_jid(self):
        try:
            return jid_text(getattr(self.client.get_me(), 'JID', None))
        except Exception:  # noqa: BLE001
            return ''

    def author_jid(self, chat_id, target):
        """Contrato 34: quem mandou a mensagem citada ou reagida: você, a outra pessoa (conversa a dois) ou o do grupo."""
        if target.get('fromMe'):
            return self.own_jid()
        if chat_id.endswith('@g.us'):
            return target.get('sender') or ''
        return target.get('sender') or chat_id

    def reply_message(self, chat_id, text, quote):
        """Contrato 34: o ExtendedTextMessage que cita a mensagem guardada (o id, quem mandou e ela refeita)."""
        from neonize.proto.waE2E.WAWebProtobufsE2E_pb2 import ContextInfo, ExtendedTextMessage, Message

        quoted = None
        if quote.get('proto'):
            try:
                quoted = Message.FromString(quote['proto'])
            except Exception:  # noqa: BLE001 - sem a mídia refeita, cita o texto
                quoted = None
        if quoted is None:
            quoted = Message(conversation=quote.get('text') or reply_preview_of(quote.get('kind'), ''))
        context = ContextInfo(stanzaID=quote['id'], participant=self.author_jid(chat_id, quote), quotedMessage=quoted)
        return Message(extendedTextMessage=ExtendedTextMessage(text=text, contextInfo=context))

    def send_reaction(self, chat_id, target, emoji):
        """Contrato 34: reage à mensagem guardada (emoji vazio tira a sua reação)."""
        from neonize.utils import build_jid

        user, server = chat_id.split('@', 1)
        chat = build_jid(user, server)
        sender_user, _, sender_server = self.author_jid(chat_id, target).partition('@')
        message = self.client.build_reaction(chat, build_jid(sender_user, sender_server or 's.whatsapp.net'), target['id'], emoji)
        self.client.send_message(chat, message)

    def send_presence(self, chat_id, state):
        """Contrato 34: "digitando…" (`composing`) ou "parou" (`paused`) na conversa. Não é mensagem."""
        from neonize.utils import build_jid
        from neonize.utils.enum import ChatPresence, ChatPresenceMedia

        user, server = chat_id.split('@', 1)
        value = ChatPresence.CHAT_PRESENCE_COMPOSING if state == 'composing' else ChatPresence.CHAT_PRESENCE_PAUSED
        self.client.send_chat_presence(build_jid(user, server), value, ChatPresenceMedia.CHAT_PRESENCE_MEDIA_TEXT)

    def send_media(self, chat_id, kind, mime, data, caption, name):
        """Contrato 39: envia a imagem ou o vídeo com a legenda; `(id, mensagem serializada)`."""
        from neonize.utils import build_jid

        user, server = chat_id.split('@', 1)
        message = self.video_message(bytes(data), mime, caption) if kind == 'video' else self.client.build_image_message(bytes(data), caption or None)
        response = self.client.send_message(build_jid(user, server), message)
        return getattr(response, 'ID', '') or '', media_proto(kind, message)

    def video_message(self, data, mime, caption):
        """Contrato 39: o VideoMessage montado aqui (sem o `build_video_message`, que pode ir à rede pela miniatura)."""
        from neonize.proto.waE2E.WAWebProtobufsE2E_pb2 import Message, VideoMessage
        from neonize.utils.enum import MediaType

        seconds, thumb = video_details(data, self.data_dir)
        upload = self.client.upload(data, MediaType.MediaVideo)
        fields = {
            'URL': upload.url,
            'directPath': upload.DirectPath,
            'fileEncSHA256': upload.FileEncSHA256,
            'fileLength': upload.FileLength,
            'fileSHA256': upload.FileSHA256,
            'mediaKey': upload.MediaKey,
            'mimetype': mime,
            'seconds': seconds,
        }
        if caption:
            fields['caption'] = caption
        if thumb:
            fields['JPEGThumbnail'] = thumb
        return Message(videoMessage=VideoMessage(**fields))

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

    def reaction_from_event(self, event):
        """Contrato 34: `(conversa, mensagem reagida, autor, emoji, hora)` quando o evento é uma reação; senão `None`."""
        found = reaction_of(getattr(event, 'Message', None))
        if found is None:
            return None
        source = event.Info.MessageSource
        chat_id = jid_text(source.Chat)
        if not chat_id or chat_id.endswith('@broadcast'):
            return None
        target, emoji, at = found
        author = REACTION_ME if source.IsFromMe else (jid_text(source.Sender) or chat_id)
        return chat_id, target, author, emoji, at or to_ms(event.Info.Timestamp)

    def presence_from_event(self, event):
        """Contrato 34: `(conversa, 'composing' | 'paused', nome de quem digita num grupo ou None)`; o seu fica de fora."""
        source = getattr(event, 'MessageSource', None)
        if source is None or getattr(source, 'IsFromMe', False):
            return None
        chat_id = jid_text(source.Chat)
        state = {1: 'composing', 2: 'paused'}.get(int(getattr(event, 'State', 0) or 0))
        if not chat_id or state is None or chat_id.endswith('@broadcast'):
            return None
        author = None
        if getattr(source, 'IsGroup', False):
            sender = jid_text(source.Sender)
            author = self.contacts.get(sender) or None
            if author is None and sender:
                try:
                    author = contact_name(self.client.contact.get_contact(source.Sender)) or None
                except Exception:  # noqa: BLE001 - sem o nome, só "digitando…"
                    author = None
        return chat_id, state, author

    def from_event(self, event):
        info = event.Info
        source = info.MessageSource
        chat_id = jid_text(source.Chat)
        if not chat_id or chat_id.endswith('@broadcast'):
            return None
        if reaction_of(event.Message) is not None:
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
        # Contrato 34: quem mandou e a citação, quando há.
        sender = jid_text(source.Sender)
        if sender:
            message['sender'] = sender
        reply_to, preview = reply_of(event.Message)
        if reply_to:
            message['replyToId'] = reply_to
            message['replyPreview'] = preview
        return with_proto(message, kind, event.Message)

    def from_history(self, event, reactions=None):
        """As mensagens do histórico; com `reactions` (uma lista), junta nela as reações (contrato 34)."""
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
                from_me = bool(web.key.fromMe)
                participant = web.participant or web.key.participant or ''
                # Contrato 34: a reação que veio como mensagem, e as reações guardadas em cada mensagem.
                found = reaction_of(web.message)
                if found is not None:
                    if reactions is not None:
                        target, emoji, at = found
                        reactions.append((chat_id, target, REACTION_ME if from_me else (participant or chat_id), emoji, at or to_ms(web.messageTimestamp)))
                    continue
                if reactions is not None:
                    for reaction in getattr(web, 'reactions', None) or []:
                        key = reaction.key
                        author = REACTION_ME if key.fromMe else (key.participant or key.remoteJID or chat_id)
                        at = getattr(reaction, 'senderTimestampMS', 0) or 0
                        reactions.append((chat_id, web.key.ID, author, reaction.text or '', to_ms(at) if at else None))
                kind, text, media = media_of(web.message)
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
                if participant or not group:
                    message['sender'] = participant or ('' if from_me else chat_id)
                reply_to, preview = reply_of(web.message)
                if reply_to:
                    message['replyToId'] = reply_to
                    message['replyPreview'] = preview
                result.append(with_proto(message, kind, web.message))
        return result
