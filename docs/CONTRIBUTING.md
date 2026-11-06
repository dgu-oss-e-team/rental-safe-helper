# 협업 규칙 (CONTRIBUTING)

자세한 내용은 팀 노션 "GitHub 협업 규칙"을 따른다. 아래는 매일 쓰는 요약이다.

## 작업 순서

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/작업이름      # 예: feature/pii-detection
# 코드 작성 → 테스트
npm test -- --run
git add 수정한파일
git commit -m "feat(pii): add foreigner id detection"
git push -u origin feature/작업이름
```

그다음 GitHub에서 Pull Request를 만들고 다른 팀원 1명에게 리뷰를 요청한다.

## 규칙

- main에 직접 push하지 않는다 (보호 규칙으로 막혀 있음). 모든 작업은 브랜치 → PR → 리뷰 1명 → Squash merge.
- 브랜치: `feature/…`, `fix/…`, `test/…`
- 커밋·PR 제목: `feat|fix|test|refactor|docs|style|chore(범위): 내용`
- PR은 작게, 자주. 무엇을 만들었는지와 테스트 결과를 적는다.
- 담당 폴더 밖의 공통 파일은 임의로 수정하지 않는다 (`docs/OWNERS.md`).
- 다른 파트를 기다리지 말고 `src/shared/mock-data.js`의 Mock 데이터로 먼저 개발한다.

## 절대 올리지 않는 것

실제 주민·외국인등록번호, 여권번호, 실제 계약서·등기부, 실제 계좌·연락처, 개인정보가 담긴 OCR 결과, API 키·비밀번호.
테스트에는 지어낸 이름·번호·주소만 쓴다.
