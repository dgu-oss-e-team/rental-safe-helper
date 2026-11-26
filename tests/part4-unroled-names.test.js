// PART 4. 역할 없는 이름(채무자·채권자·영수자 등, role: null)에 가명 연결하기
// 글자가 똑같은 이름의 인물 묶음이 딱 하나면 그 가명에 "?"를 붙여 쓰고, 둘 이상(동명이인)이거나 없으면 가린다.
// 그 묶음이 같은 서류에도 그 이름으로 나오면 "?" 없이 같은 가명을 쓴다. (아래 "같은 서류" 테스트)
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMaskingPlan, applyMaskingPlan, validateMaskedText } from '../src/features/masking/index.js';
import { readDocuments, analyzeReadDocuments, prepareForAi } from '../src/app/pipeline.js';
import { MASKING_ACTION, MASKING_PURPOSE, PII_TYPE } from '../src/shared/document-model.js';

const BOX = { x: 0.1, y: 0.1, width: 0.3, height: 0.03 };
/** 이름 탐지 결과 하나 */
const name = (id, value, documentId = 'DOC_R') => ({ id, type: PII_TYPE.PERSON_NAME, value, documentId, blockId: id, pageIndex: 0, bbox: BOX });
/** 다른 서류(계약서)에 나온 이름 */
const nameInLease = (id, value) => name(id, value, 'DOC_L');
/** 인물 묶음 하나 */
const group = (personId, alias, roles, findingIds) => ({ personId, alias, roles, findingIds, status: 'CONFIRMED' });
/** 계획에서 그 항목 */
const itemOf = (plan, id) => plan.items.find((i) => i.findingId === id);

