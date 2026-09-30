# DaVinci Resolve + ffmpeg 자동화 범용 기술 노트

특정 채널/프로젝트에 종속되지 않는 **재사용 가능한 방법론**만 모아둔 문서.
채널 고유의 스타일 값(폰트/색상/트랙 구조 등)은 [editing-style.md](editing-style.md)에 있음.

## 1. DaVinci Resolve 스크립팅 API 한계 (무료판 기준, MCP 서버 경유)

- **음성인식 자동자막(`Timeline.CreateSubtitlesFromAudio`)은 Studio 전용.** 무료판에서 호출하면
  `success:false`만 반환하고 에러 메시지가 없음(무음 실패). Studio 전용 기능을 호출한 뒤 다른 호출이
  줄줄이 실패하면, 리졸브가 업셀 모달을 띄우고 멈춰있는 상태일 수 있음 — 사람이 직접 닫아야 함.
- **SRT를 API로 자막 트랙에 임포트하는 기능 자체가 없음** (File > Import > Subtitle은 UI 전용).
- **`Timeline.InsertTitleIntoTimeline` / `InsertFusionTitleIntoTimeline`은 대상 트랙을 지정할 수 없음.**
  실측 결과 항상 **타임라인의 맨 앞(frame 0)**, 현재 지정된 비디오 트랙(대개 V1)에 삽입되며, 그 뒤의
  모든 클립(다른 트랙 포함)을 삽입된 클립 길이만큼 뒤로 미는 ripple 동작을 함. `insert_fusion_title`은
  반대로 **트랙 맨 끝에 순차적으로 추가**되는 것으로 관측됨(같은 트랙에 여러 번 호출 시 뒤에 쌓임).
  → 두 계열 다 트랙 지정이 안 되므로, 원하는 트랙으로 옮기려면 `move_clips`가 필요.
- **하지만 타이틀/제너레이터 클립은 `MediaPoolItem`이 없어서 `move_clips`로 이동이 불가능함**
  (`"Timeline item has no MediaPoolItem (generators / titles without pool media cannot use this)"`).
  → 결론: **API로 자막을 프레임 단위로 정확히 원하는 트랙/위치에 배치하는 자동화는 사실상 불가능.**
  이게 바로 "자막은 ffmpeg에서 만들어서 일반 클립처럼 얹는" 우회 전략을 쓰는 이유.
- **`timeline.ripple_insert`는 항상 모든 트랙을 함께 미는 동작**이라, 이미 배치된 멀티트랙 구성(배경+본편
  같은 병렬 레이어) 중간에 새 클립을 끼워넣으면 다른 트랙까지 밀려서 정렬이 깨짐. 여러 트랙에 동시에
  배치해야 하는 경우, **한 번의 `ripple_insert` 호출에 모든 트랙의 `clip_infos`를 함께 넘겨서** 한 번에
  삽입해야 서로 어긋나지 않음(개별 트랙마다 따로따로 호출하면 두 번째 호출이 첫 번째로 넣은 클립까지
  밀어버림).
  - `clip_infos`의 `start_frame`/`end_frame`은 **SOURCE(소스 클립 자체의 프레임 번호, 소스 자체의 fps 기준)**임.
    타임라인 fps와 다른 소스(예: 24fps 소스를 60fps 타임라인에)를 쓸 때도 "몇 초를 쓸지"는
    `소스fps × 초` 로 계산하면 되고, Resolve가 알아서 타임라인 fps로 conform함(실측 확인: 24fps 소스
    1440프레임(=60초) → 60fps 타임라인에서 정확히 3600프레임(=60초)으로 변환됨).
  - 파괴적 동작이라 `confirm_token`이 필요함. **토큰을 받은 뒤 재호출할 때는 원래 호출과 동일한 파라미터를
    유지**해야 함(예: `dry_run` 같은 부가 파라미터를 빼고 재호출하면 파라미터 불일치로 다시 dry-run처럼
    처리되는 경우가 있었음).
  - 응답의 `success:false` + `missing:[...]`이 떠도, `readback.after_counts`나 실제
    `get_items_in_track` 조회 결과 `found_duration`이 기대값과 맞으면 실제로는 정상 삽입된 것일 수 있음
    (사전 검증 로직이 conform 전 프레임 수로 비교해서 생기는 오탐으로 추정). **항상 `get_items_in_track`으로
    직접 재확인할 것.**
