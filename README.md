# NOVA

Plataforma experimental de aprendizado contínuo, previsão latente e simulação cognitiva, em Python 3.11+ e Rust/PyO3. Especificação fornecida em [docs/specification-v2.md](docs/specification-v2.md).

**Regra de honestidade:** nenhum módulo experimental é promovido ao fluxo padrão sem ganho mensurável contra baseline predefinido. Resultados negativos, limites de capacidade e dependências de hardware são parte da entrega. Inspiração biológica não equivale a validação contra dados biológicos.

## Instalação

```bash
python -m venv .venv
source .venv/bin/activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install -e '.[dev]'
pytest -q
```

Use uma distribuição CUDA compatível do PyTorch para experimentos em GPU. O caminho CPU é suficiente para os testes e experimentos de bancada. Dados são baixados apenas pelos comandos de benchmark e ficam em `data/` (ignorado pelo Git).

## Experimentos

Execute da raiz do checkout:

```bash
OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=1 python -m experiments.01_linear_nullspace_audit
OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=1 python -m experiments.02_jepa_latent_world
OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=1 python -m experiments.03_continual_split_mnist
python -m experiments.plot_reports
```

O Split-MNIST padrão usa 1.500 exemplos por tarefa e quatro épocas, cinco sementes, sem oráculo de tarefa no teste. Use `--samples 0` para todos os dados; `--dataset permuted-mnist` ou `--dataset split-cifar100` seleciona os demais protocolos. Resultados de dados reduzidos não estabelecem desempenho nos protocolos completos.

Os relatórios `reports/faseN.md` contêm as condições, métricas e limitações; os CSVs permitem comparar cada condição. O desvio reportado é amostral. Uma média misturando métodos não é uma comparação científica.

## Garantia linear

A atualização de `dW` é projetada no complemento de `U`. Retenção só vale no span calibrado, com entrada estável, precisão float64 e rank suficiente. Saturação impede aprender novas direções. A base ternária permanece congelada; o resíduo nunca é quantizado. Consulte [DEVIATIONS.md](DEVIATIONS.md).

## Fluxo completo

```bash
# Ambiente CPU e extensão Rust, quando o toolchain estiver disponível
bash scripts/setup.sh
source .venv/bin/activate

# Treino offline, antes de congelar as coordenadas da memória protegida
nova train-world --steps 900 --output checkpoints/world.npz
nova demo --ticks 100 --world checkpoints/world.npz
nova demo --ticks 100 --resume checkpoints/demo.npz
nova dashboard --metrics reports/demo.jsonl --output reports/dashboard.html

# Qualquer fase, executada explicitamente
nova benchmark 4
nova benchmark 5
nova benchmark 9
```

`nova demo` sem `--world` usa um encoder não treinado para demonstrar integração. O checkpoint inclui estado cognitivo, modelos, cascata, memórias, RNGs e estado do corpo virtual. A restauração usa NPZ/JSON, sem pickle. Alterar o encoder após consolidar memória é rejeitado, pois invalida as coordenadas protegidas.

Busca deliberada é habilitada por `--planning`. O modo determinístico usa orçamento de operações fixo; o modo com orçamento de tempo pode truncar a busca, sem prometer tempo real. Neuromoduladores e hipóteses opcionais não são promovidos automaticamente pelo demonstrador.

## Extensão Rust

Instale Rust >= 1.85 e execute:

```bash
maturin build --manifest-path nova-core/Cargo.toml --release --locked -o .cache/wheels
pip install .cache/wheels/*.whl
```

No ambiente preparado, o toolchain está em `.tools/cargo` e `.tools/rustup`:

```bash
export CARGO_HOME="$PWD/.tools/cargo"
export RUSTUP_HOME="$PWD/.tools/rustup"
export PATH="$CARGO_HOME/bin:$PATH"
```

A extensão exporta pesos ternários empacotados, Hadamard, AdEx, Kuramoto e cascata RK4, com Rayon. Falta da extensão gera erro explícito ao selecionar o backend Rust. O kernel Triton é opcional (`.[gpu]`) e requer CUDA.

## Entregas e evidência

| Fase | Código | Evidência e limite |
|---|---|---|
| 1 | `continual/ProtectedLinear` | Retenção float64 e violações de hipóteses: [relatório](reports/fase1.md) |
| 2 | JEPA, EMA, anti-colapso, ambientes | Predição com distratores: [relatório](reports/fase2.md) |
| 3 | Proteção profunda, EWC, replay, GPM, multitask | Split/Permuted-MNIST reduzidos; saturação é resultado negativo: [relatório](reports/fase3.md) |
| 4 | Hopfield, cascata, neuromodulação, CEM, DDM | Ensaios de memória/controle, sem ganho geral atribuído às ablações: [relatório](reports/fase4.md) |
| 5 | Rust/PyO3 e Triton opcional | Compactação medida; CPU mais lenta que PyTorch nas condições medidas; GPU/energia pendentes: [relatório](reports/fase5.md) |
| 6 | Kuramoto, EqProp quadrático, Laplaciano de feixe | Equações verificadas; vantagem cognitiva não demonstrada: [relatório](reports/fase6.md) |
| 7 | N0/N1/N2, percepção multimodal, microcircuito | F–I e espectro simulados; comparação com dados biológicos pendente: [relatório](reports/fase7.md) |
| 8 | Ciclo, busca, calculadora, calibração, valores, checkpoint | Domínios finitos e integração: [relatório](reports/fase8.md) |
| 9 | Cofre de identidade, proveniência, revisão, exclusão, linguagem | Perfis sintéticos; fidelidade de pessoa real e naturalidade não medidas: [relatório](reports/fase9.md) |

O [estado de aceitação](reports/STATUS.md) separa implementação de aprovação científica. Os protocolos completos, benchmarks de hardware, escalabilidade distribuída e validação com registros biológicos não são substituídos pelos ensaios reduzidos. CIFAR-100 requer acesso ao servidor oficial `www.cs.toronto.edu`, bloqueado pelo proxy nesta execução.

## Identidade e linguagem

Veja [docs/identity.md](docs/identity.md) para o formato de `consent.json`, fontes, chaves, revisão e apagamento. Não há dados pessoais reais neste repositório. O cofre exige consentimento e mantém o rótulo de simulação; dados pessoais não treinam pesos compartilhados. A exclusão reconstrói o estado derivado do perfil, sem alegar apagar cópias externas.

OCR, ASR e LLM usam adaptadores opcionais com modelos locais. A saída factual padrão é determinística e fundamentada em fontes. O adaptador neural produz rascunhos não verificados, sujeitos a revisão.

## Código consolidado

[artifacts/NOVA_codigo_completo.txt](artifacts/NOVA_codigo_completo.txt) reúne código Python, Rust, testes, scripts e configurações em texto, com caminhos e hashes. Gere novamente com `python scripts/bundle_source.py`. Esse TXT é um pacote textual do código-fonte; o módulo binário é gerado separadamente por Maturin.
