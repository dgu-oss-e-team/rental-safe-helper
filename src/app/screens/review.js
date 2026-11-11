// @ts-check
/** PART 5. ④ 보내기 전 확인 화면 (확인 내용은 PART 4 자리) */

import { el, button, card, actions } from '../ui.js';
import { slots, DOCUMENT_TEXT } from '../slots.js';

/**
 * 마스킹 PDF 미리보기 (PDF와 같은 방법으로 그린 페이지 이미지)
 * @param {ReturnType<typeof import('../app-state.js').initialState>} state
 */
function pdfPreview(state) {
  const ready = state.previews && state.previews.forPrepared === state.prepared;
  if (!ready) {
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
          ? el('p', { class: 'warning' }, [`Preview not available: ${doc.error.message}`])
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
  const analysis = /** @type {import('../pipeline.js').Analysis} */ (state.analysis);
  const prepared = /** @type {import('../pipeline.js').Prepared} */ (state.prepared);

  // 제안서: 가린 결과를 미리 보여 주고, 사용자가 확인한 뒤에만 활용한다
  const confirm = /** @type {HTMLInputElement} */ (
    el('input', { type: 'checkbox', id: 'reviewed', checked: state.reviewed })
  );
  confirm.addEventListener('change', () => act.setReviewed(confirm.checked));

  return el('div', {}, [
    card('Check what will be shared', [
      el('p', {}, ['This is exactly what the AI will see. Make sure no name, ID number, phone number, account, or full address is left.']),
      slots.maskingReview({
        analysis,
        prepared,
        edits: state.maskingEdits,
        onChange: (edits) => act.setMaskingEdits(edits),
      }),
    ]),
    card('How the masked PDF will look', [
      el('p', {}, ['The PDF you download is made from these page images. Black boxes and role names replace the hidden parts.']),
      pdfPreview(state),
    ]),
    el('label', { class: 'confirm', for: 'reviewed' }, [
      confirm,
      ' I checked the text and the pages above. No personal information is left.',
    ]),
    actions([
      button('Create masked PDF and AI prompt', () => act.finish(), { disabled: !state.reviewed }),
      button('Back', () => act.goTo('purpose'), { variant: 'secondary' }),
    ]),
  ]);
}
