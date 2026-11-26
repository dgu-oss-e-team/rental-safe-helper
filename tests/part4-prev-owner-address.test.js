// PART 4. 이전 소유자의 주소는 사기 위험 확인 목적에서도 줄이지 않고 통째로 가린다 (외부 AI 평가 후속)
// 등기부에서 주소는 그 사람 이름 줄과 같은 줄이거나 바로 아래 줄에 나온다. 예시는 모두 가짜 값이다.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMaskingPlan } from '../src/features/masking/index.js';
import { analyzeDocuments, prepareForAi } from '../src/app/pipeline.js';
import { MASKING_ACTION, MASKING_PURPOSE, PII_TYPE } from '../src/shared/document-model.js';

/** 등기부 한 줄 (y는 페이지 높이 대비 위치) */
const box = (y) => ({ x: 0.1, y, width: 0.8, height: 0.012 });
const finding = (id, type, value, y, blockId = id) => ({ id, type, value, documentId: 'REG', blockId, pageIndex: 0, bbox: box(y) });
const group = (personId, alias, roles, findingIds) => ({ personId, alias, roles, findingIds, status: 'CONFIRMED' });
const itemOf = (plan, id) => plan.items.find((i) => i.findingId === id);

describe('PART 4 이전 소유자 주소 가리기', () => {
  // 2번 이전 소유자 박영수 → 다음 줄 주소 / 5번 지금 소유자 김철수 → 다음 줄 주소
  const findings = [
    finding('PREV', PII_TYPE.PERSON_NAME, '박영수', 0.426),
    finding('PREV_ADDR', PII_TYPE.ADDRESS, '서울특별시 노원구 가상로 7, 101동 101호', 0.44),
    finding('OWNER', PII_TYPE.PERSON_NAME, '김철수', 0.553),
    finding('OWNER_ADDR', PII_TYPE.ADDRESS, '서울특별시 중구 가상로 12, 3동 702호', 0.565),
    // 부기 줄: 같은 줄에 "박영수의 주소 …"
    finding('NOTE', PII_TYPE.PERSON_NAME, '박영수의', 0.7, 'B_NOTE'),
    finding('NOTE_ADDR', PII_TYPE.ADDRESS, '서울특별시 은평구 가상길 3', 0.7, 'B_NOTE'),
    // 이름에서 멀리 떨어진 주소(표제부)는 그대로
    finding('TITLE_ADDR', PII_TYPE.ADDRESS, '서울특별시 중구 가상동 123', 0.13),
  ];
  const groups = [
    group('P1', '[Owner_A]', ['OWNER'], ['OWNER']),
    group('P2', '[PrevOwner_B]', ['PREVIOUS_OWNER'], ['PREV']),
  ];

  it('사기 위험 확인 목적: 이전 소유자 이름 줄과 바로 아래 줄, 부기 줄의 주소는 통째로 가린다', () => {
    const plan = createMaskingPlan(findings, groups, MASKING_PURPOSE.FRAUD_CHECK).data;
    for (const id of ['PREV_ADDR', 'NOTE_ADDR']) {
      expect(itemOf(plan, id), id).toMatchObject({ action: MASKING_ACTION.REDACT, replacement: '[REDACTED]' });
    }
  });

  it('지금 소유자 주소와 이름에서 떨어진 주소는 지금처럼 시·구까지만 남긴다', () => {
    const plan = createMaskingPlan(findings, groups, MASKING_PURPOSE.FRAUD_CHECK).data;
    expect(itemOf(plan, 'OWNER_ADDR')).toMatchObject({ action: MASKING_ACTION.REPLACE, replacement: '서울특별시 중구' });
    expect(itemOf(plan, 'TITLE_ADDR')).toMatchObject({ action: MASKING_ACTION.REPLACE, replacement: '서울특별시 중구' });
  });

  it('이전 소유자이면서 지금 소유자이기도 한 사람의 주소는 줄이기만 한다', () => {
    const both = [group('P1', '[Owner_A]', ['OWNER', 'PREVIOUS_OWNER'], ['OWNER', 'PREV'])];
    const plan = createMaskingPlan(findings, both, MASKING_PURPOSE.FRAUD_CHECK).data;
    expect(itemOf(plan, 'PREV_ADDR').action).toBe(MASKING_ACTION.REPLACE);
  });

  it('두 줄 주소는 조각 전체를 가린다', () => {
    const twoLines = [
      finding('PREV', PII_TYPE.PERSON_NAME, '이몽룡', 0.455),
      { ...finding('A1', PII_TYPE.ADDRESS, '서울특별시 마포구 가상로 47, 2동 304호(가', 0.469), groupId: 'G1' },
      { ...finding('A2', PII_TYPE.ADDRESS, '상동,가상빌라)', 0.484), groupId: 'G1' },
    ];
    const plan = createMaskingPlan(twoLines, [group('P2', '[PrevOwner_B]', ['PREVIOUS_OWNER'], ['PREV'])], MASKING_PURPOSE.FRAUD_CHECK).data;
    for (const id of ['A1', 'A2']) expect(itemOf(plan, id).action, id).toBe(MASKING_ACTION.REDACT);
  });
});

describe('PART 4 이전 소유자 주소 가리기: 공유 등기부 가짜 서류', () => {
  let analysis;
  beforeAll(async () => {
    const file = new File([readFileSync(new URL('./fixtures/form-coowner-registry.pdf', import.meta.url))], 'form-coowner-registry.pdf', {
      type: 'application/pdf',
    });
    analysis = (await analyzeDocuments({ files: [file] })).data;
  }, 20000);

  it('예전 공유자(이몽룡·심청)의 마포구 주소는 AI 글에 남지 않고, 지금 소유자 주소는 시·구까지 남는다', () => {
    const r = prepareForAi(analysis, MASKING_PURPOSE.FRAUD_CHECK);
    expect(r.ok).toBe(true);
    // AI로 가는 글(프롬프트)에는 예전 공유자 주소가 없다
    expect(r.data.prompt).not.toContain('마포구');
    // 가린 원문(④ 화면·마스킹 PDF)에서 가린 모양을 본다. 사기 점검의 등기부는 프롬프트에 요약으로 들어가서 원문 줄이 없다 (#360)
    const masked = Object.values(r.data.maskedText).join('\n');
    expect(masked).not.toContain('마포구');
    expect(masked).toContain('매매 서울특별시 송파구');
    expect(masked).toContain('[PrevOwner_B]의 주소 [REDACTED]');
  });
});
