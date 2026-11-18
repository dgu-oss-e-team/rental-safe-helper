// @vitest-environment happy-dom
// PART 5. 업로드 칸과 서류 종류가 다를 때 안내 (#186). 가상 데이터만 사용한다.
import { describe, it, expect, vi } from 'vitest';
import { filesWithSlots, uploadSlotNotices } from '../src/app/upload-check.js';
import { resultsScreen } from '../src/app/screens/results.js';
import { initialState } from '../src/app/app-state.js';
import { DOCUMENT_TYPE } from '../src/shared/document-model.js';

const REG = { documentType: DOCUMENT_TYPE.REGISTRY };
const LEASE = { documentType: DOCUMENT_TYPE.LEASE_CONTRACT };
const UNKNOWN = { documentType: DOCUMENT_TYPE.UNKNOWN };
const file = (name) => new File([''], name, { type: 'application/pdf' });

describe('PART 5 filesWithSlots(): 파일마다 올린 칸 기억', () => {
  it('두 칸 모두 → [등기부, 계약서] 순서, 칸도 같은 순서', () => {
    const r = filesWithSlots({ registry: file('a.pdf'), lease: file('b.pdf') });
    expect(r.files.map((f) => f.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(r.slots).toEqual(['registry', 'lease']);
  });

  it('한 칸만 → 그 칸만', () => {
    expect(filesWithSlots({ registry: null, lease: file('b.pdf') }).slots).toEqual(['lease']);
    expect(filesWithSlots({ registry: file('a.pdf'), lease: null }).slots).toEqual(['registry']);
  });
});

describe('PART 5 uploadSlotNotices(): 칸과 판별 결과 비교', () => {
  it('칸과 종류가 맞으면 안내 없음 (두 칸, 한 칸만)', () => {
    expect(uploadSlotNotices([REG, LEASE], ['registry', 'lease'])).toEqual([]);
    expect(uploadSlotNotices([LEASE], ['lease'])).toEqual([]);
    expect(uploadSlotNotices([REG], ['registry'])).toEqual([]);
  });

  it('시연 샘플(칸 없음)이나 개수가 안 맞으면 안내 없음', () => {
    expect(uploadSlotNotices([REG, LEASE], null)).toEqual([]);
    expect(uploadSlotNotices([REG, LEASE], ['registry'])).toEqual([]);
  });

  it('두 서류가 서로의 칸에 있음 → 안내 하나, 결과에는 영향 없다고 알림', () => {
    const n = uploadSlotNotices([LEASE, REG], ['registry', 'lease']);
    expect(n).toHaveLength(1);
    expect(n[0]).toContain("each other's boxes");
    expect(n[0]).toContain('not affected');
  });

  it('등기부 칸에 계약서만 → 무엇으로 점검했는지 + 등기부가 없어 확인 불가인 점검이 있다', () => {
    const n = uploadSlotNotices([LEASE], ['registry']);
    expect(n).toHaveLength(2);
    expect(n[0]).toBe('The file in the property register box looks like a lease contract, so we checked it as a lease contract.');
    expect(n[1]).toContain('No property register was checked');
    expect(n[1]).toContain('Could not check');
  });

  it('두 칸 모두 등기부 → 계약서 칸 안내 + 계약서가 없다는 안내', () => {
    const n = uploadSlotNotices([REG, REG], ['registry', 'lease']);
    expect(n).toEqual([
      'The file in the lease contract box looks like a property register, so we checked it as a property register.',
      expect.stringContaining('No lease contract was checked'),
    ]);
  });

  it('두 칸 모두 계약서 → 등기부 칸 안내 + 등기부가 없다는 안내', () => {
    const n = uploadSlotNotices([LEASE, LEASE], ['registry', 'lease']);
    expect(n[0]).toContain('property register box looks like a lease contract');
    expect(n[1]).toContain('No property register was checked');
  });

  it('종류를 모르는 서류(UNKNOWN)는 비교하지 않는다 (결과 화면이 따로 안내)', () => {
    expect(uploadSlotNotices([UNKNOWN, LEASE], ['registry', 'lease'])).toEqual([]);
    expect(uploadSlotNotices([LEASE, UNKNOWN], ['registry', 'lease'])).toEqual([
      expect.stringContaining('property register box looks like a lease contract'),
      expect.stringContaining('No property register was checked'),
    ]);
  });

  it('"safe" 같은 말이나 개발자용 말을 쓰지 않는다', () => {
    const all = [
      ...uploadSlotNotices([LEASE, REG], ['registry', 'lease']),
      ...uploadSlotNotices([REG, REG], ['registry', 'lease']),
      ...uploadSlotNotices([LEASE, LEASE], ['registry', 'lease']),
    ].join(' ');
    for (const word of ['safe', 'no risk', 'no warning', 'REGISTRY', 'LEASE_CONTRACT', 'slot']) expect(all).not.toContain(word);
  });
});

describe('PART 5 ② 결과 화면: 업로드 칸 안내 (#186)', () => {
  /** 서류 종류와 칸만 다른 가짜 분석 결과 (위험 결과·사람 없음) */
  const screenFor = (documents, uploadSlots) => {
    const analysis = { documents, fields: {}, personGroups: [], riskResults: [], findings: [], files: [] };
    const state = /** @type {any} */ ({ ...initialState(), step: 'results', analysis, uploadSlots });
    return resultsScreen(state, /** @type {any} */ ({ setPersonAnswers: vi.fn(), goTo: vi.fn(), restart: vi.fn() }));
  };

  it('칸과 종류가 맞으면 안내가 없다', () => {
    expect(screenFor([REG, LEASE], ['registry', 'lease']).querySelector('#upload-slot-notice')).toBeNull();
  });

  it('반대로 올리면 "Documents" 카드 안에 안내가 나온다', () => {
    const node = screenFor([LEASE, REG], ['registry', 'lease']);
    const notice = node.querySelector('#upload-slot-notice');
    expect(notice).not.toBeNull();
    expect(notice?.closest('section.card')?.querySelector('h2')?.textContent).toBe('Documents');
    expect(notice?.classList.contains('warning')).toBe(true);
    expect(notice?.textContent).toContain("each other's boxes");
  });

  it('두 칸 모두 계약서면 안내 문단이 2개', () => {
    const node = screenFor([LEASE, LEASE], ['registry', 'lease']);
    expect(node.querySelectorAll('#upload-slot-notice p')).toHaveLength(2);
  });

  it('시연 샘플(칸 없음)은 안내가 없다', () => {
    expect(screenFor([REG, LEASE], null).querySelector('#upload-slot-notice')).toBeNull();
  });
});
