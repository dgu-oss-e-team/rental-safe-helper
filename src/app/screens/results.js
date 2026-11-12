// @ts-check
/** PART 5. ② 위험 점검 결과 화면 (결과 카드는 PART 3 자리) */

import { el, button, card, actions } from '../ui.js';
import { slots, DOCUMENT_TEXT } from '../slots.js';
import { RISK_STATUS, DOCUMENT_TYPE } from '../../shared/document-model.js';
import { currentAnalysis } from '../app-state.js';

/**
 * @param {ReturnType<typeof import('../app-state.js').initialState>} state
 * @param {import('../main.js').Actions} act
 */
export function resultsScreen(state, act) {
  // 위험 결과는 "같은 사람인가요?" 답을 반영한 것, 질문은 원래 판정 기준 (INTERFACES.md 6번)
  const analysis = /** @type {import('../pipeline.js').Analysis} */ (currentAnalysis(state));
  const original = /** @type {import('../pipeline.js').Analysis} */ (state.analysis);
  const count = (status) => analysis.riskResults.filter((r) => r.status === status).length;
  const questions = slots.personQuestions({
    analysis: original,
    personGroups: analysis.personGroups,
    personAnswers: state.personAnswers,
    onChange: (answers) => act.setPersonAnswers(answers),
  });
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
    // 확인할 사람이 있으면 결과 바로 아래에서 묻는다. 답하면 위 결과가 그 자리에서 바뀐다.
    questions
      ? card('Help us check who is who', [
          el('p', { class: 'hint' }, ['Some people could not be matched because a birth date was missing or a name may have been misread. Your answer updates the results above.']),
          questions,
        ])
      : null,
    actions([
      button('Ask AI about these results', () => act.goTo('purpose')),
      button('Start over', () => act.restart(), { variant: 'secondary' }),
    ]),
  ]);
}
