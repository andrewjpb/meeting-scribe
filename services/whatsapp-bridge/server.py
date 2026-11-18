#!/usr/bin/env python3
# Serviço local do WhatsApp do LAP Reuniões (contrato 24, CA1). Cliente NÃO OFICIAL (neonize/whatsmeow): o
# WhatsApp pode suspender ou bloquear o número. Escuta só em 127.0.0.1, numa porta livre, e toda rota exige
# `Authorization: Bearer <token>`, com o token lido de um arquivo 0600 criado pelo app. A sessão e as mensagens
# ficam em `--data-dir` (no `userData` do app), nunca no repositório. O serviço não manda nada sozinho: a única
# rota que envia é `POST /chats/:id/send`, e o app só a chama depois do clique da pessoa.
#
# Contrato 37: `GET /chats/:id/messages/:msg/media` baixa a imagem, o vídeo ou o áudio de uma mensagem, só quando o
# app pede (no clique da pessoa), e responde os bytes (não JSON). Guarda em `<data-dir>/media/` por 7 dias.
#
# Ao subir, escreve uma linha JSON no stdout: {"event": "ready", "port": N, "version": "..."}. Logs vão para o
# stderr e nunca levam texto de mensagem.
import argparse
import hashlib
import hmac
import json
import os
import queue
import re
import shutil
import signal
import stat
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

# O app roda com `python -I` (sem a pasta atual nem variáveis do Python no caminho): os módulos do serviço vêm
# só da pasta deste arquivo.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bridge_store import MediaGone, Store, now_ms, public_message  # noqa: E402

VERSION = '0.1.0'
HOST = '127.0.0.1'
STATES = ('pairing', 'connected', 'disconnected', 'banned')
SEND_TEXT_MAX = 4096
BODY_MAX = 64 * 1024
SSE_PING_S = 15
# Contrato 32: 512 KB de imagem em base64, com o cabeçalho do data URL.
PHOTO_URL_MAX = 700_000
CHAT_ID = re.compile(r'^[\w.+:-]{1,120}@[\w.-]{1,60}$')
MESSAGE_ID = re.compile(r'^[A-Za-z0-9_.:+-]{1,200}$')
PHONE = re.compile(r'^\d{8,15}$')
# Contrato 37: a mídia baixada no clique, até 64 MB, guardada por 7 dias em `media/`.
MEDIA_MAX = 64 * 1024 * 1024
MEDIA_TTL_S = 7 * 24 * 3600
MEDIA_DIR = 'media'
# `fullmatch`: o `$` aceitaria um `\n` no fim, e o mime vai para o cabeçalho da resposta.
MEDIA_MIME = re.compile(r'(audio|image|video)/[\w.+-]{1,60}(; ?[\w.+-]{1,40}=[\w.+"-]{1,40}){0,3}', re.ASCII)
MEDIA_DEFAULT_MIME = {'image': 'image/jpeg', 'video': 'video/mp4', 'audio': 'audio/ogg'}


def log(message):
    print(f'[whatsapp-bridge] {message}', file=sys.stderr, flush=True)


