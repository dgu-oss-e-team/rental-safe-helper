// PART 2. 빽빽한 가짜 서류에서 위험 점검 재료(fields)를 바르게 읽는지 (#141), 이름을 빠짐없이 찾는지 (#142)
// tests/fixtures/dense-*.pdf는 PART 5(#140)가 공개 양식 구조를 따라 만든 가짜 서류다. 이름·번호·주소는 모두 가짜다.
// 실제 서류처럼 칸이 좁아서 글자가 다음 줄로 넘어가고, 서명란은 "주민등록번호 → 전화 → 성명" 순서다.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { readDocuments, analyzeReadDocuments, prepareForAi } from '../src/app/pipeline.js';
import { MASKING_PURPOSE } from '../src/shared/document-model.js';

const fixture = (name) =>
  new File([readFileSync(new URL(`./fixtures/${name}`, import.meta.url))], name, { type: 'application/pdf' });

/** @type {any} */
let analysis;
/** @type {any} */
let fields;
/** @type {any[]} */
let risks;

beforeAll(async () => {
  const read = await readDocuments({ files: [fixture('dense-registry.pdf'), fixture('dense-lease.pdf')] });
  if (!read.ok) throw new Error(`readDocuments stopped at ${read.step}: ${read.error.code}`);
  const r = analyzeReadDocuments(read.data);
  if (!r.ok) throw new Error(`analyzeReadDocuments stopped at ${r.step}: ${r.error.code}`);
  analysis = r.data;
  fields = r.data.fields;
  risks = r.data.riskResults;
});

/** 가짜 서류에 들어 있는 이름 (모두 가짜) */
const FAKE_NAMES = ['김철수', '박영수', '이가상', 'NGUYEN VAN A', '최가상'];

describe('PART 2 빽빽한 서류의 이름 (#142)', () => {
  it('채무자·채권자·영수자·괄호 안 이름까지 찾고, "무소"는 이름으로 잡지 않는다', () => {
    const names = analysis.findings.filter((f) => f.type === 'PERSON_NAME').map((f) => f.value);
    expect(new Set(names)).toEqual(new Set(FAKE_NAMES));
  });

  for (const purpose of Object.values(MASKING_PURPOSE)) {
    it(`${purpose}: ③→④에서 막히지 않고, 프롬프트에 이름이 남지 않는다`, () => {
      const r = prepareForAi(analysis, purpose);
      expect(r.ok, r.ok ? '' : `stopped at ${r.step}: ${r.error.message}`).toBe(true);
      for (const name of FAKE_NAMES) expect(r.data.prompt).not.toContain(name);
    });
  }
});

const statusOf = (ruleId) => risks.find((r) => r.ruleId === ruleId)?.status;

describe('PART 2 빽빽한 등기부 (#141)', () => {
  it('말소된 가압류·근저당은 말소로 읽고, 다음 줄로 넘어간 등기원인을 새 권리로 세지 않는다', () => {
    expect(fields.registry.rights.map((r) => [r.kind, r.maxClaimAmount, r.cancelled])).toEqual([
      ['PROVISIONAL_SEIZURE', null, true],
      ['MORTGAGE', 180000000, true],
      ['MORTGAGE', 240000000, false],
    ]);
    expect(statusOf('SEIZURE_ACTIVE')).toBe('NO_FLAG');
  });

  it('집 주소는 맨 위 "[집합건물]" 줄에서 읽는다 (표 안의 섞인 칸이 아니라)', () => {
    expect(fields.registry.address).toBe('서울특별시 중구 가상로 12, 가상아파트 제3동 제7층 제702호');
  });

  it('등기부 "제7층 제702호"와 계약서 "3동 702호"는 같은 주소로 본다 (PART 3 #148과 함께)', () => {
    expect(statusOf('ADDRESS_MISMATCH')).toBe('NO_FLAG');
  });

  it('주소에 표 옆 칸(면적·날짜·건물내역·사무소명칭)을 붙여 잡지 않는다 (#151)', () => {
    const addresses = analysis.findings.filter((f) => f.type === 'ADDRESS').map((f) => f.value);
    for (const a of addresses) expect(a, a).not.toMatch(/㎡|\d{4}년|등기|철근|사무소명칭/);
    expect(addresses).toContain('서울특별시 중구 가상동 123 대');
    expect(addresses).toContain('서울특별시 중구 가상로 20, 1층');
  });

  it('지금 소유자·예전 소유자·마지막 소유권이전 날짜', () => {
    expect(fields.registry.owners.map((p) => [p.name, p.birthDate])).toEqual([['김철수', '800101']]);
    expect(fields.registry.previousOwners.map((p) => [p.name, p.birthDate])).toEqual([['박영수', '700101']]);
    expect(fields.registry.lastTransferDate).toBe('2026-08-03');
  });
});

describe('PART 2 빽빽한 계약서 (#141)', () => {
  it('서명란에서 이름 앞에 있는 주민·외국인등록번호로 생년월일을 읽는다', () => {
    expect(fields.contract.landlords.map((p) => [p.name, p.birthDate])).toEqual([['김철수', '750315']]);
    expect(fields.contract.tenants.map((p) => [p.name, p.birthDate])).toEqual([['NGUYEN VAN A', '990505']]);
  });

  it('소유자(800101)와 임대인(750315)의 생년월일이 달라서 STOP이다 (확인 불가가 아니라)', () => {
    expect(statusOf('OWNER_MISMATCH')).toBe('STOP');
  });

  it('보증금·월세·계약일', () => {
    expect([fields.contract.deposit, fields.contract.monthlyRent, fields.contract.contractDate]).toEqual([
      50000000, 500000, '2026-11-01',
    ]);
  });
});
