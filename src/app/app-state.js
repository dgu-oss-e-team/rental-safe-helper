// @ts-check
/**
 * PART 5. 화면 상태 관리
 * 화면끼리 변수를 직접 주고받지 않고 이 store 하나로 상태를 공유한다.
 */

import { MASKING_PURPOSE } from '../shared/document-model.js';

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

/**
 * ④ 보내기 전 확인 화면에서 사용자가 바꾼 내용 (docs/INTERFACES.md 8번 "사용자 수정")
 * 규칙(해제 금지 종류, 묶음 단위 해제)은 PART 4 createMaskingPlan이 적용한다. PART 5는 보관·전달만 한다.
 * value에 원본 글자가 들어가므로 메모리에만 두고 로그·오류 메시지에 넣지 않는다.
 * @typedef {Object} MaskingEdits
 * @property {string[]} remove  사용자가 해제한 findingId
 * @property {{ id: string, documentId: string, blockId: string, value: string }[]} add  사용자가 더 가린 글자 (항상 REDACT)
 */

/** @returns {MaskingEdits} */
export function emptyEdits() {
  return { remove: [], add: [] };
}

/**
 * PART 4 UI가 넘긴 값을 정해진 모양으로 맞춘다. (빠진 칸은 빈 배열, 다른 칸은 버림)
 * @param {any} edits
 * @returns {MaskingEdits}
 */
export function normalizeEdits(edits) {
  return {
    remove: Array.isArray(edits?.remove) ? [...edits.remove] : [],
    add: Array.isArray(edits?.add) ? edits.add.map((a) => ({ ...a })) : [],
  };
}

/**
 * 목적을 바꾸면: 더 가린 것(add)은 유지하고, 해제(remove)는 새 목적에서 다시 고르게 비운다.
 * @param {MaskingEdits} edits
 * @returns {MaskingEdits}
 */
export function editsAfterPurposeChange(edits) {
  return { remove: [], add: normalizeEdits(edits).add };
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
