# NOVA 0.8 — organismos, substratos, busca e observação

O workspace nativo agora fica em `legacy/`, conforme a reorganização da `main`.
Esta revisão mantém o site SandboxScience na raiz e acrescenta quatro crates
Rust: `nova-substrates`, `nova-cognition`, `nova-evolution` e `nova-swarm`.
São componentes executáveis e APIs de pesquisa; não demonstram AGI, consciência,
um cérebro humano ou uma trajetória inevitável de evolução biológica.

## Compilar e usar

Todos os comandos abaixo partem de `legacy/`. São exemplos de uso futuro;
não foram executados como simulações nesta entrega.

```sh
cargo build --release --locked --features swarm
./target/release/nova substrates
./target/release/nova substrate --kind conway --ticks 10000
./target/release/nova substrate --kind conway-3d --live
./target/release/nova substrate --kind wireworld --live
./target/release/nova substrate --spec configs/research/lenia.json --live
./target/release/nova substrate --spec configs/research/neural-fusion.json --live
./target/release/nova substrate --kind gray-scott --ticks 1000 --output runs/chemistry
./target/release/nova autosearch --target-archive runs/atlas --substrate fusion --neural --islands 4 --epochs 10
./target/release/nova autosearch --target-archive runs/life-atlas --substrate conway --ticks 512 --no-observer
./target/release/nova observe --substrate conway --ticks 1024 --sleep-every 128 --output runs/observer
```

Sem `--live`, `substrate` funciona sem janela e pode gravar um TensorLake.
Sem `--output`, executa os passos em lote e atualiza a observação ao final.
`--live` oferece seleção de plugins, pausa, passo único, passos por quadro,
canal, pincel e observador. A imagem é uma projeção máxima em z do tensor,
não o renderizador líquido cinematográfico. A janela antiga de partículas
continua disponível por `nova fuse`; seu painel permite ativar organismos
neurais e controlar propulsão/recursos. Controladores neurais usam CPU;
o renderizador continua na GPU. Não foram medidos FPS ou aceleração.

## Contrato dos substratos

`Substrate: Send + Sync` expõe `name`, `step`, `observe` e `interact`.
`TensorView` empresta uma fatia contígua com forma `[canal,z,y,x]`; a referência
não pode sobreviver a uma mutação do substrato. Os adaptadores mantêm um cache
de observação. Converter partículas para voxels aloca/atualiza esse cache;
não há promessa de zero-copy entre o SoA de partículas e o tensor rasterizado.

| Pasta | Implementação |
| --- | --- |
| `conway/` | Conway/HighLife/Seeds 2D e Moore-26 3D; parser B/S[/R]; SIMD bitboard para 2D alinhado, raio 1; grade inteira geral nos demais casos |
| `particles/` | Particle Life, PVM e seis famílias fusion; ações por impulso/pincel; organismos opcionais |
| `fluids/` | Adaptador do MPM 3D existente, Gray-Scott 2D e solver 2D periódico por advecção semilagrangiana, viscosidade e projeção de pressão aproximada |
| `circuits/` | Wireworld inteiro exato, fios com pulso, pintura de condutores/cabeças e tabelas verdade para objetivos de busca |
| `lenia/` | Convolução FFT periódica 2D, kernel anelar normalizado e crescimento gaussiano |

A biblioteca de portas contém objetivos AND/OR/NOT/XOR; não afirma sintetizar
automaticamente circuitos Wireworld que realizem essas portas. O solver de
fluidos 2D tem 48 iterações de pressão, dissipação numérica e não é uma solução
exata de Navier–Stokes. Lenia não implementa Flow-Lenia conservativo.

`Registry::register` admite uma fábrica adicional sem alterar os gravadores ou
o observador. `nova_render::substrate::run_with_registry` abre os mesmos plugins
registrados por um programa consumidor. A CLI lista 17 nomes compilados; carregar
bibliotecas arbitrárias em runtime não faz parte do contrato.

Os quatro canais são densidade/ocupação, velocidade x, velocidade y e um canal
auxiliar. O auxiliar é energia nas partículas, espécie B em Gray-Scott, pressão
no fluido 2D, crescimento em Lenia e cabeça de elétron em Wireworld. É necessário
considerar o substrato ao interpretar unidades e canais. Nem todos os jogos têm
velocidade ou energia física; os canais ausentes permanecem zero.

