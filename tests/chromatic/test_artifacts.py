from nova.visuals.cinematic import CinematicConfig, build_html


def test_offline_scene_preserves_full_uint64_seed_without_network_dependencies():
    html, config = build_html(CinematicConfig(seed=2**64 - 1))
    assert config["seed"] == "18446744073709551615"
    assert "/*ENGINE_CODE*/" not in html and "/*SHADER_SOURCES*/{}" not in html
    assert 'src="http' not in html and "import " not in html


def test_source_binding_is_independent_of_scene_count():
    _, a = build_html(CinematicConfig(count=4096))
    _, b = build_html(CinematicConfig(count=8192))
    assert a["engine_sha256"] == b["engine_sha256"] and a["count"] != b["count"]
