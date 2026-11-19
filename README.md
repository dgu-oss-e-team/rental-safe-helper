# Rental Safety Helper (외국인 유학생 자취방 계약 안전 도우미)

[![CI](https://github.com/dgu-oss-e-team/rental-safe-helper/actions/workflows/ci.yml/badge.svg)](https://github.com/dgu-oss-e-team/rental-safe-helper/actions/workflows/ci.yml)
[![Deploy](https://github.com/dgu-oss-e-team/rental-safe-helper/actions/workflows/deploy.yml/badge.svg)](https://github.com/dgu-oss-e-team/rental-safe-helper/actions/workflows/deploy.yml)

**바로 써 보기: https://dgu-oss-e-team.github.io/rental-safe-helper/** (첫 화면에서 **Try with sample data**)

> 2026년 2학기 동국대학교 공개SW프로젝트 E조

## 프로젝트 개요와 동기

한국에서 자취방을 구하는 외국인 유학생은 전세·월세 사기에 특히 취약합니다.
등기부등본과 계약서가 한국어로 되어 있고, 소유자·근저당·신탁 같은 개념도 낯설며, 무엇을 확인해야 하는지 물어볼 곳도 마땅치 않습니다.
AI에게 물어보려 해도 계약서에는 이름, 외국인등록번호, 계좌번호 같은 개인정보가 그대로 들어 있습니다.

Rental Safety Helper는 **서명하기 전에** 등기부등본과 임대차계약서를 비교해 위험 신호를 영어로 알려 주고,
**개인정보를 가린 상태로** AI 상담까지 이어 갈 수 있게 돕는 웹서비스입니다.

### 개인정보 원칙

- **원본 서류는 어디에도 전송되지 않습니다.** 서버·DB 없이 정적 웹사이트(GitHub Pages)로 만들고, 모든 처리는 사용자 브라우저 안에서 합니다.
- **AI를 직접 호출하지 않습니다.** 개인정보를 가린 프롬프트를 사용자가 확인한 뒤 직접 복사해 AI 채팅에 붙여넣습니다.
- **읽지 못한 정보는 "안전"이라고 하지 않습니다.** 확인하지 못한 항목은 `Could not check`(UNVERIFIABLE)로 표시합니다.
- **마스킹 PDF는 이미지로 다시 만듭니다.** 원본 위에 상자만 덮지 않고, 페이지를 이미지로 그려 가린 뒤 새 PDF를 만들고 메타데이터를 지우고, 다시 읽어서 글자가 남지 않았는지 검사합니다.

## 핵심 기능

| 단계 | 하는 일 |
|---|---|
| ① 서류 올리기 | 등기부등본·계약서 PDF 또는 사진(JPG/PNG) 업로드, PDF 글자 추출, 사진 OCR. 흐리게 읽힌 줄은 사용자가 고치거나 확인해야 다음으로 넘어감 |
| ② 위험 점검 | 문서 종류 판별, 소유자·임대인·예금주·소재지 비교, 근저당·신탁·압류 등 위험 신호를 `Stop / Check / Could not check / No warning found`로 영어 설명. 결과에 맞는 AI 추천 질문 |
| ③ 목적 선택 | 조항·용어 설명 / 사기 위험 확인 / 계약 조건 설명 중 선택 → 목적에 필요한 정보만 남기고 가림 |
| ④ 보내기 전 확인 | AI가 볼 내용을 그대로 미리 보기. 같은 사람은 같은 가명(`[Owner_A]`, `[Landlord_B]`), 동명이인은 다른 가명. 주민·외국인등록번호, 여권번호, 전화번호, 계좌번호는 항상 가림(해제 불가). 그 밖의 가릴 곳은 직접 추가·해제 |
| ⑤ 다운로드·AI 상담 | 개인정보를 가린 PDF 다운로드, 만든 PDF를 다시 읽어 확인, AI 상담용 프롬프트 복사, ChatGPT·Claude·Gemini 열기 |

## 데모

(스크린샷·시연 영상은 기능 마감 후 추가 예정입니다. 지금은 위 링크에서 **Try with sample data**로 가상 서류의 전체 흐름을 볼 수 있습니다.)

## 설치와 실행

Node.js **26**(팀 공통, CI와 같은 버전)과 npm이 필요합니다.

```bash
git clone https://github.com/dgu-oss-e-team/rental-safe-helper.git
cd rental-safe-helper
npm ci
npm run dev           # 개발 서버 → http://localhost:5173/rental-safe-helper/
npm test -- --run     # 테스트 (Vitest)
npm run build         # 배포용 빌드 (dist/)
npm run preview       # 빌드 결과 미리 보기
```

main에 병합되면 GitHub Actions가 테스트 후 GitHub Pages에 자동 배포합니다.

### 사용법

1. 등기부등본과 임대차계약서를 올립니다. (서류가 없으면 **Try with sample data**)
2. 위험 점검 결과를 읽고, `Stop`·`Check` 항목의 **What to do**를 확인합니다.
3. AI에게 묻고 싶은 목적을 고릅니다.
4. AI가 볼 내용에 개인정보가 남지 않았는지 확인합니다.
5. 마스킹 PDF를 내려받고, 프롬프트를 복사해 원하는 AI 채팅에 붙여넣습니다.

## 기술 스택

- HTML, CSS, JavaScript (Vanilla JS), Vite, Vitest, GitHub Actions, GitHub Pages
- [pdf.js](https://github.com/mozilla/pdf.js) PDF 읽기·렌더링, [Tesseract.js](https://github.com/naptha/tesseract.js) OCR, [pdf-lib](https://github.com/Hopding/pdf-lib) PDF 생성, [Fuse.js](https://github.com/krisk/Fuse) 이름 유사도, [js-yaml](https://github.com/nodeca/js-yaml) 위험 규칙

## 구조

```text
① PART 1 서류 읽기 ──DocumentModel──▶ PART 2 판별·개인정보 탐지 ──▶ PART 4 인물 판별 ──▶ PART 3 위험 점검 (②)
                                                                   │
③ 목적 선택 ──▶ PART 4 목적별 마스킹 ──▶ ④ 사용자 확인 ──▶ PART 3 프롬프트 + PART 5 마스킹 PDF (⑤)
```

```text
src/
├── app/                 # PART 5: 시작점, 파이프라인, 상태, 단계별 화면
├── shared/              # 공통 데이터 규격, Mock 데이터
├── features/
│   ├── document-input/      # PART 1 서류 읽기·OCR
│   ├── document-analysis/   # PART 2 판별·개인정보 탐지
│   ├── risk-check/          # PART 3 위험 점검·프롬프트
│   ├── masking/             # PART 4 인물 판별·마스킹
│   └── pdf-export/          # PART 5 마스킹 PDF
└── config/              # 문서 템플릿·위험 규칙·마스킹 정책
docs/                    # 공통 규격, 담당자, 협업 규칙, 테스트 계획
tests/                   # 파트별 테스트
```

파트 사이의 데이터 형식은 [docs/INTERFACES.md](docs/INTERFACES.md), 담당자는 [docs/OWNERS.md](docs/OWNERS.md),
협업 규칙은 [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md), 테스트 계획은 [docs/TEST_PLAN.md](docs/TEST_PLAN.md)에 있습니다.

## 팀원과 역할

| 이름 | GitHub | 담당 |
|---|---|---|
| 가리드마 | [@Garid1016](https://github.com/Garid1016) | PART 1 문서 입력·OCR |
| 최영록 | [@choiyeongrok](https://github.com/choiyeongrok) | PART 2 문서 분석·개인정보 탐지 |
| 박성연 | [@yeon2sheep](https://github.com/yeon2sheep) | PART 3 위험 점검·AI 상담 프롬프트 |
| 김정연 | [@jygh429](https://github.com/jygh429) | PART 4 인물 판별·목적 기반 마스킹 |
| 박상욱 (팀장) | [@sw8606](https://github.com/sw8606) | PART 5 웹 통합·마스킹 PDF |

각자 담당 기능의 구현, 화면, 단위 테스트, 문서화, PR 리뷰를 함께 맡고, 통합 테스트는 다 같이 합니다.

## 라이선스

[MIT License](LICENSE)

## 안내

이 서비스는 법률 자문이 아닙니다. 점검 결과는 서명 전에 확인할 위험 신호를 알려 주는 보조 정보이며,
`No warning found`는 "확인한 범위에서 위험 신호를 찾지 못했다"는 뜻이지 안전하다는 뜻이 아닙니다.
중요한 결정 전에는 공인중개사, 법률 상담 기관 등에 확인하세요.
