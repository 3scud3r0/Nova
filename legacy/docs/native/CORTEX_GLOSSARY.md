# Vocabulário e referências do Cortex

| Termo | Significado no código | Limite |
| --- | --- | --- |
| Belief state / latent state | Vetores h/z do RSSM e seus parâmetros distribucionais | Não são uma leitura literal de pensamentos |
| Recurrent State-Space Model | GRU, prior gaussiano e posterior condicionado à percepção | Inspirado em world models; não replica toda a receita DreamerV3 |
| Variational free energy | Reconstrução/KL no aprendizado e surrogate de energia livre esperada no controle | Ganho de informação usa proxy de ensemble |
| Mechanistic interpretability | Features SAE, ablação, sondas, TCAV e evidências registradas | Não converte toda ativação em uma explicação causal |
| Sparse dictionary learning | Codificação overcomplete Top-K ou L1, decoder normalizado | Esparsidade não garante monossemântica |
| Linear probing | Regressão/classificação ridge com holdout explícito | Bom desempenho é associação mensurada |
| TCAV / CAV | Direção de conceito e derivada de uma saída ao longo dela | Sensibilidade depende do modelo, dos controles e do dataset |
| Symbolic distillation | Busca PySR em processo separado sobre dados alinhados | Fórmulas são candidatas |
| SINDy / STLSQ | Biblioteca de funções e regressão esparsa de derivadas numéricas | Observabilidade, ruído e ações podem impedir identificação |
| HNN / LNN | Parametrizações Hamiltoniana/Lagrangiana com autograd | Arquitetura não certifica conservação na integração discreta |
| Offline RL trajectory | Embedding, ação, recompensa, próximo embedding e flags de fim | Embedding não é o estado físico completo |
| World model rollout buffer | Memórias de transições para treino e imaginação latente | Predições imaginadas não são observações verificadas |

Referências metodológicas:

- [DreamerV3](https://arxiv.org/abs/2301.04104).
- [I-JEPA](https://arxiv.org/abs/2301.08243) e [VICReg](https://arxiv.org/abs/2105.04906).
- [SINDy](https://arxiv.org/abs/1509.03580).
- [Hamiltonian Neural Networks](https://arxiv.org/abs/1906.01563) e [Lagrangian Neural Networks](https://arxiv.org/abs/2003.04630).
- [Scaling Monosemanticity](https://transformer-circuits.pub/2024/scaling-monosemanticity/index.html).
- [SAELens](https://github.com/decoderesearch/SAELens), [TransformerLens](https://github.com/TransformerLensOrg/TransformerLens), [PySR](https://github.com/astroautomata/PySR) e [PySINDy](https://github.com/dynamicslab/pysindy).

Essas referências orientam componentes específicos, sem afirmar reprodução de
resultados publicados ou validação desses resultados no NOVA.
