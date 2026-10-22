# NOVA 0.6 — motor nativo modular

O workspace acrescenta bibliotecas Rust, um executável nativo, API Python e C ABI
sem remover os módulos de pesquisa Python 0.1–0.5. O diretório `nova-core/`
continua sendo a extensão legada `_native`, com seu próprio Cargo.lock, fora do
workspace novo. `crates/nova-core` contém os contratos de memória do motor novo.

## Compilação e execução

Rust 1.99.1 está fixado em `rust-toolchain.toml`. Os shaders WGSL são incorporados
com `include_str!` e analisados/validados por Naga durante o build. Nenhum download
ocorre durante a execução normal do binário.

```sh
cargo build --release --locked -p nova-engine -p nova-ffi
./target/release/nova live --preset cosmic-ink --particles 65536
./target/release/nova live --preset particle-vm --particles 32768 --enable-crossover
./target/release/nova live --preset liquid-mpm --particles 512
./target/release/nova live --preset particle-life --gpu --particles 65536
./target/release/nova harvest --ticks 10000 --output runs/lake --record-all --enable-crossover
./target/release/nova conway --grid 2048x2048 --rule B3/S23 --ticks 100 --benchmark
./target/release/nova mpm --ticks 100 --particles 512 --output runs/mpm-native
```

Duplo clique/execução sem argumentos abre a janela com 8.192 partículas. Espaço
pausa, setas orbitam, roda do mouse aproxima, E injeta 256 partículas (exceto MPM),
Escape fecha. `live --output runs/live-lake` grava a cada 10 passos. Os dados são
finalizados ao fechar normalmente; encerramento forçado pode deixar Arrow/Parquet
incompletos, e `manifest.json` permanece `recording`.

Para servidores sem janela/GPU:

```sh
cargo build --release --locked --no-default-features
./target/release/nova harvest --ticks 10000 --sample-every 10 --record-all
```

A pasta de saída precisa estar vazia. `--record-all` ignora o filtro heurístico de
relevância. Sem ele, um experimento pode gerar zero frames; o manifesto registra a
contagem. O grid de campos tem tamanho fixo e registra quantas partículas ficaram
fora de `[-extent, extent)^3`. Isso não limita o espaço da simulação.

## APIs de biblioteca

Rust, com dependências locais:

```toml
[dependencies]
nova-physics = { path = "../Nova/crates/nova-physics" }
nova-pvm = { path = "../Nova/crates/nova-pvm" }
# Alias opcional: nova-dataset = { package = "nova-storage", path = "../Nova/crates/nova-storage" }
nova-storage = { path = "../Nova/crates/nova-storage" }
```

```rust,ignore
let mut world = nova_physics::Universe::new(4096, Default::default())?;
world.step(100)?;
let positions = &world.particles.positions; // borrow de float4 alinhados, sem serialização
```

O registro de transferência `Particle` tem exatamente 64 bytes e alinhamento 64;
as colunas cinemáticas SoA têm alinhamento 16. As duas representações são
contratos distintos. Existem ainda colunas de IDs e linhagens: 64 bytes não é o
consumo total por partícula. `CellList` ordena todas as colunas e preserva IDs.
Morton usa 21 bits **com sinal** por eixo; coordenadas fora do alcance retornam
erro. O domínio é aberto, mas finito, sem promessa de universo infinito.
`nova-spatial` também expõe BVH e octree esparsos para consultas alternativas.

Python, a partir da raiz com o ambiente virtual ativo:

```sh
maturin develop --release
```

Esse comando instala `nova-research` 0.6 com os pacotes legados e `nova_engine`.
`pip install -e .` permanece o caminho Python legado e não compila a extensão nova.
Para uma wheel independente `nova-engine`, use o projeto de
`crates/nova-python/pyproject.toml`:

```sh
cd crates/nova-python
maturin build --release --locked
```

```python
from nova_engine import Universe, arrow_snapshot
world = Universe(particles=4096, preset="particle-vm", enable_crossover=True)
world.step(1000)
frame = world.snapshot()
a = frame.positions               # (N,4), float32, somente leitura, zero-copy
arrow = arrow_snapshot(frame)      # fixed-size-list Arrow sobre os mesmos buffers
# world.step(1) é recusado enquanto frame/arrays/tabelas ainda retêm o snapshot.
del arrow, a, frame
world.step(1)
```

