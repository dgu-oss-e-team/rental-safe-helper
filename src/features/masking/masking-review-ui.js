// @ts-check
/**
 * PART 4. ④ 보내기 전 확인 화면 (masking-review-ui)
 *
 * PART 5 slots.js의 maskingReview 자리에 들어간다. 입력·출력은 slots.js JSDoc 그대로:
 *   ({ analysis, prepared, edits, onChange }) => HTMLElement
 * 사용자가 체크를 바꾸면 onChange(edits 전체)를 부르고, PART 5가 마스킹을 다시 계산해 이 화면을 새로 그린다.
 *
 * 이번 단계: 가린 항목 목록 + "AI에게 보여 주기"(해제) + 가명 범례 + 미리보기
 * TODO(PART 4): 미리보기에서 글자를 골라 더 가리기(add), "같은 사람인가요?" 질문 (PART 3과 정한 뒤)
 *
 * 서류 글자는 el()로만 넣는다 (textContent, innerHTML 사용 안 함).
 */

import './masking-review.css';
import { el } from '../../app/ui.js';
import { DOCUMENT_TYPE, PII_TYPE } from '../../shared/document-model.js';
import { buildReviewRows, setRowShown } from './review-model.js';

/** 개인정보 종류 → 화면 이름 (화면 문구는 영어, 제안서 기준) */
const TYPE_TEXT = {
  [PII_TYPE.PERSON_NAME]: 'Name',
  [PII_TYPE.RESIDENT_ID]: 'Resident registration no.',
  [PII_TYPE.FOREIGNER_ID]: 'Foreigner registration no.',
  [PII_TYPE.PASSPORT_ID]: 'Passport no.',
  [PII_TYPE.PHONE_NUMBER]: 'Phone number',
  [PII_TYPE.BANK_ACCOUNT]: 'Bank account',
  [PII_TYPE.ADDRESS]: 'Address',
  [PII_TYPE.REGISTRY_ID]: 'Registry no.',
};

/** 서류 종류 → 짧은 이름 */
const DOC_SHORT = {
  [DOCUMENT_TYPE.REGISTRY]: 'Register',
  [DOCUMENT_TYPE.LEASE_CONTRACT]: 'Lease',
  [DOCUMENT_TYPE.UNKNOWN]: 'Document',
};

/** 서류 종류 → 미리보기 제목 */
const DOC_TITLE = {
  [DOCUMENT_TYPE.REGISTRY]: 'Property register (등기부등본)',
  [DOCUMENT_TYPE.LEASE_CONTRACT]: 'Lease contract (임대차계약서)',
  [DOCUMENT_TYPE.UNKNOWN]: 'Unknown document',
};

/**
 * AI에게 어떻게 보이는지 표시
 * @param {import('./review-model.js').ReviewRow} row
 */
function resultBadge(row) {
  const text = {
    ALIAS: `Replaced with ${row.resultText}`,
    PARTIAL: `Only "${row.resultText}" is shared`,
    HIDDEN: 'Hidden',
    SHOWN: 'Shown as written',
  }[row.result];
  return el('span', { class: `mr-result mr-result-${row.result.toLowerCase()}` }, [text]);
}

/**
 * 확인 화면을 만든다.
 * @param {{
 *   analysis: { documents: any[], findings: any[], personGroups: any[] },
 *   prepared: { maskingPlan: import('../../shared/document-model.js').MaskingPlan, maskedText: Record<string, string>, legend: Record<string, string> },
 *   edits: import('./user-edits.js').MaskingEdits,
 *   onChange: (edits: { remove: string[], add: any[] }) => void,
 * }} input
 * @returns {HTMLElement}
 */
export function renderMaskingReview({ analysis, prepared, edits, onChange }) {
  const rows = buildReviewRows({ findings: analysis.findings, personGroups: analysis.personGroups, plan: prepared.maskingPlan });
  const docType = new Map(analysis.documents.map((d) => [d.documentId, d.documentType]));
  const shownCount = rows.filter((r) => r.shown).length;
  const ambiguous = analysis.personGroups.filter((g) => g.status === 'AMBIGUOUS');

  const tableRows = rows.map((row) => {
    /** @type {HTMLElement} */
    let control;
    if (row.locked) {
      control = el('span', { class: 'mr-locked', title: 'This kind of information is always hidden.' }, ['🔒 Always hidden']);
    } else {
      const box = /** @type {HTMLInputElement} */ (
        el('input', { type: 'checkbox', id: `mr-${row.key}`, checked: row.shown, 'aria-label': `Show this ${TYPE_TEXT[row.type] ?? row.type} to the AI` })
      );
      box.addEventListener('change', () => onChange(setRowShown(edits, row, box.checked)));
      control = el('label', { class: 'mr-toggle', for: `mr-${row.key}` }, [box, 'Show']);
    }

    const where = row.documentIds.map((id) => DOC_SHORT[docType.get(id)] ?? 'Document').join(', ');
    return el('tr', { class: row.shown ? 'mr-row-shown' : undefined }, [
      el('td', {}, [TYPE_TEXT[row.type] ?? row.type, el('br'), el('span', { class: 'mr-note' }, [where])]),
      // 원본 글자는 이 화면에만 보여 준다 (AI로 보내지 않음)
      el('td', { class: 'mr-original' }, [row.values.join(' / ')]),
      el('td', {}, [resultBadge(row)]),
      el('td', {}, [control]),
    ]);
  });

  return el('div', { class: 'review mr' }, [
    el('p', {}, [
      `${rows.length - shownCount} of ${rows.length} item(s) of personal information are hidden or replaced.`,
      shownCount > 0 ? ` ${shownCount} item(s) will be shown to the AI as written.` : '',
    ]),
    ambiguous.length > 0
      ? el('p', { class: 'warning' }, [
          `We could not confirm who ${ambiguous.map((g) => g.alias).join(', ')} is, so they are treated as separate people. Check their names yourself.`,
        ])
      : null,

    el('h3', {}, ['Personal information found']),
    el('p', { class: 'mr-note' }, [
      'Tick "Show" only if the AI really needs it. ID numbers, phone numbers and bank accounts are always hidden. ',
      'All names of the same person, and all lines of one address, are shown or hidden together.',
    ]),
    rows.length === 0
      ? el('p', {}, ['No personal information was found.'])
      : el('table', { class: 'mr-table' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', {}, ['Type']),
              el('th', {}, ['In your document']),
              el('th', {}, ['What the AI sees']),
              el('th', {}, ['Show to AI']),
            ]),
          ]),
          el('tbody', {}, tableRows),
        ]),

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

    el('h3', {}, ['Preview: what the AI will see']),
    ...analysis.documents.map((doc) =>
      el('div', {}, [
        el('h4', {}, [DOC_TITLE[doc.documentType] ?? doc.documentType]),
        el('pre', { class: 'masked' }, [prepared.maskedText[doc.documentId] ?? '']),
      ]),
    ),
  ]);
}
