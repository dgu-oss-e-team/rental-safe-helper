// @vitest-environment happy-dom
// PART 5. "같은 사람인가요?" 같은 두 사람 질문은 한 번만 보이기 + 엇갈린 답 정리 (#171, #164)
// 가상 데이터만 사용한다. (이름은 화면 확인용 가짜 이름)
import { describe, it, expect, vi } from 'vitest';
import { matchPeople, buildPersonQuestions } from '../src/features/masking/index.js';
import { assessRisks } from '../src/features/risk-check/index.js';
import { visiblePersonQuestions, settlePersonAnswers, countPersonQuestions } from '../src/app/person-questions.js';
import { recheckPeople } from '../src/app/pipeline.js';
import { resultsScreen } from '../src/app/screens/results.js';
import { initialState } from '../src/app/app-state.js';

/** 소유자(생년월일 있음) + 임대인·예금주(둘 다 생년월일 없음) → 임대인·예금주가 서로를 후보로 묻는다 */
const withOwner = {
  registry: { owners: [{ findingId: 'A', name: '김철수', birthDate: '800101', role: 'OWNER' }] },
  contract: {
    landlords: [{ findingId: 'B', name: '김철수', birthDate: null, role: 'LANDLORD' }],
    accountHolders: [{ findingId: 'C', name: '김철수', birthDate: null, role: 'ACCOUNT_HOLDER' }],
  },
};
/** 계약서만: 임대인·예금주(둘 다 생년월일 없음)만 있어서 서로가 유일한 후보 */
const onlyTwo = {
  registry: {},
  contract: {
    landlords: [{ findingId: 'B', name: '김철수', birthDate: null, role: 'LANDLORD' }],
    accountHolders: [{ findingId: 'C', name: '김철수', birthDate: null, role: 'ACCOUNT_HOLDER' }],
  },
};

const setup = (fields) => {
  const personGroups = matchPeople(fields).data;
  const id = (role) => personGroups.find((g) => g.roles.includes(role)).personId;
  return { fields, personGroups, questions: buildPersonQuestions(fields, personGroups), id };
};
const shownIds = (qs) => qs.map((q) => [q.personId, q.candidates.map((c) => c.personId)]);

describe('PART 5 같은 두 사람 질문은 한 번만 (#171)', () => {
  it('PART 4는 두 사람 모두에게 서로를 묻는다 (고치기 전 모습: 같은 질문 두 번)', () => {
    const { questions, id } = setup(withOwner);
    const L = id('LANDLORD');
    const H = id('ACCOUNT_HOLDER');
    expect(shownIds(questions)).toEqual([
      [L, expect.arrayContaining([H])],
      [H, expect.arrayContaining([L])],
    ]);
  });

  it('뒤 사람 카드에서는 앞 사람 후보를 뺀다 (소유자 후보는 그대로)', () => {
    const { questions, id } = setup(withOwner);
    const shown = visiblePersonQuestions(questions, {});
    expect(shownIds(shown)).toEqual([
      [id('LANDLORD'), [id('OWNER'), id('ACCOUNT_HOLDER')]],
      [id('ACCOUNT_HOLDER'), [id('OWNER')]],
    ]);
  });

  it('앞 사람이 "다른 후보(소유자)와 같다"고 답하면 두 사람 사이는 아직 모르므로 뒤 카드에 다시 보인다', () => {
    const { questions, id } = setup(withOwner);
    const shown = visiblePersonQuestions(questions, { [id('LANDLORD')]: id('OWNER') });
    expect(shown[1].candidates.map((c) => c.personId)).toEqual([id('OWNER'), id('LANDLORD')]);
  });

  it('서로가 유일한 후보면 카드 하나만 보인다', () => {
    const { questions, id } = setup(onlyTwo);
    expect(questions).toHaveLength(2);
    expect(shownIds(visiblePersonQuestions(questions, {}))).toEqual([[id('LANDLORD'), [id('ACCOUNT_HOLDER')]]]);
    expect(countPersonQuestions(questions, {})).toEqual({ asked: 1, answered: 0 });
    expect(countPersonQuestions(questions, { [id('LANDLORD')]: null })).toEqual({ asked: 1, answered: 1 });
  });

  it('처음부터 후보가 없는 사람("다른 사람 / 모름"만)은 숨기지 않는다', () => {
    // PART 4 질문 모양 그대로 만든다 (후보 없는 AMBIGUOUS는 실제 서류 조합으로 만들기 어려워서)
    const questions = [
      { personId: 'P2', alias: '[Landlord_B]', roles: ['LANDLORD'], names: ['김철수'], candidates: [] },
      { personId: 'P4', alias: '[AccountHolder_D]', roles: ['ACCOUNT_HOLDER'], names: [], candidates: [] },
    ];
    expect(visiblePersonQuestions(questions, {})).toHaveLength(2);
    expect(settlePersonAnswers(questions, { P2: null }).answers).toEqual({ P2: null });
  });
});

