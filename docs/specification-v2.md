# NOVA — Especificação Técnica de Projeto (v2.0)

> v2.0: acrescenta a Parte II (§3A–§3K), que define como devem ser o modelo, o neurônio, a sinapse, a percepção, o raciocínio, a memória, a linguagem, o valor/emoção, a identidade e a ingestão de dados ("Nova lembrar um humano"). Nenhuma linha de código é exigida por esta versão: é só especificação.

Documento para ser entregue a uma IA/engenheiro de código. Escrito em português; código e nomes de arquivos em inglês.

---

## 0. LEIA PRIMEIRO: o que NOVA é e o que NÃO é

**NOVA é** uma plataforma de pesquisa modular para investigar uma hipótese concreta:

> Um sistema com (a) modelo de mundo preditivo em espaço latente, (b) aprendizado contínuo com proteção de memória por projeção em subespaço, (c) memória multiescala e episódica, (d) planejamento por busca em tempo de inferência e (e) camadas computacionais eficientes (pesos ternários, esparsidade) pode aprender tarefas em sequência com menos esquecimento e menor custo que baselines padrão.

**NOVA não é, e a IA codificadora NÃO deve afirmar que é:**
- uma "superinteligência" que "resolve todos os problemas";
- uma emulação do cérebro humano. A ambição de v2.0 é um **modelo inspirado no cérebro em múltiplos níveis de detalhe** (§3A–§3K), com trilha de validação contra dados biológicos (§3L). O rótulo "emulação" só pode ser usado para um módulo que passar nessa validação;
- consciente, senciente ou "uma pessoa". Ao "lembrar um humano" (§3J), Nova reproduz memórias, estilo e conhecimento de uma pessoa a partir de dados, com consentimento. Isso é fidelidade comportamental, não a pessoa;
- livre de esquecimento "para sempre" ou com "largura de banda infinita";
- livre de backprop em todo o sistema (ver §3: o encoder pode usar backprop; só a camada de memória usa atualização local).

**Regra de honestidade (obrigatória):** nenhum módulo entra na versão principal sem demonstrar ganho mensurável contra um baseline em um benchmark pré-definido. Termos como "Yang-Mills", "feixe celular", "Kuramoto" só podem aparecer no código se a equação correspondente for realmente implementada; caso contrário, o módulo deve se chamar pelo que faz (ex.: `SigmoidGate`, não `YangMillsCurvature`).

---

## 1. Consenso extraído da conversa

### 1.1 O que sobrevive (implementar)
| Ideia | Status | Fonte/Prior art |
|---|---|---|
| JEPA: predição no espaço latente, target encoder EMA + stop-gradient | Válido, funcional | LeCun; I-JEPA, V-JEPA |
| Projeção de gradiente no espaço nulo de ativações passadas | Válido em camada linear; limitado por capacidade | GPM, Adam-NSCL, OWM |
| Sinapse em cascata multiescala (Benna-Fusi) | Válido, implementar fielmente às equações | Benna & Fusi 2016 |
| Pesos ternários {-1,0,+1} | Válido; ganho só com kernel dedicado | BitNet b1.58 |
| Transformada de Walsh-Hadamard como mistura estruturada | Válido como mistura O(N log N); NÃO substitui matriz aprendida arbitrária | — |
| Memória episódica tipo Hopfield moderno | Válido | Ramsauer et al. 2020 |
| Computação em tempo de inferência (busca/verificação) | Válido, tendência atual | MCTS, verificadores formais |
| Osciladores acoplados (Kuramoto) como mecanismo de roteamento/binding | **Hipótese de pesquisa**; só com o termo de acoplamento real | Fries (CTC) |
| Neuromodulação como escalares globais (surpresa, recompensa, incerteza) | Válido como heurística de controle | — |

### 1.2 O que foi refutado/rebaixado (NÃO implementar como descrito)
1. **"Eliminação de GEMM"** via `x_had @ (W==1) - x_had @ (W==-1)`: isso são duas GEMMs densas. Só conta como "sem multiplicação" se for um kernel de acumulação (gather-add / bitpacked) medido.
2. **Quantização depois da projeção no espaço nulo** destrói a garantia de ortogonalidade. Solução adotada: **base ternária congelada + resíduo contínuo float64 protegido**.
3. **Kuramoto sem termo de acoplamento** não sincroniza; **"Yang-Mills" = norma + sigmoide** não é teoria de calibre.
4. **"Retenção exata"** vale apenas (i) no span das amostras de calibração, (ii) para uma camada linear isolada, (iii) enquanto houver dimensões livres. Em redes profundas, camadas anteriores mudam as coordenadas e a base protegida deixa de valer (representation drift).
5. **`last_pre = x.copy()`** é armazenamento de ativação; não alegar "sem memória de ativações".
6. **Comunicação por coerência de fase com "banda infinita"**: falso. Pode haver roteamento seletivo, com custo.
7. **Equilibrium Propagation** só pode ser chamado assim se houver fase livre + fase forçada com relaxamento a equilíbrio.
8. **Teorema de "esquecimento zero"**: reformular como proposição com hipóteses explícitas (ver §4.2).

