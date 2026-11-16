#!/usr/bin/env python3
# Serviço local do WhatsApp do LAP Reuniões (contrato 24, CA1). Cliente NÃO OFICIAL (neonize/whatsmeow): o
# WhatsApp pode suspender ou bloquear o número. Escuta só em 127.0.0.1, numa porta livre, e toda rota exige
# `Authorization: Bearer <token>`, com o token lido de um arquivo 0600 criado pelo app. A sessão e as mensagens
# ficam em `--data-dir` (no `userData` do app), nunca no repositório. O serviço não manda nada sozinho: a única
# rota que envia é `POST /chats/:id/send`, e o app só a chama depois do clique da pessoa.
#
# Ao subir, escreve uma linha JSON no stdout: {"event": "ready", "port": N, "version": "..."}. Logs vão para o
# stderr e nunca levam texto de mensagem.
import argparse
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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

# O app roda com `python -I` (sem a pasta atual nem variáveis do Python no caminho): os módulos do serviço vêm
# só da pasta deste arquivo.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bridge_store import Store, now_ms  # noqa: E402

VERSION = '0.1.0'
HOST = '127.0.0.1'
STATES = ('pairing', 'connected', 'disconnected', 'banned')
SEND_TEXT_MAX = 4096
BODY_MAX = 64 * 1024
SSE_PING_S = 15
CHAT_ID = re.compile(r'^[\w.+:-]{1,120}@[\w.-]{1,60}$')
PHONE = re.compile(r'^\d{8,15}$')


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
            self.publish('message', dict(message, chatName=(self.store.chat(message['chatId']) or {}).get('name')))

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

    def logout(self):
        """Sai da conta e apaga a sessão e as mensagens guardadas."""
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
                return self.send_json(200, {'chats': bridge.store.chats()})
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
