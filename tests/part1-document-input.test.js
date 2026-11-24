import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { ERROR_CODE, SOURCE_TYPE } from '../src/shared/document-model.js';
import * as pdfReader from '../src/features/document-input/pdf-reader.js';
import * as ocrModule from '../src/features/document-input/ocr.js';
import { readDocument, isSupportedFile } from '../src/features/document-input/index.js';

const mockRecognize = vi.fn();
const mockSetParameters = vi.fn().mockResolvedValue(undefined);
const mockGetDocument = vi.fn();
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getDocument: (...args) => (mockGetDocument.getMockImplementation() ? mockGetDocument(...args) : actual.getDocument(...args)),
  };
});
vi.mock('tesseract.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createWorker: vi.fn(async () => ({ recognize: mockRecognize, setParameters: mockSetParameters })) };
});

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
  it('손상된 PDF 파일은 PDF_READ_FAILED 에러를 반환한다', async () => {
    const bytes = new TextEncoder().encode('CORRUPTED-NON-PDF-BINARY-CONTENT-12345');
    const r = await readDocument(new File([bytes], 'damaged.pdf', { type: 'application/pdf' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(ERROR_CODE.PDF_READ_FAILED);
  });

  it('사진(JPG/PNG) OCR 결과는 0~1 범위로 정규화된 bbox 좌표를 반환한다', async () => {
    const orig = globalThis.createImageBitmap;
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ width: 1000, height: 1414, close: vi.fn() });
    mockRecognize.mockResolvedValueOnce({
      data: {
        text: '임대차계약서\n보증금 100,000,000원',
        confidence: 93,
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  { text: '임대차계약서', confidence: 95, bbox: { x0: 120, y0: 141, x1: 620, y1: 198 } },
                  { text: '보증금 100,000,000원', confidence: 91, bbox: { x0: 100, y0: 283, x1: 750, y1: 325 } },
                ],
              },
            ],
          },
        ],
      },
    });
    try {
      const r = await readDocument(new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'photo.jpg', { type: 'image/jpeg' }));
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.sourceType).toBe(SOURCE_TYPE.IMAGE);
        for (const b of r.data.pages[0].blocks) {
          expect(b.bbox.x).toBeGreaterThanOrEqual(0); expect(b.bbox.x).toBeLessThanOrEqual(1);
          expect(b.bbox.y).toBeGreaterThanOrEqual(0); expect(b.bbox.y).toBeLessThanOrEqual(1);
          expect(b.bbox.width).toBeGreaterThan(0); expect(b.bbox.width).toBeLessThanOrEqual(1);
          expect(b.bbox.height).toBeGreaterThan(0); expect(b.bbox.height).toBeLessThanOrEqual(1);
        }
        expect(r.data.pages[0].blocks[0].bbox).toEqual({ x: 0.12, y: 0.0997, width: 0.5, height: 0.0403 });
      }
    } finally { globalThis.createImageBitmap = orig; }
  });

  it('readPdfText() replaces U+0000-U+001F control characters with spaces before building blocks', async () => {
    mockGetDocument.mockImplementationOnce(() => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getViewport: () => ({ width: 595, height: 842, transform: [1, 0, 0, 1, 0, 0] }),
          getTextContent: async () => ({
            items: [
              {
                str: '2026\uB144\u000111\uC6D4\u00011\uC77C\u0000\u001f\uACC4\uC57D\uCCB4\uACB0',
                transform: [1, 0, 0, 12, 72, 120],
                width: 180,
                height: 12,
              },
            ],
          }),
        }),
      }),
      destroy: vi.fn().mockResolvedValue(undefined),
    }));

    try {
      const res = await pdfReader.readPdfText(new Uint8Array([1, 2, 3]).buffer);
      expect(res.textPages[0]).toBe('2026\uB144 11\uC6D4 1\uC77C \uACC4\uC57D\uCCB4\uACB0');
      expect(res.pages[0].blocks[0].text).toBe('2026\uB144 11\uC6D4 1\uC77C \uACC4\uC57D\uCCB4\uACB0');
    } finally {
      mockGetDocument.mockReset();
    }
  });
});