### 1.3 Limites teóricos que o projeto deve MEDIR, não ignorar
- Capacidade: após k tarefas, dimensões livres = `D − rank(ΣX_k)`. Saturação é inevitável numa camada de largura finita.
- Trade-off estabilidade-plasticidade: preservar A pode impedir aprender B (conflito de subespaço).
- Aprendizado local costuma ter pior eficiência amostral que backprop.

---

## 2. Arquitetura-alvo (alto nível)

```
 observações ─► ENCODER (JEPA, backprop permitido) ─► z_t (latente)
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
 MODELO DE MUNDO            MEMÓRIA CONTÍNUA          MEMÓRIA EPISÓDICA
 preditor latente           camada(s) com base        Hopfield moderno
 z_{t+1}=f(z_t,a_t)         ternária + resíduo        (k-WTA esparso na entrada)
                            protegido (null-space)
        │                          │                          │
        └──────────────┬───────────┴──────────────┬───────────┘
                       ▼                          ▼
              PLANEJADOR (busca no latente)   NEUROMODULADOR (escalares)
              MPC/CEM/MCTS + custo/crítico    surpresa→plasticidade
                       │                      incerteza→peso top-down
                       ▼
                    AÇÃO / SAÍDA (módulo de linguagem opcional, fase 6)
```

Mapa "cérebro → módulo" é **inspiração funcional**, documentado como tal:
neocórtex→encoder+memória contínua; hipocampo→Hopfield episódico; gânglios da base→seletor de ação; cerebelo→preditor de erro rápido; locus coeruleus/dopamina/ACh→escalares neuromoduladores.

---

## 3. Módulos e especificação funcional

Linguagem: Python 3.11+, PyTorch (encoder, baselines, treino) e NumPy float64 (verificação numérica). Kernels de GPU (Triton) só na Fase 5.

### 3.1 `nova/jepa/` — modelo de mundo latente
- `ContextEncoder`, `TargetEncoder` (cópia com EMA, `requires_grad=False`), `LatentPredictor(z, a)`.
- Perda: Smooth-L1 entre `pred` e `target_encoder(x_future)` (stop-gradient).
- **Anti-colapso obrigatório:** logar std por dimensão do latente e adicionar termo opcional de variância/covariância (VICReg-like). Teste automático falha se `std_médio < 0.05`.
- Ambientes de teste: (a) ponto com física linear (já existe no código da conversa); (b) pêndulo/cartpole com sensores ruidosos; (c) grid-world com distratores (ruído irrelevante que o latente deve ignorar).

### 3.2 `nova/continual/` — camada contínua protegida (núcleo científico)
Classe `ProtectedLinear`:
- `W_base`: int8 ternário `{-1,0,+1}`, **congelado** após inicialização/treino offline.
- `dW`: float64 contínuo, único parâmetro adaptado online.
- `U`: base ortonormal (colunas) das direções protegidas, com `rank_max` configurável.
- `forward(x) = x @ W_base + x @ dW` (baseline); versão `forward_addition_only` com gather-add (para medição, §3.6).
- `consolidate(X)`: atualiza `U` por SVD incremental (Brand) com tolerância numérica `1e-12·σ_max` (não cortar 1% de energia por padrão; expor `energy_threshold` como hiperparâmetro de ablação).
- `step(X, Y, lr)`: gradiente local `-(Xᵀ(Y−pred))/n`, projetado: `g ← g − U(Uᵀg)`.
- **Proibido** quantizar `dW`.
- Métricas expostas: `eps_ortho = ‖Uᵀ dW‖_F`, `eps_ret = max|f_after(X_A) − f_before(X_A)|`, `free_dims = D − rank(U)`.

Extensões (cada uma um PR separado, com ablação):
- `BennaFusiCascade`: M reservatórios com as EDOs da seção 2.2 da conversa, integração por Euler/RK4 com passo documentado; testar decaimento de memória em múltiplas escalas contra a solução analítica para M=2.
- Proteção em rede profunda: (i) congelar camadas inferiores após tarefa 1, ou (ii) projeção por camada com base recalculada sobre ativações reais da camada (como GPM). Medir drift de representação por CKA entre antes/depois.

### 3.3 `nova/memory/` — memória episódica
- `ModernHopfield(X_mem, beta)`: recuperação `softmax(β·X·ξ)·X`, energia log-sum-exp.
- Entrada esparsa k-WTA (k≈1–5% ativo) como "separação de padrões"; teste: recuperar padrão com 30% de ruído e com 50% mascarado.
- Política de escrita guiada por surpresa (erro de predição do JEPA > limiar).

### 3.4 `nova/planning/` — decisão
- `LatentPlanner`: MPC com CEM ou MCTS sobre o preditor latente; custo = `Critic(z)`; horizonte e nº de rollouts configuráveis.
- Seletor de ação por drift-diffusion como alternativa ao argmax (opcional; comparar).
- Métrica: retorno vs. baseline de política model-free (PPO/DQN) em mesmos passos de ambiente.

