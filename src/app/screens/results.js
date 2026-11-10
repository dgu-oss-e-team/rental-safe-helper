// @ts-check
/** PART 5. ② 위험 점검 결과 화면 (결과 카드는 PART 3 자리) */

import { el, button, card, actions } from '../ui.js';
import { slots, DOCUMENT_TEXT } from '../slots.js';
import { RISK_STATUS, DOCUMENT_TYPE } from '../../shared/document-model.js';

/**
 * @param {ReturnType<typeof import('../app-state.js').initialState>} state
 * @param {import('../main.js').Actions} act
 */
export function resultsScreen(state, act) {
  const analysis = /** @type {import('../pipeline.js').Analysis} */ (state.analysis);
  const count = (status) => analysis.riskResults.filter((r) => r.status === status).length;
  const unknown = analysis.documents.filter((d) => d.documentType === DOCUMENT_TYPE.UNKNOWN).length;

  return el('div', {}, [
    card('Documents', [
      el(
        'ul',
        { class: 'doc-list' },
        analysis.documents.map((d) => el('li', {}, [DOCUMENT_TEXT[d.documentType] ?? d.documentType])),
      ),
      unknown > 0
        ? el('p', { class: 'warning' }, [
            `We could not tell the type of ${unknown} document(s). Please check that you uploaded a property register or a lease contract.`,
          ])
        : null,
    ]),
    card('Check before you sign', [
      el('div', { class: 'summary' }, [
        el('span', { class: 'chip chip-stop' }, [`Stop ${count(RISK_STATUS.STOP)}`]),
        el('span', { class: 'chip chip-check' }, [`Check ${count(RISK_STATUS.CHECK)}`]),
        el('span', { class: 'chip chip-unverifiable' }, [`Could not check ${count(RISK_STATUS.UNVERIFIABLE)}`]),
      ]),
      slots.riskResults(analysis.riskResults),
    ]),
    actions([
      button('Ask AI about it safely', () => act.goTo('purpose')),
      button('Start over', () => act.restart(), { variant: 'secondary' }),
    ]),
  ]);
}
