# Fase 7

AdEx Python/Rust com dois compartimentos; curvas F–I (200 ms por corrente); microcircuito E/PV/SST/VIP esparso (500 ms); relaxamento preditivo. Cinco sementes.

| Condição | Métrica | Média | Desvio amostral |
|---|---|---:|---:|
| condition=fi, current_pa=0.0 | rate_hz | 0 | 0 |
| condition=fi, current_pa=200.0 | rate_hz | 0 | 0 |
| condition=fi, current_pa=400.0 | rate_hz | 32.75 | 0 |
| condition=fi, current_pa=600.0 | rate_hz | 63.15 | 0.223607 |
| condition=microcircuit | dale | 1 | 0 |
| condition=microcircuit | gamma_fraction | 0.0605592 | 0.00332714 |
| condition=microcircuit | mean_rate_hz | 12.748 | 0.0228035 |
| condition=microcircuit | peak_hz | 24.4141 | 0 |
| condition=microcircuit | prediction_energy_after | 2.34532 | 0.929086 |
| condition=microcircuit | prediction_energy_before | 4 | 0 |

Modelos N0/N1/N2, áudio log-mel em fluxo, visão foveal, texto, slots e fusão têm testes. Não há registros Allen/Blue Brain fornecidos nem ajuste de parâmetros contra eles. Banda gama é medida, não garantida; estes números não constituem validação biológica. Comparador de referências e importador de conectoma CSV implementados. Escala cluster e hardware neuromórfico não validados.

Dados: `phase7.csv`; grupos não misturam métodos ou orçamentos.
