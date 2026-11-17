# Cliente do WhatsApp pelo neonize (biblioteca Python sobre o whatsmeow, cliente NÃO OFICIAL do WhatsApp
# multi-dispositivo). Traduz os eventos do neonize para o serviço: QR, conectado, desconectado, número bloqueado,
# mensagens novas e o histórico que o celular manda depois do pareamento. Mídia vira só metadado (tipo, mime,
# tamanho, nome); nada é baixado. Escrito contra a API do neonize 0.10.0 (`requirements.txt`); os testes trocam
# o módulo `neonize` por um substituto, então o caminho real só roda no Mac de quem instalou e pareou.
import os
import threading

from bridge_store import to_ms

# Motivos de `ConnectFailure` do whatsmeow: 402 é a suspensão temporária; 401, 403 e 406 são sessão encerrada.
TEMP_BANNED = 402
LOGGED_OUT = (401, 403, 406)


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
            return kind, caption, {'kind': kind, 'mime': getattr(part, 'mimetype', '') or None, 'size': int(size) if size else None, 'name': name}
    return 'other', '', {'kind': 'other', 'mime': None, 'size': None, 'name': None}


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
        return {
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
                result.append(
                    {
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
                )
        return result
