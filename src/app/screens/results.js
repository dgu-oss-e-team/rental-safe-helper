// @ts-check
/** PART 5. ② 위험 점검 결과 화면 (결과 카드는 PART 3 자리) */

import { el, button, card, actions } from '../ui.js';
import { slots, DOCUMENT_TEXT } from '../slots.js';
import { DOCUMENT_TYPE } from '../../shared/document-model.js';
import { currentAnalysis } from '../app-state.js';
import { buildPersonQuestions } from '../../features/masking/index.js';
import { visiblePersonQuestions, countPersonQuestions } from '../person-questions.js';
import { uploadSlotNotices, uploadPartNotices } from '../upload-check.js';
import { changeText } from '../result-changes.js';

/** 바뀐 카드를 강조해 두는 시간 (ms) */
const HIGHLIGHT_MS = 2500;

/**
 * 바뀐 카드로 스크롤하고 잠깐 강조한다. 접힌 칸(Could not check 등) 안이면 펼치고,
 * 상태 필터 때문에 안 보이면 필터를 풀어 전체 보기로 바꾼다.
 * @param {string[]} ruleIds  답한 뒤에도 있는 바뀐 결과의 규칙 id
 */
export function showChangedCards(ruleIds) {
  /** @param {string} id */
  const find = (id) => /** @type {HTMLElement | null} */ (document.querySelector(`.risk[data-rule="${CSS.escape(id)}"]`));
  if (ruleIds.length > 0 && !ruleIds.some(find)) {
    // 필터로 다른 상태만 보고 있으면 눌린 버튼을 다시 눌러 전체 보기로 (PART 3 결과 카드의 필터)
    /** @type {HTMLButtonElement | null} */ (document.querySelector('.risk-chip[aria-pressed="true"]'))?.click();
  }
  const cards = ruleIds.map(find).filter((c) => c !== null);
  for (const c of cards) {
    const group = c.closest('details');
    if (group && !(/** @type {HTMLDetailsElement} */ (group).open)) /** @type {HTMLDetailsElement} */ (group).open = true;
    c.classList.add('risk-changed');
    setTimeout(() => c.classList.remove('risk-changed'), HIGHLIGHT_MS);
  }
  const first = cards[0];
  if (!first) return;
  first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // 화면 낭독기·키보드 사용자도 바뀐 카드로 옮겨 가도록 카드 제목에 포커스
  const heading = first.querySelector('h3');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
}

/**
 * 마지막으로 자동으로 보여 준 답 결과. 화면은 여러 번 다시 그려지므로(필터·다른 상태 변경),
 * 같은 답으로 두 번 자동 이동하지 않게 기억해 둔다. (resultChanges는 답할 때마다 새 배열)
 * @type {unknown}
 */
let autoShownFor = null;

/**
 * 답한 뒤에도 화면에 있는 바뀐 결과의 규칙 id (사라진 결과는 찾아갈 카드가 없다)
 * @param {import('../result-changes.js').ResultChange[]} changes
 */
const visibleRuleIds = (changes) => changes.filter((c) => c.to !== null).map((c) => c.ruleId);

/**
 * 자동으로 바뀐 카드로 올라가는 경우인가: 마지막 질문까지 답했고, 찾아갈 바뀐 카드가 있을 때.
 * 아직 답할 질문이 남았으면 움직이지 않는다 (답할 때마다 위로 튀면 다음 질문에 답하기 어렵다).
 * @param {import('../result-changes.js').ResultChange[] | null | undefined} changes
 * @param {boolean} allAnswered
 */
const movesAutomatically = (changes, allAnswered) => Array.isArray(changes) && allAnswered && visibleRuleIds(changes).length > 0;

/**
 * "같은 사람인가요?"에 답한 뒤 결과가 바뀌었다는 안내 (개선 목록 5번). 답한 적이 없으면 null.
 * 같은 동작이 두 번 나오지 않게 나눈다:
 *  - 위쪽(where: 'top'): 바뀐 목록만 (버튼 없음). 나중에 화면을 다시 볼 때 무엇이 바뀌었는지 보는 요약
 *  - 답한 질문 바로 아래(where: 'here'): 화면이 자동으로 움직이지 않을 때만. 바뀐 카드가 있으면 "See what changed" 버튼
 *    (자동으로 올라가는 경우에는 화면이 이미 바뀐 카드로 가므로 그리지 않는다)
 * @param {import('../result-changes.js').ResultChange[] | null | undefined} changes
 * @param {'top' | 'here'} where
 * @param {boolean} autoMove  자동으로 바뀐 카드로 올라가는 경우인가
 */
function resultsUpdatedNotice(changes, where, autoMove) {
  if (!Array.isArray(changes)) return null;
  if (where === 'here' && autoMove) return null;
  const here = where === 'here';
  // 화면 낭독기는 사용자가 있는 곳(답한 질문 아래)의 안내만 읽게 한다. 자동으로 올라갈 때는 카드 제목으로 포커스가 간다.
  const attrs = { class: `results-updated results-updated-${where}`, id: here ? 'results-updated-here' : 'results-updated', role: here ? 'status' : undefined };
  if (changes.length === 0) {
    return el('div', attrs, [el('p', {}, ['Results updated. Your answer did not change any result.'])]);
  }
  const visible = visibleRuleIds(changes);
  return el('div', attrs, [
    el('p', {}, [el('strong', {}, ['Results updated. ']), `Your answer changed ${changes.length === 1 ? '1 result' : `${changes.length} results`}:`]),
    el('ul', {}, changes.map((c) => el('li', {}, [changeText(c)]))),
    here && visible.length > 0 ? button('See what changed', () => showChangedCards(visible), { variant: 'secondary', id: 'see-changes' }) : null,
  ]);
}

