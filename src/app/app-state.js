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
    /**
     * 칸마다 올린 파일: PDF 한 개(File) 또는 사진 여러 장(File[], #268) 또는 null
     * @type {{ registry: import('./photo-pages.js').SlotValue, lease: import('./photo-pages.js').SlotValue }}
     */
    files: { registry: null, lease: null },
    /**
     * ① 화면: 칸에 넣은 글자 PDF마다 바로 판별한 서류 종류 (#365). null = 판별하지 않음(사진·스캔·못 읽음).
     * 파일을 넣으면 main.js가 뒤에서 채운다. 아직 없는 파일은 보는 중이다. 칸 아래 안내에만 쓴다.
     * @type {Map<File, string | null>}
     */
    uploadTypes: new Map(),
    /**
     * ① 칸 아래 안내 (PDF와 사진을 섞어 골랐을 때 등, #268). 정해진 문구만 넣는다.
     * @type {{ slot: 'registry' | 'lease', text: string } | null}
     */
    uploadNotice: null,
    /**
     * "Confirm text" 단계 (#54): 읽은 서류 전체와, 확인할 사진·스캔 서류의 원본 파일.
     * 사용자가 고친 글자는 화면을 다시 그리지 않으려고 main.js의 ocrDraft에 따로 둔다.
     * slots: 파일마다 올린 칸 (#186, 확인 단계를 거쳐도 유지)
     * @type {{ read: { files: File[], documents: any[] }, files: File[], slots: import('./upload-check.js').UploadSlot[] | null } | null}
     */
    ocrReview: null,
    /**
     * 분석한 파일마다 올린 칸 (analysis.documents[i] ↔ uploadSlots[i]). 시연 샘플은 칸이 없어서 null. (#186)
     * ② 결과 화면이 판별 결과와 비교해서, 칸과 서류 종류가 다르면 안내한다.
     * @type {import('./upload-check.js').UploadSlot[] | null}
     */
    uploadSlots: null,
    /**
     * 한 칸에 함께 올린 파일 조각마다 판별한 종류와 칸 목록 번호 (uploadParts[i] ↔ uploadSlots[i], 조각이 하나면 null). (#305)
     * ② 결과 화면이 칸과 다른 서류가 섞였으면 "File 2 … looks like a property register"처럼 안내한다.
     * @type {(import('./upload-check.js').UploadParts | null)[] | null}
     */
    uploadParts: null,
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
    /**
     * 마지막 "같은 사람인가요?" 답으로 바뀐 위험 점검 결과 (개선 목록 5번). 답한 적이 없으면 null, 바뀐 게 없으면 []
     * @type {import('./result-changes.js').ResultChange[] | null}
     */
    resultChanges: null,
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
    /**
     * ⑤ "Double-check the PDF" 결과. 'running'이면 검사 중. PDF를 새로 만들면 비운다.
     * @type {'running' | (import('./double-check.js').DoubleCheckResult & { documentId: string, documentType: string })[] | null}
     */
    doubleCheck: null,
    /**
     * 사진·스캔 서류에서 다시 확인이 경고를 냈을 때, 사용자가 그 쪽을 직접 봤다고 체크했는지 (#314)
     * 체크해야 다운로드가 나온다. PDF를 새로 만들면 비운다.
     */
    pdfChecked: false,
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
