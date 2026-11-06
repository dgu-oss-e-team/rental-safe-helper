# Rental Safety Helper (외국인 유학생 자취방 계약 안전 도우미)

> 현재 **스켈레톤 단계**입니다. 모든 기능이 Mock(가짜) 데이터로 연결되어 있고, 각 파트가 실제 기능으로 교체해 나갑니다.

## 프로젝트 개요와 동기

외국인 유학생이 자취방을 계약하기 전에 등기부등본과 주택임대차계약서를 비교해 사기 위험과 불리한 조건을 확인하고,
개인정보를 가린 상태로 AI 상담까지 이용할 수 있게 돕는 웹서비스입니다.
모든 처리는 사용자 브라우저 안에서 이루어지며, 원본 서류는 외부 서버로 전송되지 않습니다.

## 핵심 기능

- PDF·이미지 업로드, PDF 텍스트 추출, 이미지 OCR
- 등기부/계약서 판별, 개인정보 탐지
- 동일 인물 판별과 역할 가명 (`[Owner_A]`, `[Landlord_B]`)
- 등기부·계약서 비교를 통한 사기 위험 점검 (STOP / CHECK / NO_FLAG / UNVERIFIABLE)
- 목적별 개인정보 마스킹 (조항·용어 설명 / 사기 위험 확인 / 계약 조건 설명)
- 개인정보가 제거된 PDF 생성
- AI 상담용 프롬프트 생성 (서비스가 AI를 직접 호출하지 않음)

## 설치와 실행

Node.js LTS(팀 공통 메이저 버전)가 필요합니다.

```bash
git clone https://github.com/dgu-oss-e-team/rental-safe-helper.git
cd rental-safe-helper
npm ci
npm run dev        # http://localhost:5173
npm test -- --run  # 테스트
npm run build      # 배포용 빌드
```

화면에서 **Try with sample data**를 누르면 가상 서류로 전체 흐름을 볼 수 있습니다.

## 폴더 구조

```text
src/
├── app/                 # PART 5: 시작점, 파이프라인, 상태, 화면
├── shared/              # 공통 데이터 규격, Mock 데이터
├── features/
│   ├── document-input/      # PART 1
│   ├── document-analysis/   # PART 2
│   ├── risk-check/          # PART 3
│   ├── masking/             # PART 4
│   └── pdf-export/          # PART 5
└── config/              # 템플릿·규칙·마스킹 정책
docs/                    # INTERFACES, OWNERS, CONTRIBUTING, TEST_PLAN
tests/                   # 파트별 테스트
```

## 팀원과 역할

| 이름 | GitHub | 담당 |
|---|---|---|
| 가리드마 | [@Garid1016](https://github.com/Garid1016) | PART 1 문서 입력·OCR |
| 최영록 | [@choiyeongrok](https://github.com/choiyeongrok) | PART 2 문서 분석·개인정보 탐지 |
| 박성연 | [@yeon2sheep](https://github.com/yeon2sheep) | PART 3 위험 점검·AI 상담 프롬프트 |
| 김정연 | [@jygh429](https://github.com/jygh429) | PART 4 인물 판별·목적 기반 마스킹 |
| 박상욱 (팀장) | [@sw8606](https://github.com/sw8606) | PART 5 웹 통합·마스킹 PDF |

## 데모

(스크린샷·영상 추가 예정)

## 안내

이 서비스는 법률 자문이 아닙니다. 점검 결과는 서명 전에 확인할 위험 신호를 알려주는 보조 정보입니다.
