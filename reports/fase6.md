# Fase 6

Kuramoto acoplado vs não acoplado; EqProp quadrático vs gradiente implícito PyTorch; difusão de feixe vs ausência de difusão.

| Condição | Métrica | Média | Desvio amostral |
|---|---|---:|---:|
| all seeds | coherence_after | 0.000938643 | 0.000800411 |
| all seeds | coherence_before | 5.51881 | 5.48784 |
| all seeds | eqprop_gradient_cosine | 1 | 2.11058e-12 |
| all seeds | order_coupled | 0.998957 | 0.000200793 |
| all seeds | order_uncoupled | 0.129611 | 0.0484493 |

Verificações matemáticas passaram, mas não demonstram vantagem em tarefa cognitiva. Os três módulos são opt-in experimentais; não promovidos ao runtime padrão. EqProp quadrático não equivale a validação de uma rede não linear profunda.

Dados: `phase6.csv`; grupos não misturam métodos ou orçamentos.
