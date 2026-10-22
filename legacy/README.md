# NOVA Native + Cortex 0.9

Este é o workspace nativo/científico do NOVA. Execute Cargo e os comandos Python
a partir desta pasta. A interface web fica na raiz do repositório; o diretório
`legacy/` continua recebendo as implementações mantidas do motor.

```sh
cargo build --release --locked
./target/release/nova substrate --kind conway --live
./target/release/nova fuse --source fusion
./target/release/nova autosearch --target-archive runs/atlas --substrate fusion --neural
```

O binário nativo reúne simulação, UI, datasets e observador compacto sem Python.
O pacote opcional `nova_cortex` acrescenta modelos de mundo e interpretabilidade:

```sh
python -m pip install -e '.[cortex]'
./target/release/nova ipc --substrate fusion --directory runs/ipc-01
# Em outro terminal:
python -m nova_cortex run --ring runs/ipc-01 --output runs/brain-01 --profile compact
```

| Guia | Conteúdo |
| --- | --- |
| [Motor e APIs](docs/native/README.md) | Compilação e integração Rust/Python/C |
| [Famílias e fontes](docs/native/FUSION.md) | Particle Life, Conway e atribuições |
| [Evolução](docs/native/EVOLUTION.md) | Substratos, organismos, MAP-Elites e P2P |
| [Cortex](docs/native/CORTEX.md) | RSSM, JEPA, CEM, replay, SAE, sondas, datasets e ciência |
| [Glossário](docs/native/CORTEX_GLOSSARY.md) | Termos científicos e referências |
| [Estado](docs/native/STATUS.md) | Verificações realizadas e limitações |

O extra `cortex-science` instala PySR/PySINDy; `interpretability` instala
SAELens/TransformerLens. Dependências opcionais só são importadas quando usadas.
Esses módulos não são exigidos pelo executável Rust.

Fontes consolidados: [Rust/WGSL](artifacts/NOVA_Rust_completo.txt) e
[workspace completo com Cortex](artifacts/NOVA_codigo_completo.txt).
Regeneração: `python scripts/bundle_source.py` e o mesmo comando com `--rust-only`.
Os arquivos TXT não são executáveis.

Esta revisão teve checagens de compilação e análise estática, sem executar testes,
simulações, treinos, IPC ou benchmarks. Features esparsas não garantem conceitos
puros; equações ajustadas não viram leis físicas por terem sido exportadas.
As limitações específicas estão nos guias. Licença combinada
[AGPL-3.0-or-later](LICENSE), com [atribuições preservadas](THIRD_PARTY_NOTICES.md).
