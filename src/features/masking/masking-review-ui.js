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
 * 개선 목록 11·12번(11/26): 기본 화면은 가린 개수·개인정보 표·가명 범례·(요약으로 보내는 서류의) 요약 글만.
 *        한국어 가린 원문과 "Hide selected text"는 "For someone who reads Korean" 접힌 칸(.mr-korean) 안에 둔다.
 *        서류마다 AI에 그대로 가는지·요약만 가는지·안 가는지 적는다 (prepared.sending, #359).
 *
 * 서류 글자는 el()로만 넣는다 (textContent, innerHTML 사용 안 함).
 */

import './masking-review.css';
import { el } from '../../app/ui.js';
import { DOCUMENT_TYPE, PII_TYPE } from '../../shared/document-model.js';
import { buildReviewRows, setRowShown, addSelection, removeAdd, hiddenPlacesNote } from './review-model.js';
// block마다 가린 글을 만들 때 쓴다
import { applyMaskingPlan } from './apply-masking-plan.js';
// 계약서 인적사항 칸 범위 (요약으로 바뀐 칸 안의 항목을 찾을 때)
import { normalizeRanges } from './contract-party-summary.js';

/** 개인정보 종류 → 화면 이름 (화면 문구는 영어, 제안서 기준) */
const TYPE_TEXT = {
  [PII_TYPE.PERSON_NAME]: 'Name',
  [PII_TYPE.RESIDENT_ID]: 'Resident registration no.',
  [PII_TYPE.FOREIGNER_ID]: 'Foreigner registration no.',
  [PII_TYPE.PASSPORT_ID]: 'Passport no.',
  [PII_TYPE.PHONE_NUMBER]: 'Phone number',
  [PII_TYPE.BANK_ACCOUNT]: 'Bank account',
  [PII_TYPE.ADDRESS]: 'Address',
  // 등기 고유번호·법인등록번호·임대사업자 등록번호. 주민·외국인등록번호와 다른 번호라는 게 보이게 Other를 붙인다
  [PII_TYPE.REGISTRY_ID]: 'Other registration no.',
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

/**
 * "For someone who reads Korean" 접힌 칸을 열어 두었는지. 가리면 화면을 새로 그리므로, 열린 상태를 기억해 둔다.
 * (개선 목록 11번: 한국어 원문은 기본으로 접는다)
 */
let koreanOpen = false;

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
 * 접힌 칸의 서류 제목 아래 안내: 이 가린 글이 AI에 그대로 가는지 (#359, 개선 목록 12번)
 * 가린 글은 마스킹 PDF에 늘 쓰이지만, AI에는 목적에 따라 요약만 가거나 안 갈 수 있다.
 * @param {{ mode: string, reason?: string } | undefined} sent
 */
function sendNote(sent) {
  if (!sent) return null;
  const text = {
    SUMMARY: 'The AI gets only the short summary shown above, not this text. This text is used for the masked PDF.',
    PARTY_SUMMARY: "The AI gets this text, but the section with the parties' personal details is replaced by a short list of roles.",
    MASKED_TEXT: 'The AI gets this text.',
    OMIT: 'The AI does not get this document for this purpose. This text is used only for the masked PDF.',
  }[sent.mode];
  return text ? el('p', { class: 'mr-note' }, [text]) : null;
}

/**
 * 요약으로 보내는 서류(등기부)의 요약 글. 영어라서 한국어를 못 읽어도 확인할 수 있어 접힌 칸 밖에 둔다 (#359)
 * @param {{ documents: any[] }} analysis
 * @param {{ sentText?: Record<string, string>, sending?: { documentId: string, documentType?: string, mode: string }[] }} prepared
 */
function summaryBlocks(analysis, prepared) {
  const summaries = (prepared.sending ?? []).filter((s) => s.mode === 'SUMMARY' && typeof prepared.sentText?.[s.documentId] === 'string');
  if (summaries.length === 0) return null;
  const typeOf = new Map(analysis.documents.map((d) => [d.documentId, d.documentType]));
  // 아래 한국어 가린 원문(회색 고정폭 상자)과 헷갈리지 않게, "AI에 가는 것" 표시를 붙인 글 목록으로 보여 준다
  return el(
    'div',
    { class: 'mr-summaries' },
    summaries.map((s) => {
      const lines = /** @type {Record<string, string>} */ (prepared.sentText)[s.documentId].split('\n');
      // 첫 줄("Extracted items from the property register …")은 제목·설명과 같은 말이라 뺀다
      const items = lines.filter((line, i) => !(i === 0 && /^Extracted items/.test(line)) && line.trim() !== '');
      return el('section', { class: 'mr-sent' }, [
        el('span', { class: 'mr-sent-badge' }, ['Sent to the AI']),
        el('h3', {}, [`${DOC_SHORT_TITLE[s.documentType ?? typeOf.get(s.documentId)] ?? 'Document'}: a short summary, not the full text`]),
        el('p', { class: 'mr-note' }, [
          'This list is all the AI gets from this document. Names are role names, and the address is only the city and district.',
        ]),
        el(
          'ul',
          { class: 'mr-sent-list' },
          items.map((line) =>
            // "- Mortgage (근저당권): …" 같은 권리 줄은 한 칸 들여 쓴다
            line.startsWith('- ') ? el('li', { class: 'mr-sent-sub' }, [line.slice(2)]) : el('li', {}, [line]),
          ),
        ),
      ]);
    }),
  );
}

/** 요약 제목용 서류 이름 (영어만) */
const DOC_SHORT_TITLE = {
  [DOCUMENT_TYPE.REGISTRY]: 'Property register',
  [DOCUMENT_TYPE.LEASE_CONTRACT]: 'Lease contract',
  [DOCUMENT_TYPE.UNKNOWN]: 'Document',
};

/**
 * AI 글에 그대로 들어가지 않는 개인정보 항목 (#359): findingId → 'SUMMARY' | 'OMIT'
 *  - SUMMARY: 등기부를 요약으로 보내거나(SUMMARY), 계약서 인적사항 칸을 요약으로 바꾼(PARTY_SUMMARY) 곳에 있는 항목.
 *    요약에는 가명·역할만 들어가므로, 표에서 "Show"를 체크해도 AI 글에는 원래 값이 나가지 않는다.
 *  - OMIT: 이 목적에는 서류를 아예 보내지 않는다.
 * 어느 경우든 "Show"는 마스킹 PDF만 바꾼다. (가리기 계산은 그대로 두고, 화면에서 알려만 준다)
 * @param {{ documents: any[], findings: any[], fields?: any }} analysis
 * @param {{ sending?: { documentId: string, mode: string }[] }} prepared
 * @returns {Map<string, 'SUMMARY' | 'OMIT'>}
 */
export function notSentAsWritten(analysis, prepared) {
  /** @type {Map<string, 'SUMMARY' | 'OMIT'>} */
  const out = new Map();
  const modeOf = new Map((prepared.sending ?? []).map((s) => [s.documentId, s.mode]));
  if (modeOf.size === 0) return out;

  // 인적사항 칸을 요약으로 바꾼 계약서: block마다 시작 줄과 줄 글자 (줄 번호는 PART 2 linesOf와 같은 기준)
  /** @type {Map<string, { start: number, lines: string[], ranges: import('./contract-party-summary.js').LineRange[] }>} documentId::blockId */
  const partyBlocks = new Map();
  for (const doc of analysis.documents) {
    if (modeOf.get(doc.documentId) !== 'PARTY_SUMMARY') continue;
    const contract = analysis.fields?.contract;
    if (contract?.documentId !== doc.documentId) continue;
    let line = 0;
    /** @type {{ key: string, start: number, lines: string[] }[]} */
    const blocks = [];
    for (const p of doc.pages) {
      for (const b of p.blocks) {
        const lines = String(b.text ?? '').split('\n');
        blocks.push({ key: `${doc.documentId}::${b.blockId}`, start: line, lines });
        line += lines.length;
      }
    }
    const ranges = normalizeRanges(contract, line);
    for (const b of blocks) partyBlocks.set(b.key, { start: b.start, lines: b.lines, ranges });
  }
  /**
   * 이 항목이 요약으로 바뀐 인적사항 칸 안에 있나. 줄 단위로 본다 (#383 리뷰):
   * block 하나에 여러 줄이 있으면 값이 든 줄을 찾아 그 줄이 칸 안인지 본다.
   * 값이 든 줄을 못 찾으면 block의 모든 줄이 칸 안일 때만 칸 안으로 본다.
   * (틀리면 "PDF만 바뀐다"고 했는데 실제로는 AI에 가는 쪽이라, 애매하면 칸 밖으로 본다)
   * @param {any} f
   */
  const inPartySection = (f) => {
    const b = partyBlocks.get(`${f.documentId}::${f.blockId}`);
    if (!b) return false;
    const inRange = (/** @type {number} */ n) => b.ranges.some((r) => r.startLine <= n && n <= r.endLine);
    const value = String(f.value ?? '');
    const at = value === '' ? -1 : b.lines.findIndex((l) => l.includes(value));
    if (at >= 0) return inRange(b.start + at);
    return b.lines.every((_, i) => inRange(b.start + i));
  };

  for (const f of analysis.findings) {
    const mode = modeOf.get(f.documentId);
    if (mode === 'OMIT') out.set(f.id, 'OMIT');
    else if (mode === 'SUMMARY') out.set(f.id, 'SUMMARY');
    else if (mode === 'PARTY_SUMMARY' && inPartySection(f)) out.set(f.id, 'SUMMARY');
  }
  return out;
}

/**
 * 표의 "Show" 옆 안내 (#359). 이 항목이 AI 글에 그대로 들어가지 않으면, "Show"가 마스킹 PDF만 바꾼다고 알려 준다.
 * @param {string[]} findingIds  표 한 줄에 묶인 항목들
 * @param {Map<string, 'SUMMARY' | 'OMIT'>} notSent
 */
function showNote(findingIds, notSent) {
  const kinds = findingIds.map((id) => notSent.get(id));
  const count = kinds.filter(Boolean).length;
  if (count === 0) return null;
  if (count < findingIds.length) {
    return el('span', { class: 'mr-note mr-show-note' }, [
      'In some places this is not sent to the AI as written (only a summary, or not at all). There, ticking Show only changes the masked PDF.',
    ]);
  }
  const text = kinds.every((k) => k === 'OMIT')
    ? 'This document is not sent to the AI for this purpose, so ticking Show only changes the masked PDF.'
    : 'This part is sent to the AI as a summary with role names only, so ticking Show only changes the masked PDF.';
  return el('span', { class: 'mr-note mr-show-note' }, [text]);
}

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
 *   analysis: { documents: any[], findings: any[], personGroups: any[], fields?: any },
 *   prepared: { maskingPlan: import('../../shared/document-model.js').MaskingPlan, maskedText: Record<string, string>, legend: Record<string, string>,
 *     sentText?: Record<string, string>, sending?: { documentId: string, mode: string, reason?: string }[] },
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

  // 요약으로 보내거나 보내지 않는 곳의 항목: "Show"가 마스킹 PDF만 바꾼다고 알려 준다 (#359)
  const notSent = notSentAsWritten(analysis, prepared);
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

    // 같은 값이 여러 곳에 나오면 한 줄로 묶고 몇 곳인지 보여 준다 (review-model.js)
    const places = row.findingIds.length > 1 ? `${row.findingIds.length} places · ` : '';
    const where = places + row.documentIds.map((id) => DOC_SHORT[docType.get(id)] ?? 'Document').join(', ');
    return el('tr', { class: row.shown ? 'mr-row-shown' : undefined }, [
      // data-label: 휴대폰에서 표를 줄마다 쌓을 때 칸 이름으로 쓴다 (#382, 프로토타입 v2)
      el('td', { class: 'mr-type', 'data-label': 'Type' }, [TYPE_TEXT[row.type] ?? row.type, el('br'), el('span', { class: 'mr-note' }, [where])]),
      // 원본 글자는 이 화면에만 보여 준다 (AI로 보내지 않음)
      el('td', { class: 'mr-original', 'data-label': 'In your document' }, [row.values.join(' / ')]),
      el('td', { class: 'mr-sees', 'data-label': 'What the AI sees' }, [resultBadge(row)]),
      // 항상 가리는 항목(🔒)은 Show가 없으니 안내도 없다
      el('td', { class: 'mr-ctl', 'data-label': 'Show to AI' }, [control, row.locked ? null : showNote(row.findingIds, notSent)]),
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
  // 서류마다 AI에 어떻게 보내는지 (PART 5 prepareForAi의 sending, #361). 없으면(예전 결과) 안내 없이 가린 글만 보여 준다
  const modeOf = new Map((prepared.sending ?? []).map((s) => [s.documentId, s]));
  const preview = el(
    'div',
    { class: 'mr-preview' },
    blocksByDoc.map(({ doc, lines }) =>
      el('div', {}, [
        el('h4', {}, [DOC_TITLE[doc.documentType] ?? doc.documentType]),
        sendNote(modeOf.get(doc.documentId)),
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

  // 한국어 원문과 "Hide selected text"는 기본으로 접는다 (개선 목록 11번: 외국인에게 한국어 원문 확인을 맡기지 않는다)
  // 방금 가렸거나 더 가린 글자가 있으면 결과가 보이게 열어 둔다. PART 5 화면은 이 칸(.mr-korean)을 페이지 그림 아래로 옮길 수 있다.
  const korean = /** @type {HTMLDetailsElement} */ (
    el('details', { class: 'mr-korean', open: koreanOpen || Boolean(note) }, [
      el('summary', {}, ['For someone who reads Korean: check the masked text and hide anything we missed']),
      el('p', { class: 'mr-note' }, [
        'This is the masked Korean text of each document. Did we miss something? Select it, then press "Hide selected text".',
      ]),
      preview,
      el('div', { class: 'mr-add-bar' }, [hideButton, hint]),
      addedList,
    ])
  );
  korean.addEventListener('toggle', () => {
    koreanOpen = korean.open;
  });

  return el('div', { class: 'review mr' }, [
    el('p', { class: 'mr-count' }, [
      `We hid or replaced ${rows.length - shownCount} of ${rows.length} item(s) of personal information.`,
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

    summaryBlocks(analysis, prepared),
    korean,
  ]);
}