### 3.5 `nova/neuromod/` — escalares globais
- `surprise = erro_normalizado_JEPA` → escala `lr` de `dW` e limiar de escrita episódica.
- `reward_pe = r + γV(s') − V(s)` → modula consolidação (mover mass de reservatório rápido para lento).
- `uncertainty` → peso entre predição interna e dado sensorial.
- Cada escalar com teste de ablação (ligado/desligado).

### 3.6 `nova/kernels/` (Fase 5)
- Kernel ternário em Triton/CUDA: pesos empacotados 2 bits, acumulação sem multiplicação float.
- Benchmark honesto contra `torch.matmul` fp16/bf16 e contra `bitnet.cpp`: latência, throughput, memória, energia (nvidia-smi/NVML). Relatar também quando perder.

### 3.7 Módulos opcionais de pesquisa (só após Fases 1–4)
- `PhaseOscillatorLayer`: Kuramoto **com** acoplamento `K/N Σ A_ij sin(θ_j−θ_i−α_ij)`; testar sincronização (parâmetro de ordem `r`) e se ajuda em tarefa de binding/roteamento.
- `EquilibriumPropagation`: relaxamento fase livre + fase forçada, regra `ΔW = (1/β)(ρ_β − ρ_0)`; validar gradiente contra backprop em rede pequena (cosseno > 0.9) antes de qualquer uso.
- `SheafCoherence`: Laplaciano de feixe sobre grafo pequeno de módulos; só se houver tarefa onde consistência entre módulos seja o gargalo.
- Linguagem: adaptador que traduz latente→texto via LLM pequeno; fora do escopo do núcleo.

---

# PARTE II — Como Nova deve ser (modelo, neurônio, percepção, raciocínio, memória, identidade)

Convenção: cada item traz **Requisito** (o que deve existir), **Escolha de projeto** (a decisão tomada) e **Validação** (como saber se funciona). Onde há dúvida científica real, a decisão é marcada como **[HIPÓTESE]** e deve ter ablação.

---

## 3A. Modelo geral: "ciclo cognitivo" contínuo

**Requisito.** Nova não é uma função `entrada → saída`. É um sistema com estado que roda um ciclo contínuo, mesmo sem entrada.

**Ciclo (um "tick", ~10–100 ms simulados):**
1. **Perceber:** sensores → encoders → latente `z_t`.
2. **Prever:** o modelo de mundo gera `ẑ_t` (o que esperava ver). Erro de predição `ε_t = z_t − ẑ_t`.
3. **Avaliar:** neuromoduladores são atualizados a partir de `ε_t` (surpresa), valor e incerteza.
4. **Recordar:** o estado atual consulta a memória episódica e semântica; o resultado volta como contexto (top-down).
5. **Decidir:** modo rápido (Sistema 1, política amortizada) ou lento (Sistema 2, planejamento/busca), conforme a incerteza.
6. **Agir/expressar:** ação motora simulada, fala ou nenhuma (silêncio é uma saída válida).
7. **Aprender:** atualização local de plasticidade; escrita episódica se `surpresa > limiar`.
8. **Consolidar (fora de linha):** ciclo de "sono" (§3F).

**Escolha de projeto.** Arquitetura em **três escalas de tempo**:
- *Rápida (ms–s):* percepção, reflexo, atenção, fala em fluxo.
- *Média (s–min):* memória de trabalho, planejamento, raciocínio deliberado.
- *Lenta (horas–anos simulados):* consolidação, formação de personalidade/valores, aprendizado de habilidades.

**Validação.** Teste de "ciclo ocioso": com entrada nula por N ticks, o estado deve permanecer estável (sem explosão nem morte da atividade); teste de latência: o modo rápido deve responder em orçamento fixo.

---

## 3B. O neurônio

Três níveis, **trocáveis por configuração**; todos expõem a mesma interface `step(inputs, modulators, dt) -> output, state`.

### Nível N0 — Unidade de taxa (padrão para escala)
- Entradas: basal (bottom-up) `x_b` e apical (top-down/contexto) `x_a`.
- Dois compartimentos: `v_b = f(W_b x_b)`, `v_a = g(W_a x_a)`.
- Saída: `y = φ(v_b · (1 + tanh(v_a)))`. O sinal apical **modula** o ganho; não soma ao basal. Essa regra de "ganho apical" é o que implementa expectativa/atenção top-down. **[HIPÓTESE]** que ajuda vs. soma simples (ablação obrigatória).
- Pesos: base ternária congelada + resíduo contínuo protegido (§3.2).
- Esparsidade: k-WTA lateral por camada, k configurável (1–10% ativo).

### Nível N1 — Neurônio pulsante (padrão para o módulo "cérebro")
- Modelo **AdEx** (adaptive exponential integrate-and-fire) ou **LIF com adaptação**; equação de membrana documentada, `dt` ≤ 1 ms.
- Dois compartimentos (soma + dendrito apical) com acoplamento condutivo; potencial de ação dendrítico (não-linearidade tipo NMDA) opcional.
- Tipos celulares mínimos: **excitatório piramidal (80%)** e **inibitórios (20%)**: PV (inibição perisomática rápida), SST (inibição dendrítica), VIP (desinibição). Esse trio é obrigatório para gerar ritmos gama/beta realistas.
- Lei de Dale respeitada: cada neurônio é excitatório ou inibitório, nunca os dois.
- Codificação: espículas; leitura por taxa em janelas e por latência.

