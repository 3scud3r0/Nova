# NOVA Biocosm 0.3 — substratos, ciência e sementes

Esta revisão implementa uma plataforma experimental de vida artificial e descoberta sobre modelos numéricos explícitos. Não implementa toda a ciência, prova de consciência, descoberta automática de moléculas reais, física universal ou computação planetária já operacional. As instruções abaixo são procedimentos para execução futura: não foram executados novos testes, simulações ou benchmarks nesta entrega, por orientação do usuário.

## Começar em 3D

```bash
pip install -e .
nova cosm serve --preset organisms --size 32 --seed 42
# Abrir http://127.0.0.1:8765

# Alternativas: ink, lenia, conway, light, particles, fluid, nca, fixed
nova cosm serve --preset ink --seed 42
nova cosm render --preset lenia --output runs/lenia.html
nova cosm render --preset particles --kind volume --output runs/particles.png

# Simular e exportar checkpoint, sementes, dados, ledger, HTML e PNG
nova cosm run --preset organisms --seed 42 --ticks 100 --output runs/ecosystem-42
nova cosm render --resume runs/ecosystem-42/ecosystem.npz --output runs/inspection.html
nova cosm run --resume runs/ecosystem-42/ecosystem.npz --ticks 50 --output runs/continued-42
```

O visualizador não usa CDN: o HTML exportado contém volume, shader WebGL2 e grafo neural. Oferece raymarching com absorção/emissão ilustrativa, sombreamento por gradiente, amostras de sombra, câmera orbital e opacidade. WebGL2 é necessário no navegador; PNG e fatias são renderizados na CPU sem GPU nem dependência de imagem. A textura é quantizada em 8 bits apenas para exibição; não altera o estado científico float64/Q16. O painel de arquitetura exibe o primeiro organismo. A aparência volumétrica das criaturas representa a ocupação CPPN, não mecânica de músculos resolvida.

O servidor interativo escuta apenas em loopback. O navegador solicita ticks limitados por POST; não existe simulação oculta em segundo plano. Token de sessão e validação de Host protegem alterações locais; não há endpoint de shell, upload de código ou leitura arbitrária de arquivos. Um passo dispendioso pode reduzir a taxa visual; não foi medido FPS.

## Modelos físicos distintos

| Modo | Equação/algoritmo | Limites |
| --- | --- | --- |
| `gray_scott` / ink | ∂u=Du Δu−uv²+f(1−u); ∂v=Dv Δv+uv²−(f+k)v | Euler simultâneo, contorno periódico, subpassos limitados, clipping contabilizado |
| `fixed_gray_scott` / fixed | Mesmo estêncil em aritmética inteira Q16 | dx=1, coeficientes quantizados e arredondamento por piso; outro modelo discreto |
| `conway` | Vizinhança Moore, regras configuráveis | 2D B3/S23; padrão 3D B6/S567 explicitamente diferente |
| `lenia` | ∂a=2 exp[−(K*a−μ)²/(2σ²)]−1 | Convolução periódica FFT e saturação [0,1] |
| `fluid` | Advecção semilagrangiana, viscosidade implícita, projeção de pressão espectral | Fluido incompressível periódico simplificado; sem paredes, malhas adaptativas ou Navier–Stokes validado em turbulência |
| `wave` / light | ∂²w=c²Δw−γ∂w | Onda escalar; não Maxwell, fótons ou transporte radiativo físico |
| `particles` | Massa pontual com gravidade, arrasto e paredes refletoras | Sem colisões entre partículas ou dinâmica molecular |
| `nca` | Atualização neural local com percepção de canais/Laplacianos | Pesos iniciais fixos; não modelo de vida treinado |
| `hybrid` / organisms | Combinação de reação, fluido, onda e partículas | Acoplamento aproximado; sem conservação global exata |

A implementação suporta grades 2D/3D. São até 262.144 células, 4.096 partículas e 128 subpassos por tick. O preset limita arestas de grade a 64 e usa 32³ por padrão. O estimador de estabilidade controla difusão/onda; interpolação, clipping e acoplamento de organismos introduzem erro. Temperatura é um escalar advectado/difundido: não há solver termodinâmico fechado nem balanço ATP bioquímico. Injetar calor não demonstra termodinâmica real.

## Genomas, corpos e arquiteturas

`MorphogeneticCPPN` avalia funções seno, tanh, gaussiana, valor absoluto e linear em uma rede acíclica. Consultas corporais usam coordenadas e raio; consultas sinápticas recebem os dois extremos em seis coordenadas mais distância/constante. Pares com mesmo ponto médio podem ter conexões distintas. Densidade CPPN não é uma SDF: não se aplica sphere tracing com uma distância inexistente.

O desenvolvimento produz materiais/ocupação em voxels e um grafo dirigido. O sinal de todas as sinapses de saída depende do tipo E/PV/SST/VIP da origem. A família computacional pode ser taxa, AdEx, Hodgkin–Huxley ou porta lógica. Há limite explícito de neurônios HH e de arestas. O genoma inclui uma GRN digital e operações limitadas de adição/poda de arestas; mutações também podem recrutar/remover nós, alterar pesos e funções. Linhagens registram hashes dos pais.

