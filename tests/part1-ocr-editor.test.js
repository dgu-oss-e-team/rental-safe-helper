import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DOCUMENT_TYPE, SOURCE_TYPE } from '../src/shared/document-model.js';
import * as ocrModule from '../src/features/document-input/ocr.js';
import * as pdfReader from '../src/features/document-input/pdf-reader.js';
import {
  readDocument,
  renderOcrEditor,
  isLowConfidenceBlock,
} from '../src/features/document-input/index.js';

function createMiniDom() {
  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.attributes = {};
      this.children = [];
      this.listeners = {};
      this.value = '';
      this.hidden = false;
      this.style = {};
      this._className = '';
      this.classList = {
        add: (...names) => {
          const cur = new Set(this._className.split(/\s+/).filter(Boolean));
          names.forEach((n) => cur.add(n));
          this._className = Array.from(cur).join(' ');
        },
        contains: (name) => this._className.split(/\s+/).includes(name),
      };
    }

    get className() {
      return this._className;
    }

    set className(val) {
      this._className = String(val || '');
    }

    setAttribute(k, v) {
      this.attributes[k] = v;
      if (k === 'class') this._className = String(v);
    }

    getAttribute(k) {
      return this.attributes[k] ?? null;
    }

    append(...nodes) {
      for (const n of nodes) {
        if (n !== null && n !== undefined && n !== false) {
          this.children.push(n);
        }
      }
    }

    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    }

    dispatchEvent(evt) {
      for (const fn of this.listeners[evt.type] ?? []) {
        fn(evt);
      }
      return true;
    }

    click() {
      this.dispatchEvent({ type: 'click' });
    }

    get textContent() {
      return this.children
        .map((c) => (typeof c === 'string' ? c : c.textContent))
        .join('');
    }

    set textContent(val) {
      this.children = val === '' || val === null || val === undefined ? [] : [String(val)];
    }

    querySelectorAll(selector) {
      const results = [];
      const match = (node) => {
        if (!(node instanceof FakeElement)) return false;
        if (selector === 'button') return node.tagName === 'BUTTON';
        if (selector === 'img') return node.tagName === 'IMG';
        if (selector === 'textarea.ocr-input') {
          return node.tagName === 'TEXTAREA' && node.classList.contains('ocr-input');
        }
        if (selector === '.ocr-block-warn') {
          return node.classList.contains('ocr-block-warn');
        }
        if (selector === '.ocr-digit-hint') {
          return node.classList.contains('ocr-digit-hint');
        }
        if (selector === 'button.ocr-confirm-btn') {
          return node.tagName === 'BUTTON' && node.classList.contains('ocr-confirm-btn');
        }
        if (selector === 'button.ocr-reset-btn') {
          return node.tagName === 'BUTTON' && node.classList.contains('ocr-reset-btn');
        }
        return false;
      };
      const walk = (node) => {
        if (!(node instanceof FakeElement)) return;
        if (match(node)) results.push(node);
        node.children.forEach(walk);
      };
      walk(this);
      return results;
    }
  }

  return {
    createElement(tag) {
      return new FakeElement(tag);
    },
  };
}

function makeSampleOcrDoc() {
  return {
    documentId: 'doc-ocr-1',
    documentType: DOCUMENT_TYPE.LEASE_CONTRACT,
    sourceType: SOURCE_TYPE.IMAGE,
    pages: [
      {
        pageIndex: 0,
        width: 1000,
        height: 1414,
        blocks: [
          {
            blockId: 'p0_b0',
            text: '임대인 홍길동',
            bbox: { x: 0.1, y: 0.2, width: 0.4, height: 0.03 },
            confidence: 0.95,
          },
          {
            blockId: 'p0_b1',
            text: '보증금 50,000,00O원',
            bbox: { x: 0.1, y: 0.26, width: 0.5, height: 0.03 },
            confidence: 0.72,
          },
        ],
      },
    ],
  };
}

