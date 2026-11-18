// PART 5. 마스킹 PDF를 만들고 검증할 때도 PART 1과 같은 pdf.js 설정(CMap·표준 글꼴·wasm·ICC)으로 연다. (#214)
// pdf.js의 getDocument를 감싸서 넘어간 설정만 기록하고, 실제 동작은 원래 함수가 한다. 가짜 PDF만 사용.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';

const calls = vi.hoisted(() => /** @type {any[]} */ ([]));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', async (importOriginal) => {
  const original = /** @type {any} */ (await importOriginal());
  return {
    ...original,
    getDocument: (/** @type {any} */ params) => {
      calls.push(params);
      return original.getDocument(params);
    },
  };
});

const { buildPdfDocumentParams } = await import('../src/features/document-input/pdf-reader.js');
const { validateMaskedPdf } = await import('../src/features/pdf-export/validate-pdf.js');
const { renderPdfPages } = await import('../src/features/pdf-export/render-pages.js');

/** 글자도 문서 정보도 없는 한 쪽짜리 가짜 PDF */
const blankPdf = async () => {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.addPage([200, 200]);
  return pdf.save();
};

/** data를 뺀 설정 (경로만 비교) */
const withoutData = (/** @type {any} */ params) => {
  const { data, ...rest } = params;
  return rest;
};

describe('PART 5 pdf.js 설정이 PART 1과 같다 (#214)', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('validateMaskedPdf()는 PART 1과 같은 CMap·글꼴·wasm·ICC 설정으로 연다', async () => {
    const bytes = await blankPdf();
    const r = await validateMaskedPdf(bytes);
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(withoutData(calls[0])).toEqual(withoutData(buildPdfDocumentParams(new ArrayBuffer(0))));
    expect(calls[0]).toMatchObject({ cMapPacked: true });
    expect(calls[0].cMapUrl).toMatch(/cmaps\/$/);
    expect(calls[0].standardFontDataUrl).toMatch(/standard_fonts\/$/);
  });

  it('validateMaskedPdf()는 넘겨받은 바이트를 비우지 않는다 (복사본을 넘긴다)', async () => {
    const bytes = await blankPdf();
    const length = bytes.length;
    await validateMaskedPdf(bytes);
    expect(bytes.length).toBe(length);
    expect(calls[0].data).not.toBe(bytes);
  });

  it('renderPdfPages()도 같은 설정으로 연다 (그리기는 브라우저 전용이라 여는 부분만 본다)', async () => {
    const bytes = await blankPdf();
    await renderPdfPages(bytes.slice().buffer).catch(() => {});
    expect(calls).toHaveLength(1);
    expect(withoutData(calls[0])).toEqual(withoutData(buildPdfDocumentParams(new ArrayBuffer(0))));
  });
});
