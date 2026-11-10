import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MASKING_PURPOSE } from '../src/shared/document-model.js';

// PART 4 함수들이 edits를 받는지 확인하려고 원래 함수를 감싼다 (동작은 그대로)
vi.mock('../src/features/masking/index.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    createMaskingPlan: vi.fn(original.createMaskingPlan),
    applyMaskingPlan: vi.fn(original.applyMaskingPlan),
    validateMaskedText: vi.fn(original.validateMaskedText),
  };
});

const { createMaskingPlan, applyMaskingPlan, validateMaskedText } = await import('../src/features/masking/index.js');
const { analyzeDocuments, prepareForAi } = await import('../src/app/pipeline.js');
const { initialState } = await import('../src/app/app-state.js');
const { emptyEdits, normalizeEdits, editsAfterPurposeChange } = await import('../src/app/masking-edits.js');

const sampleFiles = () => [
  new File([''], 'sample-registry.pdf', { type: 'application/pdf' }),
  new File([''], 'sample-lease.pdf', { type: 'application/pdf' }),
];

// 가상 데이터만 사용
const someEdits = () => ({
  remove: ['PII_TEST_001'],
  add: [{ id: 'USER_001', documentId: 'DOC_TEST', blockId: 'BLOCK_001', value: 'Sample text' }],
});

describe('PART 5 사용자 수정(maskingEdits) 상태', () => {
  it('처음 상태에는 빈 수정이 들어 있다', () => {
    expect(initialState().maskingEdits).toEqual({ remove: [], add: [] });
  });

  it('빠진 칸은 빈 배열로 채우고, 정해지지 않은 칸은 버린다', () => {
    expect(normalizeEdits(undefined)).toEqual(emptyEdits());
    expect(normalizeEdits({ remove: ['A'] })).toEqual({ remove: ['A'], add: [] });
    expect(normalizeEdits({ add: 'wrong', extra: 1 })).toEqual({ remove: [], add: [] });
  });

  it('넘겨받은 값을 복사해서, 원래 객체를 바꿔도 상태가 바뀌지 않는다', () => {
    const input = someEdits();
    const saved = normalizeEdits(input);
    input.remove.push('PII_TEST_002');
    input.add[0].value = 'changed';
    expect(saved).toEqual(someEdits());
  });

  it('목적을 바꾸면 add는 유지하고 remove는 비운다', () => {
    expect(editsAfterPurposeChange(someEdits())).toEqual({ remove: [], add: someEdits().add });
  });
});

describe('PART 5 prepareForAi에 edits 전달', () => {
  /** @type {any} */
  let analysis;
  beforeEach(async () => {
    analysis = (await analyzeDocuments({ files: sampleFiles() })).data;
    vi.mocked(createMaskingPlan).mockClear();
    vi.mocked(applyMaskingPlan).mockClear();
    vi.mocked(validateMaskedText).mockClear();
  });

  it('가리기(applyMaskingPlan)와 검사(validateMaskedText)에도 같은 edits를 마지막 인자로 넘긴다 (add 글자는 findings에 없으므로)', () => {
    prepareForAi(analysis, MASKING_PURPOSE.FRAUD_CHECK, someEdits());
    expect(vi.mocked(applyMaskingPlan).mock.calls[0][4]).toEqual(someEdits());
    expect(vi.mocked(validateMaskedText).mock.calls[0][3]).toEqual(someEdits());
  });

  it('edits를 그대로 createMaskingPlan 네 번째 인자로 넘긴다', () => {
    const r = prepareForAi(analysis, MASKING_PURPOSE.FRAUD_CHECK, someEdits());
    expect(r.ok).toBe(true);
    expect(createMaskingPlan).toHaveBeenCalledWith(analysis.findings, analysis.personGroups, MASKING_PURPOSE.FRAUD_CHECK, someEdits());
  });

  it('edits를 안 넘기면 빈 수정을 넘기고, 결과는 예전과 같다', () => {
    const before = prepareForAi(analysis, MASKING_PURPOSE.FRAUD_CHECK);
    expect(createMaskingPlan).toHaveBeenLastCalledWith(analysis.findings, analysis.personGroups, MASKING_PURPOSE.FRAUD_CHECK, emptyEdits());
    const withEmpty = prepareForAi(analysis, MASKING_PURPOSE.FRAUD_CHECK, emptyEdits());
    expect(withEmpty.data.prompt).toBe(before.data.prompt);
  });

  it('모양이 잘못된 edits도 정해진 모양으로 맞춰서 넘긴다', () => {
    prepareForAi(analysis, MASKING_PURPOSE.FRAUD_CHECK, /** @type {any} */ ({ remove: 'oops' }));
    expect(createMaskingPlan).toHaveBeenLastCalledWith(analysis.findings, analysis.personGroups, MASKING_PURPOSE.FRAUD_CHECK, emptyEdits());
  });
});
