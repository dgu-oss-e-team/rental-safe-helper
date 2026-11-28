// @ts-check
/** PART 5. ② 위험 점검 결과 화면 (결과 카드는 PART 3 자리) */

import { el, button, card, actions } from '../ui.js';
import { slots, DOCUMENT_TEXT } from '../slots.js';
import { DOCUMENT_TYPE, MASKING_PURPOSE, RISK_STATUS } from '../../shared/document-model.js';
import { PURPOSES, purposeInfo, sendsTextOf } from '../purposes.js';
import { currentAnalysis } from '../app-state.js';
import { buildPersonQuestions } from '../../features/masking/index.js';
import { visiblePersonQuestions, countPersonQuestions } from '../person-questions.js';
import { uploadSlotNotices, uploadPartNotices } from '../upload-check.js';
import { changeText } from '../result-changes.js';
import { renderConclusionBanner, renderScreenOnlyNote } from '../../features/risk-check/risk-result-ui.js';

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
 * 결과 카드에 나오는 역할 이름·가명·"Could not check"를 처음 보는 사람을 위한 한 줄 설명 (기능 개선 목록 9번, 사용자 점검)
 * [Owner_A]·[PrevOwner_D]가 무엇인지, 등기부의 집주인과 계약서의 집주인이 왜 따로 나오는지 처음엔 알기 어렵다.
 * 이름·번호 같은 개인정보는 넣지 않는다 (정해진 문구만).
 */
function roleLegend(hasRegistry = true) {
  /** @param {string} term @param {string} meaning */
  const item = (term, meaning) => el('li', {}, [el('strong', {}, [term]), el('span', {}, [meaning])]);
  return el('div', { class: 'role-legend', id: 'role-legend' }, [
    el('ul', {}, [
      // 등기부를 넣지 않았으면 Owner·Previous owner는 화면 어디에도 안 나오므로 설명하지 않는다 (v2 프로토타입 의견)
      hasRegistry ? item('Owner', 'the owner of the home on the property register (등기부등본)') : null,
      hasRegistry ? item('Previous owner', 'someone who owned the home before') : null,
      item('Landlord', 'the person renting the home to you on the lease contract (임대차계약서)'),
      item(hasRegistry ? '[Owner_A], [Landlord_B] …' : '[Landlord_B], [Tenant_C] …', 'labels we use instead of real names'),
      item(
        'Could not check',
        hasRegistry
          ? 'we could not read the part we needed, so this was not checked. It does not mean there is no problem.'
          : 'the document we needed was not added or could not be read, so this was not checked. It does not mean there is no problem.',
      ),
    ]),
  ]);
}

/**
 * "Change"를 눌러 목적 목록을 펼친 상태. 목적을 고르면 화면이 다시 그려지므로, 고른 결과가 보이게 펼친 채로 둔다.
 * 다음 단계로 가면 접는다.
 */
let purposeListOpen = false;

/**
 * 결과 화면 맨 아래 "Next: ask AI" (#381, 기능 개선 목록 2번)
 * 목적은 ① 화면에서 이미 골랐다. 결과를 본 뒤에도 여기서 바꿀 수 있다 (옛 ③ 목적 화면을 대신함).
 * 큰 카드 대신 다음 버튼 위에 작은 한 줄로 둔다 (#388 성연님 의견). AI에 보내는 것 한 줄은 신뢰 때문에 남긴다.
 * Stop이 있는데 사기 위험 확인이 아니면 "Switch to Check fraud risks"를 눈에 띄게 제안한다.
 * @param {ReturnType<typeof import('../app-state.js').initialState>} state
 * @param {import('../main.js').Actions} act
 * @param {boolean} hasStop
 */
