"""Loopback-only interactive viewer. Simulation mutations require a session token."""

from __future__ import annotations
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import secrets
import threading
from nova.bioma.determinism import canonical_json, strict_json
from .renderer import FieldRenderer


def serve(ecosystem, *, port=8765):
    from nova.bioma.presets import create_ecosystem

    token = secrets.token_urlsafe(32)
    lock = threading.Lock()
    state = {"ecosystem": ecosystem}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, status, data, kind="application/json"):
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(data)

        def allowed(self):
            return self.headers.get("Host") in (
                f"127.0.0.1:{self.server.server_port}",
                f"localhost:{self.server.server_port}",
            )

        def do_GET(self):
            if not self.allowed():
                return self.reply(403, b"{}")
            if self.path != "/":
                return self.reply(404, b"{}")
            with lock:
                frame = FieldRenderer.frame(state["ecosystem"])
            html = (
                Path(__file__)
                .with_name("viewer.html")
                .read_text()
                .replace("/*INITIAL_FRAME*/null", canonical_json(frame).decode())
                .replace(
                    "/*LIVE_CONFIG*/null", canonical_json({"token": token}).decode()
                )
            )
            self.reply(200, html.encode(), "text/html; charset=utf-8")

        def do_POST(self):
            if not self.allowed() or not secrets.compare_digest(
                self.headers.get("X-Nova-Session", ""), token
            ):
                return self.reply(403, b"{}")
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 4096:
                    raise ValueError("request body size out of range")
                request = strict_json(self.rfile.read(length), 4096)
                with lock:
                    if self.path == "/step":
                        ticks = request.get("ticks", 1)
                        if not isinstance(ticks, int) or not 1 <= ticks <= 8:
                            raise ValueError("tick limit exceeded")
                        state["ecosystem"].step(ticks)
                    elif self.path == "/reset":
                        old = state["ecosystem"]
                        state["ecosystem"] = create_ecosystem(
                            request["preset"],
                            seed=old.world.config.seed,
                            size=old.world.shape[0],
                        )
                    else:
                        return self.reply(404, b"{}")
                    frame = FieldRenderer.frame(state["ecosystem"])
                self.reply(200, canonical_json(frame))
            except (ValueError, KeyError, TypeError) as error:
                self.reply(400, canonical_json({"error": str(error)}))

    class Server(ThreadingHTTPServer):
        daemon_threads = True

        def get_request(self):
            connection, address = super().get_request()
            connection.settimeout(10)
            return connection, address

    server = Server(("127.0.0.1", port), Handler)
    print(
        f"NOVA Biocosm: http://127.0.0.1:{server.server_port} (Ctrl-C para encerrar)",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
