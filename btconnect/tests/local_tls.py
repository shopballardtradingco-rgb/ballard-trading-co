"""Real loopback TLS fixture. Generated keys and synthetic traffic never leave tmp."""
import asyncio
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timedelta, timezone
import ipaddress
import ssl

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
import httpx


class LocalTLS:
    def __init__(self, root, respond=None):
        self.respond = respond or (lambda method, path, body: (200, {}, b'{}'))
        self.connections = self.requests = self.active = self.peak = self.clients = 0
        self.writers, self.tasks = set(), set()
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "loopback fixture")])
        now = datetime.now(timezone.utc)
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                .public_key(key.public_key()).serial_number(x509.random_serial_number())
                .not_valid_before(now-timedelta(minutes=1)).not_valid_after(now+timedelta(days=1))
                .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), False)
                .sign(key, hashes.SHA256()))
        root.mkdir(parents=True, exist_ok=True)
        key_path, cert_path = root / "test.key", root / "test.pem"
        key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        key_path.chmod(0o600)
        cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
        self.server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.server_context.load_cert_chain(cert_path, key_path)
        self.client_context = ssl.create_default_context(cafile=str(cert_path))

    async def handle(self, reader, writer):
        self.connections += 1
        self.writers.add(writer)
        task = asyncio.current_task()
        self.tasks.add(task)
        try:
            while True:
                try:
                    header = await reader.readuntil(b'\r\n\r\n')
                except asyncio.IncompleteReadError:
                    break
                lines = header.decode().split('\r\n')
                method, path, _ = lines[0].split()
                headers = dict(line.split(': ', 1) for line in lines[1:] if line)
                length = next((int(v) for k, v in headers.items() if k.lower() == 'content-length'), 0)
                body = await reader.readexactly(length)
                self.requests += 1
                self.active += 1
                self.peak = max(self.peak, self.active)
                try:
                    result = self.respond(method, path, body)
                    if hasattr(result, '__await__'):
                        result = await result
                    status, extra, payload = result
                    response_headers = {"Content-Length": str(len(payload)), "Content-Type": "application/json", **extra}
                    wire = f'HTTP/1.1 {status} Fixture\r\n' + ''.join(f'{k}: {v}\r\n' for k, v in response_headers.items()) + '\r\n'
                    writer.write(wire.encode()+payload)
                    await writer.drain()
                finally:
                    self.active -= 1
        except (ConnectionError, ssl.SSLError):
            pass
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except (ConnectionError, ssl.SSLError):
                pass
            self.writers.discard(writer)
            self.tasks.discard(task)

    @asynccontextmanager
    async def serve(self):
        server = await asyncio.start_server(self.handle, '127.0.0.1', 0, ssl=self.server_context)
        self.port = server.sockets[0].getsockname()[1]
        try:
            yield self
        finally:
            server.close()
            await server.wait_closed()
            for writer in list(self.writers):
                writer.close()
            if self.tasks:
                await asyncio.gather(*list(self.tasks), return_exceptions=True)

    @contextmanager
    def route_clients(self):
        """Preserve real client/pool behavior; route fixed eBay URLs to local TLS."""
        original = httpx.AsyncClient
        async def route(request):
            assert request.url.host in ('api.ebay.com', 'apiz.ebay.com', 'apim.ebay.com')
            request.url = request.url.copy_with(host='127.0.0.1', port=self.port)
        def factory(*args, **kwargs):
            assert kwargs.get('transport') is None
            self.clients += 1
            kwargs.update(verify=self.client_context, trust_env=False, event_hooks={'request': [route]})
            return original(*args, **kwargs)
        httpx.AsyncClient = factory
        try:
            yield
        finally:
            httpx.AsyncClient = original
