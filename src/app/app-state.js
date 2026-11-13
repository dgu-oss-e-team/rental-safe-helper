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

/**
 * 서류 하나의 미리보기. url은 브라우저 안의 이미지 주소(blob:)라 밖으로 나가지 않는다.
 * @typedef {Object} PreviewDoc
 * @property {string} documentId
 * @property {string} documentType
 * @property {{ pageIndex: number, url: string, width: number, height: number }[]} pages
 * @property {{ code: string, message: string } | null} error
 */

/** 처음 상태 (다시 시작할 때도 이 값으로 되돌린다) */
export function initialState() {
  return {
    /** @type {'upload' | 'confirm' | 'results' | 'purpose' | 'review' | 'done'} */
    step: 'upload',
    /** 처리 중이면 안내 문구, 아니면 null */
    /** @type {string | null} */
    busy: null,
    /** @type {{ step?: string, code: string, message: string } | null} */
    error: null,
    /** @type {{ registry: File | null, lease: File | null }} */
    files: { registry: null, lease: null },
    /**
     * "Confirm text" 단계 (#54): 읽은 서류 전체와, 확인할 사진·스캔 서류의 원본 파일.
     * 사용자가 고친 글자는 화면을 다시 그리지 않으려고 main.js의 ocrDraft에 따로 둔다.
     * @type {{ read: { files: File[], documents: any[] }, files: File[] } | null}
     */
    ocrReview: null,
    /** analyzeDocuments() 결과 (원래 판정. "같은 사람인가요?" 답은 반영되지 않음) */
    /** @type {import('./pipeline.js').Analysis | null} */
    analysis: null,
    /**
     * ②의 "같은 사람인가요?" 답 (docs/INTERFACES.md 6번). maskingEdits와 따로 둔다.
     * 새 서류를 분석하면 비우고, 목적을 바꿀 때는 유지한다.
     * @type {Record<string, string | null>}
     */
    personAnswers: {},
    /** recheckPeople() 결과 (답으로 합친 그룹 + 다시 점검한 위험 결과). 답이 없으면 null */
    /** @type {import('./pipeline.js').Checked | null} */
    checked: null,
    purpose: MASKING_PURPOSE.FRAUD_CHECK,
    /** prepareForAi() 결과 */
    /** @type {import('./pipeline.js').Prepared | null} */
    prepared: null,
    /** ④에서 사용자가 해제·추가한 마스킹 (서류를 새로 분석하면 비운다) */
    maskingEdits: emptyEdits(),
    /**
     * ④에서 보여 줄 마스킹 PDF 미리보기. prepared가 바뀌면 다시 만든다.
     * forPrepared가 지금 prepared와 다르면 아직 만드는 중이다.
     * @type {{ forPrepared: import('./pipeline.js').Prepared, docs: PreviewDoc[] } | null}
     */
    previews: null,
    /** 사용자가 "가려진 내용을 확인했다"고 체크했는지 */
    reviewed: false,
    /** exportMaskedPdfs() 결과 */
    /** @type {any[] | null} */
    pdfs: null,
  };
}

export const appState = createStore(initialState());

/**
 * 화면과 ③·④·⑤에서 쓸 분석 결과: "같은 사람인가요?" 답을 반영한 그룹과 위험 결과.
 * ③·④·⑤(마스킹·프롬프트)는 이것을 써야 같은 사람이 같은 가명이 된다.
 * (원래 판정이 필요한 곳, 예: 질문 목록은 state.analysis를 그대로 쓴다)
 * pipeline.js를 불러오지 않는다 (첫 화면을 가볍게 두기 위해, #43)
 * @param {ReturnType<typeof initialState>} state
 * @returns {import('./pipeline.js').Analysis | null}
 */
export function currentAnalysis(state) {
  if (!state.analysis) return null;
  const { checked } = state;
  return checked
    ? { ...state.analysis, personGroups: checked.personGroups, riskResults: checked.riskResults }
    : state.analysis;
}
