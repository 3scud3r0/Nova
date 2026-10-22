# NOVA 0.7 — integração nativa

O workspace reúne famílias de Particle Life em `nova-fusion`, autômatos 2D/3D em
`nova-automata`, kernels WGSL em `nova-gpu` e controles nativos em `nova-render`.
O executável consome essas bibliotecas; os loops novos de simulação são Rust/WGSL.
As interfaces web, Python e Godot dos projetos de referência não são executadas.

## Origens e escopo

| Referência | Integração nesta revisão |
| --- | --- |
| macncrash/realethersim | Força triangular, toro 3D e quatro sistemas RK4: Lorenz, Rössler, Aizawa e Thomas. A galeria inteira não foi portada. |
| hunar4321/particle-life | Lei de força constante por espécie, amortecimento e reflexão 2D. |
| mpuchstein/primordial-dish | Presets genesis/orbs/garden/symbiotes/polymers, força por intervalos, variação e reprodução de matrizes. |
| paulrobello/par-particle-life | Utilitários Rust adaptados, 34 geradores de regras, 31 distribuições, 37 paletas, DSL, raios por par e alinhamento. |
| spherical-sound-society/CellFlow | Modelo numérico novo com núcleo racional, atração e resposta à contagem de vizinhos do passo anterior. Sem copiar código ou presets. |
| VladimirTechMan/g3dl | Referência para autômatos 3D e regra padrão B5/S4-5 no alias g3dl. |
| skeeto/webgl-game-of-life | Referência para atualização por ping-pong; implementação nativa WGSL própria. |
| RandomGamingDev/ConwaysGameOfLife | Referência para pintura/interação; grade binária e pincéis nativos. |
| Bridiro/game-of-life | Padrões MIT incorporados e atribuídos; exportação/importação RLE e estado nativo. |
| rotblauer/CatConway | Análise e busca de regras implementadas de forma independente; nenhum fonte copiado. |
| WebGOL | Interpretado como varbrad/webgol; revisão contém apenas README e licença, sem simulador para portar. |
| DicSo92/SandboxScience | Referência de organização dos controles e qualidade de interface. Painel egui original; não representa equivalência visual validada. |

Os commits, licenças e hashes dos arquivos selecionados estão em
`third_party/upstream.lock.json`. Snapshots licenciados preservam as referências
originais em `third_party/upstream`. CellFlow e CatConway não declaravam licença
nas revisões inspecionadas; seus fontes não foram redistribuídos. SandboxScience
é uma referência de qualidade, sem incorporação de código.

A distribuição combinada que incorpora os módulos derivados de PAR usa
AGPL-3.0-or-later. As licenças MIT, Apache-2.0 e Unlicense dos componentes são
preservadas em `THIRD_PARTY_NOTICES.md`, junto da licença integral em `LICENSE`.

## Uso futuro

Os comandos abaixo são exemplos para executar após compilar; não foram todos
executados nesta entrega.

```sh
cargo build --release --locked -p nova-engine -p nova-ffi
nova fuse --list
nova fuse --source fusion --particles 8192
nova fuse --source hunar --particles 4096 --headless --ticks 600
nova fuse --source realethersim --gpu
nova fuse --source primordial-dish --dish-preset genesis --breed-pick 2
nova fuse --source par-particle-life --rules 0 --positions 0 --palette 0
nova fuse --source cellflow --save-settings runs/cellflow.json
nova fuse --source fusion --headless --ticks 600 --output runs/fusion-lake
nova conway --grid 2048x2048 --rule B3/S23
nova conway --source g3dl --grid 64x64x64 --gpu --ticks 100
nova conway --source bridiro --grid 256x256 --pattern glider --output runs/glider.rle
nova conway --source catconway --grid 64x64 --rule B3/S23 --classify
nova conway --grid 32x32 --search 16 --ticks 100 --output runs/rules.jsonl
```

