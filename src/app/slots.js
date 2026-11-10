// @ts-check
/**
 * PART 5. 다른 파트 UI가 들어갈 자리 (slot)
 *
 * 노션 계획상 아래 UI는 각 파트 담당이다. PART 5는 자리와 연결만 맡는다.
 *   - riskResults:   PART 3 risk-result-ui    (위험 점검 결과 카드)
 *   - maskingReview: PART 4 masking-review-ui (마스킹 미리보기, 가릴 항목 추가·해제, "같은 사람인가요?" 확인)
 *   - ocrEditor:     PART 1 ocr-editor         (OCR 결과 수정 화면, 아직 자리만)
 *
 * 지금 들어 있는 함수는 데모용 기본 화면이다. 각 파트가 자기 폴더에 UI를 만들면
 * 이 파일의 해당 줄만 그 함수로 바꾸면 된다. 함수의 입력·출력 형식은 아래 JSDoc을 지켜 주세요.
 */

import { el } from './ui.js';
import { RISK_STATUS, DOCUMENT_TYPE } from '../shared/document-model.js';

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

/**
 * [PART 4 자리] 보내기 전 확인 화면
 * 지금은 가려진 결과를 읽기 전용으로 보여 준다. 가릴 항목 추가·해제, "같은 사람인가요?" 질문은 PART 4가 만든다.
 * @param {{ analysis: import('./pipeline.js').Analysis, prepared: import('./pipeline.js').Prepared }} input
 * @returns {HTMLElement}
 */
function defaultMaskingReview({ analysis, prepared }) {
  const hiddenCount = prepared.maskingPlan.items.filter((i) => i.action !== 'KEEP').length;
  const ambiguous = analysis.personGroups.filter((g) => g.status === 'AMBIGUOUS');

  return el('div', { class: 'review' }, [
    el('p', {}, [`${hiddenCount} item(s) of personal information are hidden or replaced with role names.`]),
    ambiguous.length > 0
      ? el('p', { class: 'warning' }, [
          `We could not confirm who ${ambiguous.map((g) => g.alias).join(', ')} is, so they are treated as separate people. Check their names yourself.`,
        ])
      : null,
    Object.keys(prepared.legend).length > 0
      ? el('div', {}, [
          el('h3', {}, ['Role names']),
          el(
            'ul',
            { class: 'legend' },
            Object.entries(prepared.legend).map(([alias, meaning]) => el('li', {}, [el('code', {}, [alias]), ` = ${meaning}`])),
          ),
        ])
      : null,
    ...analysis.documents.map((doc) =>
      el('div', {}, [
        el('h3', {}, [DOCUMENT_TEXT[doc.documentType] ?? doc.documentType]),
        el('pre', { class: 'masked' }, [prepared.maskedText[doc.documentId] ?? '']),
      ]),
    ),
  ]);
}

export const slots = {
  /** PART 3: (riskResults: RiskResult[]) => HTMLElement */
  riskResults: defaultRiskResults,
  /** PART 4: ({ analysis, prepared }) => HTMLElement */
  maskingReview: defaultMaskingReview,
};