class Bridge:
    """Estado do serviço: conexão, conta, QR, banco e os ouvintes de `/events`."""

    def __init__(self, data_dir, backend):
        self.data_dir = data_dir
        self.backend = backend
        self.store = Store(os.path.join(data_dir, 'messages.db'))
        self.state = 'disconnected'
        self.me = None
        self.qr = None
        self.lock = threading.Lock()
        self.listeners = []
        # Contrato 37: um download por mensagem de cada vez (o segundo pedido espera e lê do disco). A geração sobe no
        # "Sair da conta": um download que termina depois não grava os bytes da conta que saiu.
        self.media_locks = {}
        self.media_save_lock = threading.Lock()
        self.media_generation = 0
        self.clock = time.time

    # Chamados pelo cliente do WhatsApp (neonize ou o falso).
    def on_state(self, state, me=None):
        if state not in STATES:
            return
        with self.lock:
            self.state = state
            if me is not None:
                self.me = me
            if state != 'pairing':
                self.qr = None
        self.publish('state', self.health())

    def on_qr(self, code):
        with self.lock:
            self.qr = code
            self.state = 'pairing'
        self.publish('state', self.health())

    def on_message(self, message, count_unread=True):
        if self.store.add_message(message, count_unread):
            self.publish('message', dict(public_message(message), chatName=(self.store.chat(message['chatId']) or {}).get('name')))

    def on_history(self, messages):
        """Histórico do celular: grava tudo de uma vez e avisa só "as conversas mudaram" (uma vez), em vez de uma
        mensagem por evento, que travava a tela com milhares de avisos logo depois do pareamento."""
        if self.store.add_messages(messages):
            self.publish('chats', {})

    def unnamed_chats(self):
        return self.store.unnamed_chats()

    def on_names(self, names):
        if self.store.set_names(names):
            self.publish('chats', {})

    def on_chat(self, chat_id, name=None, kind=None):
        self.store.upsert_chat(chat_id, name, kind)

    def health(self):
        with self.lock:
            return {'version': VERSION, 'state': self.state, 'me': self.me}

    def publish(self, event, data):
        with self.lock:
            listeners = list(self.listeners)
        for listener in listeners:
            # Fila cheia (o app não leu a tempo): descarta o aviso em vez de travar o cliente do WhatsApp.
            try:
                listener.put_nowait((event, data))
            except queue.Full:
                pass

    def subscribe(self):
        listener = queue.Queue(maxsize=1000)
        with self.lock:
            self.listeners.append(listener)
        return listener

    def unsubscribe(self, listener):
        with self.lock:
            if listener in self.listeners:
                self.listeners.remove(listener)

    def _media_file(self, chat_id, message_id):
        digest = hashlib.sha256(f'{chat_id}\n{message_id}'.encode('utf-8')).hexdigest()[:32]
        return os.path.join(self.data_dir, MEDIA_DIR, f'{digest}.bin')

    def _cached_media(self, path):
        try:
            if self.clock() - os.path.getmtime(path) > MEDIA_TTL_S:
                return None
            with open(path, 'rb') as handle:
                data = handle.read(MEDIA_MAX + 1)
        except OSError:
            return None
        return data if 0 < len(data) <= MEDIA_MAX else None

    def _save_media(self, path, data, generation):
        with self.media_save_lock:
            if generation != self.media_generation:
                return
            folder = os.path.dirname(path)
            os.makedirs(folder, mode=0o700, exist_ok=True)
            os.chmod(folder, 0o700)
            temp = f'{path}.tmp-{os.getpid()}-{threading.get_ident()}'
            with open(temp, 'wb') as handle:
                handle.write(data)
            os.chmod(temp, 0o600)
            os.replace(temp, path)
            # Os vencidos saem a cada gravação, com as travas deles.
            removed = []
            for name in os.listdir(folder):
                other = os.path.join(folder, name)
                try:
                    if other != path and self.clock() - os.path.getmtime(other) > MEDIA_TTL_S:
                        os.remove(other)
                        removed.append(other)
                except OSError:
                    pass
        with self.lock:
            for other in removed:
                lock = self.media_locks.get(other)
                if lock is not None and not lock.locked():
                    del self.media_locks[other]

    def media(self, chat_id, message_id):
        """
        Contrato 37: a mídia de uma mensagem, `('ok', mime, bytes)`, ou `(erro,)`: `missing` (sem as chaves do download),
        `too-big` (acima de 64 MB), `gone` (o WhatsApp não tem mais o arquivo) ou `failed`.
        """
        source = self.store.media_source(chat_id, message_id)
        if source is None:
            return ('missing',)
        kind, mime, size, proto = source
        mime = mime if isinstance(mime, str) and MEDIA_MIME.fullmatch(mime) and mime.startswith(f'{kind}/') else MEDIA_DEFAULT_MIME[kind]
        if isinstance(size, int) and size > MEDIA_MAX:
            return ('too-big',)
        path = self._media_file(chat_id, message_id)
        generation = self.media_generation
        with self.lock:
            key_lock = self.media_locks.setdefault(path, threading.Lock())
        with key_lock:
            data = self._cached_media(path)
            if data is not None:
                return ('ok', mime, data)
            download = getattr(self.backend, 'download_media', None)
            if download is None:
                return ('missing',)
            try:
                data = download(kind, proto)
            except MediaGone:
                return ('gone',)
            except Exception as error:  # noqa: BLE001 - falha do cliente vira resposta
                log(f'download da mídia falhou: {type(error).__name__}')
                return ('failed',)
            if not isinstance(data, (bytes, bytearray)) or not data:
                return ('gone',)
            if len(data) > MEDIA_MAX:
                return ('too-big',)
            try:
                self._save_media(path, bytes(data), generation)
            except OSError:
                pass
            return ('ok', mime, bytes(data))

    def logout(self):
        """Sai da conta e apaga a sessão e as mensagens guardadas."""
        # Contrato 37: um download em curso não grava mais nada (a gravação em andamento termina antes de apagar).
        with self.media_save_lock:
            self.media_generation += 1
        try:
            self.backend.logout()
        finally:
            self.store.close()
            for name in os.listdir(self.data_dir):
                path = os.path.join(self.data_dir, name)
                if os.path.isdir(path):
                    shutil.rmtree(path, ignore_errors=True)
                else:
                    os.remove(path)
            self.store = Store(os.path.join(self.data_dir, 'messages.db'))
            with self.lock:
                self.me = None
                self.qr = None
            self.on_state('disconnected')