- `insert_title`/`insert_fusion_title`은 `name` 파라미터가 필수. Fusion 템플릿 이름을 넣을 때 유니코드
  오타(예: `즈` vs 비슷한 다른 완성형 글자)에 민감해서, 실패하면 오타부터 의심할 것.

## 2. Fusion Text+ 템플릿 분석 기법

Resolve 브릿지(무료판)로도 Fusion 템플릿의 실제 스타일 값을 뽑아낼 수 있음:

1. `timeline(action="insert_fusion_title", params={"name": "<정확한 템플릿 이름>"})`로 실제 템플릿을 타임라인에 삽입
   (Effects Library의 표시 이름과 정확히 일치해야 함, 접두 번호 없이도 되는 경우가 많음 — 예: "펫&키즈06"으로 성공,
   "11. 펫&키즈06"처럼 임의로 접두어를 붙이면 오히려 실패할 수 있음).
2. `timeline_item_fusion(action="export_comp", params={track_type, track_index, item_index, index:1, path})`로
   해당 아이템의 Fusion 컴포지션을 `.comp` 파일(Lua 텍스트 포맷)로 export.
3. 파일을 그냥 텍스트로 읽으면 됨. 확인된 구조:
   - `CustomData.TEMPLATE_ID`에 템플릿의 실제 팩 경로가 그대로 노출됨 (예: `Edit/Titles/09. 여행&브이로그 11종/09. 여행&브이로그06`)
     → 패키지 이름, 아이템 개수("11종") 등을 여기서 알 수 있음.
   - `Tools.Template`이 `TextPlus` 노드이며 `Inputs`에 `Font`, `Size`, `Center`(정규화 x,y), `StyledText`(기본 placeholder 텍스트),
     그리고 `RedN/GreenN/BlueN/ThicknessN/OffsetN/SoftnessN` (N=2,3,4,5...) 형태로 레이어별 색상/두께/오프셋/부드러움이 들어있음.
   - **실측 결과 애니메이션 키프레임은 전혀 없었음** — 이런 템플릿들은 "모션그래픽 프리셋"이 아니라
     폰트+레이어드 아웃라인/글로우의 "정적 스타일 프리셋"임. TextPlus는 Element1(글자 채우기)부터
     Element5까지 레이어를 쌓으며, **숫자가 클수록 더 뒤쪽(바깥쪽) 레이어**.
   - 색상은 0~1 float. `round(v*255)`로 0~255 변환.
4. **중요한 실수 포인트**: `insert_fusion_title`을 여러 번 호출하면 트랙 끝에 순차적으로 쌓이므로,
   두 번째 이후 아이템을 export할 때 `item_index`를 매번 올바르게 증가시켜야 함. `item_index=0`으로
   고정해두면 매번 **첫 번째로 삽입했던 아이템만 재export**되는 사고가 남 (모든 결과가 동일하게 나오면 이 버그를 의심할 것).
5. 템플릿을 찾았지만 이름 매칭에 실패하는 경우, 정확한 아이템 이름을 모르는 것이 원인일 때가 많음 —
   패키지명(예: "슈돌20종")만 알고 개별 아이템 번호를 모르면 삽입이 안 됨. 이 경우 파일시스템에서 실제
   템플릿 자산을 찾으려는 시도(`AppData\Roaming\Blackmagic Design\...\Fusion\Templates`,
   `ProgramData\Blackmagic Design\...\Fusion\Templates`)는 **보통 비어있음** — 실제 팩 파일이 다른 경로에
   있거나 PowerBin으로 이미 임포트되어 원본 파일이 남아있지 않을 수 있어서, 무리하게 디스크를 뒤지기보다
   이름 후보를 여러 개 시도해보는 편이 빠름.

## 3. ffmpeg + ASS 자막 제작 기법

### 폰트 확인

- `fontTools`(`pip install fonttools`)로 폰트 파일의 **내부 등록 이름**을 뽑을 것 — 파일명과 다른 경우가 흔함:
  ```python
  from fontTools.ttLib import TTFont
  f = TTFont(path)
  f['name'].getDebugName(1)  # family name — 이걸 ASS Fontname에 사용
  f['name'].getDebugName(4)  # full name (필요시)
  ```
