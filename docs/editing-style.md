# 담유이(HONEYZ) 편집 스타일 가이드

이 문서는 기존 DaVinci Resolve 프로젝트(Damyui-n*, Damui-*, Damui-ss* 등)와
`Setting.txt`를 분석해 정리한 **이 채널 전용** 편집 스타일 기록입니다.

> Resolve/ffmpeg 자동화 방법론, API 한계, Whisper 파이프라인 같은 **범용 기술 지식**은
> [resolve-ffmpeg-automation-notes.md](resolve-ffmpeg-automation-notes.md)에 분리되어 있습니다.

## 1. 캔버스 / 포맷

| 구분 | 값 |
|---|---|
| 숏폼(Shorts) 해상도 | **1080x1920 (세로)** |
| 프레임레이트 | **60fps** |
| 롱폼(Longform) 참고 프로젝트 해상도 | 1920x1080 (가로) — VOD 하이라이트 편집본 계열, 숏폼과는 다른 트랙 |

> 과거 `Damyui-n*` 계열 프로젝트 다수는 1920x1080으로 남아있지만, 이는 롱폼/다른 용도이며
> **숏폼은 1080x1920 + `DamuiPreset.mov` 프리셋 기반**이 맞는 구성이다.

## 2. 숏폼 트랙 구조

```
V3  (최상단) 자막 / 캡션 (Text+ 템플릿, 화자별 스타일 — 3번 항목 참고)
V2          본편 영상 (프리셋 영상창에 맞춰 스케일)
V1  (최하단) DamuiPreset.mov 배경 프레임 + 뒤이어 아웃트로
```

- **V1 배경 프리셋**: `E:\Edit\DamUICLIP\EditVId\DamuiPreset\DamuiPreset.mov`
  - 원본은 세로 1080x1920, 24fps, 약 200초 길이의 루프용 소스
  - **주의**: 시작 부분 0~2초(24fps 기준 0~48프레임)에 "제목" 플레이스홀더 타이틀 애니메이션이 나왔다가 사라짐
    → **항상 in점을 2초(48프레임) 이후로 잡고 잘라서 사용** (그래야 빈 placeholder 텍스트가 노출되지 않음)
  - 프레임 안에 상단 제목 영역, 중앙 투명/흰색 "영상창", 하단 `HONEYZ` 로고 + `담유이` 워터마크가 이미 디자인되어 있음
- **V2 본편**: 프리셋의 중앙 영상창 크기에 맞춰 자동 스케일(가로 기준 fit) → 원본이 16:9면 상하로 프리셋 배경이 비쳐 보임
- **아웃트로**: 본편이 끝나는 지점에 바로 이어붙임 (V1과 동일 트랙)
  - 최신 버전: `E:\Edit\DamUICLIP\EditVId\DamuiPreset\DamuiEOVPreset3.mov` (1920x1080, 60fps, 약 7.47초)
  - 구버전 `DamuiEOVPreset.mov`, `DamuiEOVPreset2.mov`도 존재 (전부 1920x1080/60fps)

## 3. 자막 / 타이틀 템플릿 (Text+ 스타일 시트)

출처: `Setting.txt` (Fusion Text+ 템플릿 카테고리 기반, `cc`=카테고리, `size`=정규화 크기, `px/py`=정규화 위치)

### Shorts (숏폼 기준값)

| 화자/용도 | 카테고리(cc) | size | px, py | 비고 |
|---|---|---|---|---|
| 담유이 (기본 자막) | 여행&브이로그06 | 0.171 | 0.5, 0.25 | |
| 강조 | 펫&키즈06 | 0.14 | 0.5, 0.25 | Text-Color `#aaffff` |
| 허츄 | 여행&브이로그07 | 0.171 | 0.5, 0.25 | Shading-Color `#ff55ff` |
| 망내 | 게임&오락02 | 0.135 | 0.5, 0.25 | |
| 로즈 | 패션&뷰티12 | 0.18 | 0.5, 0.25 | 폰트 `luxury`(segoe UI Symbol) |
| 4포 | 게임&오락02 | 0.14 | 0.5, 0.25 | Shading-Color `#3d71ff` |
| 상단 타이틀 | 패션&뷰티04 | 0.204 | 0.5, 0.9 | |
| 하단 로고 | honeyz로고 | scale 1,1 | px=0, py=-768 | |
| 하단 채널명 | 담유이 - 슈돌20종 배민도현체 | 0.128 | 0.5, 0.75 | |

### Longform (참고 — 롱폼용 별도 값)

전반적으로 숏폼보다 자막 크기가 작고(y=0.13 부근 고정) 인물별 세부 스타일이 더 많음.
가우시안 블러 OpenFX를 인트로에 사용. 상세 값은 `Setting.txt` 원본 참고.

