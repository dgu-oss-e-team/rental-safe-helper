// @ts-check
/**
 * PART 5. ① 다음 "Confirm text" 단계: 사진·스캔 서류의 OCR 글자를 사용자가 확인한다. (#54)
 * 확인 화면 자체는 PART 1 ocr-editor(slots.ocrEditor)이고, PART 5는 화면 틀과 "다음으로" 조건을 맡는다.
 *
 * 노션 PART 1 완료 기준 "OCR 결과를 사용자가 수정할 수 있다", 6-3 "OCR 결과가 불확실한 항목을 정상으로 확정하지 않는다"
 * → 흐린 줄(PART 1 기준)을 모두 고치거나 확인해야 다음 단계로 넘어갈 수 있다.
 *
 * 주의: PART 1 화면은 입력 중인 내용을 스스로 들고 있으므로, 글자를 고칠 때마다 이 화면을 다시 그리지 않는다.
 *       (다시 그리면 입력 칸 포커스가 사라진다) 고친 내용은 act.setOcrDraft()로 저장만 하고,
 *       남은 줄 수와 버튼 상태만 이 화면에서 직접 바꾼다.
 */

import { el, button, card, actions } from '../ui.js';
import { slots } from '../slots.js';

/**
 * @param {ReturnType<typeof import('../app-state.js').initialState>} state
 * @param {import('../main.js').Actions} act
 */
export function confirmScreen(state, act) {
  const review = /** @type {NonNullable<typeof state.ocrReview>} */ (state.ocrReview);
  const draft = act.getOcrDraft();

  const status = el('p', { class: 'hint', role: 'status' }, []);
  const next = button('Continue to the results', () => act.confirmOcr(), { id: 'confirm-ocr' });

  /** @param {number} remaining */
  const showRemaining = (remaining) => {
    next.toggleAttribute('disabled', remaining > 0);
    status.textContent =
      remaining > 0
        ? `${remaining} ${remaining === 1 ? 'line still needs' : 'lines still need'} your check. Fix any misread text, then confirm each marked line.`
        : 'All marked lines are checked. You can continue.';
  };

  const editor = slots.ocrEditor
    ? slots.ocrEditor({
        documents: draft,
        files: review.files,
        onChange: (docs) => showRemaining(act.setOcrDraft(docs)),
      })
    : el('p', { class: 'warning' }, ['The text review screen could not be loaded. Please start over.']);

  showRemaining(act.countOcrLinesToCheck(draft));

  return el('div', {}, [
    card('Check the text we read', [
      el('p', {}, [
        'Some of your documents are photos or scans. Text recognition can make mistakes, so please compare the lines we marked with your document before we check the risks.',
      ]),
      el('p', { class: 'hint' }, ['Wrong numbers or names can stop us from finding and hiding personal information.']),
    ]),
    editor,
    status,
    actions([next, button('Back', () => act.cancelOcr(), { variant: 'secondary' })]),
  ]);
}