### Nível N2 — Multicompartimental (só para validação biofísica)
- Poucos neurônios com morfologia simplificada (soma + dendritos ramificados), canais Hodgkin-Huxley principais (Na, K, Ca, Ih). Serve para **calibrar N1**, não para escala.

**Regras comuns.**
- Cada neurônio tem estado explícito (potencial, adaptação, traços sinápticos). Nada de estado oculto global.
- Frequências intrínsecas heterogêneas (distribuição log-normal), pois a diversidade é o que torna a rede rica.
- **Oscilação/fase:** se usada, deve ser o acoplamento real (Kuramoto com termo `K/N Σ A_ij sin(θ_j−θ_i−α_ij)`); caso contrário, remover o rótulo.

**Validação.** N1 reproduz curvas F–I e padrões de disparo de referência (regular, adaptativo, em rajada); N0 aproxima a taxa média de N1 na mesma rede (erro < limite definido); rede E/I produz banda gama (30–80 Hz) estável sob entrada tônica.

---

## 3C. A sinapse e a plasticidade

**Requisito.** Várias escalas de tempo e proteção contra esquecimento, sem sinapse "escalar única".

**Escolha de projeto.**
1. **Cascata Benna-Fusi** (M = 4–6 reservatórios) com as EDOs da conversa, constantes `κ_m = κ_0 b^{-m}` e vazamento `λ_m`. A sinapse expressa `W_eff = Σ β_m u^(m)`.
2. **Regra local em três fatores:** `Δw = η · (traço pré × traço pós) · M(t)`, onde `M(t)` é o sinal neuromodulador (dopamina para recompensa, ACh para atenção/aprendizado sensorial, NE para surpresa). Variantes: STDP (assimétrica) para espículas; Hebb com normalização (Oja/BCM) para taxa.
3. **Proteção por subespaço** (§3.2) aplicada nas camadas contínuas; nas camadas espiculadas, a proteção é a **cascata + metaplasticidade** (sinapses consolidadas mudam menos). **[HIPÓTESE]** sem garantia exata, a medir por retenção empírica.
4. **Homeostase:** escalonamento sináptico multiplicativo e controle de taxa-alvo por neurônio, para evitar ganho descontrolado.
5. **Poda e crescimento:** conexões com rigidez baixa e contribuição baixa são podadas; novos neurônios/sinapses são recrutados quando `free_dims` cai abaixo de um limiar (resposta ao limite de capacidade do espaço nulo).

**Validação.** Decaimento de memória em lei de potência aproximada (característica da cascata); retenção após tarefas conflitantes; estabilidade de taxa sob 10⁶ ticks.

---

## 3D. Percepção

**Requisito.** Nova deve perceber o mundo como **hipóteses sobre causas**, não como rótulos.

**Escolha de projeto — codificação preditiva hierárquica:**
- Cada nível da hierarquia tem **unidades de representação** `r_l` e **unidades de erro** `ε_l = r_l − P_l(r_{l+1})`. Conexões descendentes carregam predições; ascendentes, erros. A inferência é um relaxamento até o erro ficar pequeno; a aprendizagem usa o erro local.
- **Precisão (atenção):** cada erro é ponderado por uma estimativa de confiança `π`, controlada pela ACh e pelo contexto. Atenção = aumento de precisão em um canal.
- **Encoders por modalidade**, todos entregando latentes de mesma dimensão ao "espaço comum":
  - *Visão:* patchify + ViT pequeno/CNN treinado em JEPA (V-JEPA-like); campo visual com **fóvea** (alta resolução central, baixa na periferia) e movimento ocular (sacadas) como ação.
  - *Audição:* espectrograma log-mel → encoder temporal (SSM ou conv causal); streaming obrigatório.
  - *Texto:* tokenizador + encoder pequeno; texto é **uma modalidade sensorial**, não o núcleo.
  - *Interocepção/estado interno:* energia, "fadiga" (carga de memória), erro médio — entradas reais para o sistema de valor.
- **Fusão multimodal:** alinhamento no latente por perda de predição cruzada (prever áudio a partir de vídeo e vice-versa), sem exigir tradução para texto.
- **Constância de objeto:** representação por *slots* (atenção por slots) para rastrear entidades ao longo do tempo.
- **Percepção temporal:** buffer curto de estados (memória sensorial) e predição de movimento.

**Validação.** (i) O latente prevê o futuro sob distratores (§4.1.4); (ii) probe linear recupera posição/identidade de objetos sem que isso tenha sido o alvo; (iii) manipulação de precisão muda o desempenho como previsto (atenção ↑ = erro ↓ no canal atendido); (iv) ilusões simples (Kanizsa) como teste qualitativo de inferência top-down.

---

## 3E. Raciocínio e decisão

**Requisito.** Pensar mais tempo deve melhorar a resposta; erros devem poder ser detectados.