`Snapshot` mantém um `Arc` do estado. A mutação exige proprietário único;
referências pendentes impedem avanço e realocação. `positions` inclui raio e
`velocities` inclui massa. `torch_positions(frame)` copia por segurança;
`copy=False` compartilha RAM e exige que o tensor seja tratado como somente
leitura, pois PyTorch não implementa essa restrição. Transferir para CUDA/JAX,
separar colunas intercaladas ou escrever em disco não é zero-copy.

C/C++/C#/Go:

```sh
cc examples/embed.c -Iinclude -Ltarget/release -lnova -o /tmp/nova-embed
# Linux: definir LD_LIBRARY_PATH para target/release antes de executar o exemplo.
```

`nova-ffi` produz `libnova.so`, `libnova.dylib` ou `nova.dll`. cbindgen gera
`target/<perfil>/build/nova-ffi-*/out/nova.h`; `include/nova.h` é uma cópia para
consumidores. `NovaHandle` é opaco. `nova_positions`/`nova_velocities` retornam
ponteiros emprestados com stride de quatro floats; qualquer mutação ou destruição
invalida esses ponteiros. O chamador sincroniza acesso, valida seus ponteiros e
libera cada handle uma única vez. Erros ficam em `nova_last_error`; panics não
atravessam a ABI. `examples/embed.c` demonstra criação, avanço e leitura.

## Substratos e limites matemáticos

* Conway 2D: B/S booleano periódico, oito vizinhos Moore, bitboards u64. Despacho
  AVX2 no x86_64, NEON no AArch64, fallback escalar. Largura múltipla de 64;
  até 2^30 células. O auxiliar 3D usa Moore-26 inteiro e regras explícitas.
* Particle Life: afinidades dirigidas 8×8, núcleo repulsivo linear e coroa
  triangular, domínio aberto, integração semi-implícita e amortecimento uniforme.
  Sem normalização, limitação de vizinhos ou clamp de velocidade. Núcleo finito
  não é colisão de esfera rígida impermeável. Leis dirigidas não conservam energia
  ou momento em geral; damping também remove energia.
* PVM: 16 instruções de um byte, opcode no nibble superior, operando no inferior.
  SenseDensity, SetAffinity, TransduceForce, Metabolize, Recombine; desconhecidas
  são NOP. Sem saltos ilimitados e sem alegação de completude de Turing.
  Transdução é impulso antissimétrico; crossover mantém massa e momento,
  transfere energia metabólica dos pais, registra pais/generation e muta opcodes.
  A energia cinética relativa pode se dissipar. Reprodução tem teto de população.
* MPM: grade 3D esparsa aberta, B-splines quadráticas, APIC/MLS, pressão
  `bulk*(J^-4-1)` e viscosidade. CFL/volume inválidos retornam erro, sem clamp
  escondido. O MPM é separado do Particle Life/PVM, com população fixa por run.
  Não é um solver incompressível exato nem biologia validada.
* Cosmic ink: Particle Life mais forçamento pelo curl analítico de um potencial
  trigonométrico. Não é simplex noise nem o MPM. O curl é livre de divergência
  analiticamente; o integrador discreto não preserva volume perfeitamente.

`--gpu` usa índice espacial CPU, listas completas de candidatos e integração GPU
WGSL, com leitura de volta por tick. Erra ao exceder limites de memória, em vez de
truncar. PVM/crossover e MPM usam CPU; não há fallback silencioso. Este backend não
é inteiramente residente na GPU. CPU e GPU podem divergir em ponto flutuante.

A janela usa splats de profundidade, espessura aditiva, filtro bilateral separável,
normais reconstruídas, GGX/Fresnel com F0=0.04, iluminação de estúdio analítica e
pós-processamento HDR. Não carrega uma fotografia HDRI. O raio de apresentação é
artístico e independente do raio de colisão. A cena é aberta; a câmera tem frustum
finito. Não há path tracing completo, BSSRDF medido ou garantia de 60 FPS.

## Contratos dos datasets

* `trajectories.arrow`: stream IPC por frame, IDs estáveis, posição/velocidade,
  massa e espécie. O escritor usa buffers colunares novos; a gravação não é
  zero-copy a partir das colunas intercaladas do solver.
* `world.zarr/fields`: Zarr **v3**, codec bytes little-endian + Zstandard, chunks
  `(1,12,g,g,g)`, dimensão `(tempo,canal,x,y,z)`. Canais: densidade, velocidade,
  divergência, seis componentes de **tensão cinética coarse-grained** e temperatura
  cinética específica. Não são temperatura Kelvin ou tensão constitutiva MPM.
  Os coeficientes do solver ficam no manifesto/`solver.json`; Reynolds não é
  inventado sem unidades e escala características.