function askAiSection(state, act, hasStop) {
  const chosen = purposeInfo(state.purpose);
  const listId = 'purpose-choices';
  const changeLabel = () => (purposeListOpen ? 'Close' : 'Change purpose');
  const change = button(changeLabel(), () => {
    purposeListOpen = !purposeListOpen;
    list.hidden = !purposeListOpen;
    change.textContent = changeLabel();
    change.setAttribute('aria-expanded', String(purposeListOpen));
    if (purposeListOpen) /** @type {HTMLInputElement | null} */ (list.querySelector('input:checked'))?.focus();
  }, { id: 'change-purpose', variant: 'secondary' });
  // 큰 버튼 대신 글자 버튼 (누르는 영역은 44px)
  change.className = 'purpose-change';
  change.setAttribute('aria-expanded', String(purposeListOpen));
  change.setAttribute('aria-controls', listId);

  // 목적마다 AI에 무엇을 보내는지 한 줄씩 (옛 목적 화면 설명)
  const list = el(
    'div',
    { class: 'options purpose-choices', id: listId, role: 'radiogroup', 'aria-label': 'What do you want to ask AI?', hidden: !purposeListOpen },
    PURPOSES.map((p) => {
      const id = `purpose-${p.value.toLowerCase()}`;
      const input = /** @type {HTMLInputElement} */ (
        el('input', { type: 'radio', name: 'purpose', id, value: p.value, checked: state.purpose === p.value })
      );
      input.addEventListener('change', () => act.setPurpose(p.value));
      return el('label', { class: 'option', for: id }, [
        input,
        el('span', {}, [el('strong', {}, [p.title]), el('span', { class: 'hint' }, [sendsTextOf(p)])]),
      ]);
    }),
  );

  const suggestSwitch =
    hasStop && state.purpose !== MASKING_PURPOSE.FRAUD_CHECK
      ? el('div', { class: 'warning switch-purpose', id: 'switch-purpose' }, [
          el('p', {}, ['We found a Stop. To ask AI about it, switch to ', el('strong', {}, ['Check fraud risks']), '.']),
          button('Switch to Check fraud risks', () => act.setPurpose(MASKING_PURPOSE.FRAUD_CHECK), { id: 'switch-fraud', variant: 'secondary' }),
        ])
      : null;

  // 큰 카드가 아니라 한 줄 (#388 성연님 의견). 넓은 화면에서는 오른쪽 칸 맨 아래에 둔다 (프로토타입 v2)
  return el('section', { class: 'ask-ai', id: 'ask-ai', 'aria-label': 'Next: ask AI' }, [
    suggestSwitch,
    el('div', { class: 'chosen-purpose', id: 'chosen-purpose' }, [
      el('p', { class: 'chosen-purpose-line' }, [
        el('span', { class: 'hint' }, ['Asking AI to: ']),
        el('strong', { id: 'chosen-purpose-title' }, [chosen.title]),
        el('span', { class: 'hint', 'aria-hidden': 'true' }, [' · ']),
        change,
      ]),
      el('p', { class: 'hint chosen-purpose-sends', id: 'chosen-purpose-sends' }, [sendsTextOf(chosen)]),
    ]),
    list,
    // 화면에만 보이는 정보 안내: 카드마다 붙이지 않고 다음 버튼 바로 위에 한 번만 (#377, PART 3)
    renderScreenOnlyNote(),
    actions([
      button('Next: see what AI will get', () => {
        purposeListOpen = false;
        act.prepare();
      }, { id: 'next-review' }),
      button('Start over', () => act.restart(), { variant: 'secondary' }),
    ]),
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
  // 칸에 다른 서류를 넣었거나 서류 종류를 모르면, 다시 올리러 가는 버튼을 둔다 (기능 개선 목록 10번)
  // ① 화면으로 돌아가도 고른 파일은 남아 있어서, 틀린 칸의 파일만 바꾸면 된다.
  const backToUpload =
    unknown > 0 || slotNotices.length > 0
      ? actions([
          // 종류를 모르는 서류가 있으면 눈에 띄는 기본 버튼, 칸만 다르면 보조 버튼
          button('Go back and choose the right file', () => act.goTo('upload'), {
            id: 'back-to-upload',
            ...(unknown > 0 ? {} : { variant: 'secondary' }),
          }),
        ])
      : null;

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

  // 프로토타입 v2 배치 (#382): 맨 위 결론 배너 + 개수 칸, 왼쪽 결과 카드, 오른쪽 설명·질문·다음 단계
  // 개수 칸(누르면 그 상태만 보기)은 PART 3 결과 화면 안의 것을 그대로 배너 옆으로 옮긴다 (누르는 동작은 그대로)
  const risk = slots.riskResults(analysis.riskResults, { monthlyRent: analysis.fields?.contract?.monthlyRent });
  const counts = risk.querySelector('.risk-filter');
  const bannerWrap = renderConclusionBanner(analysis.riskResults);
  const banner = bannerWrap.querySelector('.risk-banner');
  const help = bannerWrap.querySelector('.help-box');
  const hasAlerts = unknown > 0 || slotNotices.length > 0;
  const documentsCard = card('Documents', [
      el(
        'ul',
        { class: 'doc-list' },
        analysis.documents.map((d) => el('li', {}, [DOCUMENT_TEXT[d.documentType] ?? d.documentType])),
      ),
      // 등기부도 계약서도 아닌 서류: 그 서류로는 아무것도 점검하지 못하므로 노란 한 줄보다 크게 알린다 (10번)
      unknown > 0
        ? el('div', { class: 'unknown-doc-notice', id: 'unknown-doc-notice', role: 'alert' }, [
            el('strong', {}, [
              unknown === 1
                ? 'We could not recognize 1 document.'
                : `We could not recognize ${unknown} documents.`,
            ]),
            el('p', {}, [
              'It does not look like a property register (등기부등본) or a lease contract (임대차계약서), so we could not check it. ' +
                'The checks that need it show "Could not check". Please go back and upload the right file.',
            ]),
          ])
        : null,
      slotNotices.length > 0
        ? el('div', { class: 'warning upload-slot-notice', id: 'upload-slot-notice' }, slotNotices.map((t) => el('p', {}, [t])))
        : null,
      backToUpload,
    ], 'documents-card');

  return el('div', { class: 'results-screen' }, [
    // 맨 위 결론 배너 (#377) + 개수 칸
    el('section', { class: 'results-hero', 'aria-label': 'Check before you sign' }, [banner, counts]),
    // 다른 서류를 넣었거나 종류를 모르면 결과보다 먼저 알린다
    hasAlerts ? documentsCard : null,
    el('div', { class: 'results-grid' }, [
      el('div', { class: 'results-main' }, [
        changesNotice,
        questionNotice,
        help,
        risk,
      ]),
      el('aside', { class: 'results-side', 'aria-label': 'Help and next step' }, [
        // 역할 이름·가명 설명 (기능 개선 목록 9번)
        card('How to read the results', [roleLegend(analysis.documents.some((d) => d.documentType === DOCUMENT_TYPE.REGISTRY))], 'legend-card'),
        // 확인할 사람이 있으면 결과 옆에서 묻는다. 답하면 결과가 그 자리에서 바뀐다.
        questionCard,
        // 목적 확인·바꾸기와 다음 단계 (#381). "화면에만 보이는 정보" 안내(#377)는 다음 버튼 바로 위에 한 번만 둔다.
        hasAlerts ? null : documentsCard,
        askAiSection(state, act, analysis.riskResults.some((r) => r.status === RISK_STATUS.STOP)),
      ]),
    ]),
  ]);
}
