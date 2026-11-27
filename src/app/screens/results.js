// @ts-check
/** PART 5. ② 위험 점검 결과 화면 (결과 카드는 PART 3 자리) */

import { el, button, card, actions } from '../ui.js';
import { slots, DOCUMENT_TEXT } from '../slots.js';
import { DOCUMENT_TYPE } from '../../shared/document-model.js';
import { currentAnalysis } from '../app-state.js';
import { buildPersonQuestions } from '../../features/masking/index.js';
import { visiblePersonQuestions, countPersonQuestions } from '../person-questions.js';
import { uploadSlotNotices, uploadPartNotices } from '../upload-check.js';

/**
 * 결과 카드에 나오는 역할 이름·가명·"Could not check"를 처음 보는 사람을 위한 한 줄 설명 (기능 개선 목록 9번, 사용자 점검)
 * [Owner_A]·[PrevOwner_D]가 무엇인지, 등기부의 집주인과 계약서의 집주인이 왜 따로 나오는지 처음엔 알기 어렵다.
 * 이름·번호 같은 개인정보는 넣지 않는다 (정해진 문구만).
 */
function roleLegend() {
  /** @param {string} term @param {string} meaning */
  const item = (term, meaning) => el('li', {}, [el('strong', {}, [term]), ` = ${meaning}`]);
  return el('div', { class: 'role-legend', id: 'role-legend' }, [
    el('p', {}, ['How to read the results:']),
    el('ul', {}, [
      item('Owner', 'the owner of the home on the property register (등기부등본)'),
      item('Previous owner', 'someone who owned the home before'),
      item('Landlord', 'the person renting the home to you on the lease contract (임대차계약서)'),
      item('[Owner_A], [Landlord_B] …', 'labels we use instead of real names'),
      item('Could not check', 'we could not read the part we needed, so this was not checked. It does not mean there is no problem.'),
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

  return el('div', {}, [
    card('Documents', [
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
    ]),
    card('Check before you sign', [
      roleLegend(),
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
