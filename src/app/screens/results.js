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
 * "같은 사람인가요?"에 답한 뒤 결과가 바뀌었다는 안내 (개선 목록 5번). 답한 적이 없으면 null.
 * @param {import('../result-changes.js').ResultChange[] | null | undefined} changes
 */
function resultsUpdatedNotice(changes) {
  if (!Array.isArray(changes)) return null;
  if (changes.length === 0) {
    return el('div', { class: 'results-updated', id: 'results-updated', role: 'status' }, [
      el('p', {}, ['Results updated. Your answer did not change any result.']),
    ]);
  }
  const visible = changes.filter((c) => c.to !== null).map((c) => c.ruleId);
  return el('div', { class: 'results-updated', id: 'results-updated', role: 'status' }, [
    el('p', {}, [el('strong', {}, ['Results updated. ']), `Your answer changed ${changes.length === 1 ? '1 result' : `${changes.length} results`}:`]),
    el('ul', {}, changes.map((c) => el('li', {}, [changeText(c)]))),
    visible.length > 0 ? button('See what changed', () => showChangedCards(visible), { variant: 'secondary', id: 'see-changes' }) : null,
  ]);
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
  const questionCard = questions
    ? card('Help us check who is who', [
        el('p', { class: 'hint' }, [
          'Some people could not be matched because a birth date was missing or a name may have been misread. Your answer updates the results above.',
        ]),
        questions,
      ])
    : null;
  // 물어보는 사람 = 화면에 보이는 질문 카드 (같은 두 사람은 한 번만, #171)
  // 화면 구조(fieldset 개수)에 기대지 않고 질문 목록으로 센다
  const { asked, answered } = questions ? countPersonQuestions(allQuestions, state.personAnswers) : { asked: 0, answered: 0 };
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

  const changesNotice = resultsUpdatedNotice(state.resultChanges);

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
