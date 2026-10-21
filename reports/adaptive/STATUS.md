# Extensão adaptativa — estado de implementação

Implementados os três eixos solicitados: capacidade por decaimento/liberação e expansão limitada; inferência latente por EqProp não linear ou circuito AdEx efetivo; planejamento por energia com feixe temporal.

Também adicionados: versões de características e âncoras, política de readout sem autograd, recompensa de progresso com margem de incerteza, objetivos/limites de estado configuráveis, limites de histórico/grafo, checkpoint v2 atômico com integridade, retomada do solver, configurações YAML e carregamento tardio de PyTorch.

**Validação desta revisão: não executada**, conforme a preferência anterior do usuário. Foram escritos testes e os experimentos 10–12 para reprodução posterior. A revisão de código, formatação e análise estática não equivalem a executar os modelos ou demonstrar ganhos.

Os resultados das fases 1–9 pertencem à entrega anterior. Nenhuma melhora de acurácia, retenção, energia, escala ou tempo real é afirmada para esta extensão sem medições novas.

Limites: recursos finitos; liberação permite esquecer; versões de entrada são parte da garantia; rede de taxa simétrica e AdEx são hipóteses distintas; o planejador pode parar em mínimos locais; viabilidade é avaliada no modelo; parada nula não é um certificado de segurança física.
