"""Launch the optional nova-cortex train-sae workflow."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from nova_cortex.cli import main

if __name__ == "__main__":
    main(["train-sae", *sys.argv[1:]])
