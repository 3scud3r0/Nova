# Fase 2

Predição linear com oito distratores independentes; 900 passos, 5 sementes, teste independente.

| Condição | Métrica | Média | Desvio amostral |
|---|---|---:|---:|
| all seeds | autoencoder_sensitivity | 1.87171 | 0.15089 |
| all seeds | distractor_sensitivity | 0.390808 | 0.0370407 |
| all seeds | latent_mse | 0.198387 | 0.0206106 |
| all seeds | latent_std | 0.734078 | 0.0127815 |
| all seeds | mean_baseline_mse | 0.516812 | 0.0269119 |
| all seeds | position_probe_mse | 0.0129062 | 0.00335687 |

Aceite de bancada: std ≥ 0.05 e erro menor que média. Autoencoder usa reconstrução, portanto a sensibilidade é uma comparação de representações, não igualdade de objetivos. Pêndulo e grid têm testes funcionais; extrapolação JEPA nesses ambientes exige ensaios próprios.

Dados: `phase2.csv`; grupos não misturam métodos ou orçamentos.
