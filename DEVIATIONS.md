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