describe('PART 1 ocr-editor & readDocument({ allowLowConfidence })', () => {
  const prevDocument = globalThis.document;

  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.document = /** @type {any} */ (createMiniDom());
  });

  afterEach(() => {
    globalThis.document = prevDocument;
  });

  it('readDocument(file, { allowLowConfidence: true })는 숫자 줄 신뢰도가 0.8 미만이어도 원본 confidence를 유지한 DocumentModel을 반환한다', async () => {
    const imgFile = new File([new Uint8Array([1, 2, 3])], 'low-conf-lease.png', {
      type: 'image/png',
    });

    vi.spyOn(ocrModule, 'recognizeImageText').mockResolvedValue({
      text: '임대인 홍길동\n보증금 50,000,00O원',
      confidence: 0.82,
      width: 1000,
      height: 1414,
      blocks: [
        {
          text: '임대인 홍길동',
          confidence: 0.95,
          bbox: { x: 0.1, y: 0.2, width: 0.4, height: 0.03 },
        },
        {
          text: '보증금 50,000,00O원',
          confidence: 0.72,
          bbox: { x: 0.1, y: 0.26, width: 0.5, height: 0.03 },
        },
      ],
    });

    const blocked = await readDocument(imgFile);
    expect(blocked.ok).toBe(false);

    const allowed = await readDocument(imgFile, { allowLowConfidence: true });
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(allowed.data.pages[0].blocks[1].text).toBe('보증금 50,000,00O원');
      expect(allowed.data.pages[0].blocks[1].confidence).toBe(0.72);
    }
  });

  it('숫자 포함 줄은 0.8 미만일 때, 일반 줄은 0.75 미만일 때 낮은 신뢰도로 표시한다', () => {
    expect(isLowConfidenceBlock({ text: '보증금 5000만원', confidence: 0.79 })).toBe(true);
    expect(isLowConfidenceBlock({ text: '보증금 5000만원', confidence: 0.8 })).toBe(false);
    expect(isLowConfidenceBlock({ text: '임대인 홍길동', confidence: 0.74 })).toBe(true);
    expect(isLowConfidenceBlock({ text: '임대인 홍길동', confidence: 0.78 })).toBe(false);
  });

  it('낮은 신뢰도 숫자 줄에는 확인 전 오타 수정을 안내하는 힌트를 표시한다', () => {
    const doc = makeSampleOcrDoc();
    const el = renderOcrEditor({ documents: [doc] });

    const hints = el.querySelectorAll('.ocr-digit-hint');
    expect(hints).toHaveLength(2);
    expect(hints[0].hidden).toBe(true);
    expect(hints[1].hidden).toBe(false);
    expect(hints[1].textContent).toContain('Fix any wrong characters');
  });

  it('사용자가 텍스트를 수정할 때마다 원본을 변경하지 않고 onChange(editedDocuments)를 호출하며 blockId·bbox는 유지하고 confidence를 1로 설정한다', () => {
    const doc = makeSampleOcrDoc();
    const onChange = vi.fn();
    const el = renderOcrEditor({ documents: [doc], onChange });

    const inputs = el.querySelectorAll('textarea.ocr-input');
    expect(inputs).toHaveLength(2);

    inputs[1].value = '보증금 50,000,000원';
    inputs[1].dispatchEvent({ type: 'input' });

    expect(doc.pages[0].blocks[1].text).toBe('보증금 50,000,00O원');
    expect(doc.pages[0].blocks[1].confidence).toBe(0.72);

    expect(onChange).toHaveBeenCalledTimes(1);
    const updatedDocs = onChange.mock.calls[0][0];
    expect(Array.isArray(updatedDocs)).toBe(true);
    expect(updatedDocs[0].pages[0].blocks[1]).toEqual({
      blockId: 'p0_b1',
      text: '보증금 50,000,000원',
      bbox: { x: 0.1, y: 0.26, width: 0.5, height: 0.03 },
      confidence: 1,
    });
  });

  it('숫자가 맞아서 텍스트 수정 없이 줄 Confirm 버튼만 눌러도 confidence가 1이 되고 onChange가 호출된다', () => {
    const doc = makeSampleOcrDoc();
    const onChange = vi.fn();
    const el = renderOcrEditor({ documents: [doc], onChange });

    const confirmBtns = el.querySelectorAll('button.ocr-confirm-btn');
    expect(confirmBtns[0].hidden).toBe(true);
    expect(confirmBtns[1].hidden).toBe(false);

    confirmBtns[1].click();

    expect(onChange).toHaveBeenCalledTimes(1);
    const updatedDocs = onChange.mock.calls[0][0];
    expect(updatedDocs[0].pages[0].blocks[1].text).toBe('보증금 50,000,00O원');
    expect(updatedDocs[0].pages[0].blocks[1].confidence).toBe(1);
    expect(confirmBtns[1].hidden).toBe(true);
  });

  it('files 배열이 전달되면 이미지 파일 및 스캔 PDF 페이지 미리보기를 텍스트 옆에 렌더링한다', async () => {
    const doc = makeSampleOcrDoc();
    const imgFile = new File([new Uint8Array([1, 2, 3])], 'lease.png', { type: 'image/png' });
    const urlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-lease-preview');

    const el = renderOcrEditor({ documents: [doc], files: [imgFile] });
    const imgs = el.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toBe('blob:mock-lease-preview');

    // 스캔 PDF 미리보기 테스트
    const pdfFile = new File([new Uint8Array([1, 2, 3])], 'scanned.pdf', {
      type: 'application/pdf',
    });
    vi.spyOn(pdfReader, 'renderPdfToImages').mockResolvedValue([
      {
        pageIndex: 0,
        buffer: new Uint8Array([9, 8, 7]).buffer,
        width: 1000,
        height: 1414,
      },
    ]);

    const pdfEl = renderOcrEditor({ documents: [doc], files: [pdfFile] });
    await new Promise((r) => setTimeout(r, 10));
    const pdfImgs = pdfEl.querySelectorAll('img');
    expect(pdfImgs).toHaveLength(1);

    urlSpy.mockRestore();
  });

  it('Reset 버튼을 누르면 수정한 줄의 text와 confidence가 원래 OCR 값으로 복원되고 onChange가 호출된다', () => {
    const doc = makeSampleOcrDoc();
    const onChange = vi.fn();
    const el = renderOcrEditor({ documents: [doc], onChange });

    const input = el.querySelectorAll('textarea.ocr-input')[1];
    const resetBtn = el.querySelectorAll('button.ocr-reset-btn')[1];

    input.value = '잘못 고친 값';
    input.dispatchEvent({ type: 'input' });
    expect(resetBtn.hidden).toBe(false);

    resetBtn.click();
    expect(input.value).toBe('보증금 50,000,00O원');
    expect(resetBtn.hidden).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith([doc]);
  });

  it('batch-confirms non-digit flagged lines via "Confirm this page" while keeping digit lines one-by-one', () => {
    const sampleDocs = [
      {
        documentId: 'doc-1',
        documentType: DOCUMENT_TYPE.LEASE_CONTRACT,
        sourceType: 'IMAGE_PDF',
        pageCount: 1,
        fullText: '????? ??? ???\n??? ???\n??? 50,000,000?\n???? 900101-1234567',
        pages: [
          {
            pageIndex: 0,
            width: 1000,
            height: 1414,
            blocks: [
              {
                blockId: 'b0',
                text: '????? ??? ???',
                bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.04 },
                confidence: 0.65,
              },
              {
                blockId: 'b1',
                text: '??? ???',
                bbox: { x: 0.1, y: 0.16, width: 0.4, height: 0.04 },
                confidence: 0.7,
              },
              {
                blockId: 'b2',
                text: '??? 50,000,000?',
                bbox: { x: 0.1, y: 0.22, width: 0.6, height: 0.04 },
                confidence: 0.75,
              },
              {
                blockId: 'b3',
                text: '???? 900101-1234567',
                bbox: { x: 0.1, y: 0.28, width: 0.6, height: 0.04 },
                confidence: 0.78,
              },
            ],
          },
        ],
      },
    ];

    const onChange = vi.fn();
    const editor = renderOcrEditor({ documents: sampleDocs, onChange });

    const confirmPageBtn = /** @type {HTMLButtonElement} */ (
      editor.querySelectorAll('button').find((b) => b.classList.contains('ocr-confirm-page-btn'))
    );
    expect(confirmPageBtn).not.toBeNull();
    expect(confirmPageBtn.hidden).toBe(false);
    expect(editor.textContent).toContain('4 lines need careful check');

    // Click "Confirm this page": non-digit lines (b0, b1) become confirmed; digit lines (b2, b3) stay flagged
    confirmPageBtn.click();

    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0][0];
    expect(updated[0].pages[0].blocks[0].confirmed).toBe(true);
    expect(updated[0].pages[0].blocks[0].confidence).toBe(0.65);
    expect(updated[0].pages[0].blocks[1].confirmed).toBe(true);
    expect(updated[0].pages[0].blocks[1].confidence).toBe(0.7);
    expect(updated[0].pages[0].blocks[2].confidence).toBe(0.75);
    expect(updated[0].pages[0].blocks[3].confidence).toBe(0.78);

    expect(editor.textContent).toContain('2 lines need careful check');
    expect(confirmPageBtn.hidden).toBe(true);
    expect(editor.querySelectorAll('.ocr-block-warn')).toHaveLength(2);
  });

  it('always flags critical lease party/address lines even at high confidence without flagging general clauses, and matches getFlaggedBlocks()', async () => {
    const { getFlaggedBlocks } = await import('../src/features/document-input/ocr-editor.js');
    const onChange = vi.fn();
    const doc = {
      documentId: 'doc-lease-photo-1',
      documentType: DOCUMENT_TYPE.UNKNOWN,
      sourceType: SOURCE_TYPE.IMAGE,
      pages: [
        {
          pageIndex: 0,
          width: 1000,
          height: 1414,
          blocks: [
            {
              blockId: 'p0_b0',
              text: "1. 계약 당사자",
              bbox: { x: 0.1, y: 0.15, width: 0.3, height: 0.02 },
              confidence: 0.96,
            },
            {
              blockId: 'p0_b1',
              text: "임대사업자 성명(법인명) 전우치 (서명 또는 인)",
              bbox: { x: 0.1, y: 0.18, width: 0.8, height: 0.02 },
              confidence: 0.94,
            },
            {
              blockId: 'p0_b2',
              text: "개업공인 ⎸ 김삿갓 ⎸ GLEE]",
              bbox: { x: 0.1, y: 0.25, width: 0.8, height: 0.02 },
              confidence: 0.79,
            },
            {
              blockId: 'p0_b3',
              text: "◈ 해당 주택은 민간임대주택에 관한 특별법에 따라 등록한 주택입니다.",
              bbox: { x: 0.1, y: 0.32, width: 0.8, height: 0.02 },
              confidence: 0.92,
            },
            {
              blockId: 'p0_b4',
              text: "서울특별시 동대문구 가상동 210-5 가상스테이 제2층 제208호",
              bbox: { x: 0.1, y: 0.4, width: 0.8, height: 0.02 },
              confidence: 0.91,
            },
            {
              blockId: 'p0_b5',
              text: "제11조(임대보증금의 반환) 임차인이 임대사업자에게 예치한 임대보증금은 반환한다.",
              bbox: { x: 0.1, y: 0.5, width: 0.8, height: 0.02 },
              confidence: 0.93,
            },
          ],
        },
      ],
    };

    const editor = renderOcrEditor({ documents: [doc], onChange });
    const warnRows = editor.querySelectorAll('.ocr-block-warn');
    expect(warnRows).toHaveLength(4);
    expect(getFlaggedBlocks([doc]).map((b) => b.blockId)).toEqual([
      'p0_b0',
      'p0_b1',
      'p0_b2',
      'p0_b4',
    ]);
  });
});
