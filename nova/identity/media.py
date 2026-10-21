"""Local optional normalization adapters; require consent before reading media."""

from pathlib import Path


def transcribe(store, path, model_directory, source):
    store._check()
    if not Path(model_directory).is_dir():
        raise ValueError("provide a locally installed Whisper model directory")
    from faster_whisper import WhisperModel

    model = WhisperModel(
        str(model_directory), device="cpu", compute_type="int8", local_files_only=True
    )
    segments, _ = model.transcribe(str(path))
    content = " ".join(segment.text for segment in segments)
    return store.ingest({**source, "kind": "transcript", "content": content})


def ingest_image(store, path, source):
    store._check()
    from PIL import Image
    import pytesseract

    with Image.open(path) as image:
        content = pytesseract.image_to_string(image)
    return store.ingest({**source, "kind": "document", "content": content})
