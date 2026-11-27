// @ts-check
/** PART 5. ④ 보내기 전 확인 화면 (확인 내용은 PART 4 자리) */

import { el, button, card, actions } from '../ui.js';
import { slots, DOCUMENT_TEXT } from '../slots.js';
import { currentAnalysis } from '../app-state.js';
import { errorHelp } from '../error-help.js';
import { sendingNotes } from './done.js';

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
  const korean = review.querySelector('.mr-korean');
  korean?.remove();
  // 서류마다 AI에 어떻게 보내는지 (#361의 sending). 등기부는 목적에 따라 요약만 가거나 안 가서, "AI가 보는 그대로"가 아니다 (개선 목록 12번)
  const notes = sendingNotes(prepared.sending);

  return el('div', {}, [
    card('Check what will be shared', [
      el('p', {}, [
        'We hid personal information before anything is shared. Check the table and the page images below: no name, ID number, phone number, account, or full address should be left. You do not need to read Korean.',
      ]),
      notes.length > 0 ? el('ul', { class: 'sending-notes', id: 'review-sending-notes' }, notes.map((n) => el('li', {}, [n]))) : null,
      review,
    ]),
    card('How the masked PDF will look', [
      el('p', {}, ['The PDF you download is made from these page images. Black boxes and role names replace the hidden parts.']),
      pdfPreview(state),
    ]),
    korean ? card('Masked Korean text', [korean]) : null,
    el('label', { class: 'confirm', for: 'reviewed' }, [
      confirm,
      ' I looked at the table and the page images above. I did not see any name, ID number, phone number, or bank account that is still visible.',
    ]),
    ready ? null : el('p', { class: 'hint' }, ['You can tick this after the page preview is ready.']),
    actions([
      button('Create masked PDF and AI prompt', () => act.finish(), { disabled: !state.reviewed }),
      button('Back', () => act.goTo('purpose'), { variant: 'secondary' }),
    ]),
  ]);
}
