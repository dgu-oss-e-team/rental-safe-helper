// @ts-check
/** PART 5. ⑤ 완료 화면: 마스킹 PDF 다운로드 + AI 상담 연결 */

import { el, button, card, actions } from '../ui.js';
import { DOCUMENT_TEXT } from '../slots.js';
import { DOCUMENT_TYPE, MASKING_PURPOSE } from '../../shared/document-model.js';
import { errorHelp } from '../error-help.js';
import { CHECK_STATUS, PII_TYPE_TEXT, partlyCheckedText } from '../double-check.js';
import { hasPhotoDocuments } from '../text-review.js';
import { buildRestoreTable, restoreAliases } from '../alias-restore.js';

/**
 * 웹서비스가 AI를 직접 부르지 않는다. 프롬프트를 복사해 두고 사용자가 직접 붙여넣는다 (제안서 ⑨).
 * 링크를 누르면 복사를 시작하고, 링크 기본 동작으로 새 탭이 열린다.
 */
const AI_SERVICES = [
  { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { name: 'Claude', url: 'https://claude.ai/new' },
  { name: 'Gemini', url: 'https://gemini.google.com/app' },
];

/** 다운로드 주소. 화면을 다시 그릴 때 이전 주소를 풀어 메모리를 돌려준다 */
let downloadUrls = [];

/**
 * @param {any[]} pdfs  exportMaskedPdfs() 결과
 */
function downloads(pdfs) {
  downloadUrls.forEach((u) => URL.revokeObjectURL(u));
  downloadUrls = [];
  return pdfs.map((p) => {
    if (!p.result.ok) {
      const { title, help } = errorHelp({ step: 'export', code: p.result.error.code });
      return el('p', { class: 'warning' }, [`${DOCUMENT_TEXT[p.documentType] ?? 'Document'}: ${title} ${help}`]);
    }
    const url = URL.createObjectURL(p.result.data.blob);
    downloadUrls.push(url);
    const pages = p.result.data.pageCount;
    return el('a', { class: 'download', href: url, download: p.result.data.fileName }, [
      `Download ${p.result.data.fileName} (${pages} page${pages > 1 ? 's' : ''})`,
    ]);
  });
}

/**
 * @param {string} text
 * @param {HTMLTextAreaElement} box
 * @param {HTMLElement} status
 */
function copyPrompt(text, box, status) {
  navigator.clipboard.writeText(text).then(
    () => {
      status.textContent = 'Prompt copied. Paste it into the AI chat.';
    },
    () => {
      box.select();
      status.textContent = 'Could not copy automatically. Press Ctrl+C (or Copy) to copy the selected text.';
    },
  );
}

/**
 * "Double-check the PDF": 마스킹 PDF를 OCR로 다시 읽어 탐지했던 개인정보가 보이는지 확인한다. (노션 10장)
 * OCR은 시간이 걸리고(페이지당 몇 초) 처음에 읽기 도구를 받아야 해서, 글자 PDF는 원할 때만 누르게 한다.
 * 사진·스캔 서류는 PDF를 만들자마자 자동으로 한다 (#314, main.js finish).
 * 결과는 "안전하다"고 말하지 않는다. 값은 보여 주지 않고 종류와 페이지만 알려 준다.
 * @param {ReturnType<typeof import('../app-state.js').initialState>} state
 * @param {import('../main.js').Actions} act
 * @param {boolean} [photo]  사진·스캔 서류가 있는지
 */
function doubleCheckSection(state, act, photo = false) {
  const { doubleCheck } = state;
  if (doubleCheck === 'running') {
    return el('p', { class: 'busy', role: 'status', id: 'double-check-running' }, [
      el('span', { class: 'spinner', 'aria-hidden': 'true' }),
      photo
        ? 'Checking the masked PDF before you download it… (a few seconds per page)'
        : 'Reading the masked pages again… (a few seconds per page)',
    ]);
  }
  // 사진·스캔 서류는 보통 자동으로 시작한다. 시작하지 못했을 때(검사 도구를 못 받음 등)만 이 버튼이 보인다 (#314)
  if (!doubleCheck && photo) {
    return el('div', { class: 'double-check' }, [
      el('p', { class: 'hint' }, [
        'Before you download, we read the masked pages again to look for personal information that is still visible.',
      ]),
      actions([button('Check the masked PDF', () => act.doubleCheckPdfs(), { id: 'double-check' })]),
    ]);
  }
  if (!doubleCheck) {
    return el('div', { class: 'double-check' }, [
      el('p', { class: 'hint' }, [
        'Want to be sure? We can read the masked pages again with text recognition (OCR) and look for the personal information we detected.',
      ]),
      actions([button('Double-check the PDF', () => act.doubleCheckPdfs(), { id: 'double-check', variant: 'secondary' })]),
    ]);
  }
  return el(
    'ul',
    { class: 'double-check-results', role: 'status' },
    doubleCheck.map((r) => {
      const name = DOCUMENT_TEXT[r.documentType] ?? 'Document';
      if (r.status === CHECK_STATUS.NOT_FOUND) {
        return el('li', { class: 'check-ok' }, [
          `${name}: none of the personal information we detected was found in the page images. `,
          el('span', { class: 'hint' }, ['This covers only what we detected, so please look through the PDF once yourself.']),
        ]);
      }
      if (r.status === CHECK_STATUS.PARTLY_CHECKED) {
        // 읽은 부분만 확인했다고 분명히 말하고, 흐린 줄이 있는 페이지를 직접 보라고 한다 (#146)
        return el('li', { class: 'warning' }, [`${name}: ${partlyCheckedText(r.unclear)}`]);
      }
      if (r.status === CHECK_STATUS.MAYBE_VISIBLE) {
        const where = r.hits.map((h) => `${PII_TYPE_TEXT[h.type] ?? h.type} (page ${h.pageIndex + 1})`).join(', ');
        return el('li', { class: 'warning' }, [
          `${name}: this may still be visible: ${where}. Check the PDF before you share it, or go back and hide it.`,
        ]);
      }
      return el('li', { class: 'warning' }, [
        `${name}: could not check, because the text in the page images could not be read clearly. Please look through the PDF yourself.`,
      ]);
    }),
  );
}

/**
 * 사진·스캔 서류에서 다시 확인 결과에 경고가 있는지 (#314)
 * "찾지 못함(NOT_FOUND)"이 아닌 결과(보일 수 있음, 일부만 확인, 확인 불가)는 모두 사용자가 직접 봐야 한다.
 * @param {ReturnType<typeof import('../app-state.js').initialState>['doubleCheck']} doubleCheck
 */
export function hasCheckWarning(doubleCheck) {
  return Array.isArray(doubleCheck) && doubleCheck.some((r) => r.status !== CHECK_STATUS.NOT_FOUND);
}

/**
 * 사진·스캔 서류의 다운로드 영역 (#314)
 * OCR이 깨지게 읽은 줄은 탐지가 놓칠 수 있어서, 다시 확인이 끝나기 전에는 다운로드를 보여 주지 않는다.
 * 경고가 있으면 그 쪽을 직접 봤다고 체크해야 다운로드가 나온다. (확인에 실패해도 체크하면 받을 수 있다)
 * @param {ReturnType<typeof import('../app-state.js').initialState>} state
 * @param {import('../main.js').Actions} act
 */
function photoDownloads(state, act) {
  const { doubleCheck } = state;
  if (!Array.isArray(doubleCheck)) {
    return [el('p', { class: 'hint', id: 'downloads-wait' }, ['The download links appear after this check.'])];
  }
  if (!hasCheckWarning(doubleCheck)) return [el('div', { class: 'downloads' }, downloads(state.pdfs ?? []))];

  const box = /** @type {HTMLInputElement} */ (el('input', { type: 'checkbox', id: 'pdf-checked', checked: state.pdfChecked }));
  box.addEventListener('change', () => act.setPdfChecked(box.checked));
  return [
    el('p', { class: 'warning', id: 'pdf-check-warning' }, [
      'Some of your documents are photos or scans. Text that was misread may not have been found and hidden. ' +
        'Open the PDF and look at the pages listed above before you share it. If something is still visible, go back and hide it.',
    ]),
    actions([button('Go back and hide more', () => act.goTo('review'), { id: 'back-to-review', variant: 'secondary' })]),
    el('label', { class: 'confirm', for: 'pdf-checked' }, [
      box,
      ' I looked at these pages myself. Show the download links and the AI prompt.',
    ]),
    state.pdfChecked ? el('div', { class: 'downloads' }, downloads(state.pdfs ?? [])) : null,
  ];
}

/**
 * 사진·스캔 서류에서 AI 프롬프트를 아직 보여 주면 안 되는 까닭 (#315 리뷰)
 * 다시 확인에서 경고가 나는 줄은 보통 처음 OCR이 잘못 읽은 줄이고, 프롬프트의 가린 글도 같은 OCR 글이다.
 * 보내기 전 검사는 탐지한 값만 비교하므로 이런 줄은 못 잡는다. 그래서 다운로드와 같은 조건으로 프롬프트를 보여 준다.
 * @param {ReturnType<typeof import('../app-state.js').initialState>} state
 * @returns {string | null}  보여 줄 안내 (null이면 프롬프트를 보여 줘도 됨)
 */
export function promptHoldReason(state) {
  if (!hasPhotoDocuments(state.analysis)) return null;
  if (!Array.isArray(state.doubleCheck)) return 'The prompt appears after the check above.';
  if (hasCheckWarning(state.doubleCheck) && !state.pdfChecked) {
    return (
      'Photo or scan text may still contain misread personal information, and the prompt is made from the same text. ' +
      'Check the pages listed above first. If something is still visible, go back and hide it — the prompt is updated too.'
    );
  }
  return null;
}

/**
 * @param {ReturnType<typeof import('../app-state.js').initialState>} state
 * @param {import('../main.js').Actions} act
 */
export function doneScreen(state, act) {
  const prepared = /** @type {import('../pipeline.js').Prepared} */ (state.prepared);
  const box = /** @type {HTMLTextAreaElement} */ (el('textarea', { id: 'prompt', rows: '12', readonly: true }));
  box.value = prepared.prompt;
  const status = el('p', { class: 'hint', role: 'status' }, []);
  // 사진·스캔 서류는 다시 확인을 먼저 하고, 그 결과를 본 뒤에 받는다 (#314). 글자 PDF는 지금처럼 받은 뒤 원하면 확인한다.
  const photo = hasPhotoDocuments(state.analysis);

  return el('div', {}, [
    card(
      'Masked documents',
      photo
        ? [
            el('p', {}, ['These PDFs are rebuilt from page images, so the hidden text cannot be copied or searched.']),
            doubleCheckSection(state, act, true),
            ...photoDownloads(state, act),
          ]
        : [
            el('p', {}, ['These PDFs are rebuilt from page images, so the hidden text cannot be copied or searched.']),
            el('div', { class: 'downloads' }, downloads(state.pdfs ?? [])),
            doubleCheckSection(state, act),
          ],
    ),
    card('Ask AI', askAi(state, prepared, box, status)),
    restoreCard(state, prepared),
    actions([button('Check other documents', () => act.restart(), { variant: 'secondary' })]),
  ]);
}

/**
 * 서류마다 프롬프트에 어떻게 들어갔는지 안내 (#360). 가린 원문 그대로 넣은 서류는 따로 말하지 않는다.
 * @param {import('../pipeline.js').SentDocument[] | undefined} sending
 * @param {{ documentType: string }[] | null} [documents]  올린 서류 (주면 올리지 않은 등기부·계약서를 "not added"로 알린다)
 * @returns {string[]}
 */
export function sendingNotes(sending, documents = null) {
  if (!Array.isArray(sending)) return [];
  /** @type {string[]} */
  const notes = [];
  // 올리지 않은 서류도 알려 준다 (정연님 의견): 계약 조건 설명처럼 등기부 없이 진행할 수 있어서, 빠진 건지 안 보낸 건지 헷갈리지 않게
  if (Array.isArray(documents)) {
    const types = new Set(documents.map((d) => d.documentType));
    for (const t of [DOCUMENT_TYPE.REGISTRY, DOCUMENT_TYPE.LEASE_CONTRACT]) {
      if (!types.has(t)) notes.push(`${DOCUMENT_TEXT[t]}: not added. The checks that need it show "Could not check".`);
    }
  }
  for (const s of sending) {
    const name = DOCUMENT_TEXT[s.documentType] ?? 'Document';
    if (s.mode === 'SUMMARY') {
      notes.push(`${name}: only a short list of extracted items is in the prompt, not the full text.`);
      if ((s.hiddenCount ?? 0) > 0) {
        const n = /** @type {number} */ (s.hiddenCount);
        notes.push(
          `${name}: ${n} ${n === 1 ? 'item was' : 'items were'} hidden in that list because ${n === 1 ? 'it' : 'they'} may contain personal information. Check ${n === 1 ? 'it' : 'them'} in the original yourself.`,
        );
      }
    } else if (s.mode === 'PARTY_SUMMARY') {
      notes.push(`${name}: the section with the parties' personal details is replaced by a short list of roles. The rest is the masked text.`);
    } else if (s.mode === 'OMIT' && s.reason === 'SUMMARY_FAILED') {
      notes.push(`${name}: not in the prompt, because we could not prepare its summary. The full text is never shared instead. Check it yourself.`);
    } else if (s.mode === 'OMIT') {
      notes.push(`${name}: not in the prompt, because this purpose does not need it.`);
    }
  }
  return notes;
}

/**
 * "Ask AI" 카드 내용. 사진·스캔 서류는 다시 확인 결과를 본 뒤에만 프롬프트를 보여 준다 (promptHoldReason)
 * @param {ReturnType<typeof import('../app-state.js').initialState>} state
 * @param {import('../pipeline.js').Prepared} prepared
 * @param {HTMLTextAreaElement} box
 * @param {HTMLElement} status
 */
function askAi(state, prepared, box, status) {
  const hold = promptHoldReason(state);
  if (hold) {
    return [
      el('p', {}, ['Copy the prompt and paste it into the AI chat. This website does not send anything to AI by itself.']),
      el('p', { class: 'hint', id: 'prompt-wait' }, [hold]),
    ];
  }
  const notes = sendingNotes(prepared.sending, state.analysis?.documents ?? null);
  // 이 목적에 보낼 서류가 없으면 프롬프트를 만들지 않는다 (#360, 예: 등기부만 올리고 계약 조건 설명)
  if (!prepared.prompt) {
    return [
      el('ul', { class: 'sending-notes', id: 'sending-notes' }, notes.map((n) => el('li', {}, [n]))),
      el('p', { class: 'hint', id: 'no-prompt' }, [
        'There is no prompt for this purpose. To ask AI, go back and add the document this purpose needs, or choose another purpose.',
      ]),
    ];
  }
  return [
    el('p', {}, ['Copy the prompt and paste it into the AI chat. This website does not send anything to AI by itself.']),
    ...(notes.length > 0 ? [el('ul', { class: 'sending-notes', id: 'sending-notes' }, notes.map((n) => el('li', {}, [n])))] : []),
    el('label', { for: 'prompt' }, ['Prompt']),
    box,
    actions([button('Copy prompt', () => copyPrompt(prepared.prompt, box, status), { id: 'copy' })]),
    el(
      'div',
      { class: 'ai-links' },
      AI_SERVICES.map((s) => {
        const link = el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', class: 'ai-link' }, [`Copy and open ${s.name}`]);
        link.addEventListener('click', () => copyPrompt(prepared.prompt, box, status));
        return link;
      }),
    ),
    status,
  ];
}

/**
 * "Read the AI answer with real names" 카드 (#394, 도전 목표 ②)
 * AI 답변을 붙여 넣으면 [Landlord_B] 같은 가명을 이 브라우저 안에서만 원래 이름으로 보여 준다.
 * 붙여 넣은 글과 결과는 저장하지 않는다 (화면을 다시 그리거나 새로 시작하면 사라진다). 복사 버튼은 두지 않는다.
 * 프롬프트를 보여 줄 때(다시 확인을 기다리지 않을 때)만 나온다.
 * 바꿀 가명이 없으면(조항·계약 설명 목적은 이름을 가명 대신 완전히 가린다) 카드 자리에 그 이유를 짧게 알린다 (#395 리뷰).
 * @param {ReturnType<typeof import('../app-state.js').initialState>} state
 * @param {import('../pipeline.js').Prepared} prepared
 * @returns {HTMLElement | null}
 */
function restoreCard(state, prepared) {
  if (!prepared.prompt || promptHoldReason(state)) return null;
  const table = buildRestoreTable(prepared.maskingPlan, state.analysis?.findings);
  if (table.size === 0) {
    const reason =
      prepared.maskingPlan?.purpose === MASKING_PURPOSE.FRAUD_CHECK
        ? 'No name labels like [Landlord_B] were sent to the AI this time, so there are no names to put back.'
        : 'For this purpose, names are fully hidden instead of being replaced with labels like [Landlord_B], ' +
          'so there are no names to put back. To see who is who in the AI answer, choose "Check fraud risks".';
    return card('Read the AI answer with real names', [el('p', { class: 'hint', id: 'restore-none' }, [reason])], 'restore-card');
  }

  const input = /** @type {HTMLTextAreaElement} */ (
    el('textarea', { id: 'ai-answer', rows: '8', autocomplete: 'off', spellcheck: 'false' })
  );
  const output = el('div', { class: 'restored-answer', id: 'restored-answer', hidden: true }, []);
  const status = el('p', { class: 'hint', id: 'restore-status', role: 'status' }, []);

  const show = () => {
    const { segments, replaced } = restoreAliases(input.value, table);
    output.replaceChildren(
      ...segments.map((seg) =>
        'alias' in seg
          ? el('mark', { class: seg.unconfirmed ? 'restored unconfirmed' : 'restored', title: seg.alias }, [
              seg.name,
              el('span', { class: 'restored-alias' }, [
                seg.unconfirmed ? ` (${seg.alias}: same name, not confirmed to be the same person)` : ` (${seg.alias})`,
              ]),
            ])
          : document.createTextNode(seg.text),
      ),
    );
    output.hidden = segments.length === 0;
    status.textContent = !input.value.trim()
      ? 'Paste the AI answer first.'
      : replaced === 0
        ? 'We found no labels like [Landlord_B] in this answer.'
        : `Replaced ${replaced} label${replaced === 1 ? '' : 's'} with real names.`;
  };
  const clear = () => {
    input.value = '';
    output.replaceChildren();
    output.hidden = true;
    status.textContent = '';
    input.focus();
  };

  return card('Read the AI answer with real names', [
    el('p', {}, [
      'Paste the answer from the AI here. We put the real names back in place of labels like [Landlord_B], so you can see who is who.',
    ]),
    el('p', { class: 'hint', id: 'restore-privacy' }, [
      'This happens only in this browser. The answer and the names are not saved or sent anywhere, and they are gone when you leave this page. ' +
        'Only name labels are changed. Addresses and numbers stay hidden.',
    ]),
    el('label', { for: 'ai-answer' }, ['AI answer']),
    input,
    actions([
      button('Show real names', show, { id: 'restore-names' }),
      button('Clear', clear, { id: 'restore-clear', variant: 'secondary' }),
    ]),
    status,
    output,
  ], 'restore-card');
}
