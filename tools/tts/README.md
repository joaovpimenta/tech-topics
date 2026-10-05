# Narração local antes do commit

O pre-commit exige uma narração Chatterbox válida para os artigos JSON staged em `content/articles/`. O comando manual e o hook usam `precommit.py check`. A síntese do navegador continua sendo o player público; voz, roteiro temporário, WAV e metadata do Chatterbox ficam em `.local/tts/`, ignorada pelo Git.

## Preparar um clone

Use Python 3.11 ou superior para ferramentas e testes. Para a síntese, use um ambiente local compatível com as dependências do Chatterbox (`torch`, `torchaudio`, `chatterbox-tts`). O preparo não instala pacotes nem baixa modelos.

1. Crie os diretórios e um config inicial, preservando configuração já existente:

   ```powershell
   python tools/tts/precommit.py prepare --json
   ```

2. Escolha em `.local/tts/config.json` uma amostra WAV local, completa:

   ```json
   {
     "voice": ".local/tts/voices/minha-voz.wav",
     "generation": { "chunk_chars": 280, "pause_ms": 300 }
   }
   ```

   Um caminho absoluto também funciona. `TECH_TOPICS_TTS_VOICE` prevalece sobre `voice` no config. Os parâmetros opcionais de `generation` correspondem aos argumentos do gerador, usando `_` nos nomes compostos; consulte `python tools/tts/test_chatterbox.py --help`. O idioma local permanece `pt`.

3. Execute o diagnóstico com o mesmo Python que executará o hook:

   ```powershell
   python tools/tts/precommit.py doctor --json
   ```

   Ele retorna checks de voz, parâmetros, arquivos privados e disponibilidade das bibliotecas, sem importar modelos ou sintetizar. `ok=false` produz código de saída 1. `hook.enabled` informa separadamente a ativação do hook; disponibilidade das bibliotecas não garante compatibilidade binária ou qualidade da síntese.

4. Ative explicitamente o hook neste clone:

   ```powershell
   python tools/tts/precommit.py prepare --install-hook --json
   ```

   O comando configura `core.hooksPath=.githooks` localmente. Pode ser repetido e recusa substituir outro diretório de hooks. Para integrar hooks próprios, invoque `precommit.py check` no pre-commit existente.

O hook escolhe `.venv/Scripts/python.exe` no Windows, `.venv/bin/python` em Unix ou `python3`/`python` do PATH. Quando usar `.venv`, troque `python` nos comandos acima pelo executável desse ambiente. Ao versionar o hook, preserve sua permissão Unix com `git add --chmod=+x .githooks/pre-commit`.

## Verificar os artigos preparados

```powershell
python tools/tts/precommit.py check --json
```

O comando examina a versão no índice Git, preservando alterações ainda não staged. Ignora `index.json`, remoções de artigos e conteúdo não narrativo como código, controles, navegação e simuladores. O JSON lista cada slug e se houve reutilização; o progresso da síntese sai em stderr.

Cada WAV possui metadata local com hashes da narração, bytes da voz, parâmetros efetivos, extrator, gerador, versões das dependências e áudio final. Alterações nesses dados invalidam o cache. WAV sem metadata, corrompido ou truncado também exige geração. Mudanças que não alteram a prosa narrada podem reutilizar áudio. Para forçar regeneração, remova apenas `.local/tts/output/<slug>.json`.

A geração escreve num WAV temporário, valida seus chunks e só então substitui o áudio final e grava a metadata. Falha ou interrupção deixa o cache inválido. Amostra ausente, configuração inválida, arquivos privados no índice ou falha na síntese bloqueiam o commit. O comando não adiciona áudio ao Git nem o publica. Para uma exceção consciente à política local, o Git aceita `git commit --no-verify`.

## Testar sem síntese

```powershell
python -m unittest discover -s tools/tts -p 'test_*.py'
```

Os testes usam somente a biblioteca padrão e Git, com repositórios isolados sob `.local/tts/tests/`; não importam Torch, carregam modelos ou usam a voz configurada do clone. A CI pode executá-los sem instalar as dependências de síntese. Revisão humana do WAV continua necessária para avaliar pronúncia e qualidade da voz.