describe('PART 4 역할 없는 이름의 가명 연결', () => {
  it('다른 서류에 나온 같은 이름(영수자 등)은 "확인 안 됨" 표시가 붙은 소유자 가명이 된다 (같은 이름의 묶음이 하나뿐일 때)', () => {
    const findings = [name('O1', '김철수'), name('L1', '김철수'), nameInLease('N1', '김철수'), nameInLease('N2', '김 철수')];
    // 소유자 = 임대인 (같은 사람으로 판정됨)
    const groups = [group('P1', '[Owner_A]', ['OWNER', 'LANDLORD'], ['O1', 'L1'])];
    const plan = createMaskingPlan(findings, groups, MASKING_PURPOSE.FRAUD_CHECK).data;
    // 묶음에 들어 있는 이름(판정된 사람)은 그대로
    for (const id of ['O1', 'L1']) expect(itemOf(plan, id).replacement, id).toBe('[Owner_A]');
    // 이름만 같은 이름은 [Owner_A?]
    for (const id of ['N1', 'N2']) {
      expect(itemOf(plan, id), id).toMatchObject({ action: MASKING_ACTION.REPLACE, replacement: '[Owner_A?]' });
    }
  });

  it('범례에 "이름만 같고 확인 안 됨"이라고 적는다', () => {
    const findings = [name('O1', '김철수'), nameInLease('N1', '김철수')];
    const groups = [group('P1', '[Owner_A]', ['OWNER'], ['O1'])];
    const plan = createMaskingPlan(findings, groups, MASKING_PURPOSE.FRAUD_CHECK).data;
    const page = (blockId, text) => [{ pageIndex: 0, width: 100, height: 100, blocks: [{ blockId, text, bbox: BOX, confidence: null }] }];
    const docs = [
      { documentId: 'DOC_R', pages: page('O1', '소유자 김철수') },
      { documentId: 'DOC_L', pages: page('N1', '영수자 김철수') },
    ];
    const r = applyMaskingPlan(docs, plan, findings, groups).data;
    expect(r.maskedText.DOC_R).toBe('소유자 [Owner_A]');
    expect(r.maskedText.DOC_L).toBe('영수자 [Owner_A?]');
    expect(r.legend).toEqual({
      '[Owner_A]': 'owner on the register',
      '[Owner_A?]': 'same name as [Owner_A] (owner on the register), not confirmed to be the same person',
    });
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

  it('조사가 붙은 이름(김철수는)은 조사를 떼고 같은 사람을 찾아 가명 뒤에 조사를 남긴다', () => {
    const findings = [name('O1', '김철수'), nameInLease('N1', '김철수는'), nameInLease('N2', '김철수에게')];
    const groups = [group('P1', '[Owner_A]', ['OWNER'], ['O1'])];
    const plan = createMaskingPlan(findings, groups, MASKING_PURPOSE.FRAUD_CHECK).data;
    expect(itemOf(plan, 'N1')).toMatchObject({ action: MASKING_ACTION.REPLACE, replacement: '[Owner_A?]는' });
    expect(itemOf(plan, 'N2')).toMatchObject({ action: MASKING_ACTION.REPLACE, replacement: '[Owner_A?]에게' });

    const docs = [
      { documentId: 'DOC_R', pages: [{ pageIndex: 0, width: 100, height: 100, blocks: [
        { blockId: 'O1', text: '소유자 김철수', bbox: BOX, confidence: null },
      ] }] },
      { documentId: 'DOC_L', pages: [{ pageIndex: 0, width: 100, height: 100, blocks: [
        { blockId: 'N1', text: '1. 임대인 김철수는 잔금일까지 담보를 설정하지 않는다.', bbox: BOX, confidence: null },
        { blockId: 'N2', text: '2. 보증금은 김철수에게 지급한다.', bbox: BOX, confidence: null },
      ] }] },
    ];
    const r = applyMaskingPlan(docs, plan, findings, groups).data;
    expect(r.maskedText.DOC_L.split('\n')).toEqual([
      '1. 임대인 [Owner_A?]는 잔금일까지 담보를 설정하지 않는다.',
      '2. 보증금은 [Owner_A?]에게 지급한다.',
    ]);
    expect(validateMaskedText(r.maskedText, findings, plan).ok).toBe(true);
  });

  it('조사 글자로 끝나는 진짜 이름(김지은)은 쪼개지 않는다: 조사를 뗀 "김지"가 없으면 가린다', () => {
    const findings = [name('O1', '김철수'), name('N1', '김지은'), name('N2', '김정의')];
    const groups = [group('P1', '[Owner_A]', ['OWNER'], ['O1'])];
    const plan = createMaskingPlan(findings, groups, MASKING_PURPOSE.FRAUD_CHECK).data;
    expect(itemOf(plan, 'N1').action).toBe(MASKING_ACTION.REDACT);
    expect(itemOf(plan, 'N2').action).toBe(MASKING_ACTION.REDACT);
  });

  it('김지은이라는 사람이 있으면 조사를 떼지 않고 그 사람으로 연결한다 (똑같은 이름이 먼저)', () => {
    const findings = [name('T1', '김지은'), nameInLease('N1', '김지은'), nameInLease('N2', '김지은은')];
    const groups = [group('P1', '[Tenant_A]', ['TENANT'], ['T1'])];
    const plan = createMaskingPlan(findings, groups, MASKING_PURPOSE.FRAUD_CHECK).data;
    expect(itemOf(plan, 'N1').replacement).toBe('[Tenant_A?]');
    expect(itemOf(plan, 'N2').replacement).toBe('[Tenant_A?]은');
  });

  it('조사를 뗀 이름이 동명이인이면 어느 쪽인지 모르니 가린다', () => {
    const findings = [name('O1', '김철수'), name('L1', '김철수'), name('N1', '김철수는')];
    const groups = [group('P1', '[Owner_A]', ['OWNER'], ['O1']), group('P2', '[Landlord_B]', ['LANDLORD'], ['L1'])];
    const plan = createMaskingPlan(findings, groups, MASKING_PURPOSE.FRAUD_CHECK).data;
    expect(itemOf(plan, 'N1').action).toBe(MASKING_ACTION.REDACT);
  });

  it('같은 서류에 그 이름의 묶음이 나오면 "?" 없이 같은 가명을 쓴다 (계약서 동의서·서명란, 등기부 부기 줄)', () => {
    // 계약서: 임차인 성명 칸(역할 있음) + 동의서·서명란(역할 없음)
    const findings = [nameInLease('T1', '김지은'), nameInLease('N1', '김지은'), nameInLease('N2', '김지은의')];
    const groups = [group('P1', '[Tenant_A]', ['TENANT'], ['T1'])];
    const plan = createMaskingPlan(findings, groups, MASKING_PURPOSE.FRAUD_CHECK).data;
    expect(itemOf(plan, 'N1').replacement).toBe('[Tenant_A]');
    expect(itemOf(plan, 'N2').replacement).toBe('[Tenant_A]의');

    const docs = [{ documentId: 'DOC_L', pages: [{ pageIndex: 0, width: 100, height: 100, blocks: [
      { blockId: 'T1', text: '임차인 김지은', bbox: BOX, confidence: null },
      { blockId: 'N1', text: '개인정보 수집 동의 김지은 (서명)', bbox: BOX, confidence: null },
      { blockId: 'N2', text: '1-1 1번등기명의인표시변경 김지은의 주소', bbox: BOX, confidence: null },
    ] }] }];
    const r = applyMaskingPlan(docs, plan, findings, groups).data;
    expect(r.maskedText.DOC_L).not.toContain('?]');
    expect(r.legend['[Tenant_A?]']).toBeUndefined();
    expect(validateMaskedText(r.maskedText, findings, plan).ok).toBe(true);
  });

  it('같은 서류라도 같은 이름의 묶음이 둘 이상(동명이인)이면 지금처럼 가린다', () => {
    const findings = [name('O1', '김철수'), name('P1', '김철수'), name('N1', '김철수')];
    const groups = [group('P1', '[Owner_A]', ['OWNER'], ['O1']), group('P2', '[PrevOwner_B]', ['PREVIOUS_OWNER'], ['P1'])];
    const plan = createMaskingPlan(findings, groups, MASKING_PURPOSE.FRAUD_CHECK).data;
    expect(itemOf(plan, 'N1').action).toBe(MASKING_ACTION.REDACT);
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

  // PDF 읽기는 느려서(컴퓨터에 따라 5초 넘음) 테스트 밖에서 한 번만 읽는다
  let analysis;
  beforeAll(async () => {
    const read = await readDocuments({ files: [fixture('dense-registry.pdf'), fixture('dense-lease.pdf')] });
    analysis = analyzeReadDocuments(read.data).data;
  }, 20000);

  it('같은 등기부의 을구 채무자 박영수는 예전 소유자 가명 그대로, 동명이인이 있는 김철수는 가린다', () => {
    const r = prepareForAi(analysis, MASKING_PURPOSE.FRAUD_CHECK);
    expect(r.ok).toBe(true);
    // 가린 원문(④ 화면·마스킹 PDF)에서 가명 연결을 본다. 사기 점검의 등기부는 프롬프트에 요약으로 들어가서 원문 줄이 없다 (#360)
    const lines = Object.values(r.data.maskedText).join('\n').split('\n');
    expect(lines.some((l) => /채무자 \[PrevOwner_E\](?!\?)/.test(l))).toBe(true);
    expect(r.data.legend['[PrevOwner_E?]']).toBeUndefined();
    // 소유자·임대인·예금주가 모두 김철수(동명이인)라 영수자 김철수는 누구인지 정하지 않는다
    expect(lines.some((l) => /영수자 \[REDACTED\]/.test(l))).toBe(true);
    for (const secret of ['김철수', '박영수']) expect(r.data.prompt).not.toContain(secret);
  });
});
