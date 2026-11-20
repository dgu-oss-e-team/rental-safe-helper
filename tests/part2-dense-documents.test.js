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
    expect(addresses).toContain('서울특별시 중구 가상동 123'); // 대지권 표의 지목 "대"는 주소가 아니다
    expect(addresses).toContain('서울특별시 중구 가상로 20, 1층');
  });

  it('지금 소유자·예전 소유자·마지막 소유권이전 날짜', () => {
    expect(fields.registry.owners.map((p) => [p.name, p.birthDate])).toEqual([['김철수', '800101']]);
    expect(fields.registry.previousOwners.map((p) => [p.name, p.birthDate])).toEqual([['박영수', '700101']]);
    expect(fields.registry.lastTransferDate).toBe('2026-08-03');
  });
});

// 실제 개인 등기부 모양 (값은 모두 가짜): 표제부에서 주소로 찾은 지번이, 대지권 칸에서는 둘째 줄에 혼자 나온다.
// 예전에는 그 줄을 못 가려서 보내기 전 검사가 "a ADDRESS value is still visible"로 멈췄다.
describe('PART 2 같은 지번이 다른 칸에 혼자 또 나오는 등기부', () => {
  const lines = [
    '[집합건물] 서울특별시 중구 가상동3가 12-34 가상빌 제3층 제304호',
    '【 표 제 부 】 ( 1동의 건물의 표시 )',
    '1 2017년7월27일 서울특별시 중구 가상동3가 철근콘크리트구조',
    '12-34 (철근)콘크리트지붕',
    '가상빌 6층 단지형다세대주택',
    '( 대지권의 목적인 토지의 표시 )',
    '1 1. 서울특별시 중구 가상동3가 주차장 329㎡ 2017년7월27일 등기',
    ' 12-34',
    '2 1. 서울특별시 중구 가상동3가 대 329㎡ 2017년8월7일 1토지 지목변경',
    ' 12-34 2017년8월11일 등기',
    '【 갑 구 】 ( 소유권에 관한 사항 )',
    '1 소유권보존 2017년7월27일 소유자 가나다 740916-*******',
  ];
  const registry = {
    documentId: 'DOC_LOT',
    fileName: 'lot.pdf',
    sourceType: 'TEXT_PDF',
    pages: [
      {
        pageIndex: 0,
        width: 595,
        height: 842,
        blocks: lines.map((text, i) => ({
          blockId: `p0_b${i}`,
          text,
          bbox: { x: 0.05, y: (i + 1) / (lines.length + 2), width: 0.9, height: 0.01 },
          confidence: null,
        })),
      },
    ],
  };

  for (const purpose of Object.values(MASKING_PURPOSE)) {
    it(`${purpose}: 멈추지 않고, 지번이 어디에도 남지 않는다`, () => {
      const a = analyzeReadDocuments({ files: [], documents: [registry] });
      expect(a.ok).toBe(true);
      const r = prepareForAi(a.data, purpose);
      expect(r.ok, r.ok ? '' : `stopped at ${r.step}: ${r.error.message}`).toBe(true);
      const shared = [r.data.prompt, ...Object.values(r.data.maskedText)].join('\n');
      expect(shared).not.toContain('12-34');
    });
  }
});

describe('PART 2 숫자 지번 조각이 금액·호수 안에도 나오는 등기부 (#206)', () => {
  const lines = [
    '[집합건물] 서울특별시 중구 가상동3가 740 가상빌 제3층 제304호',
    '【 표 제 부 】 ( 1동의 건물의 표시 )',
    '1 2017년7월27일 서울특별시 중구 가상동3가 철근콘크리트구조',
    '740 (철근)콘크리트지붕',
    '가상빌 6층 단지형다세대주택',
    '( 대지권의 목적인 토지의 표시 )',
    '1 1. 서울특별시 중구 가상동3가 대 329㎡ 2017년7월27일 등기',
    ' 740',
    '【 을 구 】 ( 소유권 이외의 권리에 관한 사항 )',
    '1 근저당권설정 2018년1월2일 제1740호 채권최고액 금740,000,000원',
  ];
  const registry = {
    documentId: 'DOC_LOT740',
    fileName: 'lot740.pdf',
    sourceType: 'TEXT_PDF',
    pages: [
      {
        pageIndex: 0,
        width: 595,
        height: 842,
        blocks: lines.map((text, i) => ({
          blockId: `p0_b${i}`,
          text,
          bbox: { x: 0.05, y: (i + 1) / (lines.length + 2), width: 0.9, height: 0.01 },
          confidence: null,
        })),
      },
    ],
  };

  for (const purpose of Object.values(MASKING_PURPOSE)) {
    it(`${purpose}: 혼자 나온 지번은 가리고, 금액·접수번호는 그대로 둔다`, () => {
      const a = analyzeReadDocuments({ files: [], documents: [registry] });
      expect(a.ok).toBe(true);
      const r = prepareForAi(a.data, purpose);
      expect(r.ok, r.ok ? '' : `stopped at ${r.step}: ${r.error.message}`).toBe(true);
      const masked = Object.values(r.data.maskedText).join('\n');
      expect(masked).toContain('금740,000,000원');
      expect(masked).toContain('제1740호');
      expect(masked).not.toMatch(/(?<![\d,])740(?![\d,])/);
    });
  }
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
