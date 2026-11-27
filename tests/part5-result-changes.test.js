// @vitest-environment happy-dom
// "같은 사람인가요?"에 답한 뒤 "Results updated" 안내와 "See what changed" (개선 목록 5번)
// 가상 데이터만 사용한다.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { diffRiskResults, changeText } from '../src/app/result-changes.js';
import { resultsScreen } from '../src/app/screens/results.js';
import { initialState } from '../src/app/app-state.js';
import { RISK_STATUS } from '../src/shared/document-model.js';
import { matchPeople } from '../src/features/masking/index.js';
import { assessRisks } from '../src/features/risk-check/index.js';

const { STOP, CHECK, UNVERIFIABLE, NO_FLAG } = RISK_STATUS;
/** @param {string} ruleId @param {string} status @param {string} [title] */
const result = (ruleId, status, title = ruleId) => ({ ruleId, status, title, explanation: 'e', action: 'a' });

describe('결과 비교 (diffRiskResults)', () => {
  it('상태가 바뀐 규칙, 새로 생긴 규칙, 사라진 규칙만 돌려준다', () => {
    const before = [result('OWNER_MISMATCH', CHECK), result('MORTGAGE_EXISTS', CHECK), result('ACCOUNT_HOLDER', UNVERIFIABLE), result('OLD', NO_FLAG)];
    const after = [result('OWNER_MISMATCH', STOP), result('MORTGAGE_EXISTS', CHECK), result('ACCOUNT_HOLDER', NO_FLAG), result('NEW', CHECK)];
    expect(diffRiskResults(before, after)).toEqual([
      { ruleId: 'OWNER_MISMATCH', title: 'OWNER_MISMATCH', from: CHECK, to: STOP },
      { ruleId: 'ACCOUNT_HOLDER', title: 'ACCOUNT_HOLDER', from: UNVERIFIABLE, to: NO_FLAG },
      { ruleId: 'NEW', title: 'NEW', from: null, to: CHECK },
      { ruleId: 'OLD', title: 'OLD', from: NO_FLAG, to: null },
    ]);
  });

  it('바뀐 게 없으면 빈 목록, 결과가 없으면(null) 빈 목록으로 본다', () => {
    expect(diffRiskResults([result('A', STOP)], [result('A', STOP)])).toEqual([]);
    expect(diffRiskResults(null, null)).toEqual([]);
  });

  it('한 줄 글: 상태 이름은 결과 카드와 같은 말', () => {
    expect(changeText({ ruleId: 'X', title: 'Owner and landlord check', from: CHECK, to: STOP })).toBe('Owner and landlord check: Check → Stop');
    expect(changeText({ ruleId: 'X', title: 'Account holder check', from: UNVERIFIABLE, to: NO_FLAG })).toBe(
      'Account holder check: Could not check → No warning found',
    );
    expect(changeText({ ruleId: 'X', title: 'T', from: null, to: CHECK })).toBe('T: new (Check)');
    expect(changeText({ ruleId: 'X', title: 'T', from: STOP, to: null })).toBe('T: no longer shown');
  });
});

describe('② 결과 화면: "Results updated"와 "See what changed"', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  /** @param {any} resultChanges @param {any[]} riskResults */
  const screenFor = (resultChanges, riskResults) => {
    const analysis = { fields: {}, personGroups: [], riskResults, documents: [], files: [], findings: [] };
    const state = /** @type {any} */ ({ ...initialState(), step: 'results', analysis, resultChanges });
    const node = resultsScreen(state, /** @type {any} */ ({ setPersonAnswers: vi.fn(), goTo: vi.fn(), restart: vi.fn() }));
    document.body.replaceChildren(node);
    return node;
  };

  it('답한 적이 없으면(null) 안내가 없다', () => {
    expect(screenFor(null, [result('A', STOP)]).querySelector('#results-updated')).toBeNull();
  });

  it('답했는데 바뀐 게 없으면 "did not change any result"라고 알리고 버튼은 없다', () => {
    const node = screenFor([], [result('A', STOP)]);
    expect(node.querySelector('#results-updated')?.textContent).toContain('Your answer did not change any result.');
    expect(node.querySelector('#see-changes')).toBeNull();
  });

  it('바뀐 결과를 나열하고, "See what changed"를 누르면 바뀐 카드를 잠깐 강조한다 (접힌 칸이면 펼침)', () => {
    vi.useFakeTimers();
    const riskResults = [result('OWNER_MISMATCH', STOP, 'Owner and landlord check'), result('ACCOUNT_HOLDER', NO_FLAG, 'Account holder check')];
    const changes = [
      { ruleId: 'OWNER_MISMATCH', title: 'Owner and landlord check', from: CHECK, to: STOP },
      { ruleId: 'ACCOUNT_HOLDER', title: 'Account holder check', from: UNVERIFIABLE, to: NO_FLAG },
    ];
    const node = screenFor(changes, riskResults);
    const notice = node.querySelector('#results-updated');
    expect(notice?.textContent).toContain('Your answer changed 2 results');
    expect([...(notice?.querySelectorAll('li') ?? [])].map((li) => li.textContent)).toEqual([
      'Owner and landlord check: Check → Stop',
      'Account holder check: Could not check → No warning found',
    ]);

    const stopCard = node.querySelector('.risk[data-rule="OWNER_MISMATCH"]');
    const noFlagCard = node.querySelector('.risk[data-rule="ACCOUNT_HOLDER"]');
    expect(/** @type {HTMLDetailsElement} */ (noFlagCard?.closest('details')).open).toBe(false);

    /** @type {HTMLButtonElement} */ (node.querySelector('#see-changes')).click();
    expect(stopCard?.classList.contains('risk-changed')).toBe(true);
    expect(noFlagCard?.classList.contains('risk-changed')).toBe(true);
    expect(/** @type {HTMLDetailsElement} */ (noFlagCard?.closest('details')).open).toBe(true);
    expect(document.activeElement).toBe(stopCard?.querySelector('h3'));

    vi.advanceTimersByTime(3000);
    expect(stopCard?.classList.contains('risk-changed')).toBe(false);
  });

  it('사라진 결과만 바뀌었으면 찾아갈 카드가 없어서 버튼을 보이지 않는다', () => {
    const node = screenFor([{ ruleId: 'OLD', title: 'Old check', from: CHECK, to: null }], [result('A', STOP)]);
    expect(node.querySelector('#results-updated')?.textContent).toContain('Old check: no longer shown');
    expect(node.querySelector('#see-changes')).toBeNull();
  });
});

