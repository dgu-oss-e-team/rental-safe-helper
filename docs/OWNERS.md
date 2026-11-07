# 담당자 (OWNERS)

담당 폴더 밖의 파일은 담당자와 상의 후 수정한다. 폴더별 리뷰어는 `.github/CODEOWNERS`로 자동 지정된다.

| 파트 | 담당 | GitHub | 폴더 | 앞으로 만들 파일 (노션 계획) |
|---|---|---|---|---|
| PART 1 문서 입력·OCR | 가리드마 | `Garid1016` | `src/features/document-input/` | file-reader, pdf-reader, image-preprocess, ocr, ocr-editor, document-normalizer |
| PART 2 문서 분석·개인정보 탐지 | 최영록 | `choiyeongrok` | `src/features/document-analysis/`, `src/config/templates/` | document-classifier, field-extractor, pii-detector, pii-patterns, name-detector |
| PART 3 위험 점검·AI 프롬프트 | 박성연 | `yeon2sheep` | `src/features/risk-check/`, `src/config/rules/` | compare-documents, assess-risks, risk-rules, risk-explanations, risk-result-ui, prompt-builder, recommended-questions |
| PART 4 인물 판별·마스킹 | 김정연 | `jygh429` | `src/features/masking/`, `src/config/masking/` | person-matcher, alias-manager, masking-policy, create-masking-plan, masking-validator, masking-review-ui |
| PART 5 웹 통합·마스킹 PDF | 박상욱 | `sw8606` | `src/app/`, `src/features/pdf-export/` | render-pages, apply-redactions, export-pdf, metadata-cleaner, validate-pdf |

## 공통 파일 (함부로 바꾸지 않기)

| 파일 | 바꿀 때 |
|---|---|
| `src/shared/document-model.js`, `docs/INTERFACES.md` | 이 값을 쓰는 팀원에게 먼저 알리고, 두 파일을 같은 PR에서 수정 |
| `src/shared/mock-data.js` | 형식은 규격 그대로 유지. 시나리오 추가는 자유 |
| `package.json`, `package-lock.json` | 라이브러리 추가는 팀에 먼저 공유하고 별도 PR |
