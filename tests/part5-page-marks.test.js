// PART 5. 프롬프트의 가린 글에 쪽 표시 넣기 (#276 리뷰 후속). 가상 데이터만 쓴다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withPageMarks, pageMark } from '../src/app/page-marks.js';
import { analyzeDocuments, prepareForAi } from '../src/app/pipeline.js';
import { MASKING_PURPOSE } from '../src/shared/document-model.js';

const block = (blockId, text) => ({ blockId, text, bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.02 }, confidence: null });
const doc = {
  documentId: 'DOC_A',
  documentType: 'LEASE_CONTRACT',
  sourceType: 'text_pdf',
  pages: [
    { pageIndex: 0, width: 100, height: 140, blocks: [block('B1', 'Landlord [Landlord_A]'), block('B2', 'Deposit 10,000,000')] },
    { pageIndex: 1, width: 100, height: 140, blocks: [] },
    { pageIndex: 2, width: 100, height: 140, blocks: [block('B3', 'Special terms')] },
  ],
};
/** 가짜 "가리기": 블록 글을 그대로 줄로 잇는다 (applyMaskingPlan과 같은 모양) */
const fakeMask = (docs) => Object.fromEntries(docs.map((d) => [d.documentId, d.pages.flatMap((p) => p.blocks.map((b) => b.text)).join('\n')]));
const checked = fakeMask([doc]);

describe('withPageMarks', () => {
  it('쪽마다 "--- page N ---"를 붙인다 (빈 쪽은 건너뜀, 번호는 실제 쪽 번호)', () => {
    const out = withPageMarks([doc], checked, fakeMask);
    expect(out.DOC_A).toBe('--- page 1 ---\nLandlord [Landlord_A]\nDeposit 10,000,000\n--- page 3 ---\nSpecial terms');
    expect(pageMark(0)).toBe('--- page 1 ---');
  });

  it('쪽 표시를 빼면 검사한 글과 똑같다', () => {
    const out = withPageMarks([doc], checked, fakeMask);
    const withoutMarks = out.DOC_A.split('\n').filter((l) => !/^--- page \d+ ---$/.test(l)).join('\n');
    expect(withoutMarks).toBe(checked.DOC_A);
  });

  it('쪽마다 가린 글이 검사한 글과 다르면 쪽 표시 없이 검사한 글을 쓴다', () => {
    const leaky = (docs) => ({ DOC_A: docs[0].pages[0].blocks.map((b) => b.text.replace('[Landlord_A]', '홍길동')).join('\n') });
    expect(withPageMarks([doc], checked, leaky).DOC_A).toBe(checked.DOC_A);
  });

  it('가리기가 실패하거나 오류를 내면 검사한 글을 쓴다', () => {
    expect(withPageMarks([doc], checked, () => null).DOC_A).toBe(checked.DOC_A);
    expect(
      withPageMarks([doc], checked, () => {
        throw new Error('fail');
      }).DOC_A,
    ).toBe(checked.DOC_A);
  });

  it('서류 목록에 없는 글은 그대로 둔다', () => {
    expect(withPageMarks([], { DOC_X: 'text' }, fakeMask)).toEqual({ DOC_X: 'text' });
  });
});

describe('prepareForAi 프롬프트의 쪽 표시 (가짜 샘플 PDF)', () => {
  const samplePdf = (name) =>
    new File([readFileSync(new URL(`../public/samples/${name}.pdf`, import.meta.url))], `${name}.pdf`, { type: 'application/pdf' });

  it('프롬프트에는 쪽 표시가 있고, 화면·PDF용 maskedText에는 없다', async () => {
    const a = await analyzeDocuments({ files: [samplePdf('sample-registry'), samplePdf('sample-lease')] });
    expect(a.ok).toBe(true);
    for (const purpose of Object.values(MASKING_PURPOSE)) {
      const r = prepareForAi(a.data, purpose);
      expect(r.ok, purpose).toBe(true);
      expect(r.data.prompt).toContain('--- page 1 ---');
      for (const text of Object.values(r.data.maskedText)) expect(text).not.toContain('--- page');
    }
  });
});