- ASS의 `Fontname`은 이 내부 이름과 정확히 일치해야 함.
- **실측 확인**: gyan.dev의 ffmpeg full_build(`--enable-fontconfig`)는 Windows에 사용자 단위로 설치된 폰트
  (`AppData\Local\Microsoft\Windows\Fonts`)도 별도 `fontsdir` 지정 없이 자동으로 찾아서 렌더링함.
  즉 "폰트가 안 보인다"는 문제는 대개 파일이 없어서가 아니라 **Fontname에 파일명을 그대로 써서** 발생함.
- 실제로 폰트가 적용됐는지 검증하는 가장 확실한 방법: 같은 텍스트를 해당 폰트 vs 기본 폰트(예: Malgun Gothic)로
  각각 렌더링해서 결과 이미지를 비교하는 것 (다르면 성공).
- `fontsdir` 옵션을 쓸 경우 Windows 경로의 `C:` 콜론이 ffmpeg 필터그래프 파서에서 옵션 구분자(`:`)와 충돌함.
  Git Bash(MSYS) 경로 변환까지 겹치면 더 꼬이므로, **PowerShell 도구로 실행하고 절대 경로+슬래시를 쓰되,
  대부분의 경우 fontsdir 자체가 필요 없다는 걸 먼저 확인**할 것 (위 항목 참고).

### Fusion 좌표/크기 → ASS 환산

- Fusion TextPlus의 `Center`는 `{x, y}` 정규화 좌표(0~1)이며, **y는 0=하단, 1=상단** 컨벤션(OpenGL 스타일).
  ASS `Alignment=2`(하단중앙)의 `MarginV`는 "화면 하단으로부터의 거리"라서, 편리하게도 **변환 없이
  `MarginV = round(PlayResY × py)`** 로 그대로 대응됨 (x는 항상 0.5면 그냥 중앙 정렬).
- `Fontsize ≈ round(PlayResY × size)`가 출발점이지만, **이론값을 그대로 쓰면 큰 폰트/화면 가장자리 근처에서
  화면 밖으로 넘치는 경우가 있음** (특히 py가 0.85 이상처럼 가장자리에 가까울 때). 실제 렌더링해서
  눈으로 확인 후 MarginV를 미세조정하는 과정이 필요함 — 공식은 "출발점"이지 정답이 아님.
- ASS 색상은 `&HAABBGGRR`(알파+BGR) 순서. Fusion/일반적인 RGB 0~1 float에서 변환:
  ```python
  def to_ass_color(r, g, b, a=0):
      R, G, B = round(r*255), round(g*255), round(b*255)
      return f"&H{a:02X}{B:02X}{G:02X}{R:02X}"
  ```
- Fusion의 `Softness`(부드러운 외곽선/글로우)는 ASS에 직접 대응하는 필드가 없음 — `{\blur3}`~`{\blur4}` 같은
  오버라이드 태그를 Dialogue 텍스트 앞에 붙여서 근사함.
- 템플릿이 **사각형/박스 레이어**(예: 메모지 스타일 배경)로 구성된 경우 `Outline`/`Shadow`로는 재현이 안 되고
  `\p` 벡터 드로잉으로 도형을 직접 그려야 함 — 이런 경우는 통상적인 아웃라인+글로우형 캡션보다 난이도가 확 높아짐.
- 캡션 텍스트가 길면(완전한 문장 등) 큰 폰트에서 줄바꿈되거나 화면을 벗어남 — 화면에 맞는지는 실제
  렌더링 프레임을 캡처해서 확인하는 습관이 필요함(수치 계산만으로 확신하지 말 것).

## 4. 로컬 Whisper(faster-whisper) 파이프라인

재사용 스크립트: [whisper_transcribe.py](whisper_transcribe.py)

### 설치 및 Windows 환경 이슈

```bash
pip install faster-whisper
```

- **`OMP: Error #15` 크래시**: ctranslate2가 번들한 OpenMP와 다른 라이브러리(주로 numpy/MKL 계열)의
  OpenMP가 충돌해서 발생. `KMP_DUPLICATE_LIB_OK=TRUE` 환경변수로 우회(안전성 트레이드오프 있는 공식 비권장
  방법이지만 로컬 1회성 스크립트 용도로는 실용적).
