A camada protegida anterior congelava ao saturar o span, o circuito AdEx não produzia o latente da cognição e o runtime tinha apenas busca CEM. Este PR acrescenta caminhos experimentais integrados para investigar esses três limites.

- Memória `AdaptiveSubspaceLinear` com evidência/traços lentos, liberação explícita, âncoras, blocos não lineares versionados e teto de largura/bytes. Liberação permite esquecer; expansão não cria capacidade infinita.
- Modelo latente não linear por EqProp `±beta`, recorrência simétrica contrativa, alvo EMA e derivadas implícitas; perfil AdEx com circuito efetivamente no caminho do latente. Políticas e modelos locais podem operar sem importar PyTorch/autograd; o baseline continua disponível.
- Planejamento por energia com recursão adjunta explícita, busca Armijo, feixe temporal sem Laplaciano global, metas/limites configuráveis e orçamento de avaliações. O CEM ganha reaproveitamento de trajetória, diagnóstico e verificação de viabilidade. O espaço de busca de ambos é H×action_dim.
- Checkpoint v2 NPZ/JSON atômico com integridade e migração v1; versões/traços/circuito/solver persistidos; histórico/grafo limitados; curiosidade com margem de incerteza e painel que distingue valores ausentes.

Os perfis `adaptive`/`brain`, configurações YAML, treino local offline, testes de regressão e experimentos 10–12 foram adicionados. `artifacts/NOVA_codigo_completo.txt` foi regenerado. Equações, pressupostos e limites estão em `docs/adaptive-energy.md`, `DEVIATIONS.md` e `reports/adaptive/STATUS.md`.

Validação: formatação/análise estática e revisão do diff. Não foram executados novos testes ou benchmarks, conforme solicitado; nenhum ganho de desempenho, retenção ilimitada, fidelidade biológica ou garantia de segurança física é alegado. Os resultados antigos permanecem identificados como históricos. A seleção dos novos perfis é explícita.
