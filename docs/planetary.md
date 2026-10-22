# NOVA 0.4 — Biosfera Planetária experimental

A revisão amplia a infraestrutura implementada em 0.3; não transforma código não avaliado em prova de viabilidade. Não foram executados testes, simulações, comunicação entre máquinas, medições de energia/FPS ou provas Lean nesta entrega. As verificações foram estáticas: Python/Ruff, tipos Rust CPU/WebGPU e análise/validação do shader de campos por Naga durante o build e parsing JavaScript (`node --check`), sem abrir o browser.

## Iniciar uma sessão

```bash
pip install -e .
nova cosm start --seed 42 --directory runs/world-42 --open-browser
# Viewer: http://127.0.0.1:8765 ; atlas: http://127.0.0.1:8765/atlas
# Se o navegador não oferece WebGPU:
nova cosm start --renderer webgl --directory runs/world-42-gl

# Restaurar o estado local, inclusive aprendizado e sinalização
nova cosm start --resume runs/world-42/ecosystem.npz --directory runs/world-42

# Terminal sem interface, com janela de execução limitada
nova cosm join --duration 600 --directory runs/node-42
```

`start` integra o viewer, um loop limitado de simulação, arquivo de linhagens, busca simbólica periódica, fila de provas e nó local. A biosfera avança em segundo plano; o navegador recebe snapshots e pode pausar/retomar. CPU lenta reduz a cadência: o intervalo configurado não garante taxa real. O orçamento padrão é 10.000 ticks; o nó continua atendendo após esgotar esse orçamento, sem avançar automaticamente a simulação. `join` tem duração explícita. Encerramento salva checkpoint Python, atlas JSON/HTML e encerra os serviços da sessão. Chaves são persistentes e privadas; o diretório não deve ser publicado integralmente.

O padrão de computação é Python e o de exibição é WebGPU no navegador. O renderer WebGL2 anterior permanece selecionável. O browser WebGPU renderiza um volume quantizado recebido do servidor, com absorção/emissão ilustrativa e câmera orbital; não compartilha diretamente VRAM com o processo Rust. A resolução visual está limitada a 1920×1080 nesta implementação. Não há promessa de 4K/60 FPS, fotorealismo, oceanos fisicamente completos ou dezenas de milhares de criaturas.

## Campos nativos residentes em Rust e wgpu

```bash
# Somente CPU/Rayon, CPPN, HH independente e AdEx já existente
maturin develop --manifest-path nova-core/Cargo.toml --release
nova cosm native --backend rust --size 32 --ticks 100 --fluid --output runs/native.npz

# Feature opcional; requer driver/adaptador compatível com wgpu
maturin develop --manifest-path nova-core/Cargo.toml --release --features webgpu
nova cosm native --backend webgpu --size 64 --ticks 100 --fluid --output runs/gpu.npz
nova cosm start --backend webgpu --size 64 --directory runs/gpu-view
```

`NativeField` e `GpuField` mantêm células residentes f32 com química, onda, velocidade e pressão. Um chamado avança vários ticks; snapshots são readbacks explícitos. O pipeline implementa reação-difusão simultânea, onda amortecida, advecção semilagrangiana de velocidade, viscosidade explícita e projeção de pressão por iterações de Jacobi. Divergência retrógrada/gradiente progressivo produzem o mesmo Laplaciano periódico usado no solve. A projeção é aproximada e sua convergência depende das iterações; não é o solver espectral float64 anterior.

Os kernels WGSL fazem ping-pong entre buffers. Dispatch em duas dimensões respeita o limite de workgroups; tamanho de storage, buffers e memória são conferidos antes da alocação. A feature WebGPU ativa a validação sintática/semântica do shader por Naga no build. `wgpu` escolhe um backend disponível; a disponibilidade de Vulkan/Metal/DX12 depende do sistema, não do nome do comando.

O limite de aresta é 256 e o orçamento padrão contabiliza três buffers de 48 bytes por célula (512 MiB). Uma grade 256³ exige aproximadamente 2,25 GiB apenas nesse orçamento; pode ser recusada pelo adaptador ou precisar de orçamento maior. 512³ não está habilitado. Também existem cópias temporárias no Python, listas PyO3, readback e overhead do driver: o orçamento de buffers não é memória total do processo. Os snapshots nativos exportam campos observáveis, têm hash e são marcados **não retomáveis**; não incluem todo o estado necessário para continuar pressão/onda e não são HoloSeeds reprodutíveis.