**Escolha de projeto — dois sistemas + verificação:**
- **Sistema 1 (rápido):** política amortizada `π_θ(a|z)` e valor `V(z)`; uma passada, orçamento fixo.
- **Sistema 2 (lento):** ativado quando `incerteza > τ` ou `surpresa > τ'`. Executa:
  1. **Imaginação:** rollouts no preditor latente (horizonte H, N ramos).
  2. **Busca:** MCTS/CEM sobre ações ou "passos de pensamento" (operações sobre a memória de trabalho), com custo/valor do crítico.
  3. **Verificação:** quando existir verificador exato (código que executa, prova formal em Lean, simulação, cálculo), usá-lo como sinal; senão, usar consistência (autoconsistência entre ramos) e a taxa de erro de predição.
  4. **Compromisso:** escolhe o ramo de maior valor esperado menos penalidade de risco.
- **Memória de trabalho:** ~7±3 *slots* ativos mantidos por atratores (Hopfield contínuo ou recorrência gated), com atualização e esquecimento controlados; é o "quadro-negro" do Sistema 2.
- **Ferramentas externas:** calculadora, interpretador, buscador, banco de fatos. Nova **chama** ferramentas em vez de "adivinhar" aritmética ou fatos verificáveis.
- **Metacognição:** estimativa calibrada de confiança; a saída pode ser "não sei" ou "preciso de mais dados". Perda de calibração (ECE) é métrica de primeira classe.
- **Planejamento hierárquico:** objetivos → subobjetivos → ações; cada nível usa um modelo de mundo em escala temporal própria (JEPA hierárquico).
- **Seleção de ação (gânglios da base):** competição entre candidatos com acumulação de evidência (drift-diffusion), limiar adaptativo pela urgência. **[HIPÓTESE]** que supera argmax em tarefas com custo de erro assimétrico.

**Validação.** Curva *desempenho × tempo de pensamento* crescente em tarefas de raciocínio (aritmética multipasso, quebra-cabeças, planejamento em grid); taxa de alucinação medida em perguntas de fato com e sem ferramenta; calibração (ECE); ablação do verificador.

---

## 3F. Memória (quatro sistemas + consolidação)

| Sistema | Conteúdo | Implementação | Ritmo |
|---|---|---|---|
| Sensorial | últimos ms–s brutos | buffer circular | contínuo |
| Trabalho | itens ativos do raciocínio | slots/atratores | segundos |
| Episódica | "o que aconteceu, quando, onde, com quem, como me senti" | Hopfield moderno + índice esparso (DG-like), com carimbo de tempo, local, participantes e valência | escrita rápida, guiada por surpresa/emoção |
| Semântica | fatos e conceitos generalizados | pesos contínuos protegidos + grafo de conhecimento | lenta |
| Procedural | habilidades | política/preditor amortizado, cerebelo-like (modelo direto) | muito lenta |

**Recuperação.** Por pista parcial (completação de padrão), por conteúdo e por contexto (tempo/lugar/pessoa). A recuperação **reconstrói** (não é cópia exata) e reescreve a memória (reconsolidação), com registro de proveniência: toda lembrança guarda a fonte original (documento, mensagem, áudio) para que Nova **diga de onde sabe**.

**Consolidação ("sono").** Ciclo offline periódico:
1. *Replay* seletivo de episódios de alto valor/surpresa;
2. treino do modelo semântico com os episódios replayados (aprendizado complementar hipocampo→córtex);
3. generalização: extração de regularidades (esquemas);
4. esquecimento ativo de episódios redundantes (compressão), preservando âncoras;
5. recalibração homeostática.

**Validação.** Recordação por pista parcial (30–50% de ruído); *curva de esquecimento* ajustada à de referência humana; teste de interferência (episódios similares não se fundem); fidelidade de proveniência (≥ 95% das lembranças citam fonte correta).

---

## 3G. Linguagem e comunicação

**Requisito.** Fala fluente, mas **ancorada** no estado interno e na memória.

**Escolha de projeto.**
- **Módulo de linguagem** = LLM pequeno/médio **condicionado** por: (i) latente do estado atual, (ii) memórias recuperadas com proveniência, (iii) perfil de identidade (§3J), (iv) estado emocional/valência.
- A decisão do que dizer (intenção, conteúdo, tom) é tomada **antes** pelo raciocínio; o LLM só **verbaliza**. Isso reduz alucinação: afirmações factuais devem vir de memória ou ferramenta com fonte; sem fonte, Nova marca incerteza.
- **Entrada:** texto/voz → encoder → latente; fala em streaming com turnos e interrupção.
- **Pragmática:** modelo do interlocutor (teoria da mente simples): crenças, objetivos e emoções estimados, atualizados a cada turno.
- **Voz e expressão** (opcional): TTS com prosódia guiada pela valência.

**Validação.** Fidelidade ao fato (cada afirmação factual rastreável a fonte); consistência entre turnos; teste de "recordação" (§3J); teste cego de naturalidade.

---

## 3H. Valor, emoção e motivação

