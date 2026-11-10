// @ts-check
/**
 * PART 5. 화면 상태 관리
 * 화면끼리 변수를 직접 주고받지 않고 이 store 하나로 상태를 공유한다.
 */

import { MASKING_PURPOSE } from '../shared/document-model.js';
import { emptyEdits } from './masking-edits.js';

/**
 * @template T
 * @param {T} initial
 */
export function createStore(initial) {
  let state = initial;
  /** @type {Set<(s: T) => void>} */
  const listeners = new Set();

  return {
    getState: () => state,
    /** @param {Partial<T>} patch */
    setState(patch) {
      state = { ...state, ...patch };
      listeners.forEach((fn) => fn(state));
    },
    /** @param {(s: T) => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** 처음 상태 (다시 시작할 때도 이 값으로 되돌린다) */
export function initialState() {
  return {
    /** @type {'upload' | 'results' | 'purpose' | 'review' | 'done'} */
    step: 'upload',
    /** 처리 중이면 안내 문구, 아니면 null */
    /** @type {string | null} */
    busy: null,
    /** @type {{ step?: string, code: string, message: string } | null} */
    error: null,
    /** @type {{ registry: File | null, lease: File | null }} */
    files: { registry: null, lease: null },
    /** analyzeDocuments() 결과 */
    /** @type {import('./pipeline.js').Analysis | null} */
    analysis: null,
    purpose: MASKING_PURPOSE.FRAUD_CHECK,
    /** prepareForAi() 결과 */
    /** @type {import('./pipeline.js').Prepared | null} */
    prepared: null,
    /** ④에서 사용자가 해제·추가한 마스킹 (서류를 새로 분석하면 비운다) */
    maskingEdits: emptyEdits(),
    /** 사용자가 "가려진 내용을 확인했다"고 체크했는지 */
    reviewed: false,
    /** exportMaskedPdfs() 결과 */
    /** @type {any[] | null} */
    pdfs: null,
  };
}

export const appState = createStore(initialState());
