import { describe, it, expect } from 'vitest';
import { applyPersonAnswers, matchPeople, createMaskingPlan } from '../src/features/masking/index.js';
import { buildPersonQuestions } from '../src/features/masking/person-answers.js';
import { mockExtractedFields, mockPersonGroups, mockRegistryFindings, mockLeaseFindings } from '../src/shared/mock-data.js';
import { ERROR_CODE, MASKING_PURPOSE } from '../src/shared/document-model.js';

// mock: P1 소유자 김철수(800101) / P2 임대인 김철수(750315) / P3 임차인 / P4 예금주 김철수(생년월일 없음, AMBIGUOUS)
const groups = mockPersonGroups;
const byId = (list, id) => list.find((g) => g.personId === id);

describe('PART 4 applyPersonAnswers', () => {
  it('답이 없으면 그대로 (원래 그룹과 같은 내용)', () => {
    expect(applyPersonAnswers(groups, {}).data).toEqual(groups);
    expect(applyPersonAnswers(groups, undefined).data).toEqual(groups);
  });

  it('같은 사람이면 대상(P2)의 personId·가명을 남기고 역할·findingIds를 합치고 CONFIRMED', () => {
    const r = applyPersonAnswers(groups, { P4: 'P2' });
    expect(r.ok).toBe(true);
    expect(r.data).toHaveLength(groups.length - 1);
    expect(byId(r.data, 'P4')).toBeUndefined();
    expect(byId(r.data, 'P2')).toEqual({
      personId: 'P2',
      alias: byId(groups, 'P2').alias,
      roles: ['LANDLORD', 'ACCOUNT_HOLDER'],
      findingIds: [...byId(groups, 'P2').findingIds, ...byId(groups, 'P4').findingIds],
      status: 'CONFIRMED',
    });
  });

  it('다른 사람이면 그 그룹만 CONFIRMED로 바뀐다', () => {
    const r = applyPersonAnswers(groups, { P4: null });
    expect(r.data).toHaveLength(groups.length);
    expect(byId(r.data, 'P4')).toEqual({ ...byId(groups, 'P4'), status: 'CONFIRMED' });
  });

  it('답을 따라간다: P4·P2가 둘 다 AMBIGUOUS이고 P4→P2, P2→P1이면 셋 다 P1로 합친다', () => {
    const unsure = groups.map((g) => (g.personId === 'P2' ? { ...g, status: 'AMBIGUOUS' } : g));
    const r = applyPersonAnswers(unsure, { P4: 'P2', P2: 'P1' });
    expect(r.data.map((g) => g.personId)).toEqual(['P1', 'P3']);
    expect(byId(r.data, 'P1').findingIds).toEqual(
      [...byId(groups, 'P1').findingIds, ...byId(groups, 'P2').findingIds, ...byId(groups, 'P4').findingIds],
    );
  });

  it('이미 CONFIRMED인 사람의 답은 받지 않는다 (생년월일이 다른 소유자·임대인이 합쳐져 STOP이 사라지지 않게)', () => {
    for (const bad of [{ P2: 'P1' }, { P2: null }, { P4: 'P2', P2: 'P1' }]) {
      const r = applyPersonAnswers(groups, bad);
      expect(r.ok).toBe(false);
      expect(r.error.code).toBe(ERROR_CODE.INVALID_INPUT);
    }
  });

  it('없는 사람, 자기 자신, 서로 가리키는 답, 잘못된 모양은 실패한다', () => {
    for (const bad of [{ P9: null }, { P4: 'P9' }, { P4: 'P4' }, { P2: 'P4', P4: 'P2' }, { P4: 3 }, []]) {
      const r = applyPersonAnswers(groups, bad);
      expect(r.ok).toBe(false);
      expect(r.error.code).toBe(ERROR_CODE.INVALID_INPUT);
    }
  });

  it('원래 personGroups는 바꾸지 않는다', () => {
    const before = structuredClone(groups);
    applyPersonAnswers(groups, { P4: 'P2' });
    expect(groups).toEqual(before);
  });

  it('합친 그룹으로 마스킹하면 예금주 이름도 임대인 가명으로 바뀐다', () => {
    const merged = applyPersonAnswers(groups, { P4: 'P2' }).data;
    const findings = [...mockRegistryFindings, ...mockLeaseFindings];
    const plan = createMaskingPlan(findings, merged, MASKING_PURPOSE.FRAUD_CHECK).data;
    const landlordAlias = byId(groups, 'P2').alias;
    for (const id of byId(merged, 'P2').findingIds) {
      expect(plan.items.find((i) => i.findingId === id).replacement).toBe(landlordAlias);
    }
  });
});

describe('PART 4 buildPersonQuestions', () => {
  it('AMBIGUOUS인 사람마다 이름이 같은 다른 사람을 후보로 묻는다', () => {
    const qs = buildPersonQuestions(mockExtractedFields, groups);
    expect(qs).toHaveLength(1);
    expect(qs[0]).toMatchObject({ personId: 'P4', roles: ['ACCOUNT_HOLDER'], names: ['김철수'] });
    expect(qs[0].candidates.map((c) => c.personId)).toEqual(['P1', 'P2']);
  });

  it('이름은 다른데 생년월일이 같은 경우(OCR 오타)도 후보가 된다', () => {
    const fields = {
      registry: { owners: [{ findingId: 'A', name: '김철수', birthDate: '800101', role: 'OWNER' }] },
      contract: { landlords: [{ findingId: 'B', name: '김철슈', birthDate: '800101', role: 'LANDLORD' }] },
    };
    const people = matchPeople(fields).data;
    const qs = buildPersonQuestions(fields, people);
    expect(qs.map((q) => q.personId)).toEqual(['P1', 'P2']);
    expect(qs[0].candidates.map((c) => c.personId)).toEqual(['P2']);
  });

  it('AMBIGUOUS가 없으면 빈 목록', () => {
    const confirmed = groups.map((g) => ({ ...g, status: 'CONFIRMED' }));
    expect(buildPersonQuestions(mockExtractedFields, confirmed)).toEqual([]);
  });
});
