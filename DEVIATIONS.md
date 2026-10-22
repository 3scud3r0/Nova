# Decisões e limites de implementação

- A especificação referencia EDOs de uma conversa que não foi anexada. A cascata usa equações de difusão entre reservatórios com capacidades geométricas explicitadas no código; chama-se `DiffusiveCascade`, sem alegar reprodução exata das equações ausentes.
- `eps_ortho = ||U.T dW||` é exposto literalmente, mas não é uma condição necessária de retenção quando dW já aprendeu antes de consolidar U. `eps_update` mede a ortogonalidade da atualização efetiva.
- SVD incremental usa a representação comprimida `[U*S, X.T]`; não armazena todas as amostras históricas. Truncamento é uma ablação e perde a garantia completa.
- A entrega de código abrange as fases; aprovação científica é separada. Módulos sem ganho demonstrado permanecem experimentais, sem ativação automática no runtime padrão.

- A Fase 3 implementa a opção documentada de congelar camadas inferiores após a primeira tarefa. Em Split-MNIST o span completo satura; não foi demonstrada competitividade de acurácia com GPM. Não se reduz o rank silenciosamente para obter um resultado favorável.
- Split-MNIST e Permuted-MNIST executados usam amostras reduzidas; protocolos completos precisam de execução específica. O download oficial de CIFAR-100 foi bloqueado pelo proxy (CONNECT/HTTP 403 em `www.cs.toronto.edu`).
- O benchmark de controle usa DQN offline sobre as mesmas transições do modelo aprendido, porém ações discretas vs ações contínuas do CEM. Não é uma comparação definitiva de eficiência amostral online.
- O kernel Rust CPU é a trilha nativa solicitada no segundo documento. Há kernel Triton de referência, não executado sem CUDA. Energia/NVML e bitnet.cpp não foram medidos. A medição de memória considera o armazenamento dos pesos; não inclui todo o processo.
- EqProp foi implementado em uma energia quadrática convexa, com relaxamentos livre/forçado e comparação contra derivação implícita. Não se alega validação de EqProp não linear em escala.
- A simulação N2 usa compartimentos ramificados simplificados e canais Ca/Ih fenomenológicos. N1/N2 e o microcircuito não foram ajustados a registros biológicos. A banda dominante medida não atende, por si só, ao requisito de gama cortical realista.
- Encoders de imagem/áudio/texto, slots e fusão têm implementações e testes de operação. Treino multimodal completo, testes de ilusões e rastreamento visual de longo prazo não foram realizados. Perfis cluster/neuromórfico não são apresentados como implementações distribuídas prontas.
- A integração padrão usa um corpo linear 2D, além dos ambientes independentes de pêndulo e grid. Há um corpo pontual 3D com gravidade, colisões e controle de atraso, sem renderizador; adicionado na revisão final e não testado após a orientação de dispensar novos testes. Interlocutores sociais aprendidos e voz expressiva não estão implementados.
- As ablações dos neuromoduladores verificam efeitos dos sinais, não benefício comportamental geral. Regras de homeostase, Oja/STDP e poda estão disponíveis; não foi executado o ensaio de estabilidade de um milhão de ticks.
- A linguagem factual é um verbalizador controlado. O adaptador de LLM local gera rascunhos; ajuste LoRA, avaliação cega de estilo e naturalidade dependem de modelos/dados adicionais. OCR e transcrição requerem dependências externas opcionais.
- Identidade usa fontes estruturadas e revisão humana. A extração livre de fatos não é tratada como resolvida. Testes de memória usam dados fictícios, sem alegar validação de fidelidade de pessoa real.
- O pedido posterior de implementar todas as fases permite entregar os módulos experimentais após executar e registrar cada ensaio, mesmo quando o critério científico não é atingido. Isso não promove hipóteses reprovadas a resultados aceitos.


## Revisão 0.2 — análise de capacidade, inferência e busca

