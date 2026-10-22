# ADR 0001 — Prosódia e qualidade de áudio Kokoro/Dora

- **Estado:** Proposto — aguardando avaliação auditiva e decisão de publicação
- **Data:** 2026-10-22
- **Escopo:** `tools/tts/kokoro_release.py`, `.github/workflows/kokoro-audio.yml` e artefatos de comparação
- **Voz inalterada:** `pf_dora`; **velocidade de referência:** `1.00`; **perfil de referência:** `equilibrado`
- **Proteção:** `publish` e Releases existentes permanecem intactos até aprovação explícita

## Contexto

A versão `equilibrado-100` da PR #55 foi escolhida na escuta; a
segmentação baseada em frases melhorou significativamente a fluidez.
O limite anterior de 240/320 **caracteres é uma heurística nossa, não
uma restrição do modelo**. Kokoro aceita até aproximadamente 510 tokens
fonéticos por inferência; a documentação das vozes sugere como região
favorável aproximadamente 100–200 tokens e alerta para degradação em
extremos (<10–20 ou >400 tokens).

A síntese bilíngue é fonemizada primeiro com eSpeak PT-BR/EN-US e
`is_phonemes=True`, mantendo Dora também nas expressões inglesas.

## Decisão proposta

### 1. Planejamento por tokens reais, não por caracteres

- **Teto rígido editorial:** `350` tokens fonéticos, contados pelo
  **mesmo tokenizer do `kokoro-onnx`** que será usado na inferência,
  sobre a saída consolidada do fonemizador PT-BR/EN-US.
- **Faixa-alvo flexível:** `100–200` tokens. Pode-se agrupar frases
  adjacentes **dentro do mesmo parágrafo**, desde que não ultrapassem
  350 e não mudem a ordem/idioma/pontuação. Evitar chunks com menos
  de 20 tokens quando a fusão natural for possível; títulos e
  parágrafos curtos permanecem exceções legítimas.
- **Preservar frase completa** sempre que ela couber no orçamento de
  350 tokens. Não dividir apenas porque excede 320 caracteres.
- **Frase com mais de 350 tokens:** dividir preferencialmente na última
  pausa natural (vírgula, ponto e vírgula ou dois-pontos) que fique
  abaixo do limite, favorecendo partes razoavelmente equilibradas.
  Como recurso final, dividir entre palavras. Nunca cortar a palavra
  ou apagar sua pontuação.
- **Pausa adicional de 25 ms** entre inferências quando houver quebra
  interna de uma mesma frase. Manter pausa normal de parágrafo no
  fim do bloco. Evitar contar duas vezes a mesma pausa.
- **Invariantes:** concatenação normalizada dos segmentos idêntica ao
  texto de entrada; nenhum chunk com mais de 350 tokens; mesma
  sequência de `block_index` para a navegação e destaque do player.
- Registrar `phoneme_token_count`, `split_reason` e quantidade de
  cortes internos por parágrafo nos metadados do comparativo.

A verificação deve ocorrer **antes de cada chamada** a
`kokoro.create()`. Não pode haver fallback silencioso do motor
sobre trechos que excedem o teto.

### 2. Corte de silêncio (`trim`)

- Fixar `trim=True` **explicitamente** nas chamadas ao Kokoro.
  Isso **já é o default da biblioteca `kokoro-onnx==0.6.1`**;
  não é uma nova melhoria acústica por si só.
- O `trim` retira silêncios iniciais/finais produzidos pelo modelo.
  **Não executar uma segunda limpeza agressiva** depois do WAV.
- Inspecionar emendas e início/fim de cada trecho para detectar
  consoantes ou respirações cortadas. Caso haja problemas, fazer
  diagnóstico curto `trim=True` × `trim=False`, sem promover
  `False` automaticamente.
- Metadados e marcadores de parágrafos continuam calculados a partir
  do número real de amostras após a síntese e todas as pausas.

### 3. Qualidade do MP3 e normalização

**Isolar o processamento de áudio da síntese**, reaproveitando o
**mesmo WAV** para todas as alternativas de codificação; assim
diferenças perceptíveis não serão confundidas com prosódia distinta.

