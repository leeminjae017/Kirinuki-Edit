"""
범용 한국어 숏폼 자막 전사 스크립트 (faster-whisper 기반, 로컬 CPU 실행)

사용법:
    KMP_DUPLICATE_LIB_OK=TRUE HF_HUB_DISABLE_SYMLINKS=1 python whisper_transcribe.py <video_or_audio_path> [output.json]

동작:
    1. ffmpeg로 오디오를 16kHz mono wav로 추출 (영상 파일을 바로 넣어도 됨)
    2. faster-whisper "medium" 모델(int8, CPU)로 한국어 전사
       - initial_prompt로 채널 고유명사를 힌트로 제공해 인식률을 높임
    3. 알려진 오인식 패턴을 사전 기반으로 후처리
    4. {start, end, text} 세그먼트 리스트를 JSON으로 저장

Windows 환경 주의사항 (둘 다 실행 전 필수):
    - KMP_DUPLICATE_LIB_OK=TRUE : ctranslate2와 다른 OpenMP 런타임이 충돌해서 나는
      "OMP: Error #15" 크래시를 막기 위한 우회 설정. (배경: docs 참고)
    - HF_HUB_DISABLE_SYMLINKS=1 : 관리자 권한/개발자 모드가 없는 Windows 계정에서
      모델 다운로드 시 심볼릭 링크 생성 권한 오류(WinError 1314)를 막기 위한 설정.

모델 크기 선택 가이드 (i7-1260P 12코어/16스레드, GPU 없음, 실측 기준):
    small  : 60초 클립 기준 수 초~수십 초. 빠르지만 반복/뭉개짐 오류가 잦음.
    medium : 60초 클립 기준 약 48초 (거의 실시간). 정확도 크게 개선, 실전 권장.
    large  : 미실측이지만 medium의 1.5~2.5배 시간 예상 — 숏폼(1~3분) 용도로는 여전히 실용적 범위.
    "컴퓨터 성능상 불가능하다"는 가정은 실측 결과 틀렸음 — 숏폼 길이(수십 초~수 분)에서는
    medium/large도 CPU로 충분히 batch 처리 가능. 실시간 스트리밍 전사가 필요한 경우에만 문제가 됨.

고유명사 오인식은 모델 크기를 올려도 완전히 해결되지 않는 경우가 있음 (특히 신조어/브랜드명).
initial_prompt로 힌트를 줘도 남는 오류는 CORRECTIONS 딕셔너리에 정규식으로 추가해서 보정할 것.
"""
import sys
import os
import json
import re
import subprocess

# 채널/영상마다 다른 고유명사는 여기에 추가
INITIAL_PROMPT = "담유이, 허츄, 망내, 4포, 로즈, 담팬무, HONEYZ, 치지직"

# 관측된 오인식 -> 정답 교정 사전 (정규식 패턴, 순서대로 적용)
CORRECTIONS = [
    (r"아[펨킨]무", "담팬무"),
    (r"아킨부", "담팬무"),
    (r"담백\s*무", "담팬무"),
    (r"네로남부", "내로남불"),
]


def extract_audio(input_path: str, wav_path: str):
    subprocess.run(
        ["ffmpeg", "-y", "-i", input_path, "-vn", "-ac", "1", "-ar", "16000", "-acodec", "pcm_s16le", wav_path],
        check=True, capture_output=True,
    )


def apply_corrections(text: str) -> str:
    for pattern, repl in CORRECTIONS:
        text = re.sub(pattern, repl, text)
    return text


def transcribe(wav_path: str, model_size: str = "medium"):
    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, _ = model.transcribe(
        wav_path, language="ko", vad_filter=True, word_timestamps=False,
        initial_prompt=INITIAL_PROMPT,
    )
    result = []
    for seg in segments:
        result.append({"start": seg.start, "end": seg.end, "text": apply_corrections(seg.text.strip())})
    return result


def main():
    if len(sys.argv) < 2:
        print("Usage: python whisper_transcribe.py <video_or_audio_path> [output.json]")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else os.path.splitext(input_path)[0] + "_captions.json"
    wav_path = os.path.splitext(input_path)[0] + "_audio_tmp.wav"

    extract_audio(input_path, wav_path)
    result = transcribe(wav_path)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    os.remove(wav_path)
    print(f"{len(result)} segments -> {output_path}")


if __name__ == "__main__":
    main()