## Organismos com memória

`nova-core::recurrent::Memory` usa quatro estados recorrentes. Os 16 bytes do
genoma codificam 32 pesos assinados de quatro bits: 16 recorrentes e 16 sensoriais.
A norma L1 de cada linha recorrente é limitada a 0,8; tanh e o vazamento de 0,25
resultam em limite de Lipschitz 0,95 para a atualização sob entrada fixa.
Isso é uma propriedade do controlador, não estabilidade garantida de todo o
universo físico. O registro de partícula mantém os 64 bytes; a memória fica em
uma estrutura auxiliar por ID, preservada durante reordenações espaciais.

O controlador recebe densidade, gradiente de recurso, fluxo relativo e tensão
local. Produz propulsão e um sinal de reprodução. Há custo basal/motor, recurso
espacial com orçamento global por tick, morte por energia zero e teto de população.
Pais maduros em colisão podem recombinar/mutar o genoma, dividindo massa e pagando
energia. A memória da filha começa em zero e sua linhagem registra ambos os pais.
A remoção de organismos mortos torna o sistema ecológico aberto/dissipativo;
não se afirma conservação global de massa/energia da população.

Sensoriamento e colisões respeitam a imagem mínima nas famílias periódicas.
Genomas neurais são distintos de bytecode PVM: a ativação substitui os genomas
e recusa PVM/MPM. `Universe::enable_neural`, `Universe.enable_neural()` no Python
e `nova_enable_neural` na C ABI expõem o mesmo controlador nativo.

## MAP-Elites e currículo

`autosearch` avalia especificações de ambiente em ilhas Rayon independentes.
A busca muta matrizes, amostra o catálogo de geradores, varia força/arrasto,
parâmetros de campos, regras B/S e fitas neurais/PVM conforme o substrato.
Os nichos têm dois eixos: entropia normalizada do histograma espacial e correlação
espacial entre frames consecutivos, usada como autocorrelação temporal.
A qualidade combina atividade, uma faixa intermediária de entropia, persistência
e progresso recente do preditor. Essa é uma função de fitness declarada,
não uma medida demonstrada de inteligência ou relevância científica.

As ilhas migram elites em anel a cada época, com fração padrão de 5%.
Não são migrações físicas entre populações já em execução: transferem-se
especificações de ambiente para novas avaliações. Avaliações estagnadas após
warmup encerram cedo; estados instáveis ou plugins recebidos incompatíveis
entram em `rejections.jsonl`, sem interromper toda a busca.

O atlas usa objetos JSON endereçados por SHA-256, versão do motor, parâmetros,
semente, métricas e orçamento da avaliação. `index.json` publica os vencedores;
`search-state.json` preserva RNG, ilhas e época concluída. Repetir o comando
retoma a busca; apenas `--epochs` pode aumentar sem mudar a configuração.
Existe um único escritor por atlas, protegido por `search.lock`. Se o processo
for morto abruptamente, confira se o PID saiu antes de remover o lock obsoleto.
A retomada recupera a última época concluída; objetos publicados antes de uma
interrupção podem ser revisitados. Não é um checkpoint integral das partículas.

O currículo usa mutação/seleção como gerador de ambientes e um preditor recorrente
como aluno. `--interventions` ativa seu controlador durante as avaliações;
`--no-observer` desliga o aluno. Não há otimizador bayesiano nem garantia de que
esse autojogo produza uma progressão monotônica de dificuldade.

## Observador e treino

O observador resume bordas, ocupação, centroide, quadrantes e fluxo em 16 atributos.
Um modelo recorrente de 16 estados prevê esses atributos no passo seguinte,
condicionado às ações. Ele aprende online por gradiente truncado de um passo,
com pesos limitados e projeção da recorrência. O controlador compara cinco ações
por rollouts de três passos, com exploração, homeostase e novidade limitada.
Isso é planejamento finito sobre um modelo aprendido pequeno; não previsão
perfeita de trajetórias nem uma implementação de Transformer/JEPA de larga escala.

Replay usa um reservatório limitado, amostragem por surpresa e ciclos de treino
sem avançar o ambiente. Nomes como visual, dorsal e replay descrevem funções
computacionais; não provam equivalência neuroanatômica, consciência ou um “eu”.

