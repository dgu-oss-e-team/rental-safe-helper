import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DOCUMENT_TYPE, SOURCE_TYPE } from '../src/shared/document-model.js';
import { renderOcrEditor, isLowConfidenceBlock } from '../src/features/document-input/index.js';
import { slots } from '../src/app/slots.js';

/** Node 환경에서 src/app/ui.js(el, button, card, actions)를 검증하기 위한 경량 DOM 모의 객체 */
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

    querySelectorAll(selector) {
      const results = [];
      const match = (node) => {
        if (!(node instanceof FakeElement)) return false;
        if (selector === 'button') return node.tagName === 'BUTTON';
        if (selector === 'input.ocr-input') {
          return node.tagName === 'INPUT' && node.classList.contains('ocr-input');
        }
        if (selector === '.ocr-block-warn') {
          return node.classList.contains('ocr-block-warn');
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

describe('PART 1 ocr-editor (renderOcrEditor)', () => {
  const prevDocument = globalThis.document;

  beforeEach(() => {
    globalThis.document = /** @type {any} */ (createMiniDom());
  });

  afterEach(() => {
    globalThis.document = prevDocument;
  });

  it('slots.ocrEditor에 연결되어 있다', () => {
    expect(typeof slots.ocrEditor).toBe('function');
    expect(slots.ocrEditor).toBe(renderOcrEditor);
  });

  it('숫자 포함 줄은 0.8 미만일 때, 일반 줄은 0.75 미만일 때 낮은 신뢰도로 표시한다', () => {
    expect(isLowConfidenceBlock({ text: '보증금 5000만원', confidence: 0.79 })).toBe(true);
    expect(isLowConfidenceBlock({ text: '보증금 5000만원', confidence: 0.8 })).toBe(false);
    expect(isLowConfidenceBlock({ text: '임대인 홍길동', confidence: 0.74 })).toBe(true);
    expect(isLowConfidenceBlock({ text: '임대인 홍길동', confidence: 0.78 })).toBe(false);
    expect(isLowConfidenceBlock({ text: '텍스트 PDF', confidence: null })).toBe(false);
  });

  it('OCR 블록을 입력 필드로 렌더링하고 낮은 신뢰도 줄을 강조 표시한다', () => {
    const doc = makeSampleOcrDoc();
    const el = renderOcrEditor({ document: doc });

    const inputs = el.querySelectorAll('input.ocr-input');
    expect(inputs).toHaveLength(2);
    expect(inputs[0].value).toBe('임대인 홍길동');
    expect(inputs[1].value).toBe('보증금 50,000,00O원');

    const warnedBlocks = el.querySelectorAll('.ocr-block-warn');
    expect(warnedBlocks).toHaveLength(1);
    expect(el.textContent).toContain('1 line needs careful check');
  });

  it('사용자가 오인식된 텍스트를 수정하고 확인하면 원본을 변경하지 않고 수정된 DocumentModel을 전달한다', () => {
    const doc = makeSampleOcrDoc();
    const onConfirm = vi.fn();
    const el = renderOcrEditor({ document: doc, onConfirm });

    const inputs = el.querySelectorAll('input.ocr-input');
    inputs[1].value = '보증금 50,000,000원';
    inputs[1].dispatchEvent({ type: 'input' });

    // 원본 DocumentModel은 불변 유지
    expect(doc.pages[0].blocks[1].text).toBe('보증금 50,000,00O원');

    const confirmBtn = el.querySelectorAll('button').find((b) =>
      b.textContent?.includes('Confirm')
    );
    expect(confirmBtn).toBeTruthy();
    confirmBtn?.click();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const updated = onConfirm.mock.calls[0][0];
    expect(updated.pages[0].blocks[1].text).toBe('보증금 50,000,000원');
    expect(updated.pages[0].blocks[1].bbox).toEqual({ x: 0.1, y: 0.26, width: 0.5, height: 0.03 });
  });

  it('documents 배열을 전달하면 수정된 DocumentModel 배열로 돌려준다', () => {
    const doc1 = makeSampleOcrDoc();
    const doc2 = {
      ...makeSampleOcrDoc(),
      documentId: 'doc-ocr-2',
      documentType: DOCUMENT_TYPE.REGISTRY,
    };
    const onConfirm = vi.fn();
    const el = renderOcrEditor({ documents: [doc1, doc2], onConfirm });

    const confirmBtn = el.querySelectorAll('button').find((b) =>
      b.textContent?.includes('Confirm')
    );
    confirmBtn?.click();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const updatedList = onConfirm.mock.calls[0][0];
    expect(Array.isArray(updatedList)).toBe(true);
    expect(updatedList).toHaveLength(2);
    expect(updatedList[1].documentId).toBe('doc-ocr-2');
  });

  it('Reset 버튼을 누르면 수정한 줄이 원래 OCR 텍스트로 복원된다', () => {
    const doc = makeSampleOcrDoc();
    const el = renderOcrEditor({ document: doc });

    const input = el.querySelectorAll('input.ocr-input')[1];
    const resetBtn = el.querySelectorAll('button.ocr-reset-btn')[1];

    expect(resetBtn.hidden).toBe(true);
    input.value = '잘못 고친 값';
    input.dispatchEvent({ type: 'input' });
    expect(resetBtn.hidden).toBe(false);

    resetBtn.click();
    expect(input.value).toBe('보증금 50,000,00O원');
    expect(resetBtn.hidden).toBe(true);
  });
});