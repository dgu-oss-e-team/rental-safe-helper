// PART 4. 역할 없는 이름(채무자·채권자·영수자 등, role: null)에 가명 연결하기
// 글자가 똑같은 이름의 인물 묶음이 딱 하나면 그 가명을 쓰고, 둘 이상(동명이인)이거나 없으면 가린다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMaskingPlan } from '../src/features/masking/index.js';
import { readDocuments, analyzeReadDocuments, prepareForAi } from '../src/app/pipeline.js';
import { MASKING_ACTION, MASKING_PURPOSE, PII_TYPE } from '../src/shared/document-model.js';

const BOX = { x: 0.1, y: 0.1, width: 0.3, height: 0.03 };
/** 이름 탐지 결과 하나 */
const name = (id, value) => ({ id, type: PII_TYPE.PERSON_NAME, value, documentId: 'DOC_R', blockId: id, pageIndex: 0, bbox: BOX });
/** 인물 묶음 하나 */
const group = (personId, alias, roles, findingIds) => ({ personId, alias, roles, findingIds, status: 'CONFIRMED' });
/** 계획에서 그 항목 */
const itemOf = (plan, id) => plan.items.find((i) => i.findingId === id);

describe('PART 4 역할 없는 이름의 가명 연결', () => {
  it('소유자와 같은 이름의 채무자·영수자는 소유자 가명이 된다 (같은 이름의 묶음이 하나뿐일 때)', () => {
    const findings = [name('O1', '김철수'), name('L1', '김철수'), name('N1', '김철수'), name('N2', '김 철수')];
    // 소유자 = 임대인 (같은 사람으로 판정됨)
    const groups = [group('P1', '[Owner_A]', ['OWNER', 'LANDLORD'], ['O1', 'L1'])];
    const plan = createMaskingPlan(findings, groups, MASKING_PURPOSE.FRAUD_CHECK).data;
    for (const id of ['O1', 'L1', 'N1', 'N2']) {
      expect(itemOf(plan, id), id).toMatchObject({ action: MASKING_ACTION.REPLACE, replacement: '[Owner_A]' });
    }
  });

  it('같은 이름의 묶음이 둘 이상이면(동명이인) 어느 쪽인지 모르니 가린다', () => {
    const findings = [name('O1', '김철수'), name('L1', '김철수'), name('N1', '김철수')];
    const groups = [group('P1', '[Owner_A]', ['OWNER'], ['O1']), group('P2', '[Landlord_B]', ['LANDLORD'], ['L1'])];
    const plan = createMaskingPlan(findings, groups, MASKING_PURPOSE.FRAUD_CHECK).data;
    expect(itemOf(plan, 'N1')).toMatchObject({ action: MASKING_ACTION.REDACT, replacement: '[REDACTED]' });
    // 묶음에 들어 있는 이름은 지금처럼 자기 가명
    expect(itemOf(plan, 'O1').replacement).toBe('[Owner_A]');
    expect(itemOf(plan, 'L1').replacement).toBe('[Landlord_B]');
  });

  it('같은 이름의 묶음이 없거나, 이름이 비슷하기만 하면(김철슈) 연결하지 않고 가린다', () => {
    const findings = [name('O1', '김철수'), name('N1', '이가상'), name('N2', '김철슈')];
    const groups = [group('P1', '[Owner_A]', ['OWNER'], ['O1'])];
    const plan = createMaskingPlan(findings, groups, MASKING_PURPOSE.FRAUD_CHECK).data;
    expect(itemOf(plan, 'N1').action).toBe(MASKING_ACTION.REDACT);
    expect(itemOf(plan, 'N2').action).toBe(MASKING_ACTION.REDACT);
  });

  it('이름을 가리는 목적(조항·계약 설명)에서는 지금처럼 가린다', () => {
    const findings = [name('O1', '김철수'), name('N1', '김철수')];
    const groups = [group('P1', '[Owner_A]', ['OWNER'], ['O1'])];
    for (const purpose of [MASKING_PURPOSE.CLAUSE_EXPLANATION, MASKING_PURPOSE.CONTRACT_EXPLANATION]) {
      const plan = createMaskingPlan(findings, groups, purpose).data;
      expect(itemOf(plan, 'N1').action, purpose).toBe(MASKING_ACTION.REDACT);
    }
  });
});

describe('PART 4 역할 없는 이름의 가명 연결: 빽빽한 가짜 서류 (#140, #145)', () => {
  const fixture = (file) =>
    new File([readFileSync(new URL(`./fixtures/${file}`, import.meta.url))], file, { type: 'application/pdf' });

  it('을구 채무자 박영수는 예전 소유자 가명, 동명이인이 있는 김철수는 가린다', async () => {
    const read = await readDocuments({ files: [fixture('dense-registry.pdf'), fixture('dense-lease.pdf')] });
    const analysis = analyzeReadDocuments(read.data).data;
    const r = prepareForAi(analysis, MASKING_PURPOSE.FRAUD_CHECK);
    expect(r.ok).toBe(true);
    const lines = r.data.prompt.split('\n');
    expect(lines.some((l) => /채무자 \[PrevOwner_E\]/.test(l))).toBe(true);
    expect(r.data.legend['[PrevOwner_E]']).toBe('previous owner on the register');
    // 소유자·임대인·예금주가 모두 김철수(동명이인)라 영수자 김철수는 누구인지 정하지 않는다
    expect(lines.some((l) => /영수자 \[REDACTED\]/.test(l))).toBe(true);
    for (const secret of ['김철수', '박영수']) expect(r.data.prompt).not.toContain(secret);
  });
});
