# NOVA 0.5 — Chromatic

Particle Life real e um estúdio local de superfícies líquidas. A revisão acrescenta uma via visual separada do bioma e referências numéricas para estudar os modelos solicitados. Não demonstra equivalência com efeitos cinematográficos offline, física molecular universal ou escalabilidade planetária.

## Abrir o estúdio

```bash
pip install -e .
nova cosm paint --preset ink --open-browser
nova cosm paint --preset life --count 8192
nova cosm paint --preset iridescent --count 16384 --quality high
nova cosm paint --output artifacts/NOVA_Chromatic.html
```

Use WebGPU em um navegador atual, em localhost ou HTTPS. O HTML exportado contém JS e WGSL, sem CDN; caso o navegador restrinja WebGPU em `file:`, sirva-o por HTTP local. `--quality ultra` permite até 3840×2160, condicionado à janela e orçamento. A seleção até 100.000 partículas é um limite de entrada, não uma meta de desempenho comprovada. O estúdio não exige o módulo Rust compilado.

Arraste para orbitar, use a roda para aproximar e espaço para pausar. O painel permite mudar dimensão 2D/3D, matriz dirigida 8×8, paleta, força, vórtice e material; capture PNG ou WebM. Os presets são direções artísticas editáveis. Não representam materiais calibrados.

## Caminho efetivamente usado na GPU

1. Buffers residentes ping-pong, índice espacial com listas encadeadas atômicas e consulta de 27 células vizinhas. Interação por espécie com núcleo repulsivo e casca atrativa/repulsiva. A matriz pode ser assimétrica: esse sistema ativo não conserva momento por construção.
2. Nos presets líquidos, predição e correções iterativas de densidade PBF, viscosidade aproximada e estrutura tixotrópica escalar. O modo Life desliga PBF e viscosidade extra; mantém a lei de interação e arrasto. Campo de vórtice ABC e confinamento são forças artísticas declaradas.
3. Esferas projetadas geram profundidade e espessura óptica/pigmento aditivos. Filtro bilateral separável reconstrói a superfície. Normais, três luzes GGX, ambiente analítico, absorção Beer–Lambert, transmissão aproximada HG/SSS e interferência RGB de película fina produzem a imagem HDR.
4. Bloom, profundidade de campo em imagem, vinheta, grão e curva ACES fitted finalizam a imagem. Não são path tracing, BSSRDF espacial completo ou óptica espectral exata.

Consultas limitadas a 2048 vizinhos (512 acima de 32768 partículas), velocidade e correção de densidade limitadas. Os contadores mostram truncamentos e clamps; não escondem perda de fidelidade. A ordem de inserção atômica e operações f32 impedem prometer repetição bit a bit entre GPUs. O custo cresce com a ocupação local; não há garantia de custo linear em aglomerações.

## Sementes e reprodução

`NOVA-CHROMATIC-v1` inclui hash do motor JS/WGSL, semente uint64 como string, gênese, parâmetros, paleta/matriz, eventos, câmera, tick e hash do estado. Há exportação compacta por replay e exportação com checkpoint binário f32. O importador valida formato, tamanho, domínio, versão e hash do motor; compara o estado reproduzido com o hash declarado. Sementes limitam replay a 20.000 ticks. Checkpoint evita refazer a trajetória, mas não elimina divergência futura entre dispositivos. SHA-256 atesta bytes; não prova verdade científica nem autoria.

## Referências numéricas separadas

| Módulos | Implementação | Escopo |
|---|---|---|
| `matter/particle_life.py` | Interações dirigidas e vizinhança periódica float64 | CPU até 8192 partículas por passo; não reproduz bit a bit a GPU |
| `matter/mpm.py` | P2G/G2P quadrático, MLS-MPM/APIC, mistura FLIP, deformação, StVK ou pressão EOS e HB | Referência CPU pequena; não solve incompressibilidade exata, não é o PBF do navegador |
| `matter/constitutive.py` | Herschel–Bulkley regularizado, relaxamento tixotrópico, StVK, Marangoni tangente, arrasto ação/reação | Leis constitutivas locais; não resolve FSI completo |
| `matter/chemistry.py` | DLVO assintótico, solução regular/Gibbs, binodal simétrica, Onsager PSD, Gillespie | Modelos reduzidos; SSA bem misturado, sem solver espacial estocástico acoplado |
| `optics/transport.py` | Beer–Lambert, HG, perfil radial Burley, Fresnel complexo de película, PSF por FFT, ACES | Primitivas e aproximações declaradas |
| `optics/path_tracer.py` | Monte Carlo espectral unidirecional, lentes finitas, esferas, NEE/MIS e meio HG | Cena de referência CPU independente; não BDPT nem renderer das partículas |
| `optics/reservoir.py` | Reservatório RIS ponderado e combinação reponderada | Primitiva; não ReSTIR espaço-temporal completo |
| `geometry/dec.py` | Incidências orientadas inteiras, Hodge fornecido, Betti por rank, curvatura angular | Complexos pequenos; identidades topológicas não tornam toda operação float exata |
| `geometry/dynamics.py` | Yoshida 4 separável e potenciais de catástrofe | Hipóteses conservativas/separáveis; não vale para arrasto/PBF |
| `geometry/clifford.py` | Produto de Cl(4,1), wedge, reversão e embedding conforme | Álgebra CPU; não solver geométrico de todo o bioma |
| `geometry/sparse.py`, `sdf.py` | Bricks esparsos, metadados octree, LOD visual, SDF e sphere tracing | Não NanoVDB GPU; LOD não congela a física silenciosamente |

As referências não foram acopladas artificialmente ao estúdio para alegar uma simulação universal. Conservação APIC depende da transferência, suporte e condições; paredes, clamps, FLIP, forças e erros de arredondamento alteram os balanços. Yoshida preserva estrutura simplética nas hipóteses, não energia exatamente. Um ponto de catástrofe no potencial não prevê sozinho ruptura de membrana real.

Comandos para avaliação futura das referências:

```bash
nova cosm particle-life --count 512 --steps 100 --output runs/life.npz
nova cosm mpm --count 256 --steps 32 --material liquid --output runs/mpm.npz
nova cosm spectral-render --width 128 --height 96 --samples 16 --output runs/spectral.png
```

## Verificação desta entrega

Veja [STATUS](../reports/chromatic/STATUS.md). Há casos numéricos em `tests/chromatic/`, escritos para execução futura. A inspeção visual pequena não valida estabilidade longa, conservação ou metas de escala. Os cinco shaders canônicos são distribuídos no pacote Python e espelhados no crate; `scripts/sync_visual_shaders.py` sincroniza e o build WebGPU rejeita divergências e erros Naga.
