import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { addSelection, removeAdd, hiddenPlacesNote } from '../src/features/masking/review-model.js';
import { analyzeDocuments, prepareForAi } from '../src/app/pipeline.js';
import { MASKING_PURPOSE } from '../src/shared/document-model.js';

const BOX = { x: 0.1, y: 0.1, width: 0.5, height: 0.03 };
/** 미리보기 한 줄 */
const line = (documentId, blockId, text) => ({ documentId, blockId, pageIndex: 0, bbox: BOX, text });
const LINES = [
  line('DOC_R', 'R1', '근저당권자 가상은행'),
  line('DOC_R', 'R2', '채권최고액 금120,000,000원'),
  line('DOC_L', 'L1', '입금 계좌 가상은행 [REDACTED]'),
  line('DOC_L', 'L2', '월세는 현금으로 지급한다'),
];
const pick = (target, value) => ({ ...target, value });

describe('PART 4 더 가리기: 같은 글자가 여러 줄에 있을 때', () => {
  it('고른 줄과, 같은 글자가 있는 다른 줄에 모두 add를 만든다 (고른 줄이 맨 앞)', () => {
    const r = addSelection(undefined, pick(LINES[2], '가상은행'), LINES);
    expect(r.ok).toBe(true);
    expect(r.edits.add.map((a) => [a.id, a.documentId, a.blockId, a.value])).toEqual([
      ['USER_001', 'DOC_L', 'L1', '가상은행'],
      ['USER_002', 'DOC_R', 'R1', '가상은행'],
    ]);
    expect(r.edits.add.every((a) => a.pageIndex === 0 && a.bbox.width === BOX.width)).toBe(true);
  });

  it('한 번만 나오는 글자는 지금처럼 한 줄만 넣는다', () => {
    const r = addSelection(undefined, pick(LINES[3], '현금으로'), LINES);
    expect(r.edits.add).toHaveLength(1);
  });

  it('줄 목록을 안 주면 고른 줄만 넣는다 (예전 방식과 같음)', () => {
    const r = addSelection(undefined, pick(LINES[2], '가상은행'));
    expect(r.edits.add.map((a) => a.blockId)).toEqual(['L1']);
  });

  it('이미 가린 줄은 다시 넣지 않는다', () => {
    const once = addSelection(undefined, pick(LINES[0], '가상은행')).edits; // R1만
    const twice = addSelection(once, pick(LINES[2], '가상은행'), LINES).edits;
    expect(twice.add.map((a) => a.blockId)).toEqual(['R1', 'L1']);
    expect(addSelection(twice, pick(LINES[0], '가상은행'), LINES)).toEqual({ ok: false, reason: 'DUPLICATE' });
  });

  it('취소하면 같은 글자로 가린 줄이 전부 함께 되돌아가고, 다른 글자는 남는다', () => {
    let edits = addSelection(undefined, pick(LINES[2], '가상은행'), LINES).edits;
    edits = addSelection(edits, pick(LINES[3], '현금으로'), LINES).edits;
    expect(edits.add).toHaveLength(3);
    const after = removeAdd(edits, 'USER_002');
    expect(after.add.map((a) => a.value)).toEqual(['현금으로']);
    expect(edits.add).toHaveLength(3); // 원래 edits는 그대로
  });
  
  it('여러 줄을 가리면 몇 군데인지 안내하고, 한 곳만 가리면 안내하지 않는다 (상욱님 리뷰)', () => {
    expect(hiddenPlacesNote('원', 12)).toBe('Hid "원" in 12 places. In the PDF, each of those lines is covered.');
    expect(hiddenPlacesNote('현금으로', 1)).toBe('');
  });
});

describe('PART 4 더 가리기: 실제 샘플 PDF (상욱님이 찾은 경우)', () => {
  const samplePdf = (name) =>
    new File([readFileSync(new URL(`../public/samples/${name}.pdf`, import.meta.url))], `${name}.pdf`, {
      type: 'application/pdf',
    });
  let analysis;
  beforeAll(async () => {
    const r = await analyzeDocuments({ files: [samplePdf('sample-registry'), samplePdf('sample-lease')] });
    analysis = r.data;
  });

  it('등기부·계약서 둘 다 있는 "가상은행"을 가리면 검사에서 멈추지 않고, AI 글에 남지 않는다', () => {
    const lines = analysis.documents.flatMap((doc) =>
      doc.pages.flatMap((page) =>
        page.blocks.map((b) => ({ documentId: doc.documentId, blockId: b.blockId, pageIndex: page.pageIndex, bbox: b.bbox, text: b.text })),
      ),
    );
    const withBank = lines.filter((l) => l.text.includes('가상은행'));
    expect(new Set(withBank.map((l) => l.documentId)).size).toBe(2); // 두 서류 모두에 있다

    const { edits } = addSelection(undefined, { ...withBank[withBank.length - 1], value: '가상은행' }, lines);
    expect(edits.add).toHaveLength(withBank.length);

    for (const purpose of Object.values(MASKING_PURPOSE)) {
      const r = prepareForAi(analysis, purpose, edits);
      expect(r.ok, purpose).toBe(true);
      expect(r.data.prompt).not.toContain('가상은행');
    }
  });
});
