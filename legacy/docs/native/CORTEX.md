# NOVA Cortex 0.9

O `nova_cortex` é a camada opcional de pesquisa cognitiva em PyTorch. O motor de
simulação, seus jogos, a PVM, o observador compacto e a busca evolutiva continuam
em Rust. O novo crate `nova-ipc` conecta esses substratos ao Cortex por arquivos
binários mapeados em memória, sem depender de navegador ou de uma rede externa.

## Módulos implementados

| Pasta | Componentes |
| --- | --- |
| `sensory/` | Convoluções residuais 3D, GroupNorm, pooling médio/máximo, encoder de partículas invariante à permutação e normalizador Welford com máscara de telemetria ausente |
| `core/` | RSSM gaussiano GRU com prior/posterior, ensemble de priors, KL balanceada e free nats; objetivo de energia livre esperada aproximado; JEPA com alvo EMA/VICReg; APIs HNN/LNN |
| `memory/` | PER circular, partição protegida por surpresa, pesos de importância, espelho SQLite/NVMe e replay durante pausas, com decaimento fora de direções protegidas quando aplicável |
| `executive/` | CEM sobre sequências latentes, refinamento diferenciável opcional, ator limitado/critic bootstrapped, imitação do planejador e preferências homeostáticas |
| `interpretability/` | SAE Top-K/L1, ablação de features, catálogo append-only, sondas ridge, CAV/TCAV com direções de controle, regressão simbólica PySR, SINDy/STLSQ, exportação polinomial e verbalização determinística |
| `runtime/` | Bridge binária com leases, ciclo assíncrono de observação, checkpoints de pesos e normalizador, telemetria, transições Arrow/Parquet e exportação no formato de arrays D4RL |

Os nomes funcionais não afirmam equivalência a regiões de um cérebro humano.
SAE esparso não garante monossemântica; uma sonda com bom R² não é uma prova
matemática da existência de um conceito; uma equação ajustada não é uma lei
física exata. A implementação registra essas distinções nos artefatos e recibos.

## Instalação e primeiro ciclo

Execute a partir de `legacy/`. Os comandos são instruções para uso futuro:
nenhum treino, simulação, PySR, Lean ou ciclo IPC foi executado nesta entrega.

```sh
cargo build --release --locked
python -m pip install -e '.[cortex]'
```

Em um terminal, inicie o publicador nativo usando diretórios novos:

```sh
./target/release/nova ipc --substrate fusion --directory runs/ipc-01 \
  --ticks 1000000 --output runs/raw-01
```

Em outro terminal, conecte o cérebro:

```sh
python -m nova_cortex run --ring runs/ipc-01 --output runs/brain-01 \
  --config configs/cortex/compact.json --ticks 1024 \
  --memory-directory runs/memory-01
```

`run_brain.py`, `train_sae.py` e `extract_theorems.py` em `scripts/` são pontos de
entrada alternativos para os mesmos comandos. O executável instalado é
`nova-cortex`. O perfil compacto é o padrão da CLI; o completo é solicitado por
`--profile full` ou `--config configs/cortex/full.json`.

| Perfil | Embedding | h/z | Estado latente | Dicionário | Top-K |
| --- | ---: | ---: | ---: | ---: | ---: |
| Compacto | 64 | 48/16 | 64 | 512 | 8 |
| Completo | 512 | 768/256 | 1024 | 16384 | 32 |

O perfil completo usa mais RAM/VRAM e processamento. `Top-K` produz **no máximo**
K ativações positivas; não exatamente K conceitos. `device` pode ser `cpu`,
`cuda...` ou `mps`, quando o PyTorch e o hardware correspondentes estiverem
instalados. O encoder tem pooling e strides; não preserva topologia de forma
comprovada. A entrada viva usa quatro canais. A API `VisualRetina` também admite
12 canais se configurada para os campos de um lake volumétrico já gravado.

