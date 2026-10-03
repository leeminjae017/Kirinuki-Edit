# Kirinuki-Edit

방송 다시보기에서 쇼츠 · 롱폼 편집본을 만드는 작업 폴더입니다. 세 부분으로 되어 있습니다.

| 부분 | 폴더 | 하는 일 |
|---|---|---|
| 편집 엔진 | `shortsmith/` | 편 폴더의 `edit.json` · `fx.json` 으로 컷 → 화면 → 장면 → 렌더. 자막 · 연출은 React, 영상은 ffmpeg |
| 대시보드 | `dashboard/` | 브라우저 화면. AI 편집 지시 · 쪽지, 사용자 편집 (타임라인), 렌더 |
| 도구 | `tools/` | 전사, 대시보드 ↔ 편 폴더 주고받기, 미리보기 갱신, 카메라 (댄스) 등 |

화면 사용법은 [대시보드 가이드](docs/대시보드_가이드.md) 에 있습니다.
작업 규칙은 [CLAUDE.md](CLAUDE.md), 지난 기록은 [PROGRESS.md](PROGRESS.md) 에 있습니다.

## 준비

- Python 3.11 이상
- Node.js 18 이상
- `PATH` 에 ffmpeg · ffprobe
- 엔진 패키지:

```bash
cd shortsmith
npm install
```

- 담유이 프리셋은 비공개라 `presets/` 에 둡니다. 공개 프리셋은 `shortsmith/presets/` 에 있습니다.

## 대시보드 켜기

```bash
python dashboard/server.py --port 8899 --open
```

| 인자 | 기본 | 뜻 |
|---|---|---|
| `--port` | 8899 | 주소 `http://localhost:8899` |
| `--projects` | `projects/` | 프로젝트 저장소 (프로젝트마다 `project.json` · 가져온 파일 `media/`) |
| `--jobs` | `jobs/` | AI 작업 글이 쌓이는 곳 |
| `--open` | 끔 | 브라우저를 같이 연다 |

## 한 편이 흘러가는 길

1. **AI 편집 탭 · 스타일 적용**: 편집 대상 원본과 스타일을 고르고, 지시 · 쪽지를 적어 넘깁니다 → `jobs/` 에 작업 글.
2. **Claude Code**: 작업 글을 받아 편 폴더 (`edit/<편>/`) 에 `edit.json` · `captions.csv` · `fx.json` 을 씁니다.
   이 단계에서는 굽지 않고 미리보기만 만듭니다:
   ```bash
   python tools/preview_update.py edit/<편> <프로젝트 id>
   ```
3. **사용자 편집 탭**: 컷 · 트랙 · 색 · 변형 · 이펙트 · 자막을 고칩니다. 원본은 건드리지 않고 미리보기에 바로 보입니다.
4. 더 고칠 것은 **재편집** 으로 다시 AI 에게 넘깁니다 (2–3 반복).
5. **사용자 편집 > 렌더**: 마지막에 한 번 굽습니다. 서버가 아래 순서로 돌립니다.
   - `tools/apply_review.py`
   - `shortsmith cuts`
   - `shortsmith build`
   - `tools/export_shortsmith.py`

## 엔진 명령 (shortsmith)

`shortsmith` 폴더에서 돌립니다. 다른 폴더에서 돌리면 Remotion 이 그 폴더에 브라우저를 새로 받습니다.

```bash
node bin/shortsmith.mjs build <편 폴더>
```

| 명령 | 하는 일 |
|---|---|
| `build <편>` | 컷 · 화면 · 장면 · 렌더 전부 |
| `preview <편>` | 컷 · 장면만 (굽지 않음, 미리보기 배경도 만듦) |
| `cuts` · `body` · `scene` · `render` | 한 단계씩 |
| `still <편> <초> <png>` | 한 장 뜨기 |
| `doctor --preset <id>` | 글꼴 · 도구 점검 |
| `presets` | 프리셋 목록 |

자세한 것은 [shortsmith/README.md](shortsmith/README.md) 에 있습니다.

## 자주 쓰는 도구

| 도구 | 하는 일 |
|---|---|
| `tools/transcribe_words.py <편>` | 낱말 단위 전사 (AI 사용 - `ALLOW_AI=1`) |
| `tools/export_shortsmith.py <편> <id>` | 편 폴더 → 대시보드 프로젝트 |
| `tools/apply_review.py <편> <project.json>` | 대시보드에서 고친 것 → 편 폴더 |
| `tools/preview_update.py <편> <id>` | 굽지 않고 미리보기만 갱신 |
| `tools/dance_camera.py <편>` | 댄스 편 카메라 경로 |

## 라이선스

GPL-3.0 ([LICENSE](LICENSE))