describe('PART 1 overlap spacing', () => {
  it('inserts a space when text items on the same line overlap or start at/before previous item end, while preserving minor glyph kerning', async () => {
    mockGetDocument.mockImplementationOnce(() => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getViewport: () => ({ width: 595, height: 842, transform: [1, 0, 0, -1, 0, 842] }),
          getTextContent: async () => ({
            items: [
              { str: '010-1111-2222', width: 80, height: 12, transform: [12, 0, 0, 12, 100, 700] },
              { str: '010-3333-4444', width: 80, height: 12, transform: [12, 0, 0, 12, 100, 700] },
              { str: '900101-1234567', width: 90, height: 12, transform: [12, 0, 0, 12, 100, 660] },
              { str: '800202-2345678', width: 90, height: 12, transform: [12, 0, 0, 12, 140, 660] },
              { str: '\uC784', width: 12, height: 12, transform: [12, 0, 0, 12, 100, 620] },
              { str: '\uB300', width: 12, height: 12, transform: [12, 0, 0, 12, 111.5, 620] },
              { str: '\uC778', width: 12, height: 12, transform: [12, 0, 0, 12, 123, 620] },
            ],
          }),
        }),
      }),
      destroy: async () => {},
    }));

    const dummyPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer;
    const res = await pdfReader.readPdfText(dummyPdf);

    expect(res.pageCount).toBe(1);
    expect(res.textPages[0]).toContain('010-1111-2222 010-3333-4444');
    expect(res.textPages[0]).toContain('900101-1234567 800202-2345678');
    expect(res.textPages[0]).toContain('\uC784\uB300\uC778');
  });
});

describe('PART 1 local CMap, standard font, wasm, and ICC options', () => {
  it('passes local cMapUrl, cMapPacked, standardFontDataUrl, wasmUrl, and iccUrl to pdf.js getDocument', async () => {
    mockGetDocument.mockImplementationOnce((params) => {
      expect(params.cMapUrl).toMatch(/cmaps\/$/);
      expect(params.cMapPacked).toBe(true);
      expect(params.standardFontDataUrl).toMatch(/standard_fonts\/$/);
      expect(params.wasmUrl).toMatch(/wasm\/$/);
      expect(params.iccUrl).toMatch(/iccs\/$/);

      return {
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({
            getViewport: () => ({ width: 595, height: 842, transform: [1, 0, 0, -1, 0, 842] }),
            getTextContent: async () => ({ items: [] }),
          }),
        }),
        destroy: async () => {},
      };
    });

    const dummyPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer;
    const res = await pdfReader.readPdfText(dummyPdf);
    expect(res.pageCount).toBe(1);
  });
});