`train_retina` é falso por padrão: o RSSM aprende sobre um encoder fixo, inicialmente
aleatório se não houver checkpoint. Ativá-lo permite gradientes através da
posterior sensorial, sem garantia de evitar colapso de representação. O uso de
JEPA/VICReg e replay é uma estratégia de treinamento, não uma demonstração de
robustez ou ausência de esquecimento catastrófico.

## Protocolo binário e alinhamento

Cada sessão contém `ring.json`, de 2 a 32 slots, leases e `action.bin`.
O cabeçalho do frame ocupa 64 bytes: magic `NOVAFR09`, sequência, tick, forma
`[C,Z,Y,X]`, contagem de floats, contagem/largura das partículas e flag de IDs.
Depois vêm os floats little-endian do campo, os registros `[N,8]` com
`x,y,z,vx,vy,vz,massa,espécie` e os IDs `u64`. O manifesto inclui o passo de
integração; autômatos discretos usam uma unidade lógica por tick.

O publicador escreve sob lease exclusivo e publica o manifesto por rename.
O leitor toma o mesmo lease e confere o cabeçalho antes de mapear os dados.
Views NumPy read-only mantêm o proprietário do lease vivo; não podem continuar
em uso depois de liberá-lo. O publicador não sobrescreve slots ocupados.
Uma ação de 64 bytes contém sequência, opcode, controles e CRC32. Apenas a ação
que corresponde ao frame publicado pode avançar o simulador.

Há uma cópia para publicar o tensor/SoA no slot. A leitura NumPy pode compartilhar
essa memória, mas **o BrainLoop copia os inputs para armazenamento gravável de
propriedade do PyTorch**. Isso permite soltar o lease antes do próximo passo,
sem expor memória mutável do simulador ao autograd. Transferência para GPU,
rasterização e gravação de dados também podem copiar. Não há promessa de
zero-copy de ponta a ponta ou de 60 FPS.

O laço nativo espera a resposta do cérebro. Replay/planejamento deixam a física
parada nessa espera; não há promessa de aceleração 50x. O timeout padrão do
publicador é de uma hora por ação. Sessões encerradas publicam `closed.json`.
Use diretórios novos por sessão. Leases de processos mortos exigem conferir o
PID antes de removê-los; não existe expiração que invalide uma view ainda viva.
O protocolo pressupõe processos locais cooperantes em filesystem compartilhado;
CRC e locks não constituem autenticação para tenants não confiáveis.

O runtime pareia velocidades por ID para calcular acelerações médias no intervalo
entre observações. Nascimentos e reordenações não são tratados como correspondência
por posição no array. O registro de transição associa o latente em t à ação
realmente enviada e aos observáveis em t+1. O último frame encerra a sessão sem
aplicar uma ação fictícia; transições finitas terminam com `truncated=true`.

## RSSM, decisão e consolidação

O RSSM separa h determinístico e z gaussiano, aprendendo reconstrução do embedding,
KL balanceada e previsão de atributos homeostáticos. Os priors usam máscaras de
bootstrap e sua dispersão é um **proxy** de incerteza epistêmica, sem calibração
Bayesiana garantida. A variância gaussiana é registrada separadamente.

O objetivo de inferência ativa combina distância às preferências e um proxy de
ganho de informação baseado na dispersão do ensemble. O planejador CEM usa
horizonte 12 no perfil completo. O refinamento opcional diferencia as transições
imaginadas discretas; não implementa adjuntos de uma EDO contínua. O ator usa
um surrogate gaussiano com critic e imitação do CEM; isso não equivale à receita
completa de treinamento DreamerV3 nem a RL off-policy rigorosamente corrigido.

Quando energia física não é observável, a primeira preferência usa ocupação,
e essa escolha aparece no contexto do substrato. Colisões e outras grandezas
não transmitidas não são inventadas no vetor proprioceptivo. Ciclos de sono usam
replay priorizado, regularização e direções recorrentes protegidas estimadas de
memórias; não provam uma necessidade biológica de sono.

