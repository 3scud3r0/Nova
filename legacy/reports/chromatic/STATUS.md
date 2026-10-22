# NOVA 0.5 Chromatic — estado da entrega

Implementação experimental de Particle Life e estúdio WebGPU de superfícies líquidas, com referências independentes de continuum, química, óptica e geometria. Veja [escopo matemático](../../docs/chromatic.md).

## Verificações realizadas

- Ruff: análise estática e formatação dos novos módulos e scripts.
- Python: compilação de sintaxe dos novos módulos, sem execução dos ensaios numéricos.
- JavaScript: `node --check` e formatação Prettier.
- Rust/WebGPU: `cargo check --features webgpu --locked`; build Naga validou cinco shaders Chromatic e o shader de campos anterior, incluindo correspondência dos espelhos WGSL.
- Inspeção visual local: Chromium headless com SwiftShader/Vulkan, viewport 1280×720, preset ink, seed 42, render alvo 960×540, cenas pequenas de 512 e 2048 partículas. Aplicação inicializou e apresentou quadros sem erros JS/WebGPU registrados nas execuções com Vulkan. A configuração inicial sem Vulkan perdeu o dispositivo; a mudança de backend do navegador permitiu a inspeção.
- A captura final de 2048 partículas exibiu estado em torno de tick 4. Um snapshot diagnóstico anterior ao screenshot registrou tick 2, zero consultas truncadas/velocidades limitadas e 4487 correções de densidade limitadas durante a acomodação inicial. Esses limites alteram a dinâmica; não são descartados do relatório.
- `artifacts/NOVA_Chromatic_preview.png` é captura da aplicação real, não imagem conceitual. O backend de software ficou lento (indicador arredondou a 0 FPS na captura final); não há benchmark comparável nem extrapolação para GPU física.

## Não executado ou não demonstrado

As suítes de testes numéricos, benchmarks, ensaios longos, MPM CPU, path tracer CPU, migração/rede planetária e reprodução entre GPUs não foram executados nesta revisão. Casos de avaliação futura estão em `tests/chromatic/`. A inspeção visual executou alguns passos de simulação GPU; portanto esta revisão não afirma ausência total de execução de simulação.

100.000 partículas e 4K são limites configuráveis, sem validação de desempenho. Não se demonstra conservação exata sob truncamentos/clamps, estabilidade longa, calibração física, fotorealismo cinematográfico ou verdade científica universal. A camada PBF e óptica RGB aproximada do browser é distinta das referências CPU de MPM e transporte espectral.

## Artefatos

- `artifacts/NOVA_Chromatic.html`: estúdio autocontido gerado dos mesmos fontes, sem dependências CDN.
- `artifacts/NOVA_Chromatic_preview.png`: inspeção pequena em software.
- `artifacts/NOVA_codigo_completo.txt`: fontes consolidados e SHA-256 por arquivo; não é binário compilado.
