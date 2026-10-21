# Fase 5

Kernel CPU Rust/PyO3, quatro pesos por byte, acumulação por adição/subtração. Comparação contra torch.matmul fp16/bf16 CPU; cinco sementes, mediana de 30 execuções.

| Condição | Métrica | Média | Desvio amostral |
|---|---|---:|---:|
| batch=1, input_dim=128, output_dim=64, dtype=torch.float16 | dense_weight_bytes | 16384 | 0 |
| batch=1, input_dim=128, output_dim=64, dtype=torch.float16 | gpu_available | 0 | 0 |
| batch=1, input_dim=128, output_dim=64, dtype=torch.float16 | packed_gops | 0.23051 | 0.052263 |
| batch=1, input_dim=128, output_dim=64, dtype=torch.float16 | packed_ms | 0.0744115 | 0.0184457 |
| batch=1, input_dim=128, output_dim=64, dtype=torch.float16 | packed_weight_bytes | 2048 | 0 |
| batch=1, input_dim=128, output_dim=64, dtype=torch.float16 | speedup | 0.24084 | 0.033363 |
| batch=1, input_dim=128, output_dim=64, dtype=torch.float16 | torch_ms | 0.0176426 | 0.00377744 |
| batch=1, input_dim=128, output_dim=64, dtype=torch.bfloat16 | dense_weight_bytes | 16384 | 0 |
| batch=1, input_dim=128, output_dim=64, dtype=torch.bfloat16 | gpu_available | 0 | 0 |
| batch=1, input_dim=128, output_dim=64, dtype=torch.bfloat16 | packed_gops | 0.23051 | 0.052263 |
| batch=1, input_dim=128, output_dim=64, dtype=torch.bfloat16 | packed_ms | 0.0744115 | 0.0184457 |
| batch=1, input_dim=128, output_dim=64, dtype=torch.bfloat16 | packed_weight_bytes | 2048 | 0 |
| batch=1, input_dim=128, output_dim=64, dtype=torch.bfloat16 | speedup | 0.221098 | 0.0210402 |
| batch=1, input_dim=128, output_dim=64, dtype=torch.bfloat16 | torch_ms | 0.0162742 | 0.00342062 |
| batch=32, input_dim=128, output_dim=64, dtype=torch.float16 | dense_weight_bytes | 16384 | 0 |
| batch=32, input_dim=128, output_dim=64, dtype=torch.float16 | gpu_available | 0 | 0 |
| batch=32, input_dim=128, output_dim=64, dtype=torch.float16 | packed_gops | 0.227269 | 0.061661 |
| batch=32, input_dim=128, output_dim=64, dtype=torch.float16 | packed_ms | 2.45768 | 0.700194 |
| batch=32, input_dim=128, output_dim=64, dtype=torch.float16 | packed_weight_bytes | 2048 | 0 |
| batch=32, input_dim=128, output_dim=64, dtype=torch.float16 | speedup | 0.00988409 | 0.00413956 |
| batch=32, input_dim=128, output_dim=64, dtype=torch.float16 | torch_ms | 0.0220962 | 0.00367672 |
| batch=32, input_dim=128, output_dim=64, dtype=torch.bfloat16 | dense_weight_bytes | 16384 | 0 |
| batch=32, input_dim=128, output_dim=64, dtype=torch.bfloat16 | gpu_available | 0 | 0 |
| batch=32, input_dim=128, output_dim=64, dtype=torch.bfloat16 | packed_gops | 0.227269 | 0.061661 |
| batch=32, input_dim=128, output_dim=64, dtype=torch.bfloat16 | packed_ms | 2.45768 | 0.700194 |
| batch=32, input_dim=128, output_dim=64, dtype=torch.bfloat16 | packed_weight_bytes | 2048 | 0 |
| batch=32, input_dim=128, output_dim=64, dtype=torch.bfloat16 | speedup | 0.00999448 | 0.00344124 |
| batch=32, input_dim=128, output_dim=64, dtype=torch.bfloat16 | torch_ms | 0.0228264 | 0.00327473 |
| batch=8, input_dim=512, output_dim=128, dtype=torch.float16 | dense_weight_bytes | 131072 | 0 |
| batch=8, input_dim=512, output_dim=128, dtype=torch.float16 | gpu_available | 0 | 0 |
| batch=8, input_dim=512, output_dim=128, dtype=torch.float16 | packed_gops | 0.178572 | 0.0227036 |
| batch=8, input_dim=512, output_dim=128, dtype=torch.float16 | packed_ms | 5.95289 | 0.796733 |
| batch=8, input_dim=512, output_dim=128, dtype=torch.float16 | packed_weight_bytes | 16384 | 0 |
| batch=8, input_dim=512, output_dim=128, dtype=torch.float16 | speedup | 0.00819749 | 0.00235903 |
| batch=8, input_dim=512, output_dim=128, dtype=torch.float16 | torch_ms | 0.0489639 | 0.0162177 |
| batch=8, input_dim=512, output_dim=128, dtype=torch.bfloat16 | dense_weight_bytes | 131072 | 0 |
| batch=8, input_dim=512, output_dim=128, dtype=torch.bfloat16 | gpu_available | 0 | 0 |
| batch=8, input_dim=512, output_dim=128, dtype=torch.bfloat16 | packed_gops | 0.178572 | 0.0227036 |
| batch=8, input_dim=512, output_dim=128, dtype=torch.bfloat16 | packed_ms | 5.95289 | 0.796733 |
| batch=8, input_dim=512, output_dim=128, dtype=torch.bfloat16 | packed_weight_bytes | 16384 | 0 |
| batch=8, input_dim=512, output_dim=128, dtype=torch.bfloat16 | speedup | 0.00638563 | 0.00207658 |
| batch=8, input_dim=512, output_dim=128, dtype=torch.bfloat16 | torch_ms | 0.036769 | 0.00788294 |

Bytes referem-se apenas aos pesos, não a todo o processo. Latência inclui cópias da fronteira Python/Rust. Nenhuma GPU/NVML nem bitnet.cpp disponíveis: energia e comparação bitnet não medidas. Ganho de compactação não implica ganho de latência. Kernel Triton opcional implementado, mas não executado sem CUDA; ver DEVIATIONS.md.

Dados: `phase5.csv`; grupos não misturam métodos ou orçamentos.
