import { describe, it, expect } from 'vitest';
import {
  analyzeDocuments,
  readDocuments,
  analyzeReadDocuments,
  needsTextReview,
  countLinesToCheck,
} from '../src/app/pipeline.js';
import { SOURCE_TYPE } from '../src/shared/document-model.js';

// 가상 데이터만 사용 (실제 개인정보 없음)
const sampleFiles = () => [
  new File([''], 'sample-registry.pdf', { type: 'application/pdf' }),
  new File([''], 'sample-lease.pdf', { type: 'application/pdf' }),
];

/** @param {{ text: string, confidence: number | null }[]} lines */
const fakeDoc = (lines, sourceType = SOURCE_TYPE.IMAGE) => ({
  documentId: 'DOC_TEST',
  documentType: 'UNKNOWN',
  sourceType,
  pages: [
    {
      pageIndex: 0,
      width: 1000,
      height: 1400,
      blocks: lines.map((l, i) => ({
        blockId: `BLOCK_${String(i + 1).padStart(3, '0')}`,
        text: l.text,
        bbox: { x: 0.1, y: 0.1 + i * 0.05, width: 0.5, height: 0.03 },
        confidence: l.confidence,
      })),
    },
  ],
});

describe('PART 5 "Confirm text" 단계 (#54)', () => {
  it('readDocuments + analyzeReadDocuments는 analyzeDocuments와 같은 결과를 낸다', async () => {
    const whole = await analyzeDocuments({ files: sampleFiles() });
    const read = await readDocuments({ files: sampleFiles() });
    expect(whole.ok).toBe(true);
    expect(read.ok).toBe(true);
    if (!whole.ok || !read.ok) return;
    const split = analyzeReadDocuments(read.data);
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    expect(split.data.riskResults).toEqual(whole.data.riskResults);
    expect(split.data.findings).toEqual(whole.data.findings);
  });

  it('파일이 없으면 input 단계 오류', async () => {
    const r = await readDocuments({ files: [] });
    expect(r.ok).toBe(false);
    expect(r.step).toBe('input');
  });

  it('analyzeReadDocuments는 넘겨받은 서류를 바꾸지 않는다', async () => {
    const read = await readDocuments({ files: sampleFiles() });
    if (!read.ok) throw new Error('read failed');
    const before = structuredClone(read.data.documents);
    analyzeReadDocuments(read.data);
    expect(read.data.documents).toEqual(before);
  });

  it('사진·스캔 PDF만 글자 확인이 필요하다', () => {
    expect(needsTextReview(fakeDoc([], SOURCE_TYPE.IMAGE))).toBe(true);
    expect(needsTextReview(fakeDoc([], SOURCE_TYPE.IMAGE_PDF))).toBe(true);
    expect(needsTextReview(fakeDoc([], SOURCE_TYPE.TEXT_PDF))).toBe(false);
  });

  it('흐린 줄만 센다 (숫자 줄 0.8 미만, 그 밖의 줄 0.75 미만)', () => {
    const doc = fakeDoc([
      { text: '010-0000-0000', confidence: 0.7 }, // 숫자 줄, 흐림
      { text: 'Lease agreement', confidence: 0.7 }, // 글자 줄, 흐림
      { text: 'Deposit 1000', confidence: 0.85 }, // 숫자 줄, 괜찮음
      { text: 'Landlord', confidence: 0.9 },
      { text: '확인한 줄 123', confidence: 1 }, // 사용자가 확인함
    ]);
    expect(countLinesToCheck([doc])).toBe(2);
  });

  it('사용자가 고치거나 확인한 줄(confidence 1)은 더 세지 않는다', () => {
    const doc = fakeDoc([{ text: '010-0000-0000', confidence: 0.6 }]);
    expect(countLinesToCheck([doc])).toBe(1);
    doc.pages[0].blocks[0].confidence = 1;
    expect(countLinesToCheck([doc])).toBe(0);
    expect(countLinesToCheck([])).toBe(0);
  });
});