describe('② 결과 화면: 답한 자리 안내와 마지막 답 뒤 자동 이동 (섞는 방식)', () => {
  // 계약서만: 임대인·예금주(둘 다 생년월일 없음)만 있어서 서로가 유일한 후보 → 질문 카드 하나
  const onlyTwo = {
    registry: {},
    contract: {
      landlords: [{ findingId: 'B', name: '김가상', birthDate: null, role: 'LANDLORD' }],
      accountHolders: [{ findingId: 'C', name: '김가상', birthDate: null, role: 'ACCOUNT_HOLDER' }],
    },
  };
  const personGroups = matchPeople(onlyTwo).data;
  const landlordId = personGroups.find((g) => g.roles.includes('LANDLORD')).personId;
  const riskResults = assessRisks(onlyTwo, personGroups).data;
  const ruleId = riskResults[0].ruleId;

  /** @param {any} personAnswers @param {any} resultChanges */
  const screenFor = (personAnswers, resultChanges) => {
    const analysis = { fields: onlyTwo, personGroups, riskResults, documents: [], files: [], findings: [] };
    const state = /** @type {any} */ ({ ...initialState(), step: 'results', analysis, personAnswers, resultChanges });
    const node = resultsScreen(state, /** @type {any} */ ({ setPersonAnswers: vi.fn(), goTo: vi.fn(), restart: vi.fn() }));
    document.body.replaceChildren(node);
    return node;
  };
  const card = () => document.querySelector(`.risk[data-rule="${ruleId}"]`);

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('답한 질문 바로 아래에도 같은 안내와 "See what changed"가 있다 (위쪽 안내는 화면 낭독기가 두 번 읽지 않게 status가 아님)', () => {
    vi.useFakeTimers();
    const changes = [{ ruleId, title: 'T', from: 'NO_FLAG', to: 'STOP' }];
    const node = screenFor({}, changes);
    const here = node.querySelector('#results-updated-here');
    expect(here?.closest('section, .card')?.textContent).toContain('Help us check who is who');
    expect(here?.getAttribute('role')).toBe('status');
    expect(node.querySelector('#results-updated')?.getAttribute('role')).toBeNull();
    /** @type {HTMLButtonElement} */ (node.querySelector('#see-changes-here')).click();
    expect(card()?.classList.contains('risk-changed')).toBe(true);
  });

  it('아직 답할 질문이 남았으면 자동으로 움직이지 않는다', () => {
    vi.useFakeTimers();
    screenFor({}, [{ ruleId, title: 'T', from: 'NO_FLAG', to: 'STOP' }]);
    vi.advanceTimersByTime(10);
    expect(card()?.classList.contains('risk-changed')).toBe(false);
  });

  it('마지막 질문까지 답했으면 바뀐 카드로 자동으로 가서 강조하고, 같은 답으로 다시 그려도 한 번만 움직인다', () => {
    vi.useFakeTimers();
    const changes = [{ ruleId, title: 'T', from: 'NO_FLAG', to: 'STOP' }];
    screenFor({ [landlordId]: null }, changes);
    vi.advanceTimersByTime(10);
    expect(card()?.classList.contains('risk-changed')).toBe(true);
    expect(document.activeElement).toBe(card()?.querySelector('h3'));

    // 필터 등으로 화면만 다시 그려지면 또 움직이지 않는다
    screenFor({ [landlordId]: null }, changes);
    vi.advanceTimersByTime(10);
    expect(card()?.classList.contains('risk-changed')).toBe(false);
  });

  it('마지막 답이어도 바뀐 게 없으면 움직이지 않고 "did not change"만 알린다', () => {
    vi.useFakeTimers();
    const node = screenFor({ [landlordId]: null }, []);
    vi.advanceTimersByTime(10);
    expect(node.querySelector('#results-updated-here')?.textContent).toContain('did not change any result');
    expect(document.querySelector('.risk-changed')).toBeNull();
  });
});