**Requisito.** O comportamento precisa de **objetivos internos** e **prioridades**, e não apenas de reação.

**Escolha de projeto.**
- **Variáveis de estado interno (homeostáticas):** energia/orçamento computacional, carga de memória, curiosidade (ganho de informação esperado), coerência (ausência de contradições), conexão social (engajamento com interlocutores).
- **Valor:** crítico `V(z, s_interno)`; **emoção funcional** = rótulo de baixa dimensão sobre (valência, ativação, controle) derivado de erro de predição e variação do valor. É uma variável de controle que influencia atenção, escrita de memória e tom, **não** a afirmação de que Nova sente.
- **Neuromoduladores (escalares globais):**
  - NE ← surpresa → ↑ taxa de aprendizado, ↑ vigilância;
  - DA ← erro de predição de recompensa → consolidação, motivação;
  - ACh ← incerteza esperada → ↑ peso do dado sensorial vs. predição;
  - 5-HT ← paciência/horizonte temporal → desconto temporal.
- **Curiosidade intrínseca:** recompensa por redução de erro do modelo de mundo (progresso de aprendizado), com proteção contra "TV ruidosa" (ignorar ruído irredutível).
- **Valores e limites (alinhamento):** conjunto explícito de restrições duras (não enganar, respeitar consentimento e privacidade, não se passar por pessoa real sem rótulo) implementadas como **filtros fora da rede aprendida**, auditáveis e não modificáveis pela plasticidade.

**Validação.** Cada neuromodulador com ablação; curiosidade não degenera em ruído; restrições duras passam suíte de testes adversariais.

---

## 3I. Corpo, ambiente e ação

- **Corpo virtual mínimo:** atuadores (movimento no grid/ambiente 3D simples, fala, escrita), sensores (visão foveal, áudio, texto), estados internos (§3H).
- **Ambientes por etapa:** grid-world → física 2D (pêndulo/cartpole) → mundo 3D simples → ambiente com agentes simulados (conversas).
- **Controle motor:** planejador gera metas; controlador rápido (cerebelo-like) corrige erro com modelo direto e atraso compensado.
- **Ritmo de vida:** ciclos de vigília/sono simulados; sono dispara §3F.

---

## 3J. Identidade e "lembrar um humano" (ingestão de dados)

**Objetivo.** A partir de dados fornecidos sobre **uma pessoa**, Nova constrói um **modelo de memória e de estilo** dessa pessoa e consegue: (1) recordar fatos e episódios da vida dela com fonte; (2) responder no estilo e com os valores/hábitos dela; (3) sinalizar o que não sabe. É um "gêmeo digital de memória/estilo", não a pessoa.

### Condições obrigatórias (não negociáveis)
- **Consentimento.** Dados de uma pessoa viva só com consentimento explícito e revogável; de pessoa falecida, só com autorização de herdeiro/representante legal quando exigida pela jurisdição (no Brasil, LGPD e normas civis aplicáveis).
- **Rótulo permanente:** toda saída de Nova nesse modo identifica-se como simulação baseada em dados, nunca se passa pela pessoa real.
- **Sem uso para fraude, assédio, engano ou perfilamento de terceiros.** Dados de terceiros citados nas fontes (amigos, familiares) ficam minimizados.
- **Controle:** a pessoa (ou representante) pode inspecionar, corrigir e **apagar** o que Nova guarda (direito ao esquecimento técnico: remoção de episódios e retirada de sua influência nos pesos protegidos, ver abaixo).
- **Minimização e criptografia** em repouso e em trânsito; logs de acesso.

### Fontes de dados aceitas
Mensagens (chats, e-mails), diários e textos, áudios e vídeos (transcritos), fotos com legenda/data, calendário, documentos, entrevistas gravadas com a pessoa, questionários biográficos, linha do tempo de vida.

### Pipeline de ingestão
1. **Coleta e consentimento** → registro de proveniência (fonte, data, direitos).
2. **Normalização:** transcrição de áudio, OCR, extração de metadados (data, local, participantes).
3. **Segmentação em episódios:** cada episódio = {quando, onde, quem, o quê, emoção/valência estimada, fonte}.
4. **Extração:**
   - *Episódica:* eventos concretos → memória episódica (§3F).
   - *Semântica:* fatos estáveis (relações, profissão, preferências, datas) → grafo de conhecimento com confiança e fonte.
   - *Estilo:* vocabulário, estrutura de frases, humor, expressões típicas, ritmo de fala → vetor/adaptador de estilo (LoRA ou prefixo condicional no módulo de linguagem).
   - *Valores e hábitos:* decisões passadas e justificativas → perfil de valores (pesos sobre dimensões como risco, família, trabalho, religião, etc., sempre com evidências).
5. **Resolução de entidades:** unificar nomes, apelidos e pessoas citadas; desambiguar tempo.
6. **Detecção de conflitos:** informações contraditórias permanecem **ambas**, com data e fonte, e não são "fundidas".
7. **Revisão humana:** a pessoa/representante revisa um resumo e corrige.
8. **Consolidação:** ciclo de sono (§3F) incorpora o material de forma incremental; as âncoras biográficas ficam protegidas (§3.2).

