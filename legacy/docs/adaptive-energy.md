# NOVA 0.2 — capacidade adaptativa e inferência por dinâmica

Esta revisão implementa os três eixos da análise e melhorias de integração. Não executamos novos testes ou benchmarks por preferência do usuário. Os módulos são experimentais e os resultados históricos das fases 1–9 não os validam.

## 1. O que precisa ser corrigido na interpretação da análise

- `g - U Uᵀg` preserva apenas o span retido, para entradas estáveis. Não existe memória infinita em largura e armazenamento finitos. Soltar direções possibilita esquecer; expansão apenas adia a saturação e tem orçamento explícito.
- Decair os valores singulares sem remover colunas de U não muda o projetor. O código separa o decaimento da decisão de liberar capacidade.
- O JEPA de referência é predição latente, sem garantia geral contra colapso e sem identidade automática com minimização de energia livre variacional. Os números anteriores cobrem os experimentos anteriores.
- O CEM amostra `horizon × action_dim` variáveis. Latentes maiores encarecem o modelo e suas derivadas, mas não tornam diretamente a busca `latent_dim × horizon`.
- Evitar `torch.autograd` não demonstra eficiência energética, desempenho superior ou fidelidade biológica. O planejador por energia ainda usa uma recursão adjunta de gradientes, implementada explicitamente.
- A diferença positiva entre dois erros consecutivos pode recompensar ruído IID. A nova curiosidade usa duas janelas e margem de erro amostral; isso reduz um viés, não prova imunidade a todo processo estocástico.

## 2. `AdaptiveSubspaceLinear`

Extende a camada exata sem alterar sua implementação de referência. Suporta quatro políticas:

| Política | Libera direções | Acrescenta características | Limite |
|---|---|---|---|
| `strict` | Não | Não | Pode saturar |
| `relax` | Sim | Não | Troca retenção por plasticidade |
| `expand` | Não | Sim | Teto de largura e bytes |
| `hybrid` | Sim | Sim | Expande primeiro, libera depois |

Cada direção tem evidência espectral e reservatórios de difusão. Envelhecimento integra a difusão homogênea por exponencial de matriz, decai traço/evidência e permite liberação explícita. Traços lentos elevam a prioridade de manutenção; não constituem uma garantia física de consolidação. A seleção sob pressão de capacidade é uma heurística declarada. Depois de mudanças de base por âncoras/liberação, a evidência diagonal é transportada por sobreposições quadráticas; não se alega manter a covariância histórica completa nessa variante adaptativa.

Uma base separada `anchor_U` é preservada ao liberar direções. Se as âncoras ocuparem todo o espaço e o crescimento atingir o teto, a capacidade volta a esgotar: o estado relata isso, sem remover âncoras silenciosamente.

Recrutamento acrescenta blocos `tanh(xR+b)` com semente determinística. A contribuição inicial dos novos pesos é zerada compensando a base ternária no resíduo contínuo. Cada amostra possui uma **versão de características**. Uma amostra antiga mantém zeros nos blocos posteriores. O runtime guarda essa versão nos episódios e no checkpoint.

Essa retenção é condicionada ao uso da versão armazenada. Reapresentar um dado antigo como se tivesse a versão atual pode ativar novos blocos e alterar sua saída. Isso é medido separadamente no experimento 10; não há um oráculo implícito que reconheça para sempre o contexto de cada observação.

```python
from nova.continual import AdaptiveSubspaceLinear, AdaptiveConfig

memory = AdaptiveSubspaceLinear(8, 4, config=AdaptiveConfig(
    policy="hybrid", max_features=64, growth_step=8,
))
# features = memory.encode(raw_batch, version=memory.feature_version)
# memory.step(features, targets)
# memory.consolidate(features, anchor=False)
# memory.age(dt=1, consolidation=.1)
# memory.manage_capacity()
```

Reservas de estado cobrem bases, pesos, traços e projeções. Não equivalem ao pico total do processo: lotes externos, decomposições e bibliotecas também consomem memória. A história de eventos é limitada.

## 3. Modelo latente por equilíbrio não linear

`EquilibriumNetwork` implementa a energia de uma rede de taxa em `s ∈ (-1,1)`:

```
E(s,u) = Σ ∫₀ˢ atanh(v) dv - ½ sᵀ W s - sᵀ(Bᵀu+b)
```

Com W simétrica e norma espectral menor que 1, a energia é estritamente convexa para entrada fixa. O equilíbrio livre satisfaz `s=tanh(Ws+Bᵀu+b)`. Relaxamento amortecido tem resíduo, número máximo de passos e indicação explícita de convergência. O treino não altera pesos quando as fases necessárias não convergem.

EqProp usa perturbações positivas e negativas `±β` do custo, correlações entre estados de equilíbrio e projeção espectral após a atualização. A configuração exige `||W||₂+β<1`. O código expõe a derivada implícita via Hessiana `diag(1/(1-s²))-W`; não estima essa derivada com diferenças finitas no planejador.

`EquilibriumWorldModel` tem encoder recorrente, encoder alvo EMA e preditor recorrente condicionado à ação. Treino offline pode transmitir mensagens locais de erro ao encoder, com forças de variância/covariância explícitas. O runtime congela encoder e normalização, e opcionalmente adapta somente o preditor. Isso protege as coordenadas da memória de mudanças arbitrárias do encoder.

