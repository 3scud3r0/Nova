"""Launch the optional nova-cortex extract-theorems workflow."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from nova_cortex.cli import main

if __name__ == "__main__":
    main(["extract-theorems", *sys.argv[1:]])
