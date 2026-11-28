// @ts-check
/** PART 5. ④ 보내기 전 확인 화면 (확인 내용은 PART 4 자리) */

import { el, button, card, actions } from '../ui.js';
import { slots, DOCUMENT_TEXT } from '../slots.js';
import { currentAnalysis } from '../app-state.js';
import { errorHelp } from '../error-help.js';
import { sendingNotes } from './done.js';
import { purposeInfo } from '../purposes.js';

/** 개인정보 표를 모두 펼쳤는지 (표를 고칠 때마다 화면을 다시 그려도 펼친 채로 둔다) */
let showAllRows = false;
/** 처음에 보여 줄 줄 수 (프로토타입 v2) */
const FIRST_ROWS = 5;

/**
 * 표가 길면 처음 5줄만 보이고 "Show all N items"로 펼친다 (#382, 프로토타입 v2).
 * 사용자가 Show를 고른 줄은 늘 보인다.
 * @param {HTMLElement} review
 */
function collapseLongTable(review) {
  const rows = /** @type {HTMLTableRowElement[]} */ ([...review.querySelectorAll('.mr-table tbody tr')]);
  if (rows.length <= FIRST_ROWS + 1 || showAllRows) return;
  rows.forEach((tr, i) => {
    if (i >= FIRST_ROWS && !tr.classList.contains('mr-row-shown')) tr.hidden = true;
  });
  const more = button(`Show all ${rows.length} items`, () => {
    showAllRows = true;
    rows.forEach((tr) => (tr.hidden = false));
    more.remove();
  }, { id: 'show-all-rows', variant: 'secondary' });
  more.classList.add('text-button');
  review.querySelector('.mr-table')?.after(more);
}

/**
 * 지금 마스킹 결과(prepared)에 맞는 미리보기가 다 그려졌는지
 * @param {ReturnType<typeof import('../app-state.js').initialState>} state
 */
function isPreviewReady(state) {
  return Boolean(state.previews && state.previews.forPrepared === state.prepared);
}

/**
 * 마스킹 PDF 미리보기 (PDF와 같은 방법으로 그린 페이지 이미지)
 * @param {ReturnType<typeof import('../app-state.js').initialState>} state
 */
function pdfPreview(state) {
  if (!isPreviewReady(state)) {
    return el('p', { class: 'busy', role: 'status' }, [
      el('span', { class: 'spinner', 'aria-hidden': 'true' }),
      'Drawing the masked pages…',
    ]);
  }
  return el(
    'div',
    { class: 'page-previews' },
    /** @type {NonNullable<typeof state.previews>} */ (state.previews).docs.map((doc) => {
      const name = DOCUMENT_TEXT[doc.documentType] ?? doc.documentType;
      return el('div', {}, [
        el('h3', {}, [name]),
        doc.error
          ? el('p', { class: 'warning' }, [`Preview not available. ${errorHelp({ step: 'preview', code: doc.error.code }).title}`])
          : null,
        ...doc.pages.map((pg) =>
          el('img', {
            class: 'page-preview',
            src: pg.url,
            width: String(pg.width),
            height: String(pg.height),
            alt: `Masked page ${pg.pageIndex + 1} of the ${name}`,
          }),
        ),
      ]);
    }),
  );
}

/**
 * @param {ReturnType<typeof import('../app-state.js').initialState>} state
 * @param {import('../main.js').Actions} act
 */
