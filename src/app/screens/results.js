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

  // 질문 카드는 결과 목록 아래에 있어서 휴대폰에서는 화면 몇 개 아래로 밀린다.
  // 그래서 결과 요약 바로 아래에 안내와 "바로 가기" 버튼을 둔다. (#91)
  // (주소 #...로 이동하지 않고 스크롤만 한다. 주소의 # 부분은 단계 이동(#90)에 쓸 예정)
  const questionCard = questions
    ? card('Help us check who is who', [
        el('p', { class: 'hint' }, [
          'Some people could not be matched because a birth date was missing or a name may have been misread. Your answer updates the results above.',
        ]),
        questions,
      ])
    : null;
  // 물어보는 사람 = 원래 판정에서 AMBIGUOUS인 사람 (PART 4 질문 화면과 같은 기준, INTERFACES.md 6번)
  // 화면 구조(fieldset 개수)에 기대지 않고 공통 데이터로 센다
  const asked = questions ? original.personGroups.filter((g) => g.status === 'AMBIGUOUS').length : 0;
  const answered = Object.keys(state.personAnswers ?? {}).length;
  const goToQuestions = () => {
    if (!questionCard) return;
    questionCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // 화면 낭독기·키보드 사용자도 질문으로 옮겨 가도록 제목에 포커스
    const heading = questionCard.querySelector('h2');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  };
  const questionNotice = questionCard
    ? el('div', { class: answered >= asked ? 'question-notice answered' : 'warning question-notice' }, [
        el('p', {}, [
          answered >= asked
            ? 'The results below include your answer about who is who.'
            : `We need your help with ${asked === 1 ? '1 person' : `${asked} people`}. Your answer can change these results.`,
        ]),
        button(answered >= asked ? 'Change my answer' : 'Answer now', goToQuestions, { variant: 'secondary', id: 'go-questions' }),
      ])
    : null;

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
      questionNotice,
      slots.riskResults(analysis.riskResults),
    ]),
    // 확인할 사람이 있으면 결과 바로 아래에서 묻는다. 답하면 위 결과가 그 자리에서 바뀐다.
    questionCard,
    actions([
      button('Ask AI about these results', () => act.goTo('purpose')),
      button('Start over', () => act.restart(), { variant: 'secondary' }),
    ]),
  ]);
}
