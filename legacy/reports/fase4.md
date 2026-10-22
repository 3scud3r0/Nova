# Fase 4

Hopfield: 32 padrões, ruído 30% da norma e máscara Bernoulli 50%. CEM com modelo aprendido vs DQN offline e ações aleatórias, mesmas 2.048 transições, cinco sementes.

| Condição | Métrica | Média | Desvio amostral |
|---|---|---:|---:|
| all seeds | consolidation_without_5HT | 0.731059 | 0 |
| all seeds | consolidation_without_ACh | 0.731059 | 0 |
| all seeds | consolidation_without_DA | 0.5 | 0 |
| all seeds | consolidation_without_NE | 0.731059 | 0 |
| all seeds | consolidation_without_none | 0.731059 | 0 |
| all seeds | discount_without_5HT | 0.95 | 0 |
| all seeds | discount_without_ACh | 0.949302 | 0 |
| all seeds | discount_without_DA | 0.949302 | 0 |
| all seeds | discount_without_NE | 0.949302 | 0 |
| all seeds | discount_without_none | 0.949302 | 0 |
| all seeds | lr_without_5HT | 0.03 | 0 |
| all seeds | lr_without_ACh | 0.03 | 0 |
| all seeds | lr_without_DA | 0.03 | 0 |
| all seeds | lr_without_NE | 0.01 | 0 |
| all seeds | lr_without_none | 0.03 | 0 |
| all seeds | recall_chance | 0.03125 | 0 |
| all seeds | recall_mask | 1 | 0 |
| all seeds | recall_noise | 1 | 0 |
| all seeds | return_cem | -2.59518 | 0.0138 |
| all seeds | return_dqn | -3.865 | 0.912551 |
| all seeds | return_random | -23.4812 | 3.26168 |
| all seeds | sensory_without_5HT | 0.85 | 0 |
| all seeds | sensory_without_ACh | 0.5 | 0 |
| all seeds | sensory_without_DA | 0.85 | 0 |
| all seeds | sensory_without_NE | 0.85 | 0 |
| all seeds | sensory_without_none | 0.85 | 0 |

CEM tem ações contínuas, DQN três ações discretas: não é equivalência de espaço de ações. Ablações dos neuromoduladores aqui verificam efeitos de controle, não ganho final em RL; permanecem opt-in. A cascata é um modelo de difusão declarado e validado analiticamente para M=2. Não se alega superioridade universal.

Dados: `phase4.csv`; grupos não misturam métodos ou orçamentos.