O ecossistema integra efetivamente a dinâmica dos neurônios, converte sua atividade em forças, coleta sinais químicos e registra latentes. A morfologia altera massa, arrasto e custo; a locomoção é de corpos pontuais. Energia sintética alimenta manutenção, ação e reprodução; a divisão transfere energia parental e a morte recicla uma fração de recurso. Não há garantia de preservação ou emergência de organismos vivos em qualquer semente.

O preditor `EquilibriumWorldModel` aprende transições dos latentes produzidos pelo grafo. Depois de oito ticks, suas previsões participam de uma seleção limitada de ações de um passo, usando um readout de recurso aprendido e penalidade de esforço. É uma heurística experimental, sem demonstração de controle ótimo. A memória adaptativa armazena mapeamentos sob seu orçamento finito. Essa associação não identifica EqProp com Hodgkin–Huxley, não transforma bases ortogonais em conhecimento eterno e não demonstra vantagem sobre backprop.

```bash
# Busca real de arquiteturas dentro da gramática, tarefa de energia sintética
nova cosm evolve --population 4 --generations 4 --evaluations 16 --ticks 32 --output runs/evolution.json
nova cosm run --genome runs/evolution.json --seed 42 --ticks 100 --output runs/evolved-42
```

A busca usa sementes comuns por geração para reduzir confusão com a dificuldade do ambiente, aplica mutação/seleção, mede fitness e complexidade, mantém arquivo Pareto e avalia o campeão em três sementes separadas. O orçamento `--evaluations` cobre seleção; as três avaliações finais são adicionais e explicitadas no recibo. Não é NAS universal nem garantia de novidade científica. Compare contra arquiteturas fixas e outros otimizadores antes de alegar superioridade. Um genoma evoluído é um artefato completo: uma semente isolada não reconstrói mutações arbitrárias posteriores.

## Sementes reprodutíveis e limites de determinismo

```bash
# Trilha somente inteira, sem organismos ou eventos externos
nova cosm run --preset fixed --population 0 --size 16 --seed 42 --ticks 40 --tier strict_integer --output runs/integer-42
nova cosm reproduce runs/integer-42/holoseed.json --require-signature --output runs/reproduced.npz

# Reprodução float64 com comparação de estado completa
nova cosm reproduce runs/ecosystem-42/holoseed.json --require-signature
```

`NOVA-HOLOSEED-v1` contém semente uint64, motor/versionamento/hash dos fontes, parâmetros completos, geometria, regras, população inicial, relógio final, eventos e hash esperado. A assinatura Ed25519 identifica a chave emissora; não atesta a verdade científica de seu conteúdo. SHA-256 identifica conteúdo; não o comprime de modo reversível.

SplitMix64 tem aritmética uint64 especificada. No nível `strict_integer`, apenas Conway/Q16 sem população ou eventos aceitam equivalência inteira; o hash cobre arrays inteiros autoritativos e relógio. Esse contrato ainda precisa de avaliação em plataformas distintas. No nível `same_environment`, fingerprint registra Python/NumPy/SciPy/arquitetura; um fingerprint igual continua insuficiente para garantir bits iguais em bibliotecas BLAS/FFT/libm diferentes. Só a comparação do hash final informa se aquela execução coincidiu. Divergência retorna `mismatch` e código de saída 2.

O hash completo inclui o estado aprendido, membranas/adaptação, GRN, memória, genomas, RNG, eventos e histórico. A reprodução exige o mesmo código-fonte. Eventos de injeção/onda são dados limitados e reproduzidos em ordem, inclusive no relógio final. Pacotes são maiores que 64 bytes; não se promete reproduzir qualquer universo com um hash. Genesis com genomas personalizados inclui seus estados completos no manifesto e valida sua gramática e população. O parâmetro `--genome` aceita um genoma ou o campeão de `evolve`; o pacote não depende de inferir mutações a partir da semente. Estados iniciais arbitrários além desse contrato requerem checkpoint/artefatos adicionais.

Pacotes têm limite de bytes, passos, células, partículas, população, operações e trabalho agregado antes da simulação. Receber um pacote não inicia reprodução automaticamente. Os limites podem ser menores em hardware doméstico; não há medição de milhões de células ou consumo energético.

## Descoberta e prova com escopo

```bash
nova cosm run --preset ink --seed 42 --ticks 100 --output runs/chemistry-42
nova cosm discover --dataset runs/chemistry-42/dataset/observations.jsonl --target dv_dt --output runs/candidate.json
nova cosm verify --variables x y --lhs '(x+y)**2' --rhs 'x*x+2*x*y+y*y'

# Adaptadores opcionais e explícitos
pip install -e '.[science]'
nova cosm verify --backend z3 --variables x --lhs 'x*x' --rhs 'x**2'
nova cosm verify --backend lean --lean-project /caminho/projeto-mathlib --variables x y --lhs '(x+y)**2' --rhs 'x*x+2*x*y+y*y'
```

