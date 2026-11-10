import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { toPixelRect, planRedactions } from '../src/features/pdf-export/apply-redactions.js';
import { buildImageOnlyPdf } from '../src/features/pdf-export/export-pdf.js';
import { validateMaskedPdf } from '../src/features/pdf-export/validate-pdf.js';
import { exportMaskedPDF, pagesWithText } from '../src/features/pdf-export/index.js';
import { mockLeaseDocument } from '../src/shared/mock-data.js';
import { toPixelRect, planRedactions, fitFontSize } from '../src/features/pdf-export/apply-redactions.js';
// 1×1 흰색 PNG (테스트용 페이지 이미지)
const TINY_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

const page = { documentId: 'DOC_A', pageIndex: 0, width: 1000, height: 2000 };
const item = (over) => ({
  findingId: 'F1',
  action: 'REDACT',
  replacement: '[REDACTED]',
  documentId: 'DOC_A',
  pageIndex: 0,
  bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.05 },
  ...over,
});

describe('PART 5 좌표 변환 (toPixelRect)', () => {
  it('0~1 좌표를 픽셀로 바꾸고 여유를 조금 더한다', () => {
    const r = toPixelRect({ x: 0.1, y: 0.2, width: 0.3, height: 0.05 }, 1000, 2000);
    expect(r.x).toBeLessThanOrEqual(100);
    expect(r.y).toBeLessThanOrEqual(400);
    expect(r.x + r.width).toBeGreaterThanOrEqual(400);
    expect(r.y + r.height).toBeGreaterThanOrEqual(500);
  });

  it('페이지 밖으로 나가지 않는다', () => {
    const r = toPixelRect({ x: 0, y: 0, width: 1, height: 1 }, 1000, 2000);
    expect(r).toEqual({ x: 0, y: 0, width: 1000, height: 2000 });
  });
});

describe('PART 5 그릴 목록 (planRedactions)', () => {
  it('검은 상자를 먼저, 가명 글자를 나중에 그린다 (겹쳐도 가명이 보이게)', () => {
    const plan = {
      purpose: 'FRAUD_CHECK',
      items: [
        item({ findingId: 'NAME', action: 'REPLACE', replacement: '[Owner_A]' }),
        item({ findingId: 'RRN', action: 'REDACT' }),
      ],
    };
    const list = planRedactions(plan, page);
    expect(list.map((d) => d.kind)).toEqual(['box', 'label']);
    expect(list[1].text).toBe('[Owner_A]');
  });

  it('다른 문서·다른 페이지·KEEP·잘못된 좌표는 그리지 않는다', () => {
    const plan = {
      purpose: 'FRAUD_CHECK',
      items: [
        item({ documentId: 'DOC_B' }),
        item({ pageIndex: 1 }),
        item({ action: 'KEEP', replacement: null }),
        item({ bbox: { x: 120, y: 0, width: 10, height: 10 } }),
        item({ findingId: 'OK' }),
      ],
    };
    expect(planRedactions(plan, page)).toHaveLength(1);
  });
});

describe('PART 5 새 PDF 만들기와 검증', () => {
  it('이미지만 들어간 PDF는 글자가 없고 문서 정보가 비어 있다', async () => {
    const bytes = await buildImageOnlyPdf([{ bytes: TINY_PNG, format: 'png', widthPt: 595, heightPt: 842 }]);
    const check = await validateMaskedPdf(bytes);
    expect(check).toEqual({ ok: true, data: { pageCount: 1 } });
  });

  it('글자가 남은 PDF는 검증에서 실패한다 (검증이 실제로 동작하는지 확인)', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([595, 842]).drawText('800101-1234567', { x: 50, y: 700, font, size: 12 });
    const check = await validateMaskedPdf(await pdf.save());
    expect(check).toMatchObject({ ok: false, error: { code: 'PDF_EXPORT_FAILED' } });
    expect(check.error.message).not.toContain('800101'); // 오류 메시지에 실제 값이 들어가지 않는다
  });

  it('문서 정보가 남은 PDF도 검증에서 실패한다', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([595, 842]);
    pdf.setAuthor('Kim Cheolsu');
    const check = await validateMaskedPdf(await pdf.save());
    expect(check).toMatchObject({ ok: false, error: { code: 'PDF_EXPORT_FAILED' } });
  });
});

describe('PART 5 exportMaskedPDF() 안전장치', () => {
  const plan = { purpose: 'FRAUD_CHECK', items: [] };

  it('글자를 하나도 읽지 못한 문서는 PDF를 만들지 않는다 (LOW_CONFIDENCE)', async () => {
    const scanned = structuredClone(mockLeaseDocument);
    scanned.pages[0].blocks = [{ blockId: 'B', text: '  ', bbox: { x: 0, y: 0, width: 1, height: 1 }, confidence: null }];
    const r = await exportMaskedPDF(scanned, plan);
    expect(r).toMatchObject({ ok: false, error: { code: 'LOW_CONFIDENCE' } });
  });

  it('좌표가 규칙을 벗어나면 COORDINATE_INVALID', async () => {
    const bad = { purpose: 'FRAUD_CHECK', items: [item({ bbox: { x: 100, y: 0, width: 10, height: 10 } })] };
    const r = await exportMaskedPDF(structuredClone(mockLeaseDocument), bad);
    expect(r).toMatchObject({ ok: false, error: { code: 'COORDINATE_INVALID' } });
  });

  it('그릴 수 없는 환경(캔버스 없음)에서도 오류를 던지지 않고 PDF_EXPORT_FAILED를 돌려준다', async () => {
    const r = await exportMaskedPDF(structuredClone(mockLeaseDocument), plan);
    expect(r).toMatchObject({ ok: false, error: { code: 'PDF_EXPORT_FAILED' } });
  });

  it('pagesWithText()는 글자가 있는 페이지만 돌려준다', () => {
    expect([...pagesWithText(mockLeaseDocument)]).toEqual([0]);
  });
});

describe('PART 5 가명 글자 크기 (fitFontSize)', () => {
  it('넓은 상자는 높이 기준(70%)으로 정한다', () => {
    expect(fitFontSize(5, { width: 1000, height: 40 })).toBe(28);
  });

  it('좁은 상자는 글자 길이에 맞게 줄인다 (눌리지 않게)', () => {
    // 1px당 길이 8 → 너비 100에 맞추려면 약 11px
    const size = fitFontSize(8, { width: 100, height: 40 });
    expect(size).toBeLessThan(28);
    expect(size * 8).toBeLessThanOrEqual(100);
  });

  it('상자가 낮으면 10px보다 작아져도 상자 밖으로 나가지 않는다', () => {
    expect(fitFontSize(5, { width: 1000, height: 9 })).toBeLessThanOrEqual(9 * 0.7);
  });

  it('너무 작아지면 0 → 글자 없이 상자만', () => {
    expect(fitFontSize(20, { width: 40, height: 8 })).toBe(0);
  });
});