def make_handler(bridge, token, instance_id=''):
    expected = f'Bearer {token}'.encode()

    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'
        server_version = 'whatsapp-bridge'
        sys_version = ''

        def log_message(self, format, *args):  # noqa: A002 - assinatura da base
            # Só método, caminho sem consulta e código: nunca texto de mensagem nem termo de busca.
            pass

        def send_json(self, status, body):
            data = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)

        def send_bytes(self, mime, data):
            # Contrato 37: bytes opacos com o tipo guardado; o navegador não adivinha outro tipo.
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(data)

        def has_token(self):
            given = (self.headers.get('Authorization') or '').encode()
            return hmac.compare_digest(given, expected)

        def authorized(self):
            if self.has_token():
                return True
            self.send_json(401, {'error': 'unauthorized'})
            return False

        def read_json(self):
            length = int(self.headers.get('Content-Length') or 0)
            if length <= 0:
                return {}
            if length > BODY_MAX:
                raise ValueError('corpo grande demais')
            body = json.loads(self.rfile.read(length).decode('utf-8'))
            if not isinstance(body, dict):
                raise ValueError('corpo inválido')
            return body

        def do_GET(self):
            url = urlsplit(self.path)
            # Sem token, `/health` só diz o id aleatório da instalação: o app confere que a porta salva é mesmo
            # deste serviço antes de mandar o token para ela.
            if url.path == '/health' and not self.has_token():
                return self.send_json(200, {'id': instance_id})
            if not self.authorized():
                return
            query = parse_qs(url.query)
            path = url.path
            if path == '/health':
                return self.send_json(200, dict(bridge.health(), id=instance_id, pid=os.getpid()))
            if path == '/pair':
                phone = (query.get('phone') or [''])[0]
                if phone:
                    if not PHONE.match(phone):
                        return self.send_json(400, {'error': 'phone'})
                    try:
                        return self.send_json(200, {'state': bridge.health()['state'], 'qr': None, 'code': bridge.backend.pair_phone(phone)})
                    except Exception as error:  # noqa: BLE001 - erro do cliente vira resposta
                        log(f'pareamento por número falhou: {type(error).__name__}')
                        return self.send_json(502, {'error': 'pair'})
                health = bridge.health()
                return self.send_json(200, {'state': health['state'], 'qr': bridge.qr, 'code': None})
            if path == '/chats':
                chats = bridge.store.chats()
                # Contrato 25: o número das conversas `@lid`, quando o cliente sabe (o neonize pelo `get_pn_from_lid`).
                phone_for = getattr(bridge.backend, 'phone_for', None)
                if phone_for is not None:
                    for chat in chats:
                        if chat['id'].endswith('@lid'):
                            phone = phone_for(chat['id'])
                            if phone:
                                chat['phone'] = phone
                return self.send_json(200, {'chats': chats})
            match = re.fullmatch(r'/chats/([^/]+)/messages', path)
            if match:
                chat_id = unquote(match.group(1))
                if not CHAT_ID.match(chat_id):
                    return self.send_json(400, {'error': 'chat'})
                try:
                    before = int(query['before'][0]) if 'before' in query else None
                    limit = int((query.get('limit') or ['50'])[0])
                except ValueError:
                    return self.send_json(400, {'error': 'query'})
                # Cursor (hora, id): mensagens no mesmo milissegundo não se perdem entre as páginas.
                before_id = (query.get('beforeId') or [None])[0]
                if before_id is not None and (before is None or len(before_id) > 200):
                    return self.send_json(400, {'error': 'query'})
                messages = bridge.store.messages(chat_id, before, limit, before_id)
                # Abrir a conversa zera as não lidas no app (nenhum recibo vai ao WhatsApp).
                if before is None:
                    bridge.store.set_unread(chat_id, 0)
                return self.send_json(200, {'messages': messages})
            # Contrato 37: a mídia de uma mensagem, só quando o app pede (o clique da pessoa).
            match = re.fullmatch(r'/chats/([^/]+)/messages/([^/]+)/media', path)
            if match:
                chat_id = unquote(match.group(1))
                message_id = unquote(match.group(2))
                if not CHAT_ID.match(chat_id) or not MESSAGE_ID.match(message_id):
                    return self.send_json(400, {'error': 'media'})
                result = bridge.media(chat_id, message_id)
                if result[0] == 'ok':
                    return self.send_bytes(result[1], result[2])
                status = {'missing': 404, 'too-big': 413, 'gone': 410}.get(result[0], 502)
                return self.send_json(status, {'error': result[0]})
            # Contrato 32: a foto de perfil da conversa como data URL (JPEG/PNG/WebP até 512 KB), ou `null`.
            match = re.fullmatch(r'/chats/([^/]+)/photo', path)
            if match:
                chat_id = unquote(match.group(1))
                if not CHAT_ID.match(chat_id):
                    return self.send_json(400, {'error': 'chat'})
                photo_of = getattr(bridge.backend, 'photo', None)
                try:
                    photo = photo_of(chat_id) if photo_of is not None else None
                except Exception as error:  # noqa: BLE001 - sem foto em vez de erro
                    log(f'foto de perfil falhou: {type(error).__name__}')
                    photo = None
                if not isinstance(photo, str) or not photo.startswith('data:image/') or len(photo) > PHOTO_URL_MAX:
                    photo = None
                return self.send_json(200, {'photo': photo})
            if path == '/search':
                term = (query.get('q') or [''])[0].strip()
                if len(term) < 2 or len(term) > 100:
                    return self.send_json(400, {'error': 'query'})
                return self.send_json(200, {'messages': bridge.store.search(term)})
            if path == '/events':
                return self.events()
            return self.send_json(404, {'error': 'not-found'})

        def do_POST(self):
            if not self.authorized():
                return
            path = urlsplit(self.path).path
            try:
                body = self.read_json()
            except (ValueError, UnicodeDecodeError):
                return self.send_json(400, {'error': 'body'})
            if path == '/logout':
                try:
                    bridge.logout()
                except Exception as error:  # noqa: BLE001
                    log(f'sair da conta falhou: {type(error).__name__}')
                return self.send_json(200, bridge.health())
            match = re.fullmatch(r'/chats/([^/]+)/send', path)
            if match:
                chat_id = unquote(match.group(1))
                text = body.get('text')
                if not CHAT_ID.match(chat_id) or not isinstance(text, str) or not text.strip() or len(text) > SEND_TEXT_MAX:
                    return self.send_json(400, {'error': 'send'})
                if bridge.health()['state'] != 'connected':
                    return self.send_json(409, {'error': 'state'})
                try:
                    message_id = bridge.backend.send_text(chat_id, text)
                except Exception as error:  # noqa: BLE001
                    log(f'envio falhou: {type(error).__name__}')
                    return self.send_json(502, {'error': 'send'})
                me = bridge.health()['me'] or {}
                bridge.on_message(
                    {'id': message_id, 'chatId': chat_id, 'author': me.get('name') or 'Você', 'fromMe': True, 'at': now_ms(), 'type': 'text', 'text': text, 'media': None},
                    count_unread=False,
                )
                return self.send_json(200, {'id': message_id})
            # Só o serviço falso (smoke e testes): ler o QR, receber uma mensagem.
            control = getattr(bridge.backend, 'control', None)
            if path.startswith('/_fake/') and control is not None:
                return self.send_json(200, control(path[len('/_fake/'):], body))
            return self.send_json(404, {'error': 'not-found'})

        def events(self):
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Connection', 'close')
            self.end_headers()
            listener = bridge.subscribe()
            self.close_connection = True
            try:
                self.wfile.write(f'event: state\ndata: {json.dumps(bridge.health(), ensure_ascii=False)}\n\n'.encode())
                self.wfile.flush()
                while True:
                    try:
                        event, data = listener.get(timeout=SSE_PING_S)
                    except queue.Empty:
                        self.wfile.write(b': ping\n\n')
                    else:
                        self.wfile.write(f'event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n'.encode())
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                bridge.unsubscribe(listener)

    return Handler


