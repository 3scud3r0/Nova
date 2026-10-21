# Fase 3

Resultados agrupados por dataset e método. Última execução: permuted-mnist: 5 sementes, 1500 exemplos por tarefa, 4 épocas, classificação global sem oráculo. p pareado de FM protegido vs fine-tuning: 0.00201192.

| Condição | Métrica | Média | Desvio amostral |
|---|---|---:|---:|
| dataset=split-mnist, method=finetune | acc | 0.192133 | 0.000488924 |
| dataset=split-mnist, method=finetune | cka | 0.95286 | 0.00774883 |
| dataset=split-mnist, method=finetune | epochs | 4 | 0 |
| dataset=split-mnist, method=finetune | fm | 0.983999 | 0.000392366 |
| dataset=split-mnist, method=finetune | fwt | -0.113187 | 0.045081 |
| dataset=split-mnist, method=finetune | plasticity | 0.000644274 | 0.000697259 |
| dataset=split-mnist, method=finetune | samples_per_task | 1500 | 0 |
| dataset=split-mnist, method=ewc | acc | 0.192133 | 0.000285267 |
| dataset=split-mnist, method=ewc | cka | 0.930301 | 0.0197868 |
| dataset=split-mnist, method=ewc | epochs | 4 | 0 |
| dataset=split-mnist, method=ewc | fm | 0.983945 | 0.000336721 |
| dataset=split-mnist, method=ewc | fwt | -0.113187 | 0.045081 |
| dataset=split-mnist, method=ewc | plasticity | 0.000601585 | 0.000674316 |
| dataset=split-mnist, method=ewc | samples_per_task | 1500 | 0 |
| dataset=split-mnist, method=replay | acc | 0.500441 | 0.0165647 |
| dataset=split-mnist, method=replay | cka | 0.991608 | 0.00075536 |
| dataset=split-mnist, method=replay | epochs | 4 | 0 |
| dataset=split-mnist, method=replay | fm | 0.594503 | 0.0204176 |
| dataset=split-mnist, method=replay | fwt | -0.113187 | 0.045081 |
| dataset=split-mnist, method=replay | plasticity | -0.00264455 | 0.000865244 |
| dataset=split-mnist, method=replay | samples_per_task | 1500 | 0 |
| dataset=split-mnist, method=gpm | acc | 0.361902 | 0.00810614 |
| dataset=split-mnist, method=gpm | cka | 0.991112 | 0.00127207 |
| dataset=split-mnist, method=gpm | epochs | 4 | 0 |
| dataset=split-mnist, method=gpm | fm | 0.00284668 | 0.000378482 |
| dataset=split-mnist, method=gpm | fwt | -0.113187 | 0.045081 |
| dataset=split-mnist, method=gpm | plasticity | -0.615452 | 0.00875296 |
| dataset=split-mnist, method=gpm | samples_per_task | 1500 | 0 |
| dataset=split-mnist, method=protected | acc | 0.199678 | 8.45794e-05 |
| dataset=split-mnist, method=protected | cka | 1 | 0 |
| dataset=split-mnist, method=protected | epochs | 4 | 0 |
| dataset=split-mnist, method=protected | fm | 0 | 0 |
| dataset=split-mnist, method=protected | free_dims | 0 | 0 |
| dataset=split-mnist, method=protected | fwt | -0.113187 | 0.045081 |
| dataset=split-mnist, method=protected | plasticity | -0.779009 | 0.000742138 |
| dataset=split-mnist, method=protected | samples_per_task | 1500 | 0 |
| dataset=split-mnist, method=multitask | acc | 0.90168 | 0.00171834 |
| dataset=split-mnist, method=multitask | cka | 0.986307 | 0.00145683 |
| dataset=split-mnist, method=multitask | epochs | 4 | 0 |
| dataset=split-mnist, method=multitask | fm | 0.02874 | 0.0048693 |
| dataset=split-mnist, method=multitask | fwt | -0.113187 | 0.045081 |
| dataset=split-mnist, method=multitask | plasticity | -0.0581992 | 0.00853507 |
| dataset=split-mnist, method=multitask | samples_per_task | 1500 | 0 |
| dataset=permuted-mnist, method=finetune | acc | 0.778816 | 0.00842872 |
| dataset=permuted-mnist, method=finetune | cka | 0.842888 | 0.040608 |
| dataset=permuted-mnist, method=finetune | epochs | 4 | 0 |
| dataset=permuted-mnist, method=finetune | fm | 0.03995 | 0.0124732 |
| dataset=permuted-mnist, method=finetune | fwt | 0.009785 | 0.0218834 |
| dataset=permuted-mnist, method=finetune | plasticity | 0.056872 | 0.00997006 |
| dataset=permuted-mnist, method=finetune | samples_per_task | 1500 | 0 |
| dataset=permuted-mnist, method=ewc | acc | 0.7694 | 0.00917214 |
| dataset=permuted-mnist, method=ewc | cka | 0.846099 | 0.0388279 |
| dataset=permuted-mnist, method=ewc | epochs | 4 | 0 |
| dataset=permuted-mnist, method=ewc | fm | 0.038215 | 0.012621 |
| dataset=permuted-mnist, method=ewc | fwt | 0.00796 | 0.021222 |
| dataset=permuted-mnist, method=ewc | plasticity | 0.0454 | 0.00845318 |
| dataset=permuted-mnist, method=ewc | samples_per_task | 1500 | 0 |
| dataset=permuted-mnist, method=replay | acc | 0.795504 | 0.00743208 |
| dataset=permuted-mnist, method=replay | cka | 0.875705 | 0.0311974 |
| dataset=permuted-mnist, method=replay | epochs | 4 | 0 |
| dataset=permuted-mnist, method=replay | fm | 0.019865 | 0.00969759 |
| dataset=permuted-mnist, method=replay | fwt | 0.005435 | 0.0152697 |
| dataset=permuted-mnist, method=replay | plasticity | 0.054272 | 0.00980575 |
| dataset=permuted-mnist, method=replay | samples_per_task | 1500 | 0 |
| dataset=permuted-mnist, method=gpm | acc | 0.763992 | 0.00962565 |
| dataset=permuted-mnist, method=gpm | cka | 0.988379 | 0.0011741 |
| dataset=permuted-mnist, method=gpm | epochs | 4 | 0 |
| dataset=permuted-mnist, method=gpm | fm | 0.004405 | 0.0014537 |
| dataset=permuted-mnist, method=gpm | fwt | 0.018405 | 0.0225271 |
| dataset=permuted-mnist, method=gpm | plasticity | 0.01466 | 0.00689079 |
| dataset=permuted-mnist, method=gpm | samples_per_task | 1500 | 0 |
| dataset=permuted-mnist, method=protected | acc | 0.241992 | 0.0162304 |
| dataset=permuted-mnist, method=protected | cka | 1 | 0 |
| dataset=permuted-mnist, method=protected | epochs | 4 | 0 |
| dataset=permuted-mnist, method=protected | fm | 0 | 0 |
| dataset=permuted-mnist, method=protected | free_dims | 0 | 0 |
| dataset=permuted-mnist, method=protected | fwt | 0.00921 | 0.0187436 |
| dataset=permuted-mnist, method=protected | plasticity | -0.510076 | 0.0185567 |
| dataset=permuted-mnist, method=protected | samples_per_task | 1500 | 0 |
| dataset=permuted-mnist, method=multitask | acc | 0.863116 | 0.00283646 |
| dataset=permuted-mnist, method=multitask | cka | 0.911156 | 0.0228961 |
| dataset=permuted-mnist, method=multitask | epochs | 4 | 0 |
| dataset=permuted-mnist, method=multitask | fm | -0.007445 | 0.00314461 |
| dataset=permuted-mnist, method=multitask | fwt | 0.00954 | 0.0198941 |
| dataset=permuted-mnist, method=multitask | plasticity | 0.065872 | 0.0099593 |
| dataset=permuted-mnist, method=multitask | samples_per_task | 1500 | 0 |

Métodos têm mesmos dados novos; replay/multitask usam exemplos adicionais explicitamente. GPM usa 95% de energia; proteção exata usa span completo. Saturação e plasticidade negativa são resultados válidos. Este ensaio reduzido não substitui os três benchmarks completos. Consulte CSV por método, não a média agregada entre métodos.

Dados: `phase3.csv`; grupos não misturam métodos ou orçamentos.