`observe` grava `observer.jsonl`, `world-model.json`, ações e tensores.
Apenas salvar pesos não restaura automaticamente todo o estado de um experimento.
O módulo Python `nova_engine.training` oferece leitores e adaptadores opcionais:

```python
from nova_engine.training import FieldTransitions, TrajectoryTransitions, torch_loader, jax_batches
fields = FieldTransitions("runs/observer", cache="runs/decoded-cache")
loader = torch_loader(fields, workers=0)
for transition in loader:
    inputs, targets = transition["input"], transition["target"]
    # Aplicar aqui o modelo e o otimizador escolhidos pelo pesquisador.
```

Arrow IPC usa `mmap` e pode expor colunas primitivas sem cópia. A correspondência
por ID entre frames de partículas faz gathers e aloca. Zarr comprimido precisa
de descompressão; o cache `.npy` permite mmap em épocas seguintes. PyTorch recebe
cópia gravável e JAX pode copiar para o dispositivo. As transições de campos
incluem ações registradas quando disponíveis. Essas cópias são explícitas;
não se promete mmap direto de tensores comprimidos ou zero-copy até a GPU.
Instale `.[training]` no pacote nativo e o framework desejado separadamente.

## Recompensas verificáveis

```sh
./target/release/nova verify --claim configs/research/oscillator-invariant.json --output runs/receipt.json --share-directory runs/atlas
./target/release/nova rlvr --claim configs/research/oscillator-invariant.json --steps 128 --output runs/proof-policy.jsonl
./target/release/nova verify --lean-project /caminho/projeto-mathlib --output runs/lean-receipt.json
```

O verificador polinomial calcula exatamente `∇I · f` com racionais arbitrários,
com limites de termos, grau e trabalho. O recibo vincula a conclusão ao hash da
hipótese. `rlvr` aprende probabilidades de máscaras de termos; recebe +1 somente
para identidade exata não constante, depois da canonicalização. Não recompensa
uma estimativa numérica pequena ou termos que se cancelam para a identidade zero.

O modo Lean executa apenas a identidade algébrica fixa embutida, com `by ring`,
no projeto local escolhido. Recibos de indisponibilidade, falha ou timeout não
recebem recompensa. Esse teorema não valida leis arbitrárias propostas pelo
modelo, nem a implementação numérica. Recompensas formais não são misturadas
à homeostase/curiosidade do controlador como se provassem a ação física.
O Lean não foi executado nesta entrega.

## P2P e compatibilidade de seções

```sh
./target/release/nova swarm --directory runs/atlas --identity runs/node.key --listen /ip4/0.0.0.0/tcp/4400 --peer /ip4/192.0.2.10/tcp/4400/p2p/ID_DO_PEER --seconds 300
```

Use endereços reais e IDs dos seus próprios nós. P2P exige `--features swarm`.
São TCP, Noise, Yamux e Gossipsub assinado, com identidade persistente; não há
bootstrap público ou conexões durante a compilação. O padrão escuta apenas em
loopback. Não se oferece descoberta planetária automática, NAT traversal ou relay.

Nós publicam nichos ativos e envelopes do `proof-outbox`. Elites recebidas entram
em `inbox`; o `autosearch` as reavalia localmente com seu próprio orçamento antes
de promover resultados. Recibos polinomiais recebidos são recalculados localmente;
nenhum fonte Lean recebido é executado. Proveniência por assinatura e hash não
transforma a pontuação de outro nó em verdade científica.

`coherence::CoherenceGraph` compara seções com o mesmo contexto explícito,
restringindo a comparação a nomes compartilhados e conferindo unidades e
valores dentro de uma tolerância. Conflitos são contados sem sobrescrever a seção
anterior. Isso é uma auditoria finita de sobreposições, não um teorema global de
colagem, consenso físico ou implementação completa da teoria de feixes.

## Verificações e limites da entrega

A revisão foi checada por compilação Rust, validação de WGSL no build e sintaxe
Python. Não foram executados novos testes, simulações, autojogos, treinos, Lean,
benchmark, janela gráfica ou rede P2P. A matriz de CI compila Linux/Windows/macOS;
seus resultados remotos devem ser consultados no PR. Não há promessa de 5.000 FPS,
meses de evolução em dias ou emergência inevitável de inteligência.