describe('PART 1 block spans for granular PDF redaction', () => {
  it('builds sorted, non-overlapping spans for multi-column table rows where each slice matches its item text', async () => {
    mockGetDocument.mockImplementationOnce(() => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getViewport: () => ({ width: 595, height: 842, transform: [1, 0, 0, -1, 0, 842] }),
          getTextContent: async () => ({
            items: [
              { str: '소유권이전(신탁)', width: 90, height: 12, transform: [12, 0, 0, 12, 50, 700] },
              { str: '2024년 5월 10일', width: 85, height: 12, transform: [12, 0, 0, 12, 200, 700] },
              { str: '수탁자 한국자산신탁(주)', width: 130, height: 12, transform: [12, 0, 0, 12, 340, 700] },
            ],
          }),
        }),
      }),
      destroy: async () => {},
    }));

    const dummyPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer;
    const res = await pdfReader.readPdfText(dummyPdf);
    const block = res.pages[0].blocks[0];

    expect(block.text).toBe('소유권이전(신탁) 2024년 5월 10일 수탁자 한국자산신탁(주)');
    expect(block.spans).toHaveLength(3);

    const expectedTexts = ['소유권이전(신탁)', '2024년 5월 10일', '수탁자 한국자산신탁(주)'];
    block.spans.forEach((span, idx) => {
      expect(block.text.slice(span.start, span.end)).toBe(expectedTexts[idx]);
      if (idx > 0) {
        expect(span.start).toBeGreaterThan(block.spans[idx - 1].end);
      }
      expect(span.bbox.x).toBeGreaterThanOrEqual(block.bbox.x);
      expect(span.bbox.y).toBeGreaterThanOrEqual(block.bbox.y);
      expect(Number((span.bbox.x + span.bbox.width).toFixed(4))).toBeLessThanOrEqual(Number((block.bbox.x + block.bbox.width).toFixed(4)));
      expect(Number((span.bbox.y + span.bbox.height).toFixed(4))).toBeLessThanOrEqual(Number((block.bbox.y + block.bbox.height).toFixed(4)));
    });

    // Separate columns have distinct horizontal ranges narrower than the full row
    expect(block.spans[0].bbox.x + block.spans[0].bbox.width).toBeLessThan(block.spans[2].bbox.x);
  });

  it('excludes overlap-inserted spaces from spans so adjacent overlapping fields remain separate spans', async () => {
    mockGetDocument.mockImplementationOnce(() => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getViewport: () => ({ width: 595, height: 842, transform: [1, 0, 0, -1, 0, 842] }),
          getTextContent: async () => ({
            items: [
              { str: 'FIELD-ALPHA-01', width: 90, height: 12, transform: [12, 0, 0, 12, 100, 660] },
              { str: 'FIELD-BRAVO-02', width: 90, height: 12, transform: [12, 0, 0, 12, 140, 660] },
            ],
          }),
        }),
      }),
      destroy: async () => {},
    }));

    const dummyPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer;
    const res = await pdfReader.readPdfText(dummyPdf);
    const block = res.pages[0].blocks[0];

    expect(block.text).toBe('FIELD-ALPHA-01 FIELD-BRAVO-02');
    expect(block.spans).toHaveLength(2);
    expect(block.spans[0].start).toBe(0);
    expect(block.spans[0].end).toBe(14);
    expect(block.text.slice(block.spans[0].start, block.spans[0].end)).toBe('FIELD-ALPHA-01');

    // Index 14 is the inserted space and belongs to no span
    expect(block.text[14]).toBe(' ');
    expect(block.spans[1].start).toBe(15);
    expect(block.spans[1].end).toBe(29);
    expect(block.text.slice(block.spans[1].start, block.spans[1].end)).toBe('FIELD-BRAVO-02');
  });

  it('keeps span offsets aligned after control-character replacement and whitespace collapsing', async () => {
    mockGetDocument.mockImplementationOnce(() => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getViewport: () => ({ width: 595, height: 842, transform: [1, 0, 0, 1, 0, 0] }),
          getTextContent: async () => ({
            items: [
              {
                str: '  임대인    홍길동  ',
                transform: [1, 0, 0, 12, 72, 120],
                width: 110,
                height: 12,
              },
              {
                str: '  REG-2026-9999   ',
                transform: [1, 0, 0, 12, 220, 120],
                width: 120,
                height: 12,
              },
            ],
          }),
        }),
      }),
      destroy: async () => {},
    }));

    const dummyPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer;
    const res = await pdfReader.readPdfText(dummyPdf);
    const block = res.pages[0].blocks[0];

    expect(block.text).toBe('임대인 홍길동 REG-2026-9999');
    expect(block.spans).toHaveLength(2);
    expect(block.text.slice(block.spans[0].start, block.spans[0].end)).toBe('임대인 홍길동');
    expect(block.text.slice(block.spans[1].start, block.spans[1].end)).toBe('REG-2026-9999');
    expect(block.spans[0].end + 1).toBe(block.spans[1].start);
  });

  it('keeps per-glyph bold font characters together without splitting numbers like "47-12"', async () => {
    mockGetDocument.mockImplementationOnce(() => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getViewport: () => ({ width: 595, height: 842, transform: [1, 0, 0, -1, 0, 842] }),
          getTextContent: async () => ({
            items: [
              // Bold BatangChe per-glyph output with ~2.5px advance gap on 10pt font
              { str: '4', width: 5, height: 10, transform: [10, 0, 0, 10, 100, 700] },
              { str: '7', width: 5, height: 10, transform: [10, 0, 0, 10, 107.5, 700] },
              { str: '-', width: 5, height: 10, transform: [10, 0, 0, 10, 115, 700] },
              { str: '1', width: 5, height: 10, transform: [10, 0, 0, 10, 122.5, 700] },
              { str: '2', width: 5, height: 10, transform: [10, 0, 0, 10, 130, 700] },
              // Synthetic double-strike bold at identical X on next line
              { str: '4', width: 6, height: 10, transform: [10, 0, 0, 10, 100, 660] },
              { str: '4', width: 6, height: 10, transform: [10, 0, 0, 10, 100.3, 660] },
              { str: '7', width: 6, height: 10, transform: [10, 0, 0, 10, 106, 660] },
              { str: '7', width: 6, height: 10, transform: [10, 0, 0, 10, 106.3, 660] },
            ],
          }),
        }),
      }),
      destroy: async () => {},
    }));

    const dummyPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer;
    const res = await pdfReader.readPdfText(dummyPdf);
    expect(res.pages[0].blocks[0].text).toBe('47-12');
    expect(res.pages[0].blocks[0].spans).toHaveLength(5);
    expect(res.pages[0].blocks[1].text).toBe('47');
  });

  it('recovers skipped dense table rows via PSM 4 + PSM 6 vertical gap fallback', async () => {
    const imgFile = new File([new Uint8Array([1, 2, 3, 4])], 'dense-lease-table.png', {
      type: 'image/png',
    });

    const spy = vi.spyOn(ocrModule, 'recognizeImageText').mockImplementationOnce(async () => ({
      text: "1. 계약 당사자\\n임대사업자 성명(법인명) 전우치 (서명 또는 인)\\n임차인 성명(법인명) SATO YUKI (서명 또는 인)",
      confidence: 0.85,
      width: 1000,
      height: 1414,
      blocks: [
        {
          text: "1. 계약 당사자",
          confidence: 0.95,
          bbox: { x: 0.1, y: 0.14, width: 0.3, height: 0.02 },
        },
        {
          text: "임대사업자 성명(법인명) 전우치 (서명 또는 인)",
          confidence: 0.82,
          bbox: { x: 0.1, y: 0.17, width: 0.8, height: 0.02 },
        },
        {
          text: "임차인 성명(법인명) SATO YUKI (서명 또는 인)",
          confidence: 0.81,
          bbox: { x: 0.1, y: 0.23, width: 0.8, height: 0.02 },
        },
      ],
    }));

    const res = await readDocument(imgFile, { allowLowConfidence: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.pages[0].blocks.map((b) => b.text)).toContain(
        "임대사업자 성명(법인명) 전우치 (서명 또는 인)"
      );
      expect(res.data.pages[0].blocks.map((b) => b.text)).toContain(
        "임차인 성명(법인명) SATO YUKI (서명 또는 인)"
      );
    }
    spy.mockRestore();
  });
});

