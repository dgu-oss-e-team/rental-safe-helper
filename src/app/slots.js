// @ts-check
/**
 * PART 5. 다른 파트 UI가 들어갈 자리 (slot)
 *
 * 노션 계획상 아래 UI는 각 파트 담당이다. PART 5는 자리와 연결만 맡는다.
 *   - riskResults:     PART 3 risk-result-ui      (② 위험 점검 결과 카드, 지금은 아래 기본 화면)
 *   - personQuestions: PART 4 person-questions-ui (② "같은 사람인가요?" 질문, 연결됨)
 *   - maskingReview:   PART 4 masking-review-ui   (④ 마스킹 확인·해제·더 가리기, 연결됨)
 *   - ocrEditor:       PART 1 ocr-editor          (① 뒤 "Confirm text": OCR 결과 수정 화면, 연결됨 #54)
 *
 * 기본 화면(default…)은 데모용이다. 각 파트가 자기 폴더에 UI를 만들면
 * 이 파일의 해당 줄만 그 함수로 바꾸면 된다. 함수의 입력·출력 형식은 아래 JSDoc을 지켜 주세요.
 */

import { el } from './ui.js';
import { RISK_STATUS, DOCUMENT_TYPE } from '../shared/document-model.js';
import { renderMaskingReview, renderPersonQuestions } from '../features/masking/index.js';

/** @typedef {import('../shared/document-model.js').RiskResult} RiskResult */

/** 위험 상태를 사용자에게 보여 줄 말 ("Safe"라는 말은 쓰지 않는다) */
export const STATUS_TEXT = {
  [RISK_STATUS.STOP]: 'Stop',
  [RISK_STATUS.CHECK]: 'Check',
  [RISK_STATUS.UNVERIFIABLE]: 'Could not check',
  [RISK_STATUS.NO_FLAG]: 'No warning found',
};
const STATUS_ORDER = [RISK_STATUS.STOP, RISK_STATUS.CHECK, RISK_STATUS.UNVERIFIABLE, RISK_STATUS.NO_FLAG];

export const DOCUMENT_TEXT = {
  [DOCUMENT_TYPE.REGISTRY]: 'Property register (등기부등본)',
  [DOCUMENT_TYPE.LEASE_CONTRACT]: 'Lease contract (임대차계약서)',
  [DOCUMENT_TYPE.UNKNOWN]: 'Unknown document',
};

/**
 * [PART 3 자리] 위험 점검 결과
 * @param {RiskResult[]} riskResults
 * @returns {HTMLElement}
 */
function defaultRiskResults(riskResults) {
  const sorted = [...riskResults].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  return el(
    'ul',
    { class: 'risk-list' },
    sorted.map((r) =>
      el('li', { class: `risk risk-${r.status.toLowerCase()}` }, [
        el('span', { class: 'badge' }, [STATUS_TEXT[r.status] ?? r.status]),
        el('h3', {}, [r.title]),
        el('p', {}, [r.explanation]),
        el('p', { class: 'action' }, [el('strong', {}, ['What to do: ']), r.action]),
        // 근거 칸: 실제 이름·주소가 들어갈 수 있으므로 화면에만 보여 준다 (프롬프트에는 없음)
        r.evidence
          ? el('dl', { class: 'evidence' }, [
              el('dt', {}, [r.evidence.left.label]),
              el('dd', {}, [r.evidence.left.value]),
              el('dt', {}, [r.evidence.right.label]),
              el('dd', {}, [r.evidence.right.value]),
            ])
          : null,
      ]),
    ),
  );
}

export const slots = {
  /** PART 3: (riskResults: RiskResult[]) => HTMLElement */
  riskResults: defaultRiskResults,
  /**
   * PART 4: ({ analysis, personGroups, personAnswers, onChange }) => HTMLElement | null
   * analysis.personGroups는 원래 판정, personGroups는 답으로 합친 그룹. 물어볼 사람이 없으면 null. (INTERFACES.md 6번)
   */
  personQuestions: renderPersonQuestions,
  /** PART 4: ({ analysis, prepared, edits, onChange }) => HTMLElement  (analysis는 답을 반영한 것) */
  maskingReview: renderMaskingReview,
  /**
   * PART 1: ({ documents, files, onChange }) => HTMLElement  (INTERFACES.md 2번 "OCR 결과 확인")
   * PART 1 코드는 pdf.js·OCR 때문에 커서 첫 화면에 싣지 않는다. 처리 코드를 불러올 때 main.js가 채운다.
   * @type {((input: { documents: any[], files: File[], onChange: (docs: any[]) => void }) => HTMLElement) | null}
   */
  ocrEditor: null,
};
