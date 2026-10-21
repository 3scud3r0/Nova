# Identidade: operação local com consentimento

Nenhum dado real é incluído no repositório. Os testes usam pessoas fictícias. Antes de ingerir dados, o responsável deve criar `private/consent.json` com autorização explícita e verificável fora do software. Exemplo de **estrutura**, deliberadamente não autorizado:

```json
{
  "subject_id": "identificador-pseudonimo",
  "granted": false,
  "authority": "",
  "granted_at": "2026-10-21T00:00:00Z",
  "expires_at": "2027-10-21T00:00:00Z",
  "purposes": ["memory", "style"],
  "authorized_principals": ["operador-autorizado"],
  "aliases": [],
  "revoked": false
}
```

`granted` só deve mudar após obter consentimento; `authority` identifica a base da autorização. Proteja o arquivo contra edição por pessoas não autorizadas. A biblioteca verifica o registro, mas não autentica juridicamente seu autor. `actor` é uma identidade fornecida por uma aplicação confiável; não exponha esta CLI como serviço público sem autenticação externa.

```bash
nova keygen --output private/vault.key
nova identity ingest --subject identificador-pseudonimo --actor operador-autorizado \
  --key-file private/vault.key --input private/source.json
nova identity inspect --subject identificador-pseudonimo --actor operador-autorizado --key-file private/vault.key
nova identity review --subject identificador-pseudonimo --actor operador-autorizado --key-file private/vault.key
nova identity answer --subject identificador-pseudonimo --actor operador-autorizado --key-file private/vault.key --predicate profissao
```

Alternativamente, injete `NOVA_IDENTITY_KEY` em base64 pelo gerenciador de segredos. Chaves não vão a logs ou checkpoints. AES-256-GCM autentica conteúdo e associa o ciphertext ao perfil. O cofre fica em diretório 0700, arquivos 0600; escrita é atômica e operações são serializadas por flock. Não existe tráfego de rede neste fluxo local.

Formato de fonte: `subject_id`, `id`, `kind`, `rights`, `timestamp` ISO-8601 com fuso, `content`, `participants`, `facts` (`predicate`, `value`, `confidence`, `inference`), `events` (`content`, `timestamp`, `location`, `valence`, `anchor`), `values` (`dimension`, `weight`, `evidence`). Mensagens, diários, transcrições, fotos legendadas, calendário, documentos e entrevistas normalizados são aceitos. Extração semântica é estruturada/revisada; não há extração livre supostamente infalível.

Participantes declarados são pseudonimizados, e padrões de telefone/email são removidos. Essa minimização não identifica automaticamente todas as referências a terceiros em texto livre. Faça revisão dos dados antes da ingestão. Fatos explicitamente atribuídos a terceiros são rejeitados.

Correções usam uma nova fonte. Contradições coexistem com datas/fontes. `review` libera respostas após inspeção. Sem fato correspondente, a resposta diz que não sabe. Toda resposta desse modo mantém o rótulo de simulação.

`delete-source --source-id ID` remove fonte, episódios, fatos, estilo, valores e reconstrói do zero os pesos derivados a partir das fontes restantes. `erase` exclui o cofre ativo e revoga o consentimento. Logs conservam apenas hashes de perfil/ator, operação e data. Exclusão não alcança backups externos, exportações já entregues ou cópias de um administrador; não é apagamento físico certificado de SSD. A aplicação não incorpora informações pessoais ao JEPA ou a pesos compartilhados, evitando promessas de unlearning que não consegue cumprir.

OCR e transcrição têm adaptadores opcionais (`pip install -e '.[media]'`, Tesseract instalado e modelo Whisper local). A política exige consentimento antes de abrir mídias. O adaptador de LLM (`.[language]`) usa pesos locais e devolve rascunhos não verificados; não substitui a saída factual determinística nem foi validado em naturalidade.