describe('PART 1 scanned PDF page progress callback', () => {
  it('calls options.onPage once per page before OCR with pageIndex and pageCount', async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([595, 842]);
    pdfDoc.addPage([595, 842]);
    pdfDoc.addPage([595, 842]);
    const pdfBytes = await pdfDoc.save();
    const file = new File([pdfBytes], 'scanned-lease.pdf', { type: 'application/pdf' });

    vi.spyOn(pdfReader, 'renderPdfToImages').mockResolvedValue([
      { pageIndex: 0, buffer: new Uint8Array([1, 2, 3, 4]).buffer, width: 1190, height: 1684 },
      { pageIndex: 1, buffer: new Uint8Array([1, 2, 3, 4]).buffer, width: 1190, height: 1684 },
      { pageIndex: 2, buffer: new Uint8Array([1, 2, 3, 4]).buffer, width: 1190, height: 1684 },
    ]);

    const events = [];
    vi.spyOn(ocrModule, 'recognizeImageText').mockImplementation(async () => {
      events.push('ocr');
      return {
        text: '임대인 홍길동',
        confidence: 0.92,
        width: 1190,
        height: 1684,
        blocks: [
          {
            text: '임대인 홍길동',
            confidence: 0.94,
            bbox: { x: 0.1, y: 0.2, width: 0.5, height: 0.03 },
          },
        ],
      };
    });

    const onPage = vi.fn((info) => {
      events.push(`page:${info.pageIndex}/${info.pageCount}`);
    });

    const r = await readDocument(file, { onPage });
    expect(r.ok).toBe(true);
    expect(r.data.sourceType).toBe(SOURCE_TYPE.IMAGE_PDF);
    expect(onPage).toHaveBeenCalledTimes(3);
    expect(onPage).toHaveBeenNthCalledWith(1, { pageIndex: 0, pageCount: 3 });
    expect(onPage).toHaveBeenNthCalledWith(2, { pageIndex: 1, pageCount: 3 });
    expect(onPage).toHaveBeenNthCalledWith(3, { pageIndex: 2, pageCount: 3 });
    expect(events).toEqual([
      'page:0/3',
      'ocr',
      'page:1/3',
      'ocr',
      'page:2/3',
      'ocr',
    ]);
  });

  it('continues OCR if options.onPage throws', async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([595, 842]);
    const pdfBytes = await pdfDoc.save();
    const file = new File([pdfBytes], 'scanned-lease.pdf', { type: 'application/pdf' });

    vi.spyOn(pdfReader, 'renderPdfToImages').mockResolvedValue([
      { pageIndex: 0, buffer: new Uint8Array([1, 2, 3, 4]).buffer, width: 1190, height: 1684 },
    ]);
    vi.spyOn(ocrModule, 'recognizeImageText').mockResolvedValue({
      text: '임대인 홍길동',
      confidence: 0.92,
      width: 1190,
      height: 1684,
      blocks: [
        {
          text: '임대인 홍길동',
          confidence: 0.94,
          bbox: { x: 0.1, y: 0.2, width: 0.5, height: 0.03 },
        },
      ],
    });

    const r = await readDocument(file, {
      onPage: () => {
        throw new Error('progress UI failed');
      },
    });
    expect(r.ok).toBe(true);
  });
});

