# YarnGPT TTS Service

Nigerian-accented text-to-speech for DanfoAI, powered by
[YarnGPT](https://github.com/saheedniyi02/yarngpt). Runs as a standalone
FastAPI service that the Next.js app calls through `/api/speak`.

It speaks DanfoAI's replies in **English, Yorùbá, Igbo, Hausa and Pidgin** with
local voices — complementing the Whisper speech-to-text already used for input.

> YarnGPT is a separate, Python-only ML project with its own license and
> models. This folder only contains a thin service wrapper around it.

## Why a separate service?

The YarnGPT model is large and Python-only; it can't run inside the Next.js
runtime. Keeping it as its own process means you can run it locally for dev or
deploy it to a GPU box for production, and point the app at it with one env var.

## Setup

1. **Python 3.10+** and (strongly recommended) a CUDA GPU. CPU works but is slow.

2. Install [PyTorch](https://pytorch.org/get-started/locally/) for your platform
   first, then the rest:

   ```bash
   cd yarngpt-service
   python -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   ```

3. Download the WavTokenizer files YarnGPT decodes audio with, into `models/`:

   ```bash
   mkdir -p models && cd models
   # Config (from the WavTokenizer repo):
   wget https://huggingface.co/novateur/WavTokenizer-medium-speech-75token/resolve/main/wavtokenizer_mediumdata_frame75_3s_nq1_code4096_dim512_kmeans200_attn.yaml
   # Checkpoint:
   wget https://huggingface.co/novateur/WavTokenizer-large-speech-75token/resolve/main/wavtokenizer_large_speech_320_24k.ckpt
   cd ..
   ```

   (See the upstream YarnGPT README for the authoritative download links if
   these change. You can also override paths with the env vars below.)

## Run

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

Then tell the Next.js app where to find it, in the project root `.env.local`:

```
YARNGPT_API_URL=http://localhost:8000
```

The model loads lazily on the first `/tts` request (first call is slow).

## API

- `GET /health` → `{ status, model, loaded }`
- `POST /tts` with JSON:

  ```json
  { "text": "Bawo ni, e ku aaro", "language": "yoruba", "voice": "idera" }
  ```

  Returns `audio/wav` bytes. `language` ∈ {english, yoruba, igbo, hausa,
  pidgin}; `voice` is a YarnGPT2 speaker name (e.g. `idera`, `zainab`,
  `ngozi`). Unknown languages fall back to English.

## Configuration (env vars)

| Var | Default | Purpose |
|-----|---------|---------|
| `YARNGPT_MODEL` | `saheedniyi/YarnGPT2` | HF model id |
| `WAV_TOKENIZER_CONFIG` | `models/...attn.yaml` | WavTokenizer config path |
| `WAV_TOKENIZER_MODEL` | `models/...24k.ckpt` | WavTokenizer checkpoint path |
