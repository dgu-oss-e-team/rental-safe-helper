import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { ERROR_CODE, SOURCE_TYPE } from '../src/shared/document-model.js';
import * as pdfReader from '../src/features/document-input/pdf-reader.js';
import * as ocrModule from '../src/features/document-input/ocr.js';
import { readDocument, isSupportedFile } from '../src/features/document-input/index.js';

describe('PART 1 readDocument()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('PDF를 받으면 DocumentModel 형식으로 돌려준다', async () => {
    const r = await readDocument(new File([''], 'sample-lease.pdf', { type: 'application/pdf' }));
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ documentId: expect.any(String), sourceType: expect.any(String) });
    expect(r.data.pages[0].blocks[0]).toHaveProperty('bbox');
  });

  it('지원하지 않는 파일은 UNSUPPORTED_FILE 오류를 돌려준다', async () => {
    const r = await readDocument(new File([''], 'notes.txt', { type: 'text/plain' }));
    expect(r).toEqual({ ok: false, error: { code: 'UNSUPPORTED_FILE', message: expect.any(String) } });
  });

  it('isSupportedFile은 PDF·JPG·PNG만 허용한다', () => {
    expect(isSupportedFile({ name: 'a.PNG' })).toBe(true);
    expect(isSupportedFile({ name: 'a.hwp' })).toBe(false);
  });

  it('텍스트 레이어가 없는 스캔 PDF는 OCR 폴백을 통해 IMAGE_PDF DocumentModel을 반환한다', async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([595, 842]);
    const pdfBytes = await pdfDoc.save();
    const file = new File([pdfBytes], 'scanned-lease.pdf', { type: 'application/pdf' });

    const renderSpy = vi.spyOn(pdfReader, 'renderPdfToImages').mockResolvedValue([
      {
        pageIndex: 0,
        buffer: new Uint8Array([1, 2, 3, 4]).buffer,
        width: 1190,
        height: 1684,
      },
    ]);

    const ocrSpy = vi.spyOn(ocrModule, 'recognizeImageText').mockResolvedValue({
      text: '임대인 홍길동 800101-1234567',
      confidence: 0.91,
      width: 1190,
      height: 1684,
      blocks: [
        {
          text: '임대인 홍길동 800101-1234567',
          bbox: { x: 0.1, y: 0.2, width: 0.5, height: 0.03 },
        },
      ],
    });

    const r = await readDocument(file);

    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(ocrSpy).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.sourceType).toBe(SOURCE_TYPE.IMAGE_PDF);
      expect(r.data.pages).toHaveLength(1);
      expect(r.data.pages[0].blocks[0]).toMatchObject({
        blockId: 'p0_b0',
        text: '임대인 홍길동 800101-1234567',
        bbox: { x: 0.1, y: 0.2, width: 0.5, height: 0.03 },
        confidence: 0.91,
      });
    }
  });

  it('스캔 PDF에서 OCR 폴백이 실패하거나 텍스트를 찾지 못하면 LOW_CONFIDENCE 오류를 반환한다', async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([595, 842]);
    const pdfBytes = await pdfDoc.save();
    const file = new File([pdfBytes], 'blank-scan.pdf', { type: 'application/pdf' });

    vi.spyOn(pdfReader, 'renderPdfToImages').mockRejectedValue(new Error('CANVAS_UNAVAILABLE'));

    const r = await readDocument(file);

    expect(r).toEqual({
      ok: false,
      error: {
        code: ERROR_CODE.LOW_CONFIDENCE,
        message: 'No text found in this PDF.',
      },
    });
  });

  it('임베디드 텍스트가 있는 일반 PDF는 OCR 폴백 없이 TEXT_PDF로 반환한다', async () => {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);
    page.drawText('Lease Contract 2026', { x: 50, y: 750, size: 14 });
    const pdfBytes = await pdfDoc.save();
    const file = new File([pdfBytes], 'digital-lease.pdf', { type: 'application/pdf' });

    const renderSpy = vi.spyOn(pdfReader, 'renderPdfToImages');
    const ocrSpy = vi.spyOn(ocrModule, 'recognizeImageText');

    const r = await readDocument(file);

    expect(renderSpy).not.toHaveBeenCalled();
    expect(ocrSpy).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.sourceType).toBe(SOURCE_TYPE.TEXT_PDF);
      expect(r.data.pages[0].blocks[0].text).toContain('Lease Contract 2026');
    }
  });
});
