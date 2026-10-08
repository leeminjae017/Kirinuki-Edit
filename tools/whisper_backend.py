# -*- coding: utf-8 -*-
"""위스퍼 전사 엔진 고르기 (2026-10-08, 맥 포크).

    from whisper_backend import transcribe
    out = transcribe("src_loud.wav")     # [{start,end,text,words:[{start,end,word}]}] - faster-whisper 와 같은 꼴

엔진 (WHISPER_BACKEND 로 고정할 수 있다):
  cpp     whisper.cpp (whisper-cli). 맥에서는 Metal GPU 를 써서 faster-whisper (CPU) 보다 훨씬 빠르다.
          모델: WHISPER_CPP_MODEL 경로, 없으면 아래 MODEL_DIRS 에서 MODEL_NAMES 순서로 찾는다.
          받기: https://huggingface.co/ggerganov/whisper.cpp 의 ggml-large-v3.bin 을 ~/.cache/whisper.cpp/ 에 둔다.
  faster  faster-whisper large-v3 (CPU int8) - 원래 쓰던 엔진. pip install faster-whisper
기본은 whisper-cli 와 모델이 있으면 cpp, 아니면 faster.

설정은 faster-whisper 때와 맞춘다: 한국어, beam 5, VAD 없음, 앞 문장 이어 받기 없음 (-mc 0 = condition_on_previous_text=False).
낱말 시각은 whisper.cpp 토큰 시각에서 묶는다. 어차피 transcribe_words.py 2단계가 소리 자리로 다시 잡는다.
"""
import io, json, os, re, shutil, subprocess, sys, tempfile

MODEL_NAMES = ("ggml-large-v3.bin", "ggml-large-v3-turbo.bin", "ggml-medium.bin")
MODEL_DIRS = (os.path.expanduser("~/.cache/whisper.cpp"),
              os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models"))


def cpp_model():
    m = os.environ.get("WHISPER_CPP_MODEL")
    if m:
        return m if os.path.isfile(m) else None
    for n in MODEL_NAMES:
        for d in MODEL_DIRS:
            p = os.path.join(d, n)
            if os.path.isfile(p):
                return p
    return None


def backend():
    want = os.environ.get("WHISPER_BACKEND")
    if want in ("cpp", "faster"):
        return want
    if shutil.which("whisper-cli") and cpp_model():
        return "cpp"
    return "faster"


def _faster(wav, language):
    from faster_whisper import WhisperModel
    os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")
    m = WhisperModel("large-v3", device="cpu", compute_type="int8")
    segments, _ = m.transcribe(wav, language=language, word_timestamps=True, vad_filter=False,
                               beam_size=5, condition_on_previous_text=False)
    out = []
    for s in segments:
        out.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip(),
                    "words": [{"start": round(w.start, 2), "end": round(w.end, 2), "word": w.word} for w in (s.words or [])]})
    return out


def _cpp(wav, language):
    model = cpp_model()
    if not shutil.which("whisper-cli"):
        sys.exit("whisper-cli 가 없다. brew install whisper-cpp")
    if not model:
        sys.exit("whisper.cpp 모델이 없다. ggml-large-v3.bin 을 ~/.cache/whisper.cpp/ 에 두거나 WHISPER_CPP_MODEL 로 경로를 준다.")
    with tempfile.TemporaryDirectory() as tmp:
        a16 = os.path.join(tmp, "a16.wav")          # whisper-cli 는 16kHz 모노 wav 만 받는다
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-ar", "16000", "-ac", "1", a16], check=True)
        base = os.path.join(tmp, "out")
        subprocess.run(["whisper-cli", "-m", model, "-l", language, "-f", a16, "-ojf", "-of", base,
                        "-bs", "5", "-mc", "0", "-t", str(min(8, os.cpu_count() or 4)), "-np"], check=True)
        # 한글 한 글자가 토큰 둘로 갈리면 토큰 글이 깨진 UTF-8 이다. 바이트로 되살려 낱말 단위로 붙인 뒤 푼다.
        raw = io.open(base + ".json", "rb").read().decode("utf-8", "surrogateescape")
    data = json.loads(raw)
    b = lambda t: t.encode("utf-8", "surrogateescape")
    txt = lambda x: x.decode("utf-8", "replace")
    out = []
    for s in data.get("transcription", []):
        words, cur = [], None
        for tk in s.get("tokens", []):
            if re.match(r"^\[_.*\]$", tk["text"]):       # [_BEG_] · [_TT_123] 같은 특수 토큰
                continue
            t = b(tk["text"])
            a, e = tk["offsets"]["from"] / 1000.0, tk["offsets"]["to"] / 1000.0
            if cur is None or t.startswith(b" "):
                cur = {"bytes": t, "start": a, "end": e}
                words.append(cur)
            else:
                cur["bytes"] += t
                cur["end"] = max(cur["end"], e)
        ws = [{"start": round(w["start"], 2), "end": round(w["end"], 2), "word": txt(w["bytes"])}
              for w in words if txt(w["bytes"]).strip()]
        if not ws:
            continue
        out.append({"start": round(s["offsets"]["from"] / 1000.0, 2), "end": round(s["offsets"]["to"] / 1000.0, 2),
                    "text": txt(b(s["text"])).strip(), "words": ws})
    return out


def transcribe(wav, language="ko"):
    be = backend()
    sys.stderr.write("전사 엔진: %s%s\n" % (be, " (" + cpp_model() + ")" if be == "cpp" else ""))
    return _cpp(wav, language) if be == "cpp" else _faster(wav, language)
