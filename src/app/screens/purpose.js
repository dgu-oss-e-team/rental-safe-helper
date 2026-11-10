// @ts-check
/** PART 5. ③ 목적 선택 화면: 목적에 따라 가리는 정보가 달라진다 (제안서 목적별 가림 표) */

import { el, button, card, actions } from '../ui.js';
import { MASKING_PURPOSE } from '../../shared/document-model.js';

const PURPOSES = [
  {
    value: MASKING_PURPOSE.FRAUD_CHECK,
    title: 'Check fraud risks',
    text: 'Ask whether the owner, mortgage, and payment account look risky. Names become role names like [Owner_A], and only the city and district of the address are kept.',
  },
  {
    value: MASKING_PURPOSE.CLAUSE_EXPLANATION,
    title: 'Explain clauses and terms',
    text: 'Ask what each part of the documents and the legal terms mean. All names, numbers, and addresses are hidden.',
  },
  {
    value: MASKING_PURPOSE.CONTRACT_EXPLANATION,
    title: 'Explain contract conditions',
    text: 'Ask about the deposit, rent, period, and special terms. All names, numbers, and addresses are hidden.',
  },
];

/**
 * @param {ReturnType<typeof import('../app-state.js').initialState>} state
 * @param {import('../main.js').Actions} act
 */
export function purposeScreen(state, act) {
  return el('div', {}, [
    card('What do you want to ask AI?', [
      el('p', {}, ['We hide personal information depending on your question. ID numbers, phone numbers, and bank accounts are always hidden.']),
      el(
        'div',
        { class: 'options', role: 'radiogroup', 'aria-label': 'Purpose' },
        PURPOSES.map((p) => {
          const id = `purpose-${p.value.toLowerCase()}`;
          const input = /** @type {HTMLInputElement} */ (
            el('input', { type: 'radio', name: 'purpose', id, value: p.value, checked: state.purpose === p.value })
          );
          input.addEventListener('change', () => act.setPurpose(p.value));
          return el('label', { class: 'option', for: id }, [
            input,
            el('span', {}, [el('strong', {}, [p.title]), el('span', { class: 'hint' }, [p.text])]),
          ]);
        }),
      ),
    ]),
    actions([
      button('Hide personal information', () => act.prepare()),
      button('Back', () => act.goTo('results'), { variant: 'secondary' }),
    ]),
  ]);
}
