# Fase 8

Busca BFS com verificador exato em 20 grids/seed; quatro orçamentos. Calibração por temperatura em partição separada e avaliação held-out. Ciclo ocioso e checkpoint determinístico testados.

| Condição | Métrica | Média | Desvio amostral |
|---|---|---:|---:|
| condition=search, budget=1 | seconds | 9.24398e-05 | 5.93204e-05 |
| condition=search, budget=1 | success | 0 | 0 |
| condition=search, budget=32 | seconds | 0.000989362 | 0.000484872 |
| condition=search, budget=32 | success | 0 | 0 |
| condition=search, budget=128 | seconds | 0.00391219 | 0.000778263 |
| condition=search, budget=128 | success | 0.98 | 0.0447214 |
| condition=search, budget=256 | seconds | 0.00418855 | 0.000692825 |
| condition=search, budget=256 | success | 1 | 0 |
| condition=calibration_idle | ece_after | 0.0239288 | 0.00741246 |
| condition=calibration_idle | ece_before | 0.216095 | 0.015515 |
| condition=calibration_idle | idle_latent_norm | 0.0833435 | 0.0266732 |
| condition=calibration_idle | temperature | 2.98687 | 0.146314 |
| condition=calibration_idle | tick_p95_ms | 0.514524 | 0.0475535 |

Mais expansões melhoram sucesso neste domínio finito, não provam raciocínio geral. O runtime integrado é um demonstrador com encoder inicial aleatório, a substituir por pesos treinados. Busca/neuromodulação opt-in. Latência é medida, não uma garantia de tempo real. Curiosidade ignora erro estacionário; ablações comportamentais amplas permanecem abertas.

Dados: `phase8.csv`; grupos não misturam métodos ou orçamentos.