### Comportamento em uso
- **Recordação com fonte:** "Em março de 2019 você escreveu a X que... (fonte: conversa 2019-03-12)".
- **Incerteza explícita:** se não há dado, diz que não sabe, e **não inventa** lembranças. Inferências são marcadas como inferência.
- **Estilo condicionado:** resposta plausível no estilo da pessoa, sem afirmar fatos que não tem.
- **Linha do tempo:** consegue ordenar eventos e responder perguntas temporais (antes/depois, há quanto tempo).
- **Atualização:** novas informações são integradas sem destruir as antigas.

### Validação de fidelidade ("lembrar um humano" como métrica)
- *Recordação factual:* perguntas retidas (held-out) sobre a vida da pessoa; acurácia e **taxa de fabricação** (resposta sem fonte) ≤ meta.
- *Verificação de fonte:* ≥ 95% das lembranças citadas apontam para a fonte correta.
- *Estilo:* teste cego com pessoas próximas e com classificador de autoria; reportar desempenho vs. LLM sem memória (baseline).
- *Consistência temporal:* ordem correta de eventos.
- *Segurança:* testes adversariais de extração de dados de terceiros, de personificação e de pedidos de apagamento (o apagamento deve ser verificável).

---

## 3K. Escala, eficiência e implantação

- **Três perfis de execução:**
  - *Lab (CPU/1 GPU):* N0 + memória + JEPA pequeno; dezenas de milhares de neurônios espiculados em N1.
  - *Cluster (multi-GPU):* milhões de neurônios N1 em kernels fundidos; encoder visual/áudio maiores.
  - *Neuromórfico (opcional):* mapeamento para Loihi/SpiNNaker/Tianjic-like para espículas; só após validação em GPU.
- **Orçamento de recursos por tick** (tempo, memória, energia) como restrição de projeto; o sistema deve degradar com elegância (reduz H, N de rollouts, ou modo Sistema 1).
- **Persistência:** checkpoint completo do estado (pesos, cascatas, memórias, neuromoduladores) e restauração determinística com a mesma semente.
- **Observabilidade:** painel com taxa de disparo por camada, erro de predição, neuromoduladores, ocupação de memória, `free_dims`, calibração e fidelidade.

---

## 3L. Trilha de validação biológica ("Nova-Brain")

Para que "emulação" tenha significado, cada módulo biológico deve ser comparado a dados reais:
- *Microcircuito cortical (N1):* taxas de disparo por camada e tipo celular, balanço E/I, bandas gama/beta (referência: Allen Institute, Blue Brain).
- *Hipocampo:* separação/completação de padrões, células de lugar (modelo vs. registros publicados).
- *Gânglios da base:* tempos de reação e escolha em tarefas de decisão (DDM vs. dados comportamentais).
- *Conectoma:* escada de escala — C. elegans → mosca (FlyWire) → fatia de córtex de camundongo (MICrONS); usar conectomas reais para inicializar topologia quando possível.
- *Comportamento humano:* curvas de esquecimento, efeitos de atenção, ilusões, limites de memória de trabalho.
Cada comparação gera um relatório com métrica, tolerância e resultado (inclusive negativo).

---

## 3M. Limites declarados desta especificação
- Não há garantia de que Nova se aproxime do desempenho humano em generalidade; o objetivo é **medir** quanto cada decisão de projeto contribui.
- Dados de uma pessoa não bastam para reconstruir seu pensamento futuro; Nova reproduz o que está nos dados e extrapola com incerteza.
- Emoção, valor e identidade são **variáveis funcionais** de controle e organização; esta especificação não afirma nem testa consciência ou experiência subjetiva.

---

## 4. Verificação científica

### 4.1 Benchmarks obrigatórios
1. **Sintético linear** (o do §"Experimento da Seção 2"): sobreposição α ∈ {0, .25, .5, .75, 1}, `n_samples` variando até saturar.
2. **Split-MNIST / Permuted-MNIST / Split-CIFAR100** (aprendizado contínuo padrão), sem oráculo de tarefa no teste quando possível.
3. **Sequência de ambientes RL** simples para o planejador.
4. **Predição latente** com distratores (JEPA vs. autoencoder pixel-wise).

### 4.2 Métricas
- Acurácia média final (ACC), esquecimento médio (FM), transferência para frente (FWT), plasticidade (acurácia da tarefa nova vs. treino isolado).
- `eps_ret`, `eps_ortho`, `free_dims` por camada ao longo das tarefas.
- Custo: parâmetros, bytes de estado por sinapse, FLOPs/ops inteiras, latência, memória de pico.
- **≥ 5 sementes**, reportar média ± desvio; testes estatísticos simples.

### 4.3 Baselines
Fine-tuning ingênuo; EWC; replay pequeno; GPM/Adam-NSCL (reimplementação ou lib); multitask (limite superior); para custo: MLP/Transformer pequeno fp16.