* `symbolic.parquet`: dataset_id, janela de até 256 IDs estáveis, regressão L1
  de aceleração x em `[1,x,y,z,vx,vy,vz]`, RMSE, observáveis, drift cinético e
  recibo Lean. O primeiro drift tem `drift_available=false` em `frames.jsonl`.
  Drift medido em sistema dissipativo não afirma conservação/teorema de Noether.
* `lineages.jsonl` e índice de offsets: genoma exato, SHA-256, pais, geração,
  nascimento e métricas observadas. Quantidades não medidas são `null`, não
  rótulos de cooperação ou inteligência inventados. `genomes.arrow` contém os
  mesmos registros com bytecode JSON documentado.

O filtro nativo usa entropia espacial e persistência H0 (Kruskal/MST) em até 64
IDs estáveis. É um gate heurístico; não mede laços/cavidades H1/H2. O adaptador
`PersistentGate` opcional usa Ripser H0/H1/H2 em até 256 pontos e um contador
entre frames. Presença temporal não é rastreamento da identidade de uma classe.

`PairMomentum.lean` demonstra apenas a identidade algébrica de um impulso de
par. O recibo começa como **pending**, independente da regressão observacional.
O adaptador Lean executa o compilador local quando solicitado; uma saída gerada
não é declarada verificada. O módulo Rust também fornece uma auditoria numérica
por derivada direcional de Lie. Não há inferência automática de verdade física.

```python
from nova_engine.datasets import catalog, open_fields, export_huggingface
fields = open_fields("runs/lake")
db = catalog("runs/lake")
rows = db.sql("SELECT tick, noether_invariant_drift FROM symbolic").fetchall()
export_huggingface("runs/lake")
# Depois: datasets.load_from_disk("runs/lake/huggingface")
```

`dataset_dict.json` inicial é um manifesto NOVA. Só `save_to_disk` do exportador
produz o layout aceito por `datasets.load_from_disk`. `load_dataset("meu-universo")`
exigiria publicar previamente um dataset nesse nome; nenhum upload é automático.
O exportador HF materializa tabelas em RAM; para lagos maiores use os leitores
Arrow/Parquet em lotes antes da conversão.

## Integrações opcionais

Instale extras a partir de `crates/nova-python` conforme a necessidade. Cada
integração é opt-in, e falhas de dependência são explícitas:

| Ecossistema | Entrada | Escopo |
|---|---|---|
| PySR/Julia | `nova_engine.science.discover_pysr` | Regressão candidata; requer Julia e sua instalação própria |
| Z3 | `z3_counterexample` | Contraprova racional de identidade linear em uma caixa |
| Lean/mathlib | `verify_lean` | Compila arquivo local em projeto explícito, guarda hash/status |
| Ripser | `PersistentGate` | H0/H1/H2 limitado por orçamento |
| DuckDB/Zarr/Arrow/HF | `nova_engine.datasets` | Leitura, catálogo e exportação locais |
| Taichi | `integrations.taichi_life.TaichiLife` | Referência dirigida O(N²), até 4.096 partículas; `ti.init` explícito |
| NVIDIA Warp | `integrations.warp_life.WarpLife` | Referência dirigida O(N²), CPU/CUDA explícito |
| JAX-MD | `integrations.jax_md.create` | Lennard-Jones diferenciável em espaço livre, não Particle Life |
| Avida | `integrations.avida.run` | Processo externo instalado/configurado pelo usuário |
| Lenia/Flow | `nova_engine.substrates` | Lenia FFT e transporte conservativo inspirado em Flow-Lenia |

Os adaptadores não incorporam os repositórios upstream e não foram executados
nesta entrega. Versões, licenças, downloads de Julia, drivers e modelos são
responsabilidade do ambiente que optar por eles. Swarm Chemistry e Avida não são
reimplementados pelo PVM; não atribuímos equivalência científica a esses motores.

## Distribuição

`python scripts/package_native.py` empacota executável, biblioteca C, cabeçalho,
README e hashes dos arquivos. O workflow `native-builds` compila Linux x86_64,
Windows x86_64, macOS arm64/x86_64 e uma wheel Linux CPython 3.12. Tags
`native-v*` publicam os artefatos; este PR não cria uma tag nem uma Release.

O executável embute bibliotecas Rust e shaders e não precisa de Python/navegador.
Ainda exige OS/ABI compatível e drivers gráficos do sistema; Linux usa glibc e
bibliotecas padrão de janela. Não existe binário universal estático para todos os
sistemas. O build Linux atual não valida os builds futuros Windows/macOS.

Veja [STATUS.md](STATUS.md) para a evidência realmente obtida nesta entrega.