Checkpoints `.pt` são carregados com `weights_only=True`, com forma/schema
conferidos. Reutilizar `final.pt` é um warm start de pesos e normalizador,
não restauração integral do mundo, da fila de replay ou de um processo interrompido.
O espelho de episódios é opcional e vinculado à representação inicial; um diretório
de memória de outro modelo é recusado. Seeds e hashes ajudam a rastrear o
experimento, sem prometer igualdade bit a bit entre dispositivos.

## Dicionário e conceitos auditados

Um fluxo útil separa o aprendizado do mundo e a auditoria de representações:

1. Aprenda pesos em uma sessão e preserve `final.pt`.
2. Inicie outra sessão nativa e rode `run --checkpoint .../final.pt --frozen-world`
   para gravar latentes de uma representação estacionária.
3. Treine o SAE nesses latentes, com holdout temporal:

```sh
python -m nova_cortex train-sae --dataset runs/frozen-brain \
  --output runs/sae.pt --epochs 3 --max-samples 500000
```

4. Use `probe` com um NPZ contendo `x_train`, `y_train`, `x_heldout`, `y_heldout`.
   As labels devem vir de medições externas ao SAE, com separação de episódios
   quando necessária para evitar vazamento temporal:

```sh
python -m nova_cortex probe --samples runs/probe-samples.npz --output runs/probe.json
python -m nova_cortex register-concept --catalog runs/concepts.sqlite --concept runs/concept.json
```

5. Execute uma sessão com checkpoint do mundo congelado, SAE correspondente e
   `--catalog runs/concepts.sqlite`. O namespace incorpora hashes dos pesos,
   configuração Top-K e representação. Labels não são reutilizadas automaticamente
   quando o modelo continua mudando.

O conceito JSON contém `representation_sha256` (namespace do dicionário),
`feature_id`, `label`, `activation_threshold`, `physical_variable`, `evidence`,
`causal_score` opcional e `status`. Status `probe-association` exige amostras de
holdout, hash do dataset e R²/accuracy declarado >=0,98; continua sendo associação.
O catálogo armazena evidências fornecidas, não valida por si só a qualidade da
medição ou do split. Scores causais exigem declaração de intervenção pareada.
O verbalizador informa features sem label quando não há evidência aplicável.

`concept_probes.tcav` mede sensibilidade direcional de uma saída do modelo;
`controlled_tcav` compara direções aleatórias. Ablação do SAE altera uma direção
da representação, não comprova uma intervenção causal no mundo físico.
SAEs treinados durante mudança de representação podem ser explorados, mas seus
artefatos não recebem um namespace estacionário auditável automaticamente.

## Ciência simbólica e provas

Instale `.[cortex-science]` para PySR/PySINDy. Julia/PySR têm custos próprios de
instalação/compilação. PySR é executado em outro processo; o worker permite
`submit/poll` sem bloquear o ciclo chamador. Por padrão o runtime não inicia
Julia. Configurar `symbolic_every` > 0 habilita jobs periódicos sobre uma janela
limitada de latentes e acelerações médias pareadas por ID; `symbolic_window`,
`symbolic_dimensions` e `symbolic_iterations` limitam esse trabalho. Só há um job
por vez. A saída vai para `symbolic.jsonl`. O encerramento aguarda o worker próprio
concluir seu orçamento; não se promete cancelamento imediato de Julia.
Os comandos de extração também usam os dados já gravados pelo runtime.