describe('PART 1 OCR interword spacing and whitespace normalization', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockRecognize.mockReset();
    mockSetParameters.mockClear();
  });

  it('restores preserve_interword_spaces to 1 (never 0) after lease table recovery and collapses runs of spaces', async () => {
    mockRecognize
      .mockResolvedValueOnce({
        data: {
          confidence: 88,
          text: '',
          blocks: [
            {
              paragraphs: [
                {
                  lines: [
                    {
                      text: '1.   \uacc4\uc57d   \ub2f9\uc0ac\uc790',
                      confidence: 92,
                      bbox: { x0: 100, y0: 100, x1: 400, y1: 120 },
                    },
                    {
                      text: '\uc784\ucc28\uc778   \uae40\ucca0\uc218',
                      confidence: 90,
                      bbox: { x0: 100, y0: 250, x1: 400, y1: 270 },
                    },
                  ],
                },
              ],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          confidence: 88,
          text: '',
          blocks: [
            {
              paragraphs: [
                {
                  lines: [
                    {
                      text: '\uc784\ub300\uc0ac\uc5c5\uc790   \ud64d\uae38\ub3d9',
                      confidence: 91,
                      bbox: { x0: 100, y0: 175, x1: 400, y1: 195 },
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({
        width: 1000,
        height: 1000,
        close: () => {},
      })
    );

    try {
      const res = await ocrModule.recognizeImageText(new Uint8Array([1, 2, 3, 4]).buffer);
      expect(res.blocks.map((b) => b.text)).toEqual([
        '1. \uacc4\uc57d \ub2f9\uc0ac\uc790',
        '\uc784\ub300\uc0ac\uc5c5\uc790 \ud64d\uae38\ub3d9',
        '\uc784\ucc28\uc778 \uae40\ucca0\uc218',
      ]);
      expect(mockSetParameters).toHaveBeenCalledTimes(2);
      expect(mockSetParameters).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ preserve_interword_spaces: '1' })
      );
      expect(mockSetParameters).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ preserve_interword_spaces: '1' })
      );
      for (const [params] of mockSetParameters.mock.calls) {
        expect(params.preserve_interword_spaces).not.toBe('0');
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('sets preserve_interword_spaces to 1 on initial worker creation even without recovery pass (e.g., registry docs)', async () => {
    vi.resetModules();
    mockSetParameters.mockClear();
    mockRecognize.mockReset();

    mockRecognize.mockResolvedValueOnce({
      data: {
        confidence: 92,
        text: '',
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    text: '?????????',
                    confidence: 94,
                    bbox: { x0: 100, y0: 100, x1: 400, y1: 120 },
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({
        width: 1000,
        height: 1000,
        close: () => {},
      })
    );

    try {
      const freshOcr = await import('../src/features/document-input/ocr.js');
      const res = await freshOcr.recognizeImageText(new Uint8Array([1, 2, 3, 4]).buffer);
      expect(res.blocks.map((b) => b.text)).toEqual(['?????????']);
      expect(mockSetParameters).toHaveBeenCalledTimes(1);
      expect(mockSetParameters).toHaveBeenCalledWith({ preserve_interword_spaces: '1' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
