// PART 5. 서류 한 칸의 조각(계약서 PDF + 특약 별지 PDF·사진)을 따로 읽고 잇기 (#298). 가상 데이터만 사용한다.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mergeDocumentModels } from '../src/app/merge-documents.js';
import { SOURCE_TYPE, DOCUMENT_TYPE } from '../src/shared/document-model.js';

const block = (id, text) => ({ blockId: id, text, bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.02 }, confidence: null });
const docOf = (sourceType, pageTexts) => ({
  documentId: 'DOC_001',
  documentType: DOCUMENT_TYPE.UNKNOWN,
  sourceType,
  pages: pageTexts.map((texts, p) => ({
    pageIndex: p,
    width: 595,
    height: 842,
    blocks: texts.map((t, b) => block(`p${p}_b${b}`, t)),
  })),
});

describe('PART 5 mergeDocumentModels (#298)', () => {
  it('조각이 하나면 그대로 돌려준다', () => {
    const one = docOf(SOURCE_TYPE.TEXT_PDF, [['가상 계약서']]);
    expect(mergeDocumentModels([one])).toBe(one);
  });

  it('쪽을 순서대로 잇고 쪽 번호·blockId를 다시 매긴다 (좌표는 그대로)', () => {
    const lease = docOf(SOURCE_TYPE.TEXT_PDF, [['1쪽 첫 줄', '1쪽 둘째 줄'], ['2쪽']]);
    const terms = docOf(SOURCE_TYPE.IMAGE_PDF, [['특약사항 가상 문구']]);
    const merged = mergeDocumentModels([lease, terms]);
    expect(merged.pages.map((p) => p.pageIndex)).toEqual([0, 1, 2]);
    expect(merged.pages.flatMap((p) => p.blocks.map((b) => b.blockId))).toEqual(['p0_b0', 'p0_b1', 'p1_b0', 'p2_b0']);
    expect(merged.pages[2].blocks[0].text).toBe('특약사항 가상 문구');
    expect(merged.pages[2].blocks[0].bbox).toEqual(terms.pages[0].blocks[0].bbox);
    // 원래 조각은 바꾸지 않는다
    expect(terms.pages[0].pageIndex).toBe(0);
    expect(terms.pages[0].blocks[0].blockId).toBe('p0_b0');
  });

  it('blockId가 "p쪽_" 모양이 아니면 새로 붙인다 (서류 안에서 겹치지 않게)', () => {
    const a = docOf(SOURCE_TYPE.TEXT_PDF, [['가']]);
    const b = docOf(SOURCE_TYPE.TEXT_PDF, [['나', '다']]);
    b.pages[0].blocks = b.pages[0].blocks.map((x, i) => ({ ...x, blockId: `BLOCK_${i}` }));
    const ids = mergeDocumentModels([a, b]).pages.flatMap((p) => p.blocks.map((x) => x.blockId));
    expect(ids).toEqual(['p0_b0', 'p1_b0', 'p1_b1']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('한 조각이라도 사진·스캔이면 서류 전체를 그림 PDF로 본다 ("Check the text" 단계를 거치게)', () => {
    const text = docOf(SOURCE_TYPE.TEXT_PDF, [['가']]);
    expect(mergeDocumentModels([text, docOf(SOURCE_TYPE.IMAGE_PDF, [['나']])]).sourceType).toBe(SOURCE_TYPE.IMAGE_PDF);
    expect(mergeDocumentModels([text, docOf(SOURCE_TYPE.IMAGE, [['나']])]).sourceType).toBe(SOURCE_TYPE.IMAGE_PDF);
    expect(mergeDocumentModels([text, docOf(SOURCE_TYPE.TEXT_PDF, [['나']])]).sourceType).toBe(SOURCE_TYPE.TEXT_PDF);
  });
});

// readDocuments: 조각이 있으면 조각마다 PART 1로 읽는다 (합친 PDF를 읽지 않음)
const readDocument = vi.fn();
vi.mock('../src/features/document-input/index.js', async (orig) => ({
  ...(await orig()),
  readDocument: (...args) => readDocument(...args),
}));
const { readDocuments } = await import('../src/app/pipeline.js');

describe('PART 5 readDocuments({ files, parts }) (#298)', () => {
  const file = (name) => new File(['x'], name, { type: 'application/pdf' });
  beforeEach(() => {
    readDocument.mockReset();
  });

  it('조각이 2개 이상이면 조각마다 읽고 한 서류로 잇는다. 조각이 없거나 1개면 files[i]를 읽는다', async () => {
    const byName = {
      'lease-part.pdf': docOf(SOURCE_TYPE.TEXT_PDF, [['계약서 1쪽'], ['계약서 2쪽']]),
      'terms-photo.pdf': docOf(SOURCE_TYPE.IMAGE_PDF, [['특약 별지']]),
      'registry.pdf': docOf(SOURCE_TYPE.TEXT_PDF, [['등기부']]),
    };
    readDocument.mockImplementation(async (f) => ({ ok: true, data: byName[f.name] }));
    const registry = file('registry.pdf');
    const leaseParts = [file('lease-part.pdf'), file('terms-photo.pdf')];
    const r = await readDocuments({ files: [registry, file('lease.pdf')], parts: [[registry], leaseParts] }, { allowLowConfidence: true });
    expect(r.ok).toBe(true);
    expect(readDocument.mock.calls.map(([f]) => f.name)).toEqual(['registry.pdf', 'lease-part.pdf', 'terms-photo.pdf']);
    expect(readDocument.mock.calls.every(([, o]) => o?.allowLowConfidence === true)).toBe(true);
    const [reg, lease] = r.data.documents;
    expect(reg.pages).toHaveLength(1);
    expect(lease.pages).toHaveLength(3);
    expect(lease.sourceType).toBe(SOURCE_TYPE.IMAGE_PDF);
    expect(lease.pages[2].blocks[0].blockId).toBe('p2_b0');
  });

  it('조각마다 서류 종류를 판별해 partTypes로 돌려준다. 조각이 하나인 칸은 null (#305)', async () => {
    const registryText = [['등기사항전부증명서(말소사항 포함)', '【 표 제 부 】 ( 1동의 건물의 표시 )', '【 갑 구 】 ( 소유권에 관한 사항 )', '【 을 구 】 ( 소유권 이외의 권리에 관한 사항 )']];
    const leaseText = [['표준임대차계약서', '임대사업자 성명(법인명)', '임차인 성명(법인명)', '임대보증금 월임대료 임대차 계약기간']];
    const byName = {
      'lease-part.pdf': docOf(SOURCE_TYPE.TEXT_PDF, leaseText),
      'registry-part.pdf': docOf(SOURCE_TYPE.TEXT_PDF, registryText),
      'terms.pdf': docOf(SOURCE_TYPE.TEXT_PDF, [['1. 실내에서 반려동물을 기르지 않는다.']]),
      'registry.pdf': docOf(SOURCE_TYPE.TEXT_PDF, registryText),
    };
    readDocument.mockImplementation(async (f) => ({ ok: true, data: byName[f.name] }));
    const r = await readDocuments({
      files: [file('registry.pdf'), file('lease.pdf')],
      parts: [null, [file('lease-part.pdf'), file('registry-part.pdf'), file('terms.pdf')]],
    });
    expect(r.ok).toBe(true);
    expect(r.data.partTypes).toEqual([null, [DOCUMENT_TYPE.LEASE_CONTRACT, DOCUMENT_TYPE.REGISTRY, DOCUMENT_TYPE.UNKNOWN]]);
  });

  it('조각 하나라도 읽기에 실패하면 그 오류로 멈춘다', async () => {
    readDocument
      .mockResolvedValueOnce({ ok: true, data: docOf(SOURCE_TYPE.TEXT_PDF, [['가']]) })
      .mockResolvedValueOnce({ ok: false, error: { code: 'PDF_READ_FAILED', message: 'x' } });
    const r = await readDocuments({ files: [file('lease.pdf')], parts: [[file('a.pdf'), file('b.pdf')]] });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('PDF_READ_FAILED');
  });
});