Os backends são distintos. `start --backend rust/webgpu` executa campos nativos sem organismos Python; não migra silenciosamente o ecossistema inteiro. Os wrappers `cppn_native` e `independent_hh_native` expõem batches Rayon, e o kernel AdEx anterior continua disponível. HH em batch é de células independentes de um compartimento; acoplamento dendrítico arbitrário permanece no caminho Python. O compilador pode vetorizar, mas não há kernels explícitos AVX-512/Neon nem medição que comprove SIMD ou vantagem energética. Cem mil organismos, milhões de células a 60 FPS e consumo <20 W continuam sendo metas não demonstradas.

## Sinalização, aprendizado e linhagens

A sessão Python `start/join` habilita por padrão um jogo de sinalização com oito tokens e quatro contextos instrumentados de recurso/temperatura. `--no-signaling` desliga; os comandos 0.3 preservam seu padrão sem esse jogo. Emissão tem período/custo, alcance, atraso por distância, atenuação e filas limitadas. Receptores aprendem associações e a interpretação altera o ganho motor. Emissores/receptores recebem feedback supervisionado do jogo e recompensa energética artificial explicitamente contabilizada. Esse contexto privilegiado pertence ao avaliador, não é uma tradução inferida sem rótulos.

O painel apresenta padrões e associações somente após mínimo de observações de treino/holdout e acurácia suficiente. Informa também informação mútua e amostragem. Não demonstra sintaxe, palavras naturais, causalidade semântica, cooperação complexa ou cérebros obrigados a inventar linguagem. Sinais discretos e as legendas de contexto não são descrições literais do pensamento do organismo. O jogo usa tabelas locais de reforço; não substitui todo o aprendizado por uma regra neurobiológica.

`CochlearBank` oferece filtros passa-faixa streaming com estado e energia RMS. `image_source_echoes` calcula caminhos diretos e imagens de primeira ordem em uma caixa refletora. São componentes numéricos para experimentos de áudio; o canal do ecossistema continua sendo uma abstração de pacotes, separada do campo periódico e do modelo de caixa. Não há solver acústico completo com difração/Doppler.

`LineageArchive` registra pais, geração, energia e nichos fenotípicos finitos. O atlas projeta esses registros e suas relações em um mapa 3D interativo; não infere países ou espécies biológicas reais. `start/join --crossover-rate 0.1` permite cruzamento entre genomas de configurações homólogas seguido de mutação; taxas zero desativam. A energia do filho vem do progenitor que se divide; o segundo fornece genes. Genomas imigrados podem participar desse cruzamento se compatíveis.

## Descoberta não polinomial e Hamiltonianos

```bash
# NPZ local, sem pickle: arrays x (N,D) e y (N,)
nova cosm nonlinear --input observations.npz --variables x y --output runs/nonlinear.json
# NPZ local: states e derivatives (N,2d); ordem q...,p...
nova cosm hamiltonian --input oscillator.npz --variables q p --basis 'q*q' 'p*p' 'cos(q)' --output runs/hamiltonian.json
```

Árvores aritméticas limitadas aceitam `sin`, `cos`, `exp`, `log`, `sqrt`, produtos, divisões e potências inteiras pequenas, sem `eval`, imports, chamadas arbitrárias ou código remoto. Avaliação rejeita valores não finitos e violações de domínio; derivadas usam regras analíticas. A busca esparsa usa uma biblioteca finita de operadores/combinações, penalidade de complexidade e holdout. Não é uma gramática infinita nem um método universal de descoberta. Operadores fracionários são disponibilizados numericamente por Grünwald–Letnikov com memória finita e pré-história zero; não são uma prova simbólica de cálculo fracionário. Produto vetorial é explícito e restrito a vetores de três componentes.