É uma hipótese própria de rede de taxa simétrica. Não se afirma que seu treino seja o mecanismo do circuito AdEx ou que supere JEPA/PyTorch. A variante NumPy não importa PyTorch durante a seleção/inferência desse backend; o baseline PyTorch permanece disponível como extra.

## 4. AdEx no caminho efetivo da inferência

`SpikingLatentEncoder` transforma observações em correntes de um microcircuito E/PV/SST/VIP. O latente combina taxa de disparo em janela e evidência sub-limiar das membranas. Esse latente alimenta memória, política e preditor EqProp — não é um circuito que apenas produz gráficos ao lado do modelo principal.

O perfil `brain` tem custo temporal de simulação explícito (`spiking_steps × dt`). A leitura inclui membranas porque janelas curtas podem não conter espículas suficientes; portanto não se apresenta como código puramente de taxa de disparo. STDP em três fatores é opt-in, atua nas conexões recorrentes existentes e restaura os sinais de Dale. O readout e projeção aferente são fixos.

O encoder AdEx é dependente do histórico. Plasticidade espiculada adicional pode introduzir drift. A garantia linear continua restrita às ativações armazenadas, não a uma promessa de re-encoding idêntico da mesma observação bruta. Não foi realizada calibração biológica ou comparação de eficiência com GPU.

## 5. Planejamento por energia e feixe temporal

`EnergyPlanner` otimiza uma sequência de ações com projeção em `[-1,1]`, reutilização da trajetória anterior, derivadas da dinâmica e busca de passo Armijo. O custo tem objetivo configurável, penalidades de esforço/variação de ação e regularização opcional de feixe temporal.

`TemporalSheaf` aplica `Dₑz=R_left zₜ-R_right zₜ₊₁`, com energia `½||Dz||²` e gradiente `DᵀDz`. A implementação evita construir o Laplaciano global; restrições identidade usam diferenças diretas. Toda trajetória avaliada continua sendo produzida pela dinâmica do modelo. Uma difusão arbitrária de estados não é tratada como se fosse uma ação realizável.

O solver tem teto de avaliações de transição e um orçamento de parede opcional, verificado entre operações. Chamadas indivisíveis do modelo podem exceder o orçamento: não há garantia de tempo real. O CEM ganhou estado de trajetória, checagem de validade/viabilidade e observabilidade comparável.

Limites de estado são verificados no modelo, com penalidade diferenciável no solver por energia. Se nenhuma trajetória viável for encontrada, o resultado informa falha e retorna comando de parada. Ações nulas **não são universalmente seguras**; a aplicação deve fornecer supervisão/controlador de emergência específico para seu ambiente.

## 6. Operação e persistência

```bash
# Demonstração com código inicial não treinado, atualização local do preditor
nova demo --profile adaptive --ticks 100 --checkpoint checkpoints/adaptive.npz
nova demo --profile brain --ticks 100 --checkpoint checkpoints/brain.npz

# Configuração explícita
nova demo --config configs/adaptive.yaml --ticks 100

# Treino offline por EqProp, sem autograd
nova train-world --backend equilibrium --train-encoder --steps 400 \
  --output checkpoints/world-equilibrium.npz
nova demo --profile adaptive --world checkpoints/world-equilibrium.npz --ticks 100

# Retomada inclui versões, RNGs, circuitos, modelos e trajetória do planejador
nova demo --resume checkpoints/adaptive.npz --ticks 100
nova dashboard --metrics reports/demo.jsonl
```

Esses são comandos fornecidos para reprodução futura; não foram executados nesta revisão. Os demos sem pesos carregados são exemplos de integração, não agentes treinados para navegação competente.

O codec v2 usa NPZ/JSON, escrita atômica, limites de tamanho na carga e SHA-256 para detectar corrupção. O digest não autentica um autor malicioso. Não há pickle. Checkpoints v1 publicados têm um caminho explícito de migração de estrutura; migração não promete comportamento idêntico entre versões de algoritmo.

Histórico de métricas e eventos, buffer sensorial, memória episódica e grafo semântico do runtime têm limites configurados. Âncoras semânticas não são despejadas silenciosamente. Fontes e identidade mantêm os controles anteriores; nenhum dado de pessoa real foi adicionado.

## 7. Experimentos e aceitação pendente

- `nova benchmark 10`: saturação, âncoras, políticas estrita/relaxada/expansiva/híbrida, revisitas com versão antiga e re-encoding atual; cinco sementes.
- `nova benchmark 11`: previsão EqProp held-out com distratores, variância latente e auditoria de gradiente contra derivada implícita; cinco sementes.
- `nova benchmark 12`: CEM vs energia, ablação de feixe, dimensões latentes 8–128, horizontes 6/12, custo, viabilidade e avaliações de transição; cinco sementes.

Os testes de regressão foram escritos e não executados nesta revisão. Não existem CSVs ou ganhos novos declarados para esses experimentos. Para promover uma hipótese será necessário executar os protocolos, registrar inclusive resultados negativos e comparar custo total e qualidade nas mesmas condições.
