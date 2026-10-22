"""Self-contained Particle Life/WebGPU liquid studio, served on loopback or exported."""

import hashlib
import webbrowser
from dataclasses import asdict, dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from nova.bioma.determinism import SplitMix64, canonical_json

SHADERS = (
    "particle_life",
    "fluid_surface",
    "fluid_filter",
    "fluid_lighting",
    "fluid_post",
)


@dataclass(frozen=True)
class CinematicConfig:
    preset: str = "ink"
    count: int = 8192
    seed: int = 42
    quality: str = "balanced"
    max_memory_mib: int = 512

    def __post_init__(self):
        if (
            self.preset not in ("ink", "life", "iridescent", "nebula")
            or not 256 <= self.count <= 100000
            or self.quality not in ("draft", "balanced", "high", "ultra")
            or not 64 <= self.max_memory_mib <= 2048
        ):
            raise ValueError("cinematic scene/pixel/particle budget exceeded")
        SplitMix64(self.seed)


def build_html(config=None):
    config = config or CinematicConfig()
    root = Path(__file__).parent
    engine = (root / "cinematic.js").read_text()
    sources = {
        name: (root / "shaders" / (name + ".wgsl")).read_text() for name in SHADERS
    }
    digest = hashlib.sha256()
    for name, value in [("cinematic.js", engine), *sorted(sources.items())]:
        digest.update(name.encode())
        digest.update(value.encode())
    settings = {
        **asdict(config),
        "seed": str(config.seed),
        "engine_sha256": digest.hexdigest(),
    }
    html = (
        (root / "cinematic.html")
        .read_text()
        .replace(
            "/*SCENE_CONFIG*/{}",
            canonical_json(settings).decode().replace("<", "\\u003c"),
        )
        .replace(
            "/*SHADER_SOURCES*/{}",
            canonical_json(sources).decode().replace("<", "\\u003c"),
        )
        .replace("/*ENGINE_CODE*/", engine)
    )
    return html, settings


def export(config, path):
    html, settings = build_html(config)
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(html)
    return {
        "html": str(target),
        "scene": settings,
        "runtime_executed": False,
        "dependencies": "browser WebGPU only; no CDN",
        "scientific_truth_proved": False,
    }


def serve(config=None, *, port=8768, open_browser=False):
    if not 1 <= port <= 65535:
        raise ValueError("invalid local port")
    html, settings = build_html(config)
    body = html.encode()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            if self.headers.get("Host") not in (
                f"127.0.0.1:{self.server.server_port}",
                f"localhost:{self.server.server_port}",
            ):
                self.send_error(403)
                return
            if self.path not in ("/", "/scene.json"):
                self.send_error(404)
                return
            data = canonical_json(settings) if self.path == "/scene.json" else body
            self.send_response(200)
            self.send_header(
                "Content-Type",
                "application/json"
                if self.path == "/scene.json"
                else "text/html; charset=utf-8",
            )
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
            )
            self.end_headers()
            self.wfile.write(data)

    class Server(ThreadingHTTPServer):
        daemon_threads = True

        def get_request(self):
            connection, address = super().get_request()
            connection.settimeout(10)
            return connection, address

    server = Server(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{server.server_port}"
    print(f"NOVA Chromatic: {url}", flush=True)
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
