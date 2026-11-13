// PART 5. 마스킹 PDF 다시 검사 (노션 10장: 생성된 PDF를 다시 OCR하여 개인정보가 보이는지 확인)
// OCR 대신, 다시 읽은 결과(DocumentModel)를 직접 만들어 비교 로직을 검사한다. 가짜 데이터만 사용.
import { describe, it, expect, vi } from 'vitest';
import { findVisiblePii, unverifiable, CHECK_STATUS } from '../src/app/double-check.js';

// pipeline의 readDocument(PART 1)를 가짜로 바꿔, OCR 성공·실패를 흉내 낸다
vi.mock('../src/features/document-input/index.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readDocument: vi.fn(),
}));
const { readDocument } = await import('../src/features/document-input/index.js');
const { doubleCheckPdfs } = await import('../src/app/pipeline.js');

/** 다시 읽은 페이지 (줄마다 글자) */
const ocrDoc = (...lines) => ({
  documentId: 'OCR',
  documentType: 'UNKNOWN',
  sourceType: 'image_pdf',
  pages: [
    {
      pageIndex: 0,
      width: 1000,
      height: 1414,
      blocks: lines.map((text, i) => ({ blockId: `b${i}`, text, bbox: { x: 0.1, y: 0.1 * i, width: 0.5, height: 0.03 }, confidence: 0.9 })),
    },
  ],
});

const finding = (id, type, value) => ({ id, type, value, documentId: 'DOC_A', pageIndex: 0, blockId: 'b', bbox: { x: 0, y: 0, width: 0.1, height: 0.1 }, confidence: null, reviewStatus: 'DETECTED' });
const findings = [
  finding('F_NAME', 'PERSON_NAME', '김철수'),
  finding('F_RRN', 'RESIDENT_ID', '750315-1******'),
  finding('F_PHONE', 'PHONE_NUMBER', '010-0000-0000'),
  finding('F_ADDR', 'ADDRESS', '서울특별시 중구 필동로 00, 101호'),
];
const plan = (keep = []) => ({
  purpose: 'FRAUD_CHECK',
  items: findings.map((f) => ({ findingId: f.id, action: keep.includes(f.id) ? 'KEEP' : 'REDACT', replacement: '[REDACTED]', documentId: 'DOC_A', pageIndex: 0, bbox: f.bbox })),
});

describe('PART 5 findVisiblePii(): 다시 읽은 글자에서 개인정보 찾기', () => {
  it('제대로 가려졌으면(가명·시·구만) NOT_FOUND', () => {
    const r = findVisiblePii(ocrDoc('임대인 [Landlord_B]', '소재지 서울특별시 중구', '연락처'), findings, plan());
    expect(r).toEqual({ status: CHECK_STATUS.NOT_FOUND, hits: [], reason: null });
  });

  it('이름이 그대로 보이면 MAYBE_VISIBLE, 종류와 페이지만 알려 준다 (값은 없음)', () => {
    const r = findVisiblePii(ocrDoc('임대인 김철수'), findings, plan());
    expect(r.status).toBe(CHECK_STATUS.MAYBE_VISIBLE);
    expect(r.hits).toEqual([{ type: 'PERSON_NAME', pageIndex: 0 }]);
    expect(JSON.stringify(r)).not.toContain('김철수');
  });

  it('OCR이 띄어쓰기를 틀려도 찾는다 ("김 철 수", 주소 띄어쓰기)', () => {
    const r = findVisiblePii(ocrDoc('임대인 김 철 수', '서울특별시중구 필동로00, 101호'), findings, plan());
    expect(r.hits.map((h) => h.type).sort()).toEqual(['ADDRESS', 'PERSON_NAME']);
  });

  it('번호는 하이픈·기호를 잘못 읽어도 숫자만으로 찾는다 ("010 0000.0000")', () => {
    const r = findVisiblePii(ocrDoc('연락처 010 0000.0000'), findings, plan());
    expect(r.hits).toEqual([{ type: 'PHONE_NUMBER', pageIndex: 0 }]);
  });

  it('사용자가 "AI에게 보여 주기"로 해제한 항목(KEEP)은 보여도 문제로 보지 않는다', () => {
    const r = findVisiblePii(ocrDoc('임대인 김철수'), findings, plan(['F_NAME']));
    expect(r.status).toBe(CHECK_STATUS.NOT_FOUND);
  });

  it('확인할 수 없으면 UNVERIFIABLE과 이유 코드', () => {
    expect(unverifiable('LOW_CONFIDENCE')).toEqual({ status: CHECK_STATUS.UNVERIFIABLE, hits: [], reason: 'LOW_CONFIDENCE' });
  });
});

describe('PART 5 doubleCheckPdfs(): 서류마다 PDF를 다시 읽어 검사', () => {
  const analysis = { findings };
  const pdfOk = { documentId: 'DOC_A', documentType: 'LEASE_CONTRACT', result: { ok: true, data: { blob: new Blob(['%PDF']), fileName: 'masked-lease-contract.pdf', pageCount: 1 } } };

  it('다시 읽은 글자에 개인정보가 없으면 NOT_FOUND', async () => {
    vi.mocked(readDocument).mockResolvedValueOnce({ ok: true, data: ocrDoc('임대인 [Landlord_B]') });
    const [r] = await doubleCheckPdfs(analysis, plan(), [pdfOk]);
    expect(r).toMatchObject({ documentId: 'DOC_A', documentType: 'LEASE_CONTRACT', status: CHECK_STATUS.NOT_FOUND });
  });

  it('OCR이 실패하면(LOW_CONFIDENCE) "괜찮다"가 아니라 확인 불가', async () => {
    vi.mocked(readDocument).mockResolvedValueOnce({ ok: false, error: { code: 'LOW_CONFIDENCE', message: 'x' } });
    const [r] = await doubleCheckPdfs(analysis, plan(), [pdfOk]);
    expect(r).toMatchObject({ status: CHECK_STATUS.UNVERIFIABLE, reason: 'LOW_CONFIDENCE' });
  });

  it('PDF를 만들지 못한 서류도 확인 불가로 둔다', async () => {
    const failed = { documentId: 'DOC_B', documentType: 'REGISTRY', result: { ok: false, error: { code: 'PDF_EXPORT_FAILED', message: 'x' } } };
    const [r] = await doubleCheckPdfs(analysis, plan(), [failed]);
    expect(r).toMatchObject({ status: CHECK_STATUS.UNVERIFIABLE, reason: 'PDF_EXPORT_FAILED' });
  });

  it('다른 서류의 개인정보와는 비교하지 않는다', async () => {
    vi.mocked(readDocument).mockResolvedValueOnce({ ok: true, data: ocrDoc('임대인 김철수') });
    const other = { ...pdfOk, documentId: 'DOC_OTHER' };
    const [r] = await doubleCheckPdfs(analysis, plan(), [other]);
    expect(r.status).toBe(CHECK_STATUS.NOT_FOUND);
  });
});
