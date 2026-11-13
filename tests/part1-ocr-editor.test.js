import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DOCUMENT_TYPE, SOURCE_TYPE } from '../src/shared/document-model.js';
import * as ocrModule from '../src/features/document-input/ocr.js';
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
        if (selector === 'input.ocr-input') {
          return node.tagName === 'INPUT' && node.classList.contains('ocr-input');
        }
        if (selector === '.ocr-block-warn') {
          return node.classList.contains('ocr-block-warn');
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

    // 옵션 없이는 기존처럼 LOW_CONFIDENCE로 차단
    const blocked = await readDocument(imgFile);
    expect(blocked.ok).toBe(false);

    // allowLowConfidence: true 일 때는 편집 화면용으로 통과
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

  it('사용자가 텍스트를 수정할 때마다 원본을 변경하지 않고 onChange(editedDocuments)를 호출하며 blockId·bbox는 유지하고 confidence를 1로 설정한다', () => {
    const doc = makeSampleOcrDoc();
    const onChange = vi.fn();
    const el = renderOcrEditor({ documents: [doc], onChange });

    const inputs = el.querySelectorAll('input.ocr-input');
    expect(inputs).toHaveLength(2);

    inputs[1].value = '보증금 50,000,000원';
    inputs[1].dispatchEvent({ type: 'input' });

    // 원본 입력은 절대 변경되지 않음
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

  it('files 배열이 전달되면 이미지 파일 미리보기를 텍스트 옆에 렌더링한다', () => {
    const doc = makeSampleOcrDoc();
    const imgFile = new File([new Uint8Array([1, 2, 3])], 'lease.png', { type: 'image/png' });
    const urlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-lease-preview');

    const el = renderOcrEditor({ documents: [doc], files: [imgFile] });
    const imgs = el.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toBe('blob:mock-lease-preview');
    urlSpy.mockRestore();
  });

  it('Reset 버튼을 누르면 수정한 줄의 text와 confidence가 원래 OCR 값으로 복원되고 onChange가 호출된다', () => {
    const doc = makeSampleOcrDoc();
    const onChange = vi.fn();
    const el = renderOcrEditor({ documents: [doc], onChange });

    const input = el.querySelectorAll('input.ocr-input')[1];
    const resetBtn = el.querySelectorAll('button.ocr-reset-btn')[1];

    input.value = '잘못 고친 값';
    input.dispatchEvent({ type: 'input' });
    expect(resetBtn.hidden).toBe(false);

    resetBtn.click();
    expect(input.value).toBe('보증금 50,000,00O원');
    expect(resetBtn.hidden).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith([doc]);
  });
});