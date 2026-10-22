# Estado 0.4 — infraestrutura planetária experimental

Implementados: campos residentes Rust/Rayon e feature wgpu com WGSL; CPPN/HH independentes em batch; sinalização de Lewis com métricas/feedback instrumentados; nichos/linhagens/crossover; regressão transcendental e Hamiltonianos condicionais; fila de provas; descoberta XOR com descritores, mDNS e WebRTC opcionais; esporos com imigração reprodutível; buscas de contraexemplos assinadas; orquestração `start/join` e atlas/WebGPU no browser.

Verificações executadas nesta revisão:

- Ruff: nomes/importações/sintaxe e formatação.
- `cargo check --locked`: tipos do backend CPU.
- `cargo check --features webgpu --locked`: tipos com wgpu e validação estática do shader de campos por Naga no build.
- Parser JavaScript `node --check` dos três viewers, sem executar DOM/browser.
- Rustfmt dos novos fontes e verificação textual do diff.

**Nenhum teste, simulação, benchmark, medição energética ou prova Lean foi executado**, conforme orientação do usuário. Browser/WebGPU real, WebRTC, mDNS, migrações entre computadores e rede global não foram exercitados. Nenhum FPS/ganho energético, linguagem natural emergente, novidade física ou garantia de verdade global é reivindicado.

A 0.3 não havia comprovado viabilidade teórica ou empírica. A 0.4 continua experimental. Kernels nativos não substituem todo o ecossistema Python; prova polinomial não resolve toda matemática; descoberta de pares precisa de bootstrap; ausência de contraexemplo nunca é prova. Detalhes em [docs/planetary.md](../../docs/planetary.md).
