// @ts-check
/** PART 5. ④ 보내기 전 확인 화면 (확인 내용은 PART 4 자리) */

import { el, button, card, actions } from '../ui.js';
import { slots } from '../slots.js';

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
      slots.maskingReview({ analysis, prepared }),
      el('label', { class: 'confirm', for: 'reviewed' }, [confirm, ' I checked that no personal information is left.']),
    ]),
    actions([
      button('Create masked PDF and AI prompt', () => act.finish(), { disabled: !state.reviewed }),
      button('Back', () => act.goTo('purpose'), { variant: 'secondary' }),
    ]),
  ]);
}
