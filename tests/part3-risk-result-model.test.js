import { describe, it, expect } from 'vitest';
import { RISK_STATUS } from '../src/shared/document-model.js';
import {
  STATUS_ORDER,
  STATUS_TEXT,
  COLLAPSED_STATUSES,
  normalizeStatus,
  groupRiskResults,
  validFilter,
  getConclusion,
} from '../src/features/risk-check/risk-result-model.js';

const make = (ruleId, status) => ({ ruleId, status, title: ruleId, explanation: 'e', action: 'a' });

describe('PART 3 위험 결과 카드: 상태 계산', () => {
  it('STOP → CHECK → 확인 불가 → 문제 없음 순서로 보여 준다 (STOP이 맨 위)', () => {
    expect(STATUS_ORDER).toEqual([RISK_STATUS.STOP, RISK_STATUS.CHECK, RISK_STATUS.UNVERIFIABLE, RISK_STATUS.NO_FLAG]);
  });

  it('상태별로 나누고, 같은 상태 안에서는 들어온 순서를 지킨다', () => {
    const groups = groupRiskResults([
      make('A', RISK_STATUS.NO_FLAG),
      make('B', RISK_STATUS.STOP),
      make('C', RISK_STATUS.CHECK),
      make('D', RISK_STATUS.STOP),
    ]);
    expect(groups.STOP.map((r) => r.ruleId)).toEqual(['B', 'D']);
    expect(groups.CHECK.map((r) => r.ruleId)).toEqual(['C']);
    expect(groups.NO_FLAG.map((r) => r.ruleId)).toEqual(['A']);
    expect(groups.UNVERIFIABLE).toEqual([]);
  });

  it('알 수 없는 상태는 "문제 없음"이 아니라 확인 불가로 다룬다', () => {
    expect(normalizeStatus('SOMETHING_NEW')).toBe(RISK_STATUS.UNVERIFIABLE);
    expect(normalizeStatus(undefined)).toBe(RISK_STATUS.UNVERIFIABLE);
    const groups = groupRiskResults([make('X', 'SOMETHING_NEW')]);
    expect(groups.UNVERIFIABLE).toHaveLength(1);
    expect(groups.NO_FLAG).toHaveLength(0);
  });

  it('배열이 아니거나 이상한 값이 섞여 있어도 오류 없이 빈 그룹을 돌려준다', () => {
    expect(groupRiskResults(null).STOP).toEqual([]);
    expect(groupRiskResults([null, undefined, make('A', RISK_STATUS.CHECK)]).CHECK).toHaveLength(1);
  });

  it('입력 배열을 바꾸지 않는다', () => {
    const input = [make('A', RISK_STATUS.NO_FLAG), make('B', RISK_STATUS.STOP)];
    const copy = structuredClone(input);
    groupRiskResults(input);
    expect(input).toEqual(copy);
  });

  it('확인 불가·문제 없음은 기본으로 접고, STOP·CHECK는 접지 않는다', () => {
    expect(COLLAPSED_STATUSES).toEqual([RISK_STATUS.UNVERIFIABLE, RISK_STATUS.NO_FLAG]);
  });

  it('고른 필터의 결과가 없으면 전체 보기(null)로 돌아간다', () => {
    const groups = groupRiskResults([make('A', RISK_STATUS.CHECK)]);
    expect(validFilter(groups, RISK_STATUS.CHECK)).toBe(RISK_STATUS.CHECK);
    expect(validFilter(groups, RISK_STATUS.STOP)).toBeNull();
    expect(validFilter(groups, null)).toBeNull();
  });

  it('상태 이름에 "안전(safe)"이라는 말을 쓰지 않는다', () => {
    for (const text of Object.values(STATUS_TEXT)) {
      expect(text.toLowerCase()).not.toMatch(/\bsafe\b/);
    }
    expect(STATUS_TEXT[RISK_STATUS.NO_FLAG]).toBe('No warning found');
  });
});

describe('PART 3 결론 배너 (#377)', () => {
  it('STOP이 있으면 Do not sign yet', () => {
    const c = getConclusion([make('A', RISK_STATUS.STOP), make('B', RISK_STATUS.CHECK)]);
    expect(c.level).toBe('stop');
    expect(c.title).toBe('Do not sign yet');
  });

  it('STOP 없이 CHECK만 있으면 확인 필요 배너', () => {
    expect(getConclusion([make('A', RISK_STATUS.CHECK)]).level).toBe('check');
  });

  it('전부 NO_FLAG여도 안전하다고 단정하지 않는다', () => {
    const c = getConclusion([make('A', RISK_STATUS.NO_FLAG)]);
    expect(c.level).toBe('no_flag');
    expect(c.message).toContain('This does not mean the home is safe');
    expect(c.unverifiableNote).toBeNull();
  });

  it('UNVERIFIABLE가 있으면 확인하지 못한 항목이 있다고 함께 알린다', () => {
    for (const first of [RISK_STATUS.STOP, RISK_STATUS.CHECK, RISK_STATUS.NO_FLAG]) {
      expect(getConclusion([make('A', first), make('B', RISK_STATUS.UNVERIFIABLE)]).unverifiableNote).toMatch(/could not be checked/);
    }
  });

  it('결과가 없거나 전부 확인 불가면 "경고 없음"이라고 하지 않는다', () => {
    expect(getConclusion([]).level).toBe('unverifiable');
    expect(getConclusion([make('A', RISK_STATUS.UNVERIFIABLE)]).level).toBe('unverifiable');
  });
});