### 4.4 Proposição formal a testar (substitui o "teorema")
> Seja `U` base ortonormal de `span(X_A)`. Se `dW` é atualizado apenas por `g − U Uᵀ g`, então para todo `x ∈ span(X_A)` e qualquer número de passos, `x·dW` permanece inalterado (até precisão de máquina). Hipóteses: camada linear isolada, sem quantização de `dW`, entrada da camada estável (sem drift das camadas anteriores), base com rank suficiente. Não implica generalização de A para amostras fora do span.

Testes unitários devem cobrir cada hipótese (incluindo um teste que **demonstra** a falha quando a hipótese é violada: quantizar `dW`, truncar o rank, introduzir rotação de entrada).

### 4.5 Critérios de aceitação por fase
| Fase | Entrega | Critério de aceite |
|---|---|---|
| 1 | `ProtectedLinear` + auditoria linear | `eps_ret < 1e-10` em float64; curva plasticidade×α reproduzível; saturação documentada |
| 2 | JEPA + ambientes | sem colapso; erro latente < baseline de média; ignora distratores |
| 3 | Rede profunda + contínuo | FM menor que fine-tuning e competitivo com GPM em Split-MNIST |
| 4 | Hopfield + neuromod + planejador | cada módulo com ablação mostrando ganho ou sendo removido |
| 5 | Kernels ternários | ganho medido de memória/energia vs. fp16, ou relatório negativo |
| 6 | Osciladores/EqProp/sheaf (opcional) | só mantidos se superarem versão simples equivalente |
| 7 | Percepção + neurônio N1 (§3B, §3D) + trilha Nova-Brain B1 (§3L) | curvas F–I e banda gama reproduzidas; latente prevê futuro sob distratores; probes lineares acima do acaso |
| 8 | Raciocínio, memória em quatro sistemas, valor (§3E, §3F, §3H) | desempenho cresce com tempo de pensamento; calibração (ECE) dentro da meta; ablação de cada neuromodulador |
| 9 | Identidade e ingestão (§3J) com dados de uma pessoa **consentidos** | acurácia factual em perguntas retidas; fabricação ≤ meta; ≥ 95% das lembranças com fonte correta; apagamento verificável; rótulo de simulação sempre presente |

---

## 5. Estrutura do repositório

```
nova/
  pyproject.toml
  README.md                # com a "Regra de honestidade" do §0
  nova/
    jepa/ continual/ memory/ planning/ neuromod/ kernels/ research/
    neuron/        # N0, N1, N2 (§3B)
    synapse/       # cascata, regras de 3 fatores, homeostase (§3C)
    perception/    # encoders, codificação preditiva, atenção (§3D)
    reasoning/     # Sistema 1/2, working memory, verificadores, ferramentas (§3E)
    values/        # estado interno, emoção funcional, restrições duras (§3H)
    language/      # verbalizador condicionado (§3G)
    identity/      # ingestão, proveniência, perfil de estilo/valores, apagamento (§3J)
    brain/         # trilha Nova-Brain: microcircuito, hipocampo, gânglios (§3L)
  experiments/
    01_linear_nullspace_audit.py
    02_jepa_latent_world.py
    03_continual_split_mnist.py
    04_planning_latent.py
    05_kernel_benchmark.py
  tests/                   # pytest; inclui testes de violação de hipótese
  reports/                 # tabelas CSV + figuras geradas por script
  configs/                 # YAML com seeds e hiperparâmetros
```

Requisitos de engenharia: tipagem, docstrings com a equação implementada, seeds fixas, logging em CSV/JSON, CI com `pytest`, nenhuma afirmação de desempenho no README sem tabela gerada por `reports/`.

---

## 6. Instruções diretas para a IA codificadora

1. Comece **somente** pela Fase 1. Entregue código, testes e relatório antes de avançar.
2. Se uma equação da especificação não for implementada fielmente, renomeie o módulo e registre em `DEVIATIONS.md`.
3. Se um resultado contradisser a hipótese, **reporte o resultado negativo**; não ajuste o benchmark para "passar".
4. Cada módulo novo vem com ablação e baseline.
5. Ao final de cada fase, produza `reports/faseN.md` com: o que foi feito, números, o que falhou, próximos passos.
6. Não use as palavras "superinteligência", "AGI", "consciente" ou "senciente" em código, docstrings ou README. "Emulação" só para módulo que passou na validação da §3L; os demais são "inspirados no cérebro".
7. Módulos de identidade (§3J) não processam dados de nenhuma pessoa sem registro de consentimento no `consent.json` e sempre exibem o rótulo de simulação.
8. Esta v2.0 define **o que construir**; implemente na ordem das fases e nunca pule a validação de uma fase para começar a seguinte.

---

## 7. Riscos conhecidos
- Projeção no espaço nulo é limitada pela largura da camada; pode exigir expansão dinâmica de dimensão (adicionar neurônios) ou reciclagem de subespaço (esquecimento controlado).
- Drift de representação em redes profundas é o risco principal da Fase 3.
- Aprendizado local pode exigir muitas iterações de relaxamento (custo > backprop).
- Ganhos de energia de pesos ternários só existem com kernel/hardware adequados.
- Escopo grande: priorizar profundidade de validação sobre número de módulos.