O fluxo de coleta registra trajetórias e sondas locais `(u,v,Δu,Δv)` com derivadas por diferenças finitas e unidades adimensionais. A regressão busca polinômios esparsos, racionaliza coeficientes e mede erro fora do treino e contra média constante. Quando há múltiplos grupos, separa trajetórias inteiras; com uma trajetória usa blocos ordenados, uma avaliação mais limitada. Grau, termos, dimensões e amostras são limitados. Campos acoplados podem não ter fechamento na biblioteca. Quando o manifesto original está disponível, o candidato também é comparado por álgebra exata à parcela Gray–Scott contínua declarada; diferenças nos coeficientes geram `refuted`, sem invalidar ou aprovar automaticamente os dados. Essa comparação não inclui o integrador acoplado. `distill_latent` oferece sondagem explícita de coordenadas do modelo de equilíbrio; omitir variáveis latentes pode invalidar uma equação reduzida.

Há três classes diferentes: observação sintética, candidato empírico e identidade do modelo provada. Normalização racional exata decide identidades polinomiais e derivadas de Lie de invariantes de EDO contínua. Z3 pode emitir `proved`, `refuted`, `unknown`, `vacuous` ou `unavailable`. Lean requer projeto Mathlib local já preparado; gera apenas uma identidade polinomial e a tática `ring`, com limites de tempo/heartbeats. Não baixa ferramentas ou executa scripts Lean recebidos de pares. `unavailable` nunca vira prova aprovada.

Uma identidade `dI/dt=0` cobre o campo vetorial codificado, não a conservação exata de um integrador nem a física real. Ajustar uma trajetória não resolve Navier–Stokes ou prova uma lei nova. Dataset JSONL tem cadeia de hashes, origem por semente e classe de evidência; um checksum nunca promove uma linha a verdade. O writer do dataset é local e de escritor único. Os recibos exigem revisão de hipóteses/modelo/dados antes de uso científico.

## Rede opt-in, artefatos e consenso numérico

```bash
pip install -e '.[swarm]'  # somente para WebSockets; TCP/TLS usa stdlib
nova cosm peer-id --directory runs/peer-a
nova cosm peer-id --directory runs/peer-b
# Preparar manualmente peers-a.json/peers-b.json com as chaves públicas identificadas:
# [{"peer_id":"<sha256-da-chave-publica-do-outro-no>","endpoint":"tcp://127.0.0.1:9002"}]
nova cosm node --directory runs/peer-a --peers peers-a.json --port 9001
nova cosm node --directory runs/peer-b --peers peers-b.json --port 9002
nova cosm sync --directory runs/peer-a --peers peers-a.json --peer-id <id-do-peer-b>
# Para compartilhar um run exportado, usar --directory runs/ecosystem-42
# Remoto: tls://host:porta ou wss://host:porta e certificado confiável.
```

O transporte oferece TCP enquadrado/TLS e WebSockets opcionais, mensagens Ed25519, admissão por identidade fixada, timestamps/nonces contra replay, cotas por par, limites de conexão/frame/blob e roteamento por distância XOR. Não implementa libp2p, descoberta global, NAT traversal, Sybil resistance, disponibilidade global ou DHT planetária. TCP/WS sem TLS aceita apenas loopback. A confiança TLS do sistema permanece obrigatória.

O CAS verifica hash antes de aceitar conteúdo e limita armazenamento. Blobs recebidos são inertes; anúncios entram como alegações em quarentena. Sincronização não executa código, simulações ou provas automaticamente. A rede transporta genomas, sementes e recibos; compartilhar origem e artefatos não significa incorporar habilidades.

Na API, `register_consensus(SheafGossip(...))` opta explicitamente por um modelo comum. O RPC `belief` faz atualização de consistência local com restrições e penalidade Huber; igualdade numérica não é prova de verdade ou consenso bizantino. `register_subspace(coordinate_id, U, rank_budget)` habilita RPC `subspace`: bases são validadas, unidas por SVD e rejeitadas quando o rank excede a capacidade. O fingerprint precisa incluir encoder e esquema de características. Encoders diferentes não podem compartilhar bases diretamente; uma matriz U contém direções protegidas, não o mapeamento funcional aprendido. Não há cópia automática dessas bases para todos os cérebros.

O ledger SQLite usa transações, assinatura e cadeia local de hashes. Um head externo confiável é necessário para detectar rollback; apagar o arquivo não é impedido criptograficamente. Chaves privadas ficam em `private/signing.key` com modo 0600 e não são transmitidas nem incluídas no TXT. Evite publicar diretórios de execução contendo chaves.

## Estado da entrega

Implementação e revisão estática não substituem validação de execução. Casos de avaliação futura em `tests/biocosm/` cobrem estênceis, estequiometria, replay, checkpoints, Dale, provas, isolamento entre coordenadas e admissão P2P. Não foram executados nesta revisão. Tampouco foram medidos FPS, energia, escalabilidade, desempenho evolutivo, provas Lean/Z3 ou comunicação real entre computadores.
