// PART 5. 등기부 요약 글도 보내기 전 검사를 거친다 (#360). 요약 함수가 번호를 남긴 가짜 상황. 가짜 데이터만 사용.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeDocuments, prepareForAi } from '../src/app/pipeline.js';
import { MASKING_PURPOSE } from '../src/shared/document-model.js';

// 요약 함수가 실수로 주민번호 모양 번호(가짜)를 남겼다고 가정한다
vi.mock('../src/features/masking/index.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    buildRegistrySummary: (fields) => ({
      ok: true,
      data: { documentId: fields.documentId, text: 'Extracted items from the property register\nCurrent owner: 900101-1000000', hiddenCount: 0 },
    }),
  };
});

const samplePdf = (name) =>
  new File([readFileSync(new URL(`../public/samples/${name}.pdf`, import.meta.url))], `${name}.pdf`, { type: 'application/pdf' });

describe('PART 5 요약 글의 보내기 전 검사 (#360)', () => {
  it('요약에 번호가 남으면 멈추고, "이 줄 가리기" 줄 정보는 붙이지 않는다', async () => {
    const a = await analyzeDocuments({ files: [samplePdf('sample-registry'), samplePdf('sample-lease')] });
    const r = prepareForAi(a.data, MASKING_PURPOSE.FRAUD_CHECK);
    expect(r.ok).toBe(false);
    expect(r.step).toBe('validateMaskedText');
    expect(r.lines).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('900101');
  }, 20000);

  it('요약을 쓰지 않는 목적은 그대로 진행한다', async () => {
    const a = await analyzeDocuments({ files: [samplePdf('sample-registry'), samplePdf('sample-lease')] });
    expect(prepareForAi(a.data, MASKING_PURPOSE.CLAUSE_EXPLANATION).ok).toBe(true);
  }, 20000);
});
