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

  it('텍스트 레이어가 없는 스캔 PDF는 원본 buffer를 보존한 채 OCR 폴백과 줄별 confidence를 통해 IMAGE_PDF DocumentModel을 반환한다', async () => {
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
      text: '임대인 홍길동\n임차인 김철수 800101-1******',
      confidence: 0.88,
      width: 1190,
      height: 1684,
      blocks: [
        {
          text: '임대인 홍길동',
          confidence: 0.94,
          bbox: { x: 0.1, y: 0.2, width: 0.5, height: 0.03 },
        },
        {
          text: '임차인 김철수 800101-1******',
          confidence: 0.85,
          bbox: { x: 0.1, y: 0.25, width: 0.5, height: 0.03 },
        },
      ],
    });

    const r = await readDocument(file);

    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(renderSpy.mock.calls[0][0].byteLength).toBe(pdfBytes.byteLength);
    expect(ocrSpy).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.sourceType).toBe(SOURCE_TYPE.IMAGE_PDF);
      expect(r.data.pages).toHaveLength(1);
      expect(r.data.pages[0].blocks[0]).toMatchObject({
        blockId: 'p0_b0',
        text: '임대인 홍길동',
        bbox: { x: 0.1, y: 0.2, width: 0.5, height: 0.03 },
        confidence: 0.94,
      });
      expect(r.data.pages[0].blocks[1]).toMatchObject({
        blockId: 'p0_b1',
        text: '임차인 김철수 800101-1******',
        confidence: 0.85,
      });
    }
  });

  it('스캔 PDF에서 OCR 폴백이 실패하면 LOW_CONFIDENCE 오류를 반환한다', async () => {
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

  it('스캔 PDF나 이미지의 OCR 신뢰도가 0.6 미만이면 LOW_CONFIDENCE 오류를 반환한다', async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([595, 842]);
    const pdfBytes = await pdfDoc.save();
    const pdfFile = new File([pdfBytes], 'blurry-scan.pdf', { type: 'application/pdf' });

    vi.spyOn(pdfReader, 'renderPdfToImages').mockResolvedValue([
      {
        pageIndex: 0,
        buffer: new Uint8Array([1, 2, 3, 4]).buffer,
        width: 1190,
        height: 1684,
      },
    ]);

    vi.spyOn(ocrModule, 'recognizeImageText').mockResolvedValue({
      text: '주민번호 75O315-1234567',
      confidence: 0.45,
      width: 1190,
      height: 1684,
      blocks: [
        {
          text: '주민번호 75O315-1234567',
          confidence: 0.45,
          bbox: { x: 0.1, y: 0.2, width: 0.5, height: 0.03 },
        },
      ],
    });

    const pdfRes = await readDocument(pdfFile);
    expect(pdfRes.ok).toBe(false);
    if (!pdfRes.ok) {
      expect(pdfRes.error.code).toBe(ERROR_CODE.LOW_CONFIDENCE);
    }

    const imgFile = new File([new Uint8Array([1, 2, 3])], 'blurry.png', { type: 'image/png' });
    const imgRes = await readDocument(imgFile);
    expect(imgRes.ok).toBe(false);
    if (!imgRes.ok) {
      expect(imgRes.error.code).toBe(ERROR_CODE.LOW_CONFIDENCE);
    }
  });

  it('페이지 전체 신뢰도가 0.6 이상이어도 숫자가 포함된 줄의 신뢰도가 0.8 미만이면 LOW_CONFIDENCE 오류를 반환한다', async () => {
    const imgFile = new File([new Uint8Array([1, 2, 3])], 'partial-id.png', { type: 'image/png' });

    vi.spyOn(ocrModule, 'recognizeImageText').mockResolvedValue({
      text: '임대인 홍길동\n990505-5****+*',
      confidence: 0.89,
      width: 1000,
      height: 1414,
      blocks: [
        {
          text: '임대인 홍길동',
          confidence: 0.96,
          bbox: { x: 0.1, y: 0.2, width: 0.5, height: 0.03 },
        },
        {
          text: '990505-5****+*',
          confidence: 0.79,
          bbox: { x: 0.1, y: 0.25, width: 0.5, height: 0.03 },
        },
      ],
    });

    const r = await readDocument(imgFile);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe(ERROR_CODE.LOW_CONFIDENCE);
    }
  });

  it('OCR 결과에 줄 위치(bbox)가 없으면 전체 페이지(0,0,1,1) 대신 LOW_CONFIDENCE 오류를 반환한다', async () => {
    const imgFile = new File([new Uint8Array([1, 2, 3])], 'no-boxes.png', { type: 'image/png' });

    vi.spyOn(ocrModule, 'recognizeImageText').mockResolvedValue({
      text: '소유자 김철수',
      confidence: 0.92,
      width: 1000,
      height: 1414,
      blocks: [],
    });

    const r = await readDocument(imgFile);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe(ERROR_CODE.LOW_CONFIDENCE);
    }
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