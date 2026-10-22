"""Launch the local WebGPU/WebGL viewer with optional planetary orchestration."""

import webbrowser
from .server import serve


def start(
    ecosystem, *, port=8765, renderer="webgl", planetary=None, open_browser=False
):
    if renderer not in ("webgl", "webgpu"):
        raise ValueError("unknown browser renderer")
    if planetary:
        planetary.start()
    try:
        serve(
            ecosystem,
            port=port,
            lock=planetary.lock if planetary else None,
            atlas=planetary.atlas if planetary else None,
            renderer=renderer,
            control=planetary.control if planetary else None,
            on_ready=webbrowser.open if open_browser else None,
        )
    finally:
        if planetary:
            planetary.close()


def export_atlas(data, path):
    from pathlib import Path
    from nova.bioma.determinism import canonical_json

    template = Path(__file__).with_name("science_atlas.html").read_text()
    html = template.replace(
        "/*ATLAS_DATA*/null", canonical_json(data).decode().replace("<", "\\u003c")
    )
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(html)
    return str(target)