def read_token(path):
    """O token do arquivo criado pelo app; recusa arquivo que outros usuários possam ler."""
    info = os.stat(path)
    if stat.S_IMODE(info.st_mode) & 0o077:
        raise SystemExit('arquivo do token com permissão aberta demais (precisa ser 0600)')
    token = open(path, encoding='utf-8').read().strip()
    if len(token) < 32:
        raise SystemExit('token curto demais')
    return token


def load_backend(name, data_dir):
    if name == 'fake':
        from backend_fake import FakeBackend

        return FakeBackend(data_dir)
    from backend_neonize import NeonizeBackend

    return NeonizeBackend(data_dir)


def main(argv=None):
    parser = argparse.ArgumentParser(description='Serviço local do WhatsApp (não oficial) do LAP Reuniões')
    parser.add_argument('--data-dir', required=True)
    parser.add_argument('--token-file', required=True)
    parser.add_argument('--backend', choices=('neonize', 'fake'), default='neonize')
    parser.add_argument('--port', type=int, default=0)
    parser.add_argument('--instance-id', default='')
    args = parser.parse_args(argv)
    # Tudo o que o serviço e o neonize criarem (sessão, banco, -wal, -shm) sai só para o dono.
    os.umask(0o077)
    os.makedirs(args.data_dir, mode=0o700, exist_ok=True)
    os.chmod(args.data_dir, 0o700)
    token = read_token(args.token_file)
    try:
        backend = load_backend(args.backend, args.data_dir)
    except ImportError as error:
        # O neonize abre a `libmagic` ao importar: sem ela (`brew install libmagic`), o app explica.
        reason = 'libmagic' if 'magic' in str(error).lower() else 'neonize'
        print(json.dumps({'event': 'error', 'error': reason}), flush=True)
        raise SystemExit(3) from error
    bridge = Bridge(args.data_dir, backend)
    server = ThreadingHTTPServer((HOST, args.port), make_handler(bridge, token, args.instance_id))
    server.daemon_threads = True
    # O app manda SIGTERM ao desligar; o stdin fechado (o app morreu) também encerra.
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown, daemon=True).start())

    def watch_stdin():
        try:
            while sys.stdin.read(1024):
                pass
        except (OSError, ValueError):
            # Sem stdin para ler (teste, terminal): só o SIGTERM encerra.
            return
        server.shutdown()

    threading.Thread(target=watch_stdin, daemon=True).start()
    backend.start(bridge)
    print(json.dumps({'event': 'ready', 'port': server.server_address[1], 'version': VERSION}), flush=True)
    log(f'escutando em {HOST}:{server.server_address[1]} ({args.backend})')
    try:
        server.serve_forever(poll_interval=0.2)
    finally:
        try:
            backend.stop()
        except Exception:  # noqa: BLE001
            pass
        bridge.store.close()


if __name__ == '__main__':
    main()