### NOGARI / Thumbnail

- NOGARI: 화자 이름 텍스트 각각 다른 색상 (담유이 `#55ffff`/`#4172bc`, 망내 `#7b84a1`, 모네 `#ffaaff`/`#c66dd0`), 폰트 `배민 주아`, size 0.045
- 썸네일 폰트: `Jua`

### 3.1 실제 폰트 파일 매핑

`Setting.txt`에 적힌 폰트 표기 → 실제 파일 → ASS `Fontname`에 넣어야 하는 **내부 등록명**(파일명과 다를 수 있음).
전부 `C:\Users\12612\AppData\Local\Microsoft\Windows\Fonts\`에 사용자 단위로 설치되어 있고, ffmpeg에서
별도 설정 없이 정상 인식/렌더링됨을 확인함 (확인 방법은 범용 노트 참고).

| Setting.txt 표기 | 실제 파일 | ASS `Fontname` |
|---|---|---|
| 배민 주아 | `BMJUA_otf.otf` / `BMJUA_ttf.ttf` | `BM JUA OTF` |
| 배민 도현체 | `BMDOHYEON_ttf.ttf` | `BM DoHyeon` |
| 777별나라달님 | `777Starlandmoon.TTF` | `777Starlandmoon` |
| CookieRunOTF | `CookieRunOTF Black.OTF` / `Bold.OTF` | `CookieRunOTF Black` / `CookieRunOTF Bold` |
| Yu Gothic UI | 시스템 폰트 | `Yu Gothic UI` |
| segoe UI Symbol (로즈 luxury용) | 시스템 폰트 (`seguisym.ttf`) | `Segoe UI Symbol` |
| Jua (썸네일) | 별도 파일 없음 → `BM JUA OTF`로 대체(사실상 동일 폰트) | `BM JUA OTF` |

> **슈돌20종은 폰트가 아님.** 시스템 전체(C:, E: 드라이브 포함) 어디에도 해당 이름의 폰트 파일이 없음 →
> "여행&브이로그", "패션&뷰티"처럼 **Resolve Text+ 템플릿 팩의 카테고리명**으로 추정됨.

### 3.2 Text+ 템플릿 실측값 (정적 레이어드 스타일, 애니메이션 없음)

각 템플릿을 Fusion에서 직접 export해서 뽑은 실측값. 전부 키프레임 없는 정적 `TextPlus` 노드로 확인됨
(추출 방법은 범용 노트의 "Fusion Text+ 템플릿 분석 기법" 참고). TextPlus는 Element1(채우기)~Element5까지
레이어를 쌓으며, **숫자가 클수록 뒤쪽(바깥쪽) 레이어**다. 색상은 0~1 float → 0~255 hex로 환산 (ASS에 넣을 땐 BGR로 뒤집을 것).

| cc(카테고리) | TEMPLATE_ID (실제 팩 경로) | 기본 폰트 | 레이어 구성 (뒤→앞) |
|---|---|---|---|
| 여행&브이로그06 | `Edit/Titles/09. 여행&브이로그 11종/...06` | CookieRunOTF Bold | E3 글로우 `#05EBFD`(시안, thickness0.041, offset 우하단) → E2 외곽선 `#00131A`(진네이비, 0.0315) → 흰 글자 |
| 여행&브이로그07 | `Edit/Titles/09. 여행&브이로그 11종/...07` | CookieRunOTF Bold | E3 글로우 `#FD6405`(오렌지, 0.041) → E2 외곽선 `#220E01`(진갈색, 0.031) → 흰 글자 *(담유이 프로젝트에서 Shading `#ff55ff`로 덮어씀)* |
| 펫&키즈06 | `Edit/Titles/11. 펫&키즈 11종/...06` | BM JUA_TTF Regular | E4 소프트그림자 회색 `#555555`(thickness0.1, 매우 부드러움) → E3/E2 파란 외곽선 `#00AAFF` → 노란 글자(B=0) |
| 게임&오락02 | `Edit/Titles/10. 게임&오락 12종/...02` | Maplestory Bold | E4 그림자 남색 `#222F6C`(0.054, offset 우하단) → E3 큰 소프트외곽선(색 기본값) → E2 시안 외곽선 `#00FFFF` → 검정 글자 |
| 패션&뷰티12 | `Edit/Titles/06. 패션&뷰티 17종/...12` | tvN Enjoystories Bold | E4 새빨강 초대형 소프트글로우(블러 20,20) → E3 핑크 `#FF7EC1`(0.024) → E2 모브 `#A46DA4` |
| 패션&뷰티04 | `Edit/Titles/06. 패션&뷰티 17종/...04` | BM JUA_TTF Regular | E4 올리브 그림자 45% 투명(0.058, offset) → E3 파랑 `#5096FF` 60% 투명(0.031) → E2 외곽선(R=0만 지정) |
| 패션&뷰티13 | `Edit/Titles/06. 패션&뷰티 17종/...13` | **BM DoHyeon** Regular | E3 마젠타 `#FF55FF`(글자색과 동일 계열) → E2 다크그레이 외곽선 `#222222`(0.043) → 하늘색 글자 `#00B8FC` |
| Memo_002 | `Edit/Titles/01. Memo Titles 30종/Memo_002` | Gong Gothic Light | 사각형(ElementShape 2/3) 레이어로 "메모지 박스" 구성: E5 다크`#191919`(외곽 박스) → E4 라임 `#CCFF66`(포인트 박스) → E3 사각형(기본색) → E2 시안 사각형 `#00FFFF` → 거의 검정 글자 `#191919` |

