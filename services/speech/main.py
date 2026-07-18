"""
YarnGPT text-to-speech microservice for DanfoAI.

YarnGPT (https://github.com/saheedniyi02/yarngpt) is a Python-only,
model-heavy TTS system that produces Nigerian-accented speech in English,
Yoruba, Igbo, Hausa and Pidgin. It can't run inside the Next.js process, so it
lives here as a small FastAPI service. The Next.js /api/speak route proxies to
it (see app/api/speak/route.ts), configured via YARNGPT_API_URL.

Run:
    pip install -r requirements.txt
    # download the WavTokenizer files (see README.md), then:
    uvicorn main:app --host 0.0.0.0 --port 8000

The model loads lazily on first request so the server starts fast.
"""

import io
import os
import hashlib
import tempfile
import threading
from collections import OrderedDict

import torch
import torchaudio
import soundfile as sf
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel
from transformers import AutoModelForCausalLM

from yarngpt.audiotokenizer import AudioTokenizerV2

# Load yarngpt-service/.env (if present) so service config lives in one file.
try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    pass

# CPU-only box: use all cores for inference (biggest safe speed lever here).
try:
    torch.set_num_threads(os.cpu_count() or 4)
except Exception:
    pass

# --- Configuration (override via environment) -------------------------------
HF_MODEL = os.getenv("YARNGPT_MODEL", "saheedniyi/YarnGPT2")
WAV_CONFIG = os.getenv(
    "WAV_TOKENIZER_CONFIG",
    "models/wavtokenizer_mediumdata_frame75_3s_nq1_code4096_dim512_kmeans200_attn.yaml",
)
WAV_MODEL = os.getenv(
    "WAV_TOKENIZER_MODEL",
    # HF renamed the old *_320_24k.ckpt to *_320_v2.ckpt.
    "models/wavtokenizer_large_speech_320_v2.ckpt",
)
SAMPLE_RATE = 24000
# Cap on generated tokens (bounds worst-case latency for long text).
MAX_GEN_LENGTH = int(os.getenv("YARNGPT_MAX_LENGTH", "4000"))
# Preload + warm up the model at startup so the first request isn't slow.
PRELOAD = os.getenv("YARNGPT_PRELOAD", "1") != "0"
# Preload STT at startup. Off by default: on low-RAM machines a startup load can
# get OOM-killed; lazy loading keeps the service alive and loads on first use.
STT_PRELOAD = os.getenv("STT_PRELOAD", "0") != "0"
# In-memory cache of recent clips (identical text/voice replays are instant).
CACHE_SIZE = int(os.getenv("YARNGPT_CACHE_SIZE", "64"))
_cache: "OrderedDict[str, bytes]" = OrderedDict()
_cache_lock = threading.Lock()

# --- Speech-to-text (Whisper) — auto-detects language incl. Nigerian ones ----
# tiny/base/small/medium/large: bigger = better accuracy but slower on CPU.
WHISPER_MODEL_NAME = os.getenv("WHISPER_MODEL", "base")
WHISPER_COMPUTE = os.getenv("WHISPER_COMPUTE", "int8")  # faster-whisper CPU type
WHISPER_BEAM = int(os.getenv("WHISPER_BEAM", "5"))  # >1 = better accuracy, slower
WHISPER_THREADS = int(os.getenv("WHISPER_THREADS", str(os.cpu_count() or 4)))
WHISPER_LANGS = {"yo", "ig", "ha", "en"}  # a hint may be passed; else auto-detect
# Domain prompt biases recognition toward Lagos transit vocabulary/place names.
WHISPER_PROMPT = os.getenv(
    "WHISPER_PROMPT",
    "Lagos danfo and BRT transit. Places: CMS, Obalende, TBS, Marina, Oshodi, "
    "Yaba, Ojuelegba, Mile 2, Festac, Ikeja, Berger, Ojota, Maryland, Ketu, "
    "Mile 12, Ikorodu, Ajah, Lekki, Victoria Island, Surulere, Costain, "
    "Iyana Ipaja, Agege, Abule Egba, keke, okada, molue, conductor.",
)
_whisper = None
_whisper_faster = False  # True when using faster-whisper (CTranslate2)
_whisper_lock = threading.Lock()