- **`OSError: WinError 1314` (심볼릭 링크 권한 오류)**: 관리자 권한/개발자 모드가 없는 Windows 계정에서
  HuggingFace Hub가 모델 캐시에 심볼릭 링크를 만들려다 실패. `HF_HUB_DISABLE_SYMLINKS=1` 환경변수로 우회
  (디스크를 조금 더 쓰지만 문제없이 동작).
- 콘솔에 한글 출력이 깨져 보여도(mojibake) 파일에 `encoding='utf-8'`로 저장했다면 실제 파일 내용은
  정상임 — Read 도구로 파일을 직접 열어서 확인할 것 (터미널 출력만 보고 실패로 오판하지 말 것).

### 모델 크기 선택 (i7-1260P, 12코어/16스레드, GPU 없음, int8 CPU 기준 실측)

| 모델 | 60초 클립 처리 시간 | 체감 정확도 |
|---|---|---|
| small | 수 초~수십 초 | 반복/뭉개짐 오류 잦음 (예: "어?"가 7번 연속 잘못 반복) |
| medium | 약 48초 | 훨씬 안정적 — 애매한 구간은 억지로 채우지 않고 건너뜀, 문장이 자연스러움 |

**"컴퓨터 성능상 더 좋은 모델은 불가능하다"는 가정은 숏폼(수십 초~수 분) 용도에서는 대체로 틀림.**
medium은 거의 실시간에 가까운 속도로 돌아가고, large도 이 CPU에서 medium의 1.5~2.5배 정도로 예상되어
여전히 batch 처리 범위 안에 있음. 문제가 되는 건 "실시간 스트리밍 전사"처럼 지연시간이 중요한 경우뿐임.
→ 정확도가 아쉬우면 모델을 포기하기 전에 **먼저 한 단계 큰 모델로 실측해볼 것.**

### 정확도 개선 기법

1. **`initial_prompt`**: 전사 전에 채널 고유명사(화자 이름, 유행어, 브랜드명 등)를 프롬프트로 미리 제공하면
   해당 단어들의 인식률이 올라감. 단, 완전히 새로운 조어(예: 방송 자체 밈 단어)는 프롬프트를 줘도
   여전히 틀릴 수 있음 — 만능은 아님.
2. **사전 기반 후처리**: `initial_prompt`로도 못 잡는 고유명사 오인식은 정규식 치환 사전으로 마지막에
   보정하는 게 가장 확실함. 예: `아[펨킨]무` → `담팬무`. 채널마다 반복되는 오인식 패턴이 있으므로
   한번 정리해두면 계속 재사용 가능(`whisper_transcribe.py`의 `CORRECTIONS` 참고).

## 5. ffmpeg vs DaVinci Resolve — 언제 뭘 쓸지

- **사람이 중간에 개입해서 리졸브 UI로 다듬을 계획이 있다면** → Resolve 프로젝트로 작업 (나중에 GUI에서
  자유롭게 수정 가능한 `.drp` 프로젝트 파일이 남음).
- **결과물만 보고 판단하고 중간 과정에 개입하지 않는 자동화 파이프라인이라면** → ffmpeg가 유리함.
  이유: Resolve 스크립팅 API는 GUI 편집자를 전제로 설계되어 있어서 `confirm_token`, 트랙별 ripple 밀림,
  타이틀 클립의 트랙 지정/이동 불가 같은 우회가 계속 필요한 반면, ffmpeg는 스케일/오버레이/컨캣/자막
  번인을 필터그래프 하나로 결정론적으로 처리 가능. 실패 지점이 훨씬 적고 빠름.
- **혼합 전략도 가능**: 배경 합성/본편 배치처럼 구조적인 부분은 Resolve 타임라인(`ripple_insert`로
  다중 트랙 동시 배치 — 이 문서 1장 참고)에서 처리하고, 정밀한 타이밍이 필요한 자막만 ffmpeg에서
  별도 영상으로 렌더링해 트랙에 일반 클립으로 얹는 방식. Resolve의 API 한계(자막 트랙 자동 배치 불가)를
  우회하면서도 프로젝트 파일 자체는 유지하고 싶을 때 유효함.
