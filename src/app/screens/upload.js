// @ts-check
/** PART 5. ① 서류 올리기 화면 */

import { el, button, card, actions } from '../ui.js';
import { resumeStep } from '../step-history.js';

/**
 * 이전 결과가 남아 있으면 ① 위쪽에 보여 주는 안내 (#124)
 * 제목·뒤로 가기로 ①에 오면 결과는 그대로인데, 그걸 몰라서 사라졌다고 생각하지 않게 한다.
 * 파일 이름 등 서류 정보는 넣지 않는다.
 * @param {ReturnType<typeof import('../app-state.js').initialState>} state
 * @param {import('../main.js').Actions} act
 */
function resumeCard(state, act) {
  const step = resumeStep(state);
  if (!step) return null;
  return card(
    'Your earlier results are still here',
    [
      el('p', {}, ['If you check new documents or try the sample, these results will be replaced.']),
      actions([button('Back to your results', () => act.goTo(step), { id: 'back-to-results', variant: 'secondary' })]),
    ],
    'resume-card',
  );
}

/**
 * 파일 고르는 칸 하나
 * @param {string} id
 * @param {string} label
 * @param {string} hint
 * @param {File | null} current
 * @param {(file: File | null) => void} onChange
 */
function filePicker(id, label, hint, current, onChange) {
  const input = /** @type {HTMLInputElement} */ (
    el('input', { type: 'file', id, accept: 'application/pdf,image/jpeg,image/png' })
  );
  input.addEventListener('change', () => onChange(input.files?.[0] ?? null));
  return el('div', { class: 'picker' }, [
    el('label', { for: id }, [label]),
    el('p', { class: 'hint' }, [hint]),
    input,
    // 파일 이름에는 개인정보가 있을 수 있어 화면에만 보여 준다
    current ? el('p', { class: 'chosen' }, [`Selected: ${current.name}`]) : null,
  ]);
}

/**
 * @param {ReturnType<typeof import('../app-state.js').initialState>} state
 * @param {import('../main.js').Actions} act
 */
export function uploadScreen(state, act) {
  const { registry, lease } = state.files;
  const hasFile = Boolean(registry || lease);
  return el('div', {}, [
    resumeCard(state, act),
    card('Upload your documents', [
      el('p', {}, [
        'Upload the property register and the lease contract you received. PDF files and photos (JPG, PNG) both work. On a phone, you can take a photo.',
      ]),
      filePicker(
        'registry-file',
        'Property register (등기부등본)',
        'Shows who owns the home and any mortgage or seizure.',
        registry,
        (f) => act.setFiles({ registry: f }),
      ),
      filePicker(
        'lease-file',
        'Lease contract (임대차계약서)',
        'The contract you are about to sign.',
        lease,
        (f) => act.setFiles({ lease: f }),
      ),
      actions([
        button('Check my documents', () => act.analyze(), { id: 'run', disabled: !hasFile }),
        button('Try with sample data', () => act.analyzeSample(), { id: 'run-sample', variant: 'secondary' }),
      ]),
    ]),
  ]);
}
