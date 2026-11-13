// @ts-check
/**
 * PART 4. ② 결과 화면의 "같은 사람인가요?" 질문 (PART 5 slots.js personQuestions 자리)
 *
 *   ({ analysis, personGroups, personAnswers, onChange }) => HTMLElement | null
 *   - analysis.personGroups: 원래 판정 (질문은 이것 기준이라 답한 뒤에도 남는다)
 *   - personGroups: 답을 반영해 합친 그룹 (PART 5가 applyPersonAnswers로 만들어 넘김)
 *   - onChange(answers 전체): 답이 바뀔 때마다 부른다. PART 5가 위험 점검과 마스킹을 다시 계산한다.
 *   - 물어볼 사람이 없으면 null (아무것도 그리지 않음)
 *
 * 이름은 이 화면에만 보여 준다 (AI로 보내지 않음). 서류 글자는 el()로만 넣는다.
 */

import './person-questions.css';
import { el } from '../../app/ui.js';
import { buildPersonQuestions } from './person-answers.js';

/** 역할 → 화면 이름 */
const ROLE_TEXT = {
  OWNER: 'registered owner',
  LANDLORD: 'landlord',
  TENANT: 'tenant',
  ACCOUNT_HOLDER: 'payment account holder',
  PREVIOUS_OWNER: 'previous owner',
};

/** @param {string[]} roles */
const rolesText = (roles) => roles.map((r) => ROLE_TEXT[/** @type {keyof typeof ROLE_TEXT} */ (r)] ?? r).join(' and ');
/** @param {string[]} names */
const namesText = (names) => (names.length > 0 ? names.join(' / ') : 'name not readable');

/**
 * @param {{
 *   analysis: { fields: any, personGroups: any[] },
 *   personGroups: any[],
 *   personAnswers: Record<string, string | null> | null | undefined,
 *   onChange: (answers: Record<string, string | null>) => void,
 * }} input
 * @returns {HTMLElement | null}
 */
export function renderPersonQuestions({ analysis, personAnswers, onChange }) {
  const questions = buildPersonQuestions(analysis.fields, analysis.personGroups);
  if (questions.length === 0) return null;
  const answers = personAnswers ?? {};

  /**
   * 한 사람의 답을 바꾼 새 answers (undefined = 답 지우기)
   * @param {string} personId
   * @param {string | null | undefined} value
   */
  const change = (personId, value) => {
    const next = { ...answers };
    if (value === undefined) delete next[personId];
    else next[personId] = value;
    onChange(next);
  };

  return el(
    'div',
    { class: 'pq' },
    questions.map((q) => {
      const name = `pq-${q.personId}`;
      const current = q.personId in answers ? answers[q.personId] : undefined;

      /**
       * 보기 하나
       * @param {string} id
       * @param {string | null | undefined} value
       * @param {(string | HTMLElement)[]} label
       */
      const option = (id, value, label) => {
        const input = /** @type {HTMLInputElement} */ (el('input', { type: 'radio', name, id, checked: current === value }));
        input.addEventListener('change', () => change(q.personId, value));
        return el('label', { class: 'pq-option', for: id }, [input, el('span', {}, label)]);
      };

      return el('fieldset', { class: 'pq-card' }, [
        el('legend', {}, ['Are these the same person?']),
        el('p', { class: 'pq-text' }, [
          'We could not confirm who the ',
          el('strong', {}, [rolesText(q.roles)]),
          ` (${q.alias}, written as "${namesText(q.names)}") is. Your answer updates the results.`,
        ]),
        ...q.candidates.map((c) =>
          option(`${name}-${c.personId}`, c.personId, [
            'Same person as the ',
            el('strong', {}, [rolesText(c.roles)]),
            ` (${c.alias}, "${namesText(c.names)}")`,
          ]),
        ),
        option(`${name}-none`, null, ['A different person']),
        option(`${name}-unsure`, undefined, ['Not sure yet']),
      ]);
    }),
  );
}
