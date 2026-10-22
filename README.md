# NOVA Lab — browser-first scientific sandbox

NOVA Lab replaces the public-facing interface of NOVA with the original [Sandbox Science](https://github.com/DicSo92/SandboxScience) Particle Life and Conway web simulators, licensed AGPL-3.0-or-later. The original NOVA Rust/Python source tree is preserved at [legacy/](legacy/).

## Website

After the PR is merged and GitHub Pages is configured to publish from GitHub Actions, visit:

**https://3scud3r0.github.io/Nova/**

The site exposes /particle-life, /game-of-life and /nova-data. Particle Life uses the upstream built-in CPU fallback and optional WebGPU when supported. No universal FPS is promised.

## Provenance and license

- Upstream: [DicSo92/SandboxScience](https://github.com/DicSo92/SandboxScience), pinned Git submodule at commit ba43fde7ed3fc2224302c2682a3ecd3030717ba5.
- Original copyright 2024–2026 Charly Luzzi / DicSo92; the upstream LICENSE remains in the clone.
- NOVA-specific Vue overlays and browser data bridge are distributed under AGPL-3.0-or-later.
- Previous NOVA native source and prior CI remain in the legacy directory, outside the static site.

## Run locally

Install Node.js 22 and Git. Run from repository root:

    git submodule update --init --recursive
    node --test tests/nova-data.test.mjs
    node scripts/sync-upstream.mjs
    cd .web-build
    npm ci
    NUXT_APP_BASE_URL=/Nova/ npm run dev

GitHub Actions generates .web-build/.output/public via npm run generate and uploads a Pages artifact. An administrator must first set Settings > Pages > Build and deployment > Source: GitHub Actions. The workflow cannot guarantee that Pages is enabled.

## Native data interoperability

The /nova-data route reads files only inside the browser (no uploads): Conway .nca with SHA-256 verification; Life .rle; CSV, JSONL and JSON. CSV x/y columns or JSON position arrays show a 2D scatter projection. Files are capped at 32 MiB, grids at 4,194,304 cells. The import never executes arbitrary code.

GitHub Pages cannot run Rust binaries or long-lived backends. The original CLI remains in legacy/. Direct native Arrow, Parquet, Zarr, streaming and WASM are **not** implemented; convert datasets to CSV/JSONL before importing. This is an honest data bridge, not a claim that the Rust engine is running in the browser.

## Performance and deployment

The actual upstream Nuxt and Canvas/WebGPU simulators are cloned and compiled into the static site; this is not an iframe or external runtime redirect. Rendering performance depends on device and selected mode. Nuxt prerendering produces static routes for Pages, with .nojekyll and a 404 SPA fallback.

## Review / rollback

This is intentionally a large replacement PR. It moves the old source tree to legacy/, preserves the original Git history, and replaces the root interface and CI. Review licensing, verify the three routes in GitHub Actions and enable Pages before merging. To rollback, revert the merge commit.

## Native research workspace (0.8)

The Rust engine remains in [legacy/](legacy/), with modular substrates, neural
organisms, MAP-Elites island search, a predictive observer, tensor training
readers and optional libp2p discovery exchange. See the
[implementation, commands and limits](legacy/docs/native/EVOLUTION.md).

From `legacy/`, compile with `cargo build --release --locked --features swarm`.
The native CLI exposes `substrate`, `autosearch`, `observe`, `verify`, `rlvr`
and `swarm`; the static website does not execute these native workloads.

Source bundles: [Rust/WGSL TXT](legacy/artifacts/NOVA_Rust_completo.txt) and
[complete native source TXT](legacy/artifacts/NOVA_codigo_completo.txt).
