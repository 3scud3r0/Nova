# NOVA — simulação, evolução e cognição experimental

NOVA reúne um motor nativo em **Rust**, uma interface web baseada no
[SandboxScience](https://github.com/DicSo92/SandboxScience) e uma camada opcional
**PyTorch** para modelos de mundo e interpretabilidade. A revisão **0.9 Cortex**
acrescenta percepção multimodal, RSSM, planejamento, memória, SAE e ciência simbólica.

O código nativo e científico fica em [`legacy/`](legacy/), conforme a organização
atual do repositório. A interface web ocupa a raiz. O nome da pasta não significa
que o motor foi abandonado: é nela que está o workspace Rust mantido.

## Escolha um modo

| Objetivo | Caminho |
| --- | --- |
| Explorar Particle Life e Conway no navegador | [Interface web](https://3scud3r0.github.io/Nova/) |
| Rodar simulações e gerar datasets sem Python | [Workspace Rust](legacy/Cargo.toml) |
| Buscar ambientes e evoluir organismos recorrentes | [MAP-Elites e observador nativo](legacy/docs/native/EVOLUTION.md) |
| Treinar um modelo de mundo e inspecionar features | [NOVA Cortex](legacy/docs/native/CORTEX.md) |
| Embutir o motor em outro programa | [APIs Rust, Python e C](legacy/docs/native/README.md) |

## Motor nativo

O workspace separa memória, busca espacial, física, PVM, autômatos, renderização,
datasets, ciência, substratos, cognição, evolução, IPC e P2P em crates próprios.
O executável usa essas bibliotecas; a simulação nativa não exige navegador ou Python.

Inclui Conway/HighLife/Seeds e autômatos 3D, Wireworld, Particle Life, famílias
fusion, MPM, Gray-Scott, fluido 2D aproximado e Lenia FFT. O contrato de substrato
expõe observação e intervenção comuns ao gravador e ao observador. O renderizador
genérico apresenta projeções do tensor; a janela de partículas tem seu próprio
pipeline visual e controles de regras.

```sh
cd legacy
cargo build --release --locked
./target/release/nova substrates
./target/release/nova substrate --kind conway --live
./target/release/nova fuse --source fusion --particles 8192
./target/release/nova substrate --spec configs/research/neural-fusion.json --live
./target/release/nova autosearch --target-archive runs/atlas --substrate fusion --neural
```

Organismos podem carregar micro-RNNs com pesos quantizados, memória por ID,
metabolismo e recombinação. MAP-Elites mantém nichos, ilhas, migração de elites,
retomada e registros de avaliações rejeitadas. A rede P2P é opcional, exige
`--features swarm` e peers explícitos; dados recebidos são reavaliados localmente.

## Cortex opcional

O Cortex observa o motor Rust por slots binários mapeados em memória. Usa
convoluções 3D e pooling de partículas, RSSM gaussiano, objetivo JEPA, preferências
homeostáticas, planejador CEM, ator/critic e replay priorizado. SAE, sondas e TCAV
ajudam a inspecionar representações; o catálogo registra labels e evidências.

A partir de `legacy/`, instale o extra em um ambiente Python apropriado:

```sh
python -m pip install -e '.[cortex]'
```

Em dois terminais, usando diretórios novos:

```sh
# Terminal 1: motor nativo, aguardando as ações do cérebro.
./target/release/nova ipc --substrate fusion --directory runs/ipc-01 --output runs/raw-01

# Terminal 2: percepção, previsão, atuação, explicação e consolidação.
python -m nova_cortex run --ring runs/ipc-01 --output runs/brain-01 \
  --config configs/cortex/compact.json --ticks 1024
```

O perfil compacto usa latente de 64 dimensões e dicionário de 512 features.
O completo usa latente de 1024 dimensões e dicionário de 16384 features, com
custos maiores de memória e processamento. O observador compacto da revisão 0.8
continua disponível em Rust, sem PyTorch.

Consulte o [guia Cortex](legacy/docs/native/CORTEX.md) para treinar SAE, reutilizar
checkpoints, congelar a representação para auditoria, registrar conceitos,
extrair equações e gerar candidatos Lean. O [glossário](legacy/docs/native/CORTEX_GLOSSARY.md)
explica os termos e referências metodológicas.

## Dados e verificação

O motor grava Arrow IPC, Parquet, Zarr e metadados de linhagem conforme o modo.
O Cortex grava transições com embedding atual/seguinte, ação, recompensa,
flags de término, latente, ativações esparsas e explicações com evidências.
Também exporta arrays com layout D4RL.

Arrow pode expor buffers mapeados sem cópia; Zarr comprimido precisa ser
descomprimido. O IPC copia o estado para o slot e o BrainLoop usa inputs próprios
para o PyTorch. Portanto, não há promessa de zero-copy até a GPU.

PySR, PySINDy, SAELens e TransformerLens são integrações opcionais, instaladas
separadamente. Jobs PySR periódicos podem ser habilitados por `symbolic_every`;
ficam desligados por padrão e não bloqueiam os ticks enquanto calculam. Equações ajustadas permanecem candidatas. O verificador Rust
calcula identidades polinomiais com racionais exatos; Lean pode verificar fontes
algébricos gerados explicitamente. Essas provas dizem respeito ao modelo
declarado, não certificam o ajuste empírico ou a realidade física.

Features esparsas não recebem significado humano automaticamente. Sondas medem
associação; TCAV mede sensibilidade do modelo; ambos exigem contexto e controles.
O projeto não demonstra AGI, consciência ou equivalência a um cérebro humano.

## Interface web

A aplicação estática usa o upstream SandboxScience fixado em submódulo e overlays
NOVA. As rotas incluem `/particle-life`, `/game-of-life` e `/nova-data`.
GitHub Pages não executa o binário Rust ou o Cortex. A ponte do navegador aceita
os formatos documentados no projeto, sem afirmar suporte direto a Arrow/Zarr.

```sh
# A partir da raiz do repositório; Node.js 22 e Git.
git submodule update --init --recursive
node scripts/sync-upstream.mjs
cd .web-build
npm ci
NUXT_APP_BASE_URL=/Nova/ npm run dev
```

O workflow Pages gera o site; a publicação depende da configuração de Pages no
GitHub. Nenhuma nova implantação foi feita nesta entrega.

## Código consolidado e estado da entrega

- [TXT Rust/WGSL](legacy/artifacts/NOVA_Rust_completo.txt).
- [TXT completo do workspace nativo e Cortex](legacy/artifacts/NOVA_codigo_completo.txt).
- [Evidências e limites da revisão](legacy/docs/native/STATUS.md).

Os TXT contêm **código-fonte**, com índice e hashes por arquivo; não são binários
compilados. Checagens Rust, WGSL e Python foram realizadas. Testes, simulações,
IPC, treinos, ferramentas científicas opcionais, Lean e benchmarks não foram
executados nesta revisão. Não há medição de FPS ou latência garantida.

## Licença e atribuições

A distribuição combinada usa [AGPL-3.0-or-later](LICENSE). O upstream web é de
Charly Luzzi / DicSo92; componentes incorporados mantêm suas atribuições e
licenças MIT, Apache-2.0, Unlicense ou AGPL conforme a origem.
Veja [notices](legacy/THIRD_PARTY_NOTICES.md) e o
[manifesto de fontes/referências](legacy/third_party/upstream.lock.json).
CellFlow e CatConway permanecem referências sem fonte copiado nas revisões
sem licença declarada. As bibliotecas opcionais Cortex não foram vendorizadas.