Hamiltonianos são ajustados contra o campo vetorial medido `xdot = J grad H`, com derivadas analíticas da biblioteca e erro fora do treino. A identidade de cancelamento `Hq Hp − Hp Hq = 0` é algébrica e condicional ao modelo autônomo diferenciável. Não prova que dados/organismos obedecem a esse modelo, nem descobre automaticamente uma simetria de Noether ou torna um integrador conservativo. O intervalo de energia observado e os erros continuam parte do candidato.

Na sessão autônoma, sondas químicas alimentam uma busca a cada 64 ticks, com janela limitada, manifesto HoloSeed e dataset com proveniência. Candidatos transcendentes permanecem sem prova formal automática; candidatos polinomiais podem ser comparados ao termo Gray–Scott declarado, que exclui acoplamento e erro numérico. Encontrar diferenças gera refutação dessa identidade, sem maquiar o resultado. Seeds/fonte/ambiente continuam vinculados à versão do motor; pacotes 0.3 não são silenciosamente declarados equivalentes à 0.4.

## Fila de provas e publicação de `.lean`

```bash
nova cosm proof-submit --directory runs/proofs --variables x y --lhs '(x+y)**2' --rhs 'x*x+2*x*y+y*y'
nova cosm proof-daemon --directory runs/proofs --once
# Projeto Mathlib local já preparado, sem downloads automáticos:
nova cosm proof-daemon --directory runs/proofs --lean-project /caminho/mathlib
```

O worker usa lock de arquivo, valida conteúdo/gramática, verifica identidades por aritmética racional e opcionalmente pede ao Lean/Mathlib sua compilação. Só após aprovação do Lean escreve `theorems/thm_<hash>.lean`. O hash do arquivo deve coincidir com o fonte que foi compilado. Sem a ferramenta, registra `unavailable`; com timeout, `unknown`; uma identidade racional aprovada continua distinguível de uma prova Lean compilada. Templates atuais de Lean são polinomiais (`ring`). Não há provador universal de expressões transcendentes ou EDPs.

Os jobs de rede, descoberta científica e provas são limitados e independentes do avanço do bioma; um bootstrap indisponível ou um compilador lento não precisa bloquear o loop principal.

O worker não executa `.lean`, táticas ou imports recebidos de pares. O projeto/toolchain Mathlib local é uma dependência de confiança configurada pelo operador. Provas cobrem o modelo e hipóteses declarados; nem assinatura nem compilação provam adequação à realidade. A sessão integrada consulta a fila em segundo plano independentemente de sua descoberta periódica.

## Descoberta dinâmica, bootstrap e NAT

```bash
pip install -e '.[swarm]'
# Publicar um descritor da própria chave e endpoint; exemplo local:
nova cosm descriptor --directory runs/node-a --endpoint tcp://127.0.0.1:9001 --output runs/a.json
# bootstrap-b.json deve conter uma lista JSON com o objeto assinado de a.json.
nova cosm join --directory runs/node-a --port 9001 --advertise tcp://127.0.0.1:9001 --allow-lan --duration 600
nova cosm join --directory runs/node-b --port 9002 --advertise tcp://127.0.0.1:9002 --bootstrap bootstrap-b.json --allow-lan --duration 600

# LAN real: endereço de interface explícito e mDNS/DNS-SD opcionais
nova cosm join --allow-lan --mdns-ip 192.168.1.10 --advertise tls://host-com-certificado:8766 --certfile cert.pem --keyfile key.pem

# WebRTC com STUN/TURN fornecidos pelo operador
pip install -e '.[webrtc]'
nova cosm join --bootstrap bootstrap.json --advertise tls://host-publico:8766 --certfile cert.pem --keyfile key.pem --ice-file private/ice.json
```

Descoberta usa descritores Ed25519 expirantes, buckets por distância XOR, capacidade limitada e consultas iterativas com fanout três. Não é o protocolo libp2p/Kademlia interoperável completo nem uma DHT planetária já lançada. É necessário pelo menos um bootstrap alcançável ou descoberta mDNS na mesma LAN. Não foi criada uma lista fictícia de nós públicos. Sem âncora, a sessão permanece isolada e informa zero pares; `join` não encontra a internet espontaneamente.

