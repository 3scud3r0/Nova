# Evidência da entrega nativa 0.6

Solicitação: implementar e criar PR/TXT sem executar testes.

## Verificações concluídas no ambiente Linux x86_64

- `cargo check --workspace --locked`: passou; inclui Rust/PyO3/C ABI e análise/validação WGSL pelo Naga.
- `cargo check --locked --examples`: passou, sem executar os exemplos.
- `cargo build --release --locked -p nova-engine -p nova-ffi`: passou; gera executável Linux, biblioteca dinâmica e estática C.
- `cargo check -p nova-physics --target aarch64-unknown-linux-gnu --locked`: passou; inclui a implementação NEON. É checagem de compilação, sem link/execução ARM.
- `maturin develop --release`: passou; extensão Python CPython 3.12 instalada em modo editável.
- Build independente em `crates/nova-python`: wheel `nova_engine-0.6.0-cp312-cp312-manylinux_2_34_x86_64.whl` gerada.
- `cc -Wall -Wextra -Werror examples/embed.c -Iinclude -Ltarget/release -lnova -o /tmp/nova-embed-compiled`: compilou/linkou; o programa não foi executado.
- `python -m compileall`: sintaxe dos novos módulos Python aprovada.
- Arquivos YAML de workflows analisados; a matriz Windows/macOS não foi executada localmente.
- `readelf` mostrou dependências ELF padrão do sistema, sem dependência de Python no executável.

Testes, simulações, benchmarks, chamadas funcionais das APIs Python/C, interação
gráfica, geração/leitura de datasets e integrações opcionais **não foram
executados**. Não há medição de FPS, reprodução numérica entre backends ou
validação em execução dos formatos exportados. Compilação não demonstra essas
propriedades.

## Entregáveis

- Workspace, CLI e bibliotecas em `Cargo.toml`, `crates/` e `src/`.
- Bindings e controle científico opcionais em `nova_engine/`.
- C ABI documentada em `include/nova.h`; exemplos em `examples/`.
- Workflow de compilação e empacotamento multiplataforma, sem publicar uma Release nesta tarefa.
- `artifacts/NOVA_codigo_completo.txt`: fonte consolidado com índice e SHA-256 por arquivo, não um executável.
- Pacote Linux gerado localmente por `scripts/package_native.py` em `dist/`, fora do Git.

A suíte legada teve uma falha de restauração em memória durante o onboarding
anterior. Ela não foi alterada nem reexecutada por esta entrega. A compilação
nativa nova não resolve ou verifica esse defeito legado.