Use `./target/release/nova` no lugar de `nova` se o binário não estiver no PATH.
Diretórios de saída devem existir quando exigidos pelo formato. Arquivos de
estado e busca recusam sobrescrita. `--settings` carrega configurações salvas;
`--save-settings` salva parâmetros, matriz e paleta, não um checkpoint de todas
as partículas. A semente controla a geração, sem promessa de igualdade bit a bit
entre backends e arquiteturas.

O painel nativo permite pausar, avançar um passo, trocar família, editar matriz,
cores, forças, parâmetros CellFlow, variação temporal, distribuição e aparência.
Aplicar geradores de posições reinicializa as posições. A reprodução oferece
seis candidatos para seleção, não seis simulações simultâneas. B gera candidatos,
1–6 selecionam, M muta e R sorteia regras. O pincel aplica força radial.

## Modelos e desempenho

Os modelos de partículas usam snapshots síncronos, ponto flutuante f32 e índice
espacial compacto compartilhado. Portar a lei de força não reproduz a ordem de
atualização in-place, RNG ou renderização dos aplicativos originais. O modo
fusion combina mecanismos; não é um preset canônico de qualquer upstream.

O índice visita todas as partículas das células candidatas, sem truncamento
silencioso de vizinhos. Domínio aberto usa extensão finita de indexação;
não significa espaço infinito. Há limites explícitos de memória/partículas,
validação de parâmetros e contadores para limitação de velocidade/densidade.
Densidades patológicas ainda podem tornar a busca quadrática.

Partículas na GPU usam indexação na CPU, upload e readback a cada passo; não são
uma simulação inteiramente residente. Autômatos GPU usam buffers ping-pong
residentes, com leitura quando solicitada para saída/análise. A classificação
por frame exige readbacks adicionais. Nenhum ganho universal de GPU ou FPS é
inferido de compilação ou de um caso esparso.

Conway mantém o caminho SIMD bitboard para grades 2D periódicas compatíveis.
O caminho geral usa estados inteiros binários e Moore: raio 1 ou 2 em 2D,
raio 1 em 3D. O formato `.nca` contém cabeçalho JSON, células binárias e SHA-256;
RLE é limitado a 2D. Regras B/S aceitam intervalos, listas e conjuntos explícitos.
Busca e classificação calculam atividade, entropia, periodicidade limitada,
autocorrelação, rugosidade e lambda. São heurísticas numéricas; não constituem
provas de universalidade, de classe dinâmica ou análise topológica persistente.

## Bibliotecas e dados

`nova-physics::Universe` recebe `Config { fusion: Some(Family::...), .. }`.
`nova-fusion` expõe modelos, configurações, reprodução e os quatro atratores.
`nova-automata` expõe grades, regras, pincéis, padrões, RLE e observadores.
A C ABI adiciona `nova_create_fusion`, com famílias 0..5 em `include/nova.h`.
Os bindings Python nativos aceitam os nomes dos novos presets.

A gravação existente Arrow/Parquet/Zarr permanece disponível. `fusion_frames.jsonl`
acrescenta configurações, matriz e referência de linhagem de regras por frame.
Esse metadado descreve mutações de regras, sem atribuir genealogia biológica
individual a todas as partículas. A presença dos formatos não certifica a
relevância científica dos dados.

## Entregáveis e verificações

- `artifacts/NOVA_Rust_completo.txt`: fontes Rust/WGSL, manifests, header C e atribuições.
- `artifacts/NOVA_codigo_completo.txt`: fonte consolidado, incluindo referências licenciadas selecionadas.
- Ambos incluem índice com SHA-256 por arquivo; são código-fonte textual, não binários compilados.
- `python scripts/bundle_source.py --rust-only` e o mesmo comando sem a opção regeneram os arquivos.
- `python scripts/verify_upstream_sources.py` confere hashes sem executar os projetos externos.

Consulte `STATUS.md` para distinguir compilação, execuções anteriores e recursos
que ainda não foram validados em execução.
