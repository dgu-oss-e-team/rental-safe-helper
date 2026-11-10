// @ts-check
/** PART 5. ① 서류 올리기 화면 */

import { el, button, card, actions } from '../ui.js';

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