> **Memo_002는 단순 아웃라인이 아니라 사각형(박스) 레이어 조합**이라, ASS의 `BorderStyle=3`(불투명 박스)만으로는
> 다중 레이어 박스를 못 살림 — 정확히 재현하려면 `\p` 벡터 드로잉으로 사각형을 직접 그려야 함.
> 나머지(외곽선+글로우형)는 ASS `Outline`+`Shadow`+색상만으로 거의 그대로 재현 가능.

**찾았지만 이름 매칭 실패한 것**: `뭉쳐야쏜다2 MC_Point`(롱폼용, 여러 이름 조합 시도했지만 실패 — 우선순위 낮아 보류),
`슈돌20종`(개별 아이템 이름을 몰라서 실패 — 어차피 Setting.txt에 실제 사용값(폰트=배민도현체 등)이 다 있어서 베이스 프리셋 없이도 직접 스타일 구성 가능).
`honeyz로고`는 Text+ 템플릿이 아니라 `E:\Edit\DamUICLIP\Honeyz.png` 이미지 파일임(확인 완료).

### 3.3 완성된 ASS 스타일시트

위 실측값 + `Setting.txt` 오버라이드(크기/위치/색상)를 반영한 실제 사용 가능한 스타일시트가
[damyui_caption_styles.ass](damyui_caption_styles.ass)로 완성되어 ffmpeg 렌더 검증까지 마쳤음
(환산 공식·조정 내역은 범용 노트 참고). 요약:

- `TopTitle`(상단 타이틀)은 이론값(`MarginV=1728`)대로 두면 화면 위로 넘쳐서 `1250`으로 시각 보정함.
- 이 채널 자막은 원래 **1~4음절 정도의 짧은 문구**용으로 설계된 큰 폰트 — 긴 문장을 넣으면 줄바꿈/화면 이탈 발생.
- 채널명(`ChannelName`)은 대응 템플릿(슈돌20종)을 못 찾아서 Setting.txt 폰트(배민도현체)만으로 기본 아웃라인 스타일을 새로 구성함.
- "즉시 완벽"이 아니라 **실측 기반의 검증된 v1 초안**으로 취급할 것 — 실제 대사 길이에 따라 미세 조정 필요.

## 4. 소스/자산 경로 규칙

| 용도 | 경로 |
|---|---|
| 치지직 클립 원본 | `E:\Edit\DamUICLIP\chzzk-clips\` |
| OBS 녹화본 | `E:\Edit\OBS\<시리즈명>\` (예: 야낭0~8.mp4) |
| 프리셋/브랜딩 소스 | `E:\Edit\DamUICLIP\EditVId\DamuiPreset\` |
| 배경 이미지 | `E:\Edit\DamUICLIP\EditVId\LongBG.jpg`, `노가리BG.png` |

## 5. DaVinci Resolve 프로젝트 명명 규칙

- `Damyui-n###` : 순번 기반 메인 편집 프로젝트 (숫자가 클수록 최신)
- `Damui-ss#` : 캡션/타이틀 템플릿 테스트·프리뷰용 (실제 결과물 아님, 초단편)
- `Damyui-p0` : 날짜(YYMMDD) 파일명 기반 클립 모음 프로젝트

## 6. 화자별 STT 고유명사 힌트

Whisper `initial_prompt`와 후처리 사전에 넣을 이 채널 고유명사 목록 (자세한 사용법은 범용 노트 참고):

```
담유이, 허츄, 망내, 4포, 로즈, 담팬무, HONEYZ, 치지직
```

관측된 오인식 → 교정:

| 오인식 | 정답 |
|---|---|
| 아펨무 / 아킨부 / 담백무 | 담팬무 |
| 네로남부 | 내로남불 |
