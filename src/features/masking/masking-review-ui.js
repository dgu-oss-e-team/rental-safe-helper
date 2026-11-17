// @ts-check
/**
 * PART 4. ④ 보내기 전 확인 화면 (masking-review-ui)
 *
 * PART 5 slots.js의 maskingReview 자리에 들어간다. 입력·출력은 slots.js JSDoc 그대로:
 *   ({ analysis, prepared, edits, onChange }) => HTMLElement
 * 사용자가 체크를 바꾸면 onChange(edits 전체)를 부르고, PART 5가 마스킹을 다시 계산해 이 화면을 새로 그린다.
 *
 * 1단계: 가린 항목 목록 + "AI에게 보여 주기"(해제) + 가명 범례 + 미리보기
 * 2단계: 미리보기에서 글자를 골라 더 가리기(add) + 더 가린 글자 목록·취소
 *        value는 미리보기 글자, pageIndex·bbox는 그 block 위치 (INTERFACES.md 8번)
 *
 * 서류 글자는 el()로만 넣는다 (textContent, innerHTML 사용 안 함).
 */

import './masking-review.css';
import { el } from '../../app/ui.js';
import { DOCUMENT_TYPE, PII_TYPE } from '../../shared/document-model.js';
import { buildReviewRows, setRowShown, addSelection, removeAdd, hiddenPlacesNote } from './review-model.js';
// block마다 가린 글을 만들 때 쓴다
import { applyMaskingPlan } from './apply-masking-plan.js';

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
 * 여러 줄을 가린 직후 보여 줄 안내. 가리면 화면을 새로 그리므로 (여러 번 그릴 수도 있음),
 * 마지막으로 더한 add의 id와 목적을 함께 기억해 두고, 그 add가 맨 끝에 있을 때만 보여 준다.
 * 다른 체크를 바꾸거나 Undo하거나 목적이 바뀌면 지운다.
 * announced: 화면 읽기 프로그램에 한 번 알렸는지. 알린 뒤 다시 그릴 때는 글을 처음부터 넣어서 두 번 읽지 않게 한다.
 * @type {{ lastId: string, purpose: string, text: string, announced?: boolean } | null}
 */
let lastHideNote = null;

/** 화면을 그린 뒤 안내 글을 넣기까지 기다리는 시간. 화면 읽기 프로그램이 "바뀐 내용"으로 읽게 한다. (ms) */
const ANNOUNCE_DELAY = 100;

/** 고르기 실패 이유 → 안내 문구 */
const SELECT_HINT = {
  NONE: 'Select some text in the preview first.',
  MULTI_LINE: 'Select text within one line at a time.',
  EMPTY: 'Select some text in the preview first.',
  ALREADY_HIDDEN: 'That part is already hidden.',
  DUPLICATE: 'You already hid that text on this line.',
};

/**
 * 서류의 block마다 가린 글을 만든다. (미리보기에서 어느 block을 골랐는지 알기 위해)
 * @param {any} doc
 * @param {any} plan
 * @param {any[]} findings
 * @param {any[]} personGroups
 * @param {any} edits
 * @returns {{ block: any, pageIndex: number, text: string }[]}
 */
function maskedBlocks(doc, plan, findings, personGroups, edits) {
  return doc.pages.flatMap((page) =>
    page.blocks.map((block) => {
      const one = { ...doc, pages: [{ ...page, blocks: [block] }] };
      const r = applyMaskingPlan([one], plan, findings, personGroups, edits);
      return { block, pageIndex: page.pageIndex, text: r.ok ? r.data.maskedText[doc.documentId] : '' };
    }),
  );
}

/**
 * 지금 고른 글자가 미리보기의 어느 줄(block)인지 찾는다.
 * @param {HTMLElement} root  미리보기 전체
 * @returns {{ ok: true, line: HTMLElement, value: string } | { ok: false, reason: 'NONE' | 'MULTI_LINE' }}
 */