SUPPORTED_LANGUAGES = {"english", "yoruba", "igbo", "hausa", "pidgin"}

# AudioTokenizerV2 only accepts these tokenizer languages; Pidgin uses English.
TOKENIZER_LANGS = {"hausa", "igbo", "yoruba", "english"}
# Valid speaker names per folder (default_speakers = English, *_local = others).
ENG_SPEAKERS = {
    "idera", "emma", "jude", "osagie", "onye", "regina", "remi",
    "chinenye", "joke", "azeez",
}
LOCAL_SPEAKERS = {
    "yoruba_female1", "yoruba_female2", "yoruba_male2", "yoruba_male3",
    "igbo_female1", "igbo_female2", "igbo_male2",
    "hausa_female1", "hausa_female2", "hausa_male1", "hausa_male2",
}

app = FastAPI(title="DanfoAI YarnGPT TTS")

# Loaded once, lazily, guarded by a lock (model.generate is not thread-safe).
_tokenizer: "AudioTokenizerV2 | None" = None
_model = None
_load_lock = threading.Lock()
_infer_lock = threading.Lock()


def _ensure_loaded():
    global _tokenizer, _model
    if _model is not None:
        return
    with _load_lock:
        if _model is not None:
            return
        for path in (WAV_CONFIG, WAV_MODEL):
            if not os.path.exists(path):
                raise RuntimeError(
                    f"Missing WavTokenizer file: {path}. See README.md for downloads."
                )
        tokenizer = AudioTokenizerV2(HF_MODEL, WAV_MODEL, WAV_CONFIG)
        model = AutoModelForCausalLM.from_pretrained(
            HF_MODEL, torch_dtype="auto"
        ).to(tokenizer.device)
        model.eval()
        _tokenizer, _model = tokenizer, model


@app.on_event("startup")
def _startup():
    """Load models at boot so the first real request isn't paying the load cost."""
    # STT preload is opt-in — on low-RAM machines loading at boot can be
    # OOM-killed. Default lazy: the model loads on the first /stt request.
    if STT_PRELOAD:
        try:
            _ensure_whisper()
            print(
                f"Whisper STT ready "
                f"({'faster-whisper' if _whisper_faster else 'openai-whisper'}, "
                f"{WHISPER_MODEL_NAME})."
            )
        except Exception as e:  # noqa: BLE001
            print(f"STT preload skipped: {e}")

    # TTS is heavy (multi-GB) — preload only when explicitly requested.
    if not PRELOAD:
        return
    try:
        _ensure_loaded()
        with _infer_lock, torch.inference_mode():
            prompt = _tokenizer.create_prompt(
                "E kaabo", lang="english", speaker_name="idera"
            )
            ids = _tokenizer.tokenize_prompt(prompt)
            _model.generate(
                input_ids=ids,
                temperature=0.1,
                repetition_penalty=1.1,
                max_length=200,
            )
        print("YarnGPT model preloaded and warmed up.")
    except Exception as e:  # noqa: BLE001
        print(f"warmup skipped: {e}")


def _ensure_whisper():
    global _whisper, _whisper_faster
    if _whisper is not None:
        return
    with _whisper_lock:
        if _whisper is not None:
            return
        # Prefer faster-whisper (CTranslate2, int8) — ~3-4x faster on CPU.
        try:
            from faster_whisper import WhisperModel

            _whisper = WhisperModel(
                WHISPER_MODEL_NAME,
                device="cpu",
                compute_type=WHISPER_COMPUTE,
                cpu_threads=WHISPER_THREADS,
            )
            _whisper_faster = True
        except Exception as e:  # noqa: BLE001 - fall back to openai-whisper
            print(f"faster-whisper unavailable ({e}); using openai-whisper.")
            import whisper

            _whisper = whisper.load_model(WHISPER_MODEL_NAME)
            _whisper_faster = False


class TTSRequest(BaseModel):
    text: str
    language: str = "english"
    voice: str = "idera"


@app.get("/health")
def health():
    return {
        "status": "ok",
        "tts_model": HF_MODEL,
        "tts_loaded": _model is not None,
        "stt_model": WHISPER_MODEL_NAME,
        "stt_loaded": _whisper is not None,
    }