export function reviewScreen(state, act) {
  // "같은 사람인가요?" 답을 반영한 그룹 (같은 사람의 이름은 한 줄로 묶여 같이 해제된다)
  const analysis = /** @type {import('../pipeline.js').Analysis} */ (currentAnalysis(state));
  const prepared = /** @type {import('../pipeline.js').Prepared} */ (state.prepared);

  // 제안서: 가린 결과를 미리 보여 주고, 사용자가 확인한 뒤에만 활용한다
  // "위 페이지를 확인했다"는 문구와 맞게, 미리보기가 다 그려진 뒤에만 체크할 수 있다
  const ready = isPreviewReady(state);
  const confirm = /** @type {HTMLInputElement} */ (
    el('input', { type: 'checkbox', id: 'reviewed', checked: state.reviewed, disabled: !ready })
  );
  confirm.addEventListener('change', () => act.setReviewed(confirm.checked));

  const review = slots.maskingReview({
    analysis,
    prepared,
    edits: state.maskingEdits,
    onChange: (edits) => act.setMaskingEdits(edits),
  });
  // 한국어 가린 원문 접힌 칸은 페이지 그림 아래, 맨 끝으로 옮긴다 (개선 목록 11번: 기본 화면은 표와 페이지 그림)
  // 프로토타입 v2 배치 (#382): PART 4 확인 화면의 칸들을 자리만 옮긴다 (내용·동작은 그대로)
  //  - 한국어 가린 원문(.mr-korean): 맨 아래 넓은 칸 / 요약으로 보내는 글(.mr-summaries): 오른쪽 "Sent to the AI"
  //  - 가린 개수(.mr-count): 맨 위 초록 띠 / 역할 이름: 왼쪽 표 아래 따로 카드
  collapseLongTable(review);
  const korean = review.querySelector('.mr-korean');
  korean?.remove();
  const summaries = review.querySelector('.mr-summaries');
  summaries?.remove();
  const count = review.querySelector('.mr-count');
  count?.remove();
  const legend = review.querySelector('.legend')?.parentElement ?? null;
  legend?.remove();
  legend?.querySelector('h3')?.remove();
  const notes = sendingNotes(prepared.sending, analysis.documents);
  const onlySummary = (prepared.sending ?? []).some((d) => d.mode === 'SUMMARY' || d.mode === 'PARTY_SUMMARY');

  const back = button('Back to results', () => act.goTo('results'), { variant: 'secondary' });
  back.classList.add('text-button');
  const changePurpose = button('Change', () => act.goTo('results'), { id: 'review-change-purpose', variant: 'secondary' });
  changePurpose.classList.add('text-button');
  changePurpose.setAttribute('aria-label', 'Change purpose on the results screen');

  return el('div', { class: 'review-screen' }, [
    el('div', { class: 'page-head' }, [
      el('h2', { class: 'page-title' }, ['Check what will be shared']),
      el('p', { class: 'page-purpose' }, [
        el('span', { class: 'hint' }, ['Purpose: ']),
        el('strong', {}, [purposeInfo(prepared.purpose ?? state.purpose).title]),
        el('span', { class: 'hint', 'aria-hidden': 'true' }, [' · ']),
        changePurpose,
      ]),
    ]),
    el('div', { class: 'ok-banner', role: 'status' }, [
      el('strong', {}, [count?.textContent ?? 'We hid personal information before anything is shared.']),
      el('p', {}, [
        'Check the table and the page images: no name, ID number, phone number, account, or full address should be left. You do not need to read Korean.',
      ]),
    ]),
    el('div', { class: 'review-grid' }, [
      el('div', { class: 'review-main' }, [
        el('section', { class: 'card review-table-card' }, [review]),
        legend ? card('Role names', [legend], 'role-names-card') : null,
      ]),
      el('div', { class: 'review-side' }, [
        card(
          'Sent to the AI',
          [
            onlySummary ? el('span', { class: 'pill-summary' }, ['Summary only']) : null,
            notes.length > 0 ? el('ul', { class: 'sending-notes', id: 'review-sending-notes' }, notes.map((n) => el('li', {}, [n]))) : null,
            summaries,
          ],
          'sent-card',
        ),
        card(
          'How the masked PDF will look',
          [
            el('p', { class: 'hint' }, ['The PDF you download is made from these page images. Black boxes and role names replace the hidden parts.']),
            pdfPreview(state),
          ],
          'preview-card',
        ),
      ]),
    ]),
    korean ? el('section', { class: 'card korean-card' }, [korean]) : null,
    el('div', { class: 'confirm-bar' }, [
      el('label', { class: 'confirm', for: 'reviewed' }, [
        confirm,
        ' I looked at the table and the page images above. I did not see any name, ID number, phone number, or bank account that is still visible.',
      ]),
      ready ? null : el('p', { class: 'hint' }, ['You can tick this after the page preview is ready.']),
      el('div', { class: 'confirm-actions' }, [
        back,
        button('Create masked PDF and AI prompt', () => act.finish(), { disabled: !state.reviewed }),
      ]),
    ]),
  ]);
}
