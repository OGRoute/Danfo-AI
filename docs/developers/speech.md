---
description: Optional FastAPI service — YarnGPT2 TTS and Whisper STT for Nigerian languages.
---

# Speech service

`services/speech` is a thin FastAPI wrapper around
[YarnGPT](https://github.com/saheedniyi02/yarngpt), giving Danfo Nigerian-accented
text-to-speech in **English, Yorùbá, Igbo, Hausa, and Pidgin**. The Next.js app
calls it through `/api/speak`; Whisper handles speech-to-text on the input side.

It is optional and out of the npm workspace set — the model is large and
Python-only, so it cannot run inside the Next.js runtime. Keeping it a separate
process means you can run it locally for development or put it on a GPU box for
production and point the app at it with one env var.

> YarnGPT is a separate ML project with its own license and models. This folder
> only wraps it. See [THIRD-PARTY-NOTICES.md](https://github.com/OGRoute/Danfo-AI/blob/main/THIRD-PARTY-NOTICES.md).

## Setup

Python 3.10+, and a CUDA GPU is strongly recommended (CPU works but is slow).
Install [PyTorch](https://pytorch.org/get-started/locally/) for your platform
first, then:

```bash
cd services/speech
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

Download the WavTokenizer files YarnGPT decodes audio with into `models/`:

```bash
mkdir -p models && cd models
wget https://huggingface.co/novateur/WavTokenizer-medium-speech-75token/resolve/main/wavtokenizer_mediumdata_frame75_3s_nq1_code4096_dim512_kmeans200_attn.yaml
wget https://huggingface.co/novateur/WavTokenizer-large-speech-75token/resolve/main/wavtokenizer_large_speech_320_24k.ckpt
```

`services/speech/fetch-yarngpt.sh` automates this. Check the upstream YarnGPT
README for authoritative links if they move; paths are overridable via env.

## Run

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

Then point the app at it — in `apps/web/.env.local`:

```
YARNGPT_API_URL=http://localhost:8000
```

The model loads lazily on the first `/tts` request, so that first call is slow.

## API

### `GET /health`

```json
{ "status": "ok", "model": "saheedniyi/YarnGPT2", "loaded": true }
```

### `POST /tts`

```json
{ "text": "Bawo ni, e ku aaro", "language": "yoruba", "voice": "idera" }
```

Returns `audio/wav` bytes. `language` ∈ `english`, `yoruba`, `igbo`, `hausa`,
`pidgin` — unknown values fall back to English. `voice` is a YarnGPT2 speaker
name (`idera`, `zainab`, `ngozi`, …).

## Configuration

| Var | Default | Purpose |
|---|---|---|
| `YARNGPT_MODEL` | `saheedniyi/YarnGPT2` | Hugging Face model id |
| `WAV_TOKENIZER_CONFIG` | `models/…attn.yaml` | WavTokenizer config path |
| `WAV_TOKENIZER_MODEL` | `models/…24k.ckpt` | WavTokenizer checkpoint path |

## Without it

`YARNGPT_API_URL` unset ⇒ voice output is unavailable and the speaker controls
hide. Text chat, the map, and the corrections feed are unaffected.