- `AdaptiveSubspaceLinear` separa projeção exata atual, decaimento de evidência, liberação explícita e recrutamento limitado. Não promete aprender infinitamente com retenção irrestrita. Âncoras são reinseridas mesmo após envelhecimento de evidência; não são descartadas por truncamento relativo silencioso.
- Recrutamento usa blocos não lineares versionados. A preservação dos dados antigos depende de sua versão de características. Re-encoding com novos blocos é um protocolo diferente e pode alterar a resposta.
- A evidência da variante adaptativa é diagonal e transportada por sobreposições entre bases. Não equivale à covariância histórica exata após rotações/liberações; a camada `ProtectedLinear` de referência mantém sua implementação anterior.
- EqProp não linear foi implementado em uma rede de taxa simétrica contrativa com duas fases `±beta`, encoder alvo EMA e mensagens locais. Evitar autograd não prova vantagem energética e não identifica essa dinâmica com o cérebro AdEx.
- O perfil AdEx produz as ativações usadas pela cognição, mas continua sendo um modelo biofísico não calibrado. A regra STDP, quando explicitamente ativada, pode produzir drift. Não se alega equivalência entre seu aprendizado e EqProp.
- A dimensionalidade da busca de ações do CEM é H×action_dim. A nova comparação não atribui incorretamente ao solver uma busca direta em D×H dimensões latentes.
- Planejamento por energia usa derivadas implícitas/analíticas e recursão adjunta, com feixe temporal opcional. Isso elimina a dependência de autograd nesse caminho, mas não elimina toda propagação reversa de informação matemática.
- Curiosidade com diferença de erro de um passo tem viés positivo sob ruído. O novo estimador com janelas e margem amostral reduz esse viés sem alegar proteção absoluta contra todo ruído.
- Nenhum novo teste/benchmark foi executado nesta revisão, conforme a preferência anterior do usuário. As suítes novas e experimentos 10–12 foram escritos para avaliação posterior; não são evidência já produzida.


## Revisão 0.3 — Biocosm e compartilhamento científico

- O pedido de “toda a ciência e matemática” é aberto: foram implementados substratos e gramáticas explicitamente delimitados, com pontos de integração. Não é um simulador universal ou descoberta irrestrita de arquiteturas/leis.
- Gray–Scott, Lenia, Conway, fluido projetado, ondas escalares, partículas e NCA são algoritmos distintos. Misturar seus campos não prova leis fundamentais emergentes. O modo “light” é uma onda escalar; renderizar luz não resolve Maxwell.
- Corpos CPPN têm ocupação/material em voxels e afetam massa, arrasto e energia de uma mecânica pontual. Densidade não é SDF. Não há músculos deformáveis, colisões de corpos completos ou ATP bioquímico.
- CPPN de pares usa as duas posições; rede mista integra efetivamente taxas/AdEx/HH/lógica. Há limites de nós, HH e sinapses. Evolução pode adicionar/remover nós/arestas dentro de uma gramática finita; não equivale a descobrir qualquer arquitetura.
- O caminho Biocosm usa NumPy/SciPy em CPU. A existência de kernels ternários Rust anteriores não torna seus campos em uma simulação ternária, nem sustenta milhões de células com energia desprezível.
- HoloSeed é um manifesto versionado completo, assinado opcionalmente; não uma codificação universal de 64 bytes. Sementes exigem o mesmo motor e genesis, e genomas evoluídos precisam de artefatos próprios. Q16/Conway possuem trilha inteira restrita; float64 exige verificação posterior de hash, mesmo com fingerprint igual.
- Normalização polinomial, Z3 opcional e Lean/Mathlib local comprovam apenas as afirmações modeladas. Nenhum checksum ou assinatura transforma uma observação sintética em verdade física. Não há integração automática com literatura externa, química quântica ou prova de Navier–Stokes.
- A rede usa pares explicitamente fixados, TCP/TLS ou WebSockets, CAS e roteamento XOR limitado. Não implementa libp2p/DHT global, NAT traversal ou consenso bizantino. Nenhum nó público foi iniciado nesta entrega.
- União de bases exige encoder/coordenadas compatíveis e rank disponível; transfere restrições, não habilidades. Feixes alinham valores locais dentro de um modelo declarado; concordância pode estar errada.
- Ledger é uma cadeia local assinada e transacional, não um blockchain imutável. Um head externo é necessário para detectar rollback completo. Recebimentos de rede ficam inertes/sem verificação científica automática.
- Testes novos foram escritos para avaliação posterior. Não foram executados testes, simulações ou benchmarks novos nesta revisão; verificação foi estática. Consulte `docs/biocosm.md` e `reports/biocosm/STATUS.md`.


