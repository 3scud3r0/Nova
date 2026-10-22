# Pinned upstream sources

`upstream.lock.json` records exact Git revisions and raw-byte SHA-256 hashes of
selected redistributed files. MIT, Apache-2.0, Unlicense and AGPL components
retain their notices. These snapshots are reference inputs, not additional
workspace members or applications executed during a native build. Binary assets,
caches, Git metadata and upstream agent instructions are excluded.

Native ports live in `crates/nova-fusion` and `crates/nova-automata`, with GPU
kernels in `crates/nova-gpu`. PAR Rust adaptations retain attribution under
`nova-fusion/src/par`; MIT Conway patterns are attributed in `patterns.rs`.
The original browser/Godot interfaces and complete Ethersim gallery are not
claimed to be fully ported.

CellFlow and CatConway have no declared license in the inspected revisions;
their code and presets are not copied. SandboxScience is a quality reference
without copied code. Unqualified WebGOL is interpreted as varbrad/webgol, whose
inspected revision contains no simulator implementation.

`python scripts/verify_upstream_sources.py` checks retained hashes without
executing upstream code. The full TXT includes all selected reference files.
See `THIRD_PARTY_NOTICES.md` and `docs/native/FUSION.md` for attribution and scope.