@app.post("/stt")
def stt(file: UploadFile = File(...), language: str = Form(default="")):
    """Speech-to-text via Whisper. Auto-detects language unless a hint
    (yo/ig/ha/en) is given. Returns {text, language}."""
    data = file.file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty audio")

    hint = (language or "").strip().lower()
    lang = hint if hint in WHISPER_LANGS else None  # None => auto-detect

    try:
        _ensure_whisper()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"Whisper unavailable: {e}")

    suffix = os.path.splitext(file.filename or "audio.webm")[1] or ".webm"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        with _infer_lock:  # serialize heavy CPU work with TTS
            if _whisper_faster:
                segments, info = _whisper.transcribe(
                    tmp_path,
                    language=lang,
                    beam_size=WHISPER_BEAM,
                    vad_filter=True,  # drop silence/noise -> better + faster
                    condition_on_previous_text=False,  # avoids drift on short clips
                    initial_prompt=WHISPER_PROMPT,  # bias toward Lagos vocabulary
                )
                text = "".join(seg.text for seg in segments).strip()
                detected = info.language
            else:
                result = _whisper.transcribe(
                    tmp_path,
                    language=lang,
                    fp16=False,
                    beam_size=WHISPER_BEAM,
                    initial_prompt=WHISPER_PROMPT,
                )
                text = (result.get("text") or "").strip()
                detected = result.get("language")
        return {"text": text, "language": detected}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"STT failed: {e}")
    finally:
        if tmp_path:
            try:
                os.remove(tmp_path)
            except OSError:
                pass


@app.post("/tts")
def tts(req: TTSRequest):
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    language = req.language.lower().strip()
    if language not in SUPPORTED_LANGUAGES:
        language = "english"

    try:
        _ensure_loaded()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    # Pidgin isn't a tokenizer language — speak it with the English voice.
    tok_lang = "english" if language in ("english", "pidgin") else language
    if tok_lang not in TOKENIZER_LANGS:
        tok_lang = "english"
    # Pick a valid speaker for the language; fall back sensibly if the caller
    # sent an unknown/mismatched voice (None lets V2 auto-pick a local speaker).
    if tok_lang == "english":
        speaker = req.voice if req.voice in ENG_SPEAKERS else "idera"
    else:
        speaker = req.voice if req.voice in LOCAL_SPEAKERS else None

    # Serve identical (text, language, voice) requests from cache instantly.
    cache_key = hashlib.sha1(
        f"{tok_lang}|{speaker}|{text}".encode("utf-8")
    ).hexdigest()
    with _cache_lock:
        cached = _cache.get(cache_key)
        if cached is not None:
            _cache.move_to_end(cache_key)
            return Response(content=cached, media_type="audio/wav")

    try:
        with _infer_lock, torch.inference_mode():
            prompt = _tokenizer.create_prompt(
                text, lang=tok_lang, speaker_name=speaker
            )
            input_ids = _tokenizer.tokenize_prompt(prompt)
            output = _model.generate(
                input_ids=input_ids,
                temperature=0.1,
                repetition_penalty=1.1,
                max_length=MAX_GEN_LENGTH,
            )
            codes = _tokenizer.get_codes(output)
            audio = _tokenizer.get_audio(codes)

        # Encode WAV with soundfile (libsndfile) to avoid torchaudio's new
        # torchcodec backend requirement. soundfile wants (frames[, channels]).
        audio = audio.detach().cpu()
        data = audio.numpy()
        if data.ndim > 1:
            data = data.T  # (channels, frames) -> (frames, channels)

        buf = io.BytesIO()
        sf.write(buf, data, SAMPLE_RATE, format="WAV", subtype="PCM_16")
        wav_bytes = buf.getvalue()

        with _cache_lock:
            _cache[cache_key] = wav_bytes
            while len(_cache) > CACHE_SIZE:
                _cache.popitem(last=False)

        return Response(content=wav_bytes, media_type="audio/wav")
    except Exception as e:  # noqa: BLE001 - surface a clean error to the client
        raise HTTPException(status_code=500, detail=f"TTS failed: {e}")