## Revisão 0.4 — infraestrutura planetária experimental

- A premissa de que 0.3 “provou viabilidade” não corresponde à entrega anterior sem testes/simulações. A 0.4 acrescenta implementação e checks estáticos, sem reivindicar essa comprovação.
- Campos Rust/Rayon/wgpu são um solver f32 distinto; a projeção de pressão é iterativa. A feature WebGPU valida WGSL no build. O ecossistema de organismos não foi todo transferido para GPU/Rust. HH em batch é de um compartimento independente e não há kernels intrínsecos AVX-512/Neon.
- Não foram medidos 60 FPS, 100 mil entidades, 20 W ou 4K. 512³ não está habilitado; 256³ pode exceder memória/limites do adaptador. Cópias PyO3/readbacks e overhead não desaparecem. Exportação nativa não é checkpoint retomável ou HoloSeed portátil.
- O jogo de linguagem usa oito tokens, feedback supervisionado sobre contextos instrumentados e recompensa sintética. A associação altera o controle e tem holdout, mas não demonstra sintaxe, semântica natural ou compreensão de frases. Banco coclear e ecos são componentes separados, sem solver acústico completo integrado.
- Nichos fenotípicos são bins descritivos. Crossover exige homologia; energia de filhos vem do progenitor que se divide. Esporos transferem genomas completos e imigração adiciona energia contabilizada, não habilidades treinadas instantâneas.
- Busca transcendental é finita e verifica domínios. Derivada fracionária tem pré-história zero/truncamento. Hamiltonianos são candidatos condicionais ao campo canônico; identidade de cancelamento não descobre simetrias de Noether nem prova adequação à realidade.
- Lean automático usa templates polinomiais locais. Só publica `.lean` após compilação e comparação do hash do fonte compilado. Sem Lean registra indisponibilidade, nunca aprovação. Expressões transcendentes não têm prova Lean universal automática.
- Descoberta é XOR iterativa com descritores assinados e bootstrap/mDNS opcionais. Não implementa interoperabilidade libp2p completa, não fornece bootstraps globais nem TURN público e não garante atravessar NAT. WebRTC opcional negocia SDP assinado; o signaling inicial ainda precisa ser alcançável.
- Buscas cruzadas são avaliações limitadas de identidades/domínios e do oscilador codificado, sem execução arbitrária de simuladores remotos. Não há experimento efetivo com 50 nós/24 horas. Nenhum protocolo aceita ausência de contraexemplo como prova formal. Assinaturas não impedem Sybil/colusão e o ledger continua local.
- Browser, rede, migração entre máquinas e Lean não foram executados nesta revisão. Novos testes foram escritos sem execução. Checks estáticos Rust CPU/WebGPU/Naga e Ruff não substituem validação empírica ou auditoria de uma implantação pública.


## Revisão 0.5 — Chromatic

- A implementação de Particle Life e PBF usa shaders GPU reais. O renderer de superfícies usa espessura e filtro bilateral; SSS, película RGB, DOF e ambiente são aproximações artísticas. Não se alega equivalência com cinema offline.
- MPM/APIC/FLIP CPU, StVK, HB, DLVO, Gibbs/Onsager, SSA, DEC, Clifford, Yoshida, catástrofes, SDF e bricks esparsos são referências separadas. Não constituem um solver universal acoplado. Não há NanoVDB GPU, BDPT ou ReSTIR completo.
- Limites de vizinhos/correção/velocidade são explícitos e instrumentados; 100 mil partículas e 4K são opções limitadas por orçamento, sem desempenho validado. Nenhuma promessa de 60 FPS, 20 Watts ou conservação exata sob limites e paredes.
- O estúdio exporta parâmetros, eventos, versão e hashes, com checkpoint opcional; operações f32/atômicas não garantem identidade entre GPUs. Hash não é prova formal de ciência.
- Foi feita inspeção visual pequena com Chromium/SwiftShader, além de checks estáticos. As novas suítes numéricas e benchmarks não foram executados. Detalhes em reports/chromatic/STATUS.md.