describe('PART 5 답 정리: 숨긴 카드·엇갈린 답 (#171)', () => {
  it('앞 사람이 "다른 사람"이라고 답하면, 숨긴 뒤 사람도 "다른 사람"으로 본다 (저장은 안 함)', () => {
    const { questions, id } = setup(onlyTwo);
    const s = settlePersonAnswers(questions, { [id('LANDLORD')]: null });
    expect(s.answers).toEqual({ [id('LANDLORD')]: null });
    expect(s.effective).toEqual({ [id('LANDLORD')]: null, [id('ACCOUNT_HOLDER')]: null });
  });

  it('앞 사람이 "이 사람과 같다"고 답하면 따로 정할 것이 없다 (합쳐짐)', () => {
    const { questions, id } = setup(onlyTwo);
    const s = settlePersonAnswers(questions, { [id('LANDLORD')]: id('ACCOUNT_HOLDER') });
    expect(s.effective).toEqual({ [id('LANDLORD')]: id('ACCOUNT_HOLDER') });
  });

  it('앞 사람이 아직 안 답했으면 숨긴 뒤 사람도 안 답한 것으로 둔다', () => {
    const { questions } = setup(onlyTwo);
    expect(settlePersonAnswers(questions, {}).effective).toEqual({});
  });

  it('엇갈린 답: 앞 사람은 "다른 사람", 뒤 사람은 "앞 사람과 같다" → 화면에 없는 뒤 답을 지운다', () => {
    const { questions, id } = setup(withOwner);
    const L = id('LANDLORD');
    const H = id('ACCOUNT_HOLDER');
    const s = settlePersonAnswers(questions, { [L]: null, [H]: L });
    expect(s.answers).toEqual({ [L]: null });
  });

  it('앞 카드 답이 바뀌어 숨겨진 카드의 답은 지운다', () => {
    const { questions, id } = setup(onlyTwo);
    const L = id('LANDLORD');
    const H = id('ACCOUNT_HOLDER');
    // 뒤 사람 카드에 남아 있던 답은 앞 사람 카드가 보이는 한 쓰지 않는다
    expect(settlePersonAnswers(questions, { [L]: null, [H]: null }).answers).toEqual({ [L]: null });
  });

  it('보이는 후보를 고른 답과 질문 없는 사람의 답은 건드리지 않는다', () => {
    const { questions, id } = setup(withOwner);
    const answers = { [id('LANDLORD')]: id('OWNER'), [id('ACCOUNT_HOLDER')]: id('LANDLORD'), [id('OWNER')]: null };
    expect(settlePersonAnswers(questions, answers).answers).toEqual(answers);
  });
});

describe('PART 5 recheckPeople(): 정리한 답으로 다시 점검 (#171)', () => {
  const analysisOf = (fields) => {
    const personGroups = matchPeople(fields).data;
    return /** @type {any} */ ({ fields, personGroups, riskResults: assessRisks(fields, personGroups).data, documents: [], files: [], findings: [] });
  };

  it('앞 사람 "다른 사람" → 숨긴 뒤 사람도 확인됨(CONFIRMED)으로 다시 점검하고, 저장할 답은 앞 사람 것만', () => {
    const analysis = analysisOf(onlyTwo);
    const { id } = setup(onlyTwo);
    const r = recheckPeople(analysis, { [id('LANDLORD')]: null });
    expect(r.ok).toBe(true);
    expect(r.data.personAnswers).toEqual({ [id('LANDLORD')]: null });
    expect(r.data.personGroups.every((g) => g.status === 'CONFIRMED')).toBe(true);
  });

  it('엇갈린 답은 오류 없이 화면에 보이는 답만으로 점검한다', () => {
    const analysis = analysisOf(withOwner);
    const { id } = setup(withOwner);
    const L = id('LANDLORD');
    const r = recheckPeople(analysis, { [L]: null, [id('ACCOUNT_HOLDER')]: L });
    expect(r.ok).toBe(true);
    expect(r.data.personAnswers).toEqual({ [L]: null });
    // 뒤 사람(예금주)은 아직 소유자 후보가 남아 있어서 안 답한 것으로 남는다
    expect(r.data.personGroups.find((g) => g.roles.includes('ACCOUNT_HOLDER')).status).toBe('AMBIGUOUS');
  });

  it('이미 확인된 사람의 답은 그대로 실패한다 (STOP이 근거 없이 사라지지 않게)', () => {
    const analysis = analysisOf(withOwner);
    const { id } = setup(withOwner);
    expect(recheckPeople(analysis, { [id('OWNER')]: id('LANDLORD') })).toMatchObject({ ok: false, step: 'applyPersonAnswers' });
  });
});

describe('PART 5 ② 화면: 질문 카드 수와 안내 (#171)', () => {
  const screenFor = (fields, personAnswers = {}) => {
    const personGroups = matchPeople(fields).data;
    const analysis = { fields, personGroups, riskResults: assessRisks(fields, personGroups).data, documents: [], files: [], findings: [] };
    const state = /** @type {any} */ ({ ...initialState(), step: 'results', analysis, personAnswers });
    return resultsScreen(state, /** @type {any} */ ({ setPersonAnswers: vi.fn(), goTo: vi.fn(), restart: vi.fn() }));
  };

  it('서로가 유일한 후보인 두 사람은 카드 하나, 안내도 "1 person"', () => {
    const node = screenFor(onlyTwo);
    expect(node.querySelectorAll('fieldset.pq-card')).toHaveLength(1);
    expect(node.querySelector('.question-notice')?.textContent).toContain('1 person');
  });

  it('하나뿐인 카드에 답하면 "답을 반영했다" 안내로 바뀐다', () => {
    const { id } = setup(onlyTwo);
    const node = screenFor(onlyTwo, { [id('LANDLORD')]: null });
    expect(node.querySelector('.question-notice')?.textContent).toContain('include your answer');
  });
});
