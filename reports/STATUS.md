# Estado da entrega

**Atualização 0.2:** o [estado da extensão adaptativa](adaptive/STATUS.md) e o [projeto técnico](../docs/adaptive-energy.md) descrevem memória adaptativa, inferência por equilíbrio/AdEx e planejamento por energia. Não foram executados novos testes ou benchmarks nesta revisão. As medições abaixo são históricas da primeira entrega e não validam as extensões.

Código experimental para as nove fases, com relatórios e resultados de cinco sementes por experimento. Implementação não equivale à aprovação científica integral da especificação.

| Fase | Resultado observado | Aceitação |
|---|---|---|
| 1 | Retenção média ~1,4e-13; violações e saturação demonstradas | Critério linear atendido nas condições medidas |
| 2 | MSE latente 0,198 vs média 0,517; std 0,734 | Atendido no ambiente linear com distratores; demais domínios pendentes |
| 3 | Proteção exata satura e preserva memória, mas perde plasticidade | Não atende competitividade com GPM em Split-MNIST; dados reduzidos |
| 4 | Recuperação de padrões e planejamento funcionais | Ablações não estabelecem ganho geral de cada módulo |
| 5 | Pesos compactados em 2 bits; latência CPU desfavorável | Resultado negativo de velocidade; GPU, energia e bitnet.cpp não medidos |
| 6 | EqProp alinhado ao gradiente; sincronização e difusão verificadas | Benefício em tarefa cognitiva não demonstrado; opt-in |
| 7 | AdEx, cascata e encoders operacionais; espectro medido | Validação biológica não realizada; pico de microcircuito ~24,4 Hz |
| 8 | Busca melhora com orçamento; ECE de ~0,216 para ~0,024 em dados sintéticos | Validação limitada aos domínios de bancada |
| 9 | Fontes, rótulos, rejeição sem fonte e apagamento verificados | Perfis sintéticos; fidelidade humana/linguística não avaliada |

Antes da instrução posterior de dispensar novos testes, a suíte integrada registrou **40 aprovados e 1 ignorado por ausência de CUDA**, e os testes Rust registraram **2 aprovados**. Não foram iniciados novos testes após essa instrução. Os logs anteriores foram mantidos. Alterações finais de documentação, empacotamento, corpo 3D e acesso exclusivo para apagamento após revogação não receberam uma nova rodada de testes, conforme solicitado.

O JEPA treinado para o demonstrador produziu MSE 0,179 vs média 0,523, com std 0,738 (`trained-world.json`). O exemplo executado e o painel offline ficam em `demo-result.json`, `demo.jsonl` e `dashboard.html`. Checkpoints e bibliotecas compiladas permanecem em caminhos ignorados pelo Git.

Pendências externas: acesso a `www.cs.toronto.edu` para CIFAR-100; GPU/NVML e instalação de bitnet.cpp para custo; dados biológicos com referências/tolerâncias; modelos locais opcionais para OCR/ASR/LLM; dados pessoais apenas mediante consentimento válido. Esses itens não são substituídos por números simulados.


## Revisão Biocosm 0.3

Novos componentes e limites em [biocosm/STATUS.md](biocosm/STATUS.md). Implementação experimental, sem testes/benchmarks/simulações novos executados. Resultados históricos das fases não validam os módulos desta revisão.