```sh
# NPZ com states [T,D], time [T] estritamente crescente; D <= 16.
python -m nova_cortex extract-theorems --states runs/states.npz \
  --output runs/candidate --polynomial-only --nova-binary ./target/release/nova

# Acrescentar --lean-project /caminho/mathlib executa a prova algébrica gerada
# apenas se o verificador nativo já confirmou a identidade candidata.

# PySR sobre posição/velocidade e aceleração medida por IDs em um lake nativo:
python -m nova_cortex particle-force --dataset runs/particle-lake --output runs/force.json

# Latente em t pareado com aceleração média observada após a ação:
python -m nova_cortex extract-latent --dataset runs/brain-01 \
  --dimensions 0,1,2,3 --target mean_ax --output runs/latent-equation.json
```

O SINDy local usa biblioteca polinomial até grau 3, termos trigonométricos
opcionais, STLSQ e holdout temporal de derivadas numéricas. O adaptador PySINDy
está disponível pela API. A regressão exige alinhamento temporal; dados sob
controle ou variáveis omitidas podem impedir identificar uma lei autônoma.
`particle-force` não substitui observação dos vizinhos ou de todos os mecanismos
da força. Resultados permanecem `candidate-not-verified`.

O exportador polinomial racionaliza coeficientes com denominador limitado e gera
`candidate_claim.json` e definições `Candidate.lean`. Por padrão audita a hipótese
soma de quadrados, que **não é inferida automaticamente como invariante**.
`--nova-binary` executa o verificador exato da revisão 0.8; se ele confirmar a
identidade para o campo ajustado, gera `CandidateInvariant.lean` com `by ring`.
Lean opcional é executado somente no projeto explicitamente selecionado, com
fonte gerado por gramática numérica restrita. Sem compilação há recibo pendente.
Nem a identidade exata nem o aceite do Lean provam que o ajuste corresponde à
simulação ou à natureza. ASTs não polinomiais do PySR não são promovidas a
teoremas por strings ou `eval`.

As APIs HNN/LNN implementam parametrizações Hamiltoniana e Lagrangiana treináveis.
O HNN usa o campo canônico J∇H; o LNN regulariza a Hessiana em velocidades antes
de resolver acelerações. Integração discreta, regularização e erro de ajuste
impedem inferir conservação exata da simulação a partir da arquitetura da rede.

## Datasets e integração opcional

`explained.arrow` e `explained.parquet` contêm embeddings atual/seguinte, ação,
recompensa, terminal/timeout, latente, features esparsas, explicação com evidências
e observáveis dos dois instantes. O publicador pode gravar campos crus por
`nova ipc --output`. O runtime não afirma que embeddings são o estado físico
completo nem que os textos são uma transcrição fiel de raciocínio interno.

```sh
python -m nova_cortex export-d4rl --dataset runs/brain-01 --output runs/offline-rl.npz
```

A exportação usa arrays `observations`, `next_observations`, `actions`, `rewards`,
`terminals` e `timeouts`. É compatibilidade de layout, sem registrar automaticamente
um ambiente Gym/D4RL. O limite de observações é explícito para evitar carregamento
integral ilimitado em RAM.

SAELens, TransformerLens, PySR e PySINDy são dependências opcionais instaladas
separadamente. Os nomes de alguns repositórios foram redirecionados pelos próprios
projetos; URLs canônicas, aliases solicitados, licenças e revisões inspecionadas
estão em `third_party/upstream.lock.json`. Nenhum fonte desses quatro projetos
foi copiado. O adaptador SAELens usa a classe concreta StandardSAE da API 6;
TransformerLens exige um modelo local explicitamente fornecido. Não se baixa um
LLM para a explicação determinística.

## Validação desta entrega

Passaram checagem de compilação Rust, validação WGSL herdada, análise de símbolos
e formatação Python/Ruff, sintaxe Python e análise de manifests. Não foram
executados treinos, testes, IPC, simulações, PySR/PySINDy, SAELens, TransformerLens,
Lean, benchmarks ou interfaces. As APIs opcionais foram codificadas e tiveram
referências inspecionadas; compatibilidade e resultados em execução ainda precisam
ser avaliados. Não há promessa de latência de 2 ms, 60 FPS ou conceitos puros.