1. Fixar primeiro o `loudnorm` atual `I=-19:TP=-1:LRA=11`
   e comparar `libmp3lame` mono 24 kHz em **96, 128 e 160 kbps**.
   Registrar tamanho, bitrate, qualidade percebida e eventuais
   artefatos em sibilantes.
2. Com bitrate escolhido, testar separadamente normalização
   **`-19` versus `-17` LUFS** (e `-16` LUFS somente se
   desejarmos um volume mais próximo de podcasts), mantendo
   `TP=-1 dBTP`. Avaliar também `loudnorm` em duas passagens
   para arquivos, sem prometer melhora audível.
3. Usar `ffprobe` e `ebur128`/medição de true peak para registrar
   duração, sample rate, canais, LUFS medido, true peak e tamanho
   final. Detectar clipping e garantir reprodução no navegador.

Não aumentar sample rate do WAV original de 24 kHz esperando criar
detalhes que o vocoder não gerou. Avaliar o custo adicional de
downloads e armazenamento da Release.

### 4. `continuous` e compatibilidade com Dora

**Não afirmar que Dora é incompatível.** A compatibilidade depende
da **exportação ONNX**, não da identidade da voz.

- A distribuição oficial `model-files-v1.1` informa que seu
  `kokoro-v1.0.onnx` inclui saída de durações, usada por
  `create(continuous=True)`.
- O `kokoro-onnx` exige que `kokoro.has_timings` seja verdadeiro
  (saída `duration` presente). Caso contrário, `continuous=True`
  lança erro.
- Antes de qualquer teste, validar os outputs do **arquivo exato
  baixado pela Action** e `kokoro.has_timings`.
- `continuous` usa janelas sobrepostas **dentro de uma mesma
  chamada** e pode consumir cerca de **1,4×** a computação.
  **Não une automaticamente** as fronteiras entre chamadas diferentes
  do nosso segmentador. Com chunks limitados a 350 tokens, os ganhos
  são incertos; não habilitar em produção sem A/B audível e medição.
- **Decisão provisória:** `continuous=False`; considerar um ensaio
  restrito a frases longas com o export compatível somente se as
  emendas continuarem perceptíveis. Se a Action algum dia usar um
  ONNX sem `duration`, registrar a incompatibilidade **daquele
  export específico**, não da Dora.

Referências:
- https://github.com/thewh1teagle/kokoro-onnx/releases
- https://github.com/thewh1teagle/kokoro-onnx/blob/main/src/kokoro_onnx/__init__.py
- https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md
- https://ffmpeg.org/ffmpeg-filters.html#loudnorm

## Execução e validação em etapas

1. **Baseline:** manter e identificar o WAV/MP3 `equilibrado-100`
   aprovado de Bulkhead; preservar a Release original.
2. **Segmentação:** alterar somente a lógica de montagem, para usar
   tokens e 25 ms em cortes internos; teste com título + introdução
   metafórica e um parágrafo técnico mais longo para exercitar
   sentenças acima de 350 tokens. Registrar transcrição, divisão e
   distribuição de tamanhos de chunks.
3. **Trim:** explicitar `trim=True`, checar silêncios/respirações
   nas junções e sincronismo dos marcadores, sem síntese repetida de
   artigos inteiros.
4. **Compressão:** mesmo WAV, três MP3s (96/128/160), comparação
   em fones e celular; experimentar alvos de loudness em rodada
   separada somente se necessário.
5. **Continuous (opcional):** conferir `has_timings`, custo e
   naturalidade em um trecho longo antes de cogitar alteração padrão.
6. **Aceite:** escolher um único preset após audição, registrar
   métricas, testes de regressão e consentimento explícito antes
   de aplicar ao `publish` ou substituir qualquer Release.

**Critérios de aceite:** voz sempre `pf_dora`; velocidade `1.00`;
texto preservado incluindo inglês e léxico; 350 tokens no máximo
por inferência; pontos de emenda aceitáveis; MP3 sem distorção;
marcadores por parágrafo corretos; geração comparativa sem publicação
e sem recomputações desnecessárias.