Pares remotos exigem TLS/WSS com validação de certificado do sistema. Descritores são autodeclarados, não certificados de honestidade. Endereços descobertos são resolvidos, verificados contra redes privadas por padrão e fixados para conexão, preservando a verificação do hostname TLS. `--allow-lan` permite endereços privados explicitamente. Descritores expirantes são removidos; identidade, nonce, tamanho e taxa continuam verificados.

WebRTC usa `aiortc`, SDP assinado sobre RPC autenticado e data channels DTLS que carregam as mesmas mensagens assinadas. Não fornece servidores TURN, credenciais ou acesso através de todo NAT. Sem LAN habilitada, candidatos ICE remotos privados/não literais são filtrados. Configuração ICE local pode conter credenciais e não é publicada. A conexão RPC de bootstrap/signaling precisa ser alcançável antes da negociação WebRTC; não existe rendezvous universal ou relay implícito. Uso de UDP/TLS e certificados depende das políticas de rede da máquina.

## Migração e refutação cruzada

```bash
# Recepção em quarentena é padrão; admissão automática precisa estar habilitada
nova cosm join --bootstrap bootstrap.json --migration --validate-challenges --duration 3600
nova cosm spore --directory runs/node-a --genome runs/evolution.json --output runs/spore.json --send-peers runs/node-a/peers.json

# Identidade em domínio finito, ou derivada de invariante do oscilador q'=p,p'=-q
nova cosm challenge --lhs 'q*q+p*p' --kind oscillator_invariant --variables q p --bounds '[[-5,5],[-5,5]]' --samples 512 --local
nova cosm challenge --lhs 'x*x' --rhs x --variables x --bounds '[[-2,2]]' --send-peers runs/node-a/peers.json
nova cosm aggregate --receipts receipts.json --challenge <hash-do-envelope-do-desafio>
```

Esporos transferem o genoma completo, assinatura, validade e proveniência, não só um hash ou o estado neural treinado. Admissão verifica hash, gramática, orçamento de desenvolvimento, população, cooldown e cota total. Cada imigração vira um evento do HoloSeed com genoma, posição e energia; a energia de imigração é uma fonte externa contabilizada. A reprodução desse evento não depende do relógio de expiração original. O mecanismo permite movimento e cruzamento de linhagens, sem prometer transferência instantânea de habilidades. O envio periódico escolhe organismos maduros e limita destinatários/frequência. Campos nativos sem organismos não admitem esporos na biosfera.

Desafios e recibos são assinados. A implementação faz buscas finitas em domínios declarados: identidades por avaliação e invariantes do oscilador por derivada no campo codificado. Não executa automaticamente organismos arbitrários recebidos ou simulações hostis extensíveis em máquinas alheias. Amostragem inclui extremos e sementes independentes por chave; receptores precisam habilitar o worker. Fanout do comando é no máximo 50 pares já conhecidos; não se inventa sua existência.

O protocolo distingue `counterexample_found`, `no_counterexample_within_budget`, `domain_inconclusive` e `expired`. Agregação deduplica chaves e retorna evidência finita, contraexemplo reportado ou inconclusão. **24 horas sem refutação não produzem prova.** Assinaturas atestam relatos, não execução honesta ou independência humana; ataques Sybil/colusão continuam possíveis. O ledger permanece local e encadeado, sem consenso global/imutabilidade. Um contraexemplo relatado precisa de reprodução local para adquirir confiança científica.

## Limites e avaliação pendente

Filas, frames, conexões, bytes, passos, operadores, arquivo de linhagens e cotas de desenvolvimento são limitados. O worker de refutação processa no máximo 4.096 tarefas por sessão. Os valores podem exigir redução em hardware doméstico. Nenhum componente é promovido por alegações de escala não medidas.

Testes em `tests/planetary/` foram escritos para avaliação futura, incluindo domínios/derivadas, Hamiltonianos, canais, crossover, imigração/replay, evidências assinadas e equivalência dos batches nativos. Não foram executados. Tampouco foram executados o browser, WebRTC, mDNS, nós externos, Lean ou benchmarks. Os checks estáticos não validam runtime, segurança de uma implantação pública ou resultados científicos. Consulte [o registro desta entrega](../reports/planetary/STATUS.md).
