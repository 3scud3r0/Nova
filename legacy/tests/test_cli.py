import json
from nova.cli import main


def test_cli_demo_and_dashboard(tmp_path, capsys):
    metrics = tmp_path / "metrics.jsonl"
    checkpoint = tmp_path / "demo.npz"
    html = tmp_path / "panel.html"
    main(
        [
            "demo",
            "--ticks",
            "4",
            "--checkpoint",
            str(checkpoint),
            "--metrics",
            str(metrics),
        ]
    )
    assert json.loads(capsys.readouterr().out)["ticks"] == 4
    main(["dashboard", "--metrics", str(metrics), "--output", str(html)])
    assert "latency_ms" in html.read_text()
    assert checkpoint.is_file()


def test_demo_resume_includes_body_state(tmp_path, capsys):
    import numpy as np
    from nova.runtime import CognitiveRuntime

    full = tmp_path / "full.npz"
    part = tmp_path / "part.npz"
    metrics = tmp_path / "metrics.jsonl"
    main(["demo", "--ticks", "8", "--checkpoint", str(full), "--metrics", str(metrics)])
    main(["demo", "--ticks", "4", "--checkpoint", str(part), "--metrics", str(metrics)])
    main(
        [
            "demo",
            "--ticks",
            "4",
            "--resume",
            str(part),
            "--checkpoint",
            str(part),
            "--metrics",
            str(metrics),
        ]
    )
    a, b = CognitiveRuntime.load(full), CognitiveRuntime.load(part)
    np.testing.assert_array_equal(a.z, b.z)
    np.testing.assert_array_equal(a.continual.dW, b.continual.dW)
    assert a.external_state == b.external_state