function readSelection(root) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return { ok: false, reason: 'NONE' };
  /** @param {Node | null} n */
  const lineOf = (n) => /** @type {HTMLElement | null} */ ((n instanceof Element ? n : n?.parentElement)?.closest('.mr-line') ?? null);
  const a = lineOf(sel.anchorNode);
  const b = lineOf(sel.focusNode);
  if (!a || !b || !root.contains(a)) return { ok: false, reason: 'NONE' };
  if (a !== b) return { ok: false, reason: 'MULTI_LINE' };
  return { ok: true, line: a, value: sel.toString() };
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
      box.addEventListener('change', () => {
        lastHideNote = null;
        onChange(setRowShown(edits, row, box.checked));
      });
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

  // ── 미리보기 + 더 가리기 ──
  const blocksByDoc = analysis.documents.map((doc) => ({
    doc,
    lines: maskedBlocks(doc, prepared.maskingPlan, analysis.findings, analysis.personGroups, edits),
  }));
  /** @type {Map<string, { doc: any, block: any, pageIndex: number }>} 줄 id → 원래 block */
  const lineInfo = new Map();
  // 같은 글자를 다른 줄에서도 같이 가리려고 미리보기의 모든 줄을 모아 둔다
  const previewLines = blocksByDoc.flatMap(({ doc, lines }) =>
    lines.map(({ block, pageIndex, text }) => ({
      documentId: doc.documentId,
      blockId: block.blockId,
      pageIndex,
      bbox: block.bbox,
      text,
    })),
  );
  const preview = el(
    'div',
    { class: 'mr-preview' },
    blocksByDoc.map(({ doc, lines }) =>
      el('div', {}, [
        el('h4', {}, [DOC_TITLE[doc.documentType] ?? doc.documentType]),
        el(
          'div',
          { class: 'masked mr-doc' },
          lines.map(({ block, pageIndex, text }) => {
            const lineId = `${doc.documentId}::${block.blockId}`;
            lineInfo.set(lineId, { doc, block, pageIndex });
            return el('div', { class: 'mr-line', 'data-line': lineId }, [text || ' ']);
          }),
        ),
      ]),
    ),
  );

  const purpose = prepared.maskingPlan.purpose;
  // 목적을 바꿔서 다시 그리면 예전 안내는 지운다
  if (lastHideNote && lastHideNote.purpose !== purpose) lastHideNote = null;
  const lastAdd = edits?.add?.[edits.add.length - 1];
  const note = lastHideNote && lastAdd?.id === lastHideNote.lastId ? lastHideNote.text : '';
  // role="status"는 글이 "바뀔 때" 읽어 준다. 처음 알릴 때는 빈 칸으로 그리고, 조금 뒤에 글을 넣는다.
  // 이미 알린 안내면(가린 뒤 화면이 한 번 더 그려지는 경우) 글을 처음부터 넣어서 다시 읽지 않게 한다.
  const noteEntry = note ? lastHideNote : null;
  const hint = el('span', { class: 'mr-note', role: 'status' }, [noteEntry?.announced ? note : '']);
  if (noteEntry && !noteEntry.announced) {
    setTimeout(() => {
      // 그사이 다시 그려져서 이 칸이 화면에 없으면, 새로 그린 칸이 알린다
      if (!hint.isConnected || hint.textContent !== '') return;
      hint.textContent = note;
      noteEntry.announced = true;
    }, ANNOUNCE_DELAY);
  }
  /** @type {ReturnType<typeof readSelection>} 버튼을 누르는 순간 고른 글자 (누르면 선택이 풀리는 기기가 있어서 미리 읽어 둠) */
  let picked = { ok: false, reason: 'NONE' };
  const hideButton = el('button', { type: 'button', class: 'secondary' }, ['Hide selected text']);
  hideButton.addEventListener('pointerdown', () => {
    picked = readSelection(preview);
  });
  hideButton.addEventListener('click', () => {
    // 키보드로 누른 경우에는 pointerdown이 없으므로 여기서 다시 읽는다
    if (!picked.ok) picked = readSelection(preview);
    if (!picked.ok) {
      hint.textContent = SELECT_HINT[picked.reason];
      return;
    }
    const info = lineInfo.get(picked.line.dataset.line ?? '');
    if (!info) return;
    const r = addSelection(edits, {
      documentId: info.doc.documentId,
      blockId: info.block.blockId,
      pageIndex: info.pageIndex,
      bbox: info.block.bbox,
      value: picked.value,
    }, previewLines);
    picked = { ok: false, reason: 'NONE' };
    if (!r.ok) {
      hint.textContent = SELECT_HINT[r.reason];
      return;
    }
    window.getSelection()?.removeAllRanges();
    const added = r.edits.add[r.edits.add.length - 1];
    const places = r.edits.add.length - (edits?.add?.length ?? 0);
    lastHideNote = { lastId: added.id, purpose, text: hiddenPlacesNote(added.value, places) };
    onChange(r.edits);
  });

  // 같은 글자로 가린 줄은 목록에서 한 줄로 묶는다 (Undo하면 전부 함께 되돌아감)
  /** @type {Map<string, any[]>} */
  const addsByValue = new Map();
  for (const a of edits?.add ?? []) {
    const list = addsByValue.get(a.value) ?? [];
    list.push(a);
    addsByValue.set(a.value, list);
  }
  const addedList =
    addsByValue.size === 0
      ? null
      : el('div', {}, [
          el('h4', {}, ['Text you hid']),
          el(
            'ul',
            { class: 'mr-added' },
            [...addsByValue].map(([value, list]) => {
              const undo = el('button', { type: 'button', class: 'secondary mr-undo' }, ['Undo']);
              undo.addEventListener('click', () => {
                lastHideNote = null;
                onChange(removeAdd(edits, list[0].id));
              });
              const docs = [...new Set(list.map((a) => DOC_SHORT[docType.get(a.documentId)] ?? 'Document'))].join(', ');
              const places = list.length > 1 ? `${list.length} places, ` : '';
              return el('li', {}, [el('span', {}, [`"${value}" `, el('span', { class: 'mr-note' }, [`(${places}${docs})`])]), undo]);
            }),
          ),
        ]);

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
    el('p', { class: 'mr-note' }, ['Did we miss something? Select it in the preview, then press "Hide selected text".']),
    preview,
    el('div', { class: 'mr-add-bar' }, [hideButton, hint]),
    addedList,
  ]);
}