/**
 * 마지막 질문까지 답했으면 바뀐 카드로 자동으로 올라간다 (개선 목록 5번, 섞는 방식).
 * 화면을 다 그린 뒤 움직여야 해서 다음 차례로 미룬다.
 * @param {import('../result-changes.js').ResultChange[] | null | undefined} changes
 * @param {boolean} autoMove
 */
function autoShowChanges(changes, autoMove) {
  if (!autoMove || !Array.isArray(changes) || changes === autoShownFor) return;
  autoShownFor = changes;
  const visible = visibleRuleIds(changes);
  setTimeout(() => showChangedCards(visible), 0);
}

/**
 * @param {ReturnType<typeof import('../app-state.js').initialState>} state
 * @param {import('../main.js').Actions} act
 */
export function resultsScreen(state, act) {
  // 위험 결과는 "같은 사람인가요?" 답을 반영한 것, 질문은 원래 판정 기준 (INTERFACES.md 6번)
  const analysis = /** @type {import('../pipeline.js').Analysis} */ (currentAnalysis(state));
  const original = /** @type {import('../pipeline.js').Analysis} */ (state.analysis);
  // 같은 두 사람 질문은 한 번만 보인다 (#171). 앞 카드 답에 따라 뒤 카드가 숨거나 다시 보인다.
  const allQuestions = buildPersonQuestions(original.fields, original.personGroups);
  const questions = slots.personQuestions({
    analysis: original,
    personGroups: analysis.personGroups,
    personAnswers: state.personAnswers,
    onChange: (answers) => act.setPersonAnswers(answers),
    questions: visiblePersonQuestions(allQuestions, state.personAnswers),
  });
  const unknown = analysis.documents.filter((d) => d.documentType === DOCUMENT_TYPE.UNKNOWN).length;
  // 업로드 칸과 판별 결과가 다르면 안내한다 (#186). 결과는 내용으로 판별한 그대로 쓴다.
  // 한 칸에 함께 올린 파일 중 칸과 다른 서류가 섞였으면 그것도 안내한다 (#305)
  const slotNotices = [
    ...uploadSlotNotices(analysis.documents, state.uploadSlots),
    ...uploadPartNotices(state.uploadParts, state.uploadSlots),
  ];

  // 질문 카드는 결과 목록 아래에 있어서 휴대폰에서는 화면 몇 개 아래로 밀린다.
  // 그래서 결과 요약 바로 아래에 안내와 "바로 가기" 버튼을 둔다. (#91)
  // (주소 #...로 이동하지 않고 스크롤만 한다. 주소의 # 부분은 단계 이동(#90)에 쓸 예정)
  // 물어보는 사람 = 화면에 보이는 질문 카드 (같은 두 사람은 한 번만, #171)
  // 화면 구조(fieldset 개수)에 기대지 않고 질문 목록으로 센다
  const { asked, answered } = questions ? countPersonQuestions(allQuestions, state.personAnswers) : { asked: 0, answered: 0 };
  // 마지막 질문까지 답했고 바뀐 카드가 있으면 그 카드로 자동으로 올라간다 (개선 목록 5번)
  const autoMove = movesAutomatically(state.resultChanges, asked > 0 && answered >= asked);
  const questionCard = questions
    ? card('Help us check who is who', [
        el('p', { class: 'hint' }, [
          'Some people could not be matched because a birth date was missing or a name may have been misread. Your answer updates the results above.',
        ]),
        questions,
        // 답한 자리에서 바로 무엇이 바뀌었는지 보이게 한다 (개선 목록 5번)
        resultsUpdatedNotice(state.resultChanges, 'here', autoMove),
      ])
    : null;
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

  const changesNotice = resultsUpdatedNotice(state.resultChanges, 'top', autoMove);
  autoShowChanges(state.resultChanges, autoMove);

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
      slotNotices.length > 0
        ? el('div', { class: 'warning upload-slot-notice', id: 'upload-slot-notice' }, slotNotices.map((t) => el('p', {}, [t])))
        : null,
    ]),
    card('Check before you sign', [
      changesNotice,
      questionNotice,
      // 위쪽 요약(Stop / Check / Could not check 개수, 눌러서 필터)은 PART 3 카드 화면 안에 있다 (#63)
      slots.riskResults(analysis.riskResults, { monthlyRent: analysis.fields?.contract?.monthlyRent }),
    ]),
    // 확인할 사람이 있으면 결과 바로 아래에서 묻는다. 답하면 위 결과가 그 자리에서 바뀐다.
    questionCard,
    actions([
      button('Ask AI about these results', () => act.goTo('purpose')),
      button('Start over', () => act.restart(), { variant: 'secondary' }),
    ]),
  ]);
}
