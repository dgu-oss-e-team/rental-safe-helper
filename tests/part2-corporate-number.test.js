// PART 2. 법인 임대사업자 민간임대 계약서: 회사 이름 칸 아래 당사자 칸의 번호는 법인등록번호(REGISTRY_ID)
// 회사 이름·사람 이름·번호는 모두 가짜다.
import { describe, it, expect } from 'vitest';
import { analyzeReadDocuments, prepareForAi } from '../src/app/pipeline.js';
import { MASKING_PURPOSE, PII_TYPE } from '../src/shared/document-model.js';

/** @param {string[]} lines */
const doc = (lines) => ({
  documentId: 'LEASE',
  fileName: 'LEASE.pdf',
  sourceType: 'TEXT_PDF',
  pages: [
    {
      pageIndex: 0,
      width: 595,
      height: 842,
      blocks: lines.map((text, i) => ({
        blockId: `p0_b${i}`,
        text,
        bbox: { x: 0.1, y: (i + 1) / (lines.length + 2), width: 0.8, height: 0.01 },
        confidence: null,
      })),
    },
  ],
});

/** 실제 서식과 같은 읽기 순서. landlordName·landlordNumber만 바꿔 쓴다. */
const lease = (landlordName = '주식회사가상위탁관리부동산투자회사', landlordNumber = '110111-6000000') => [
  '■ 민간임대주택에 관한 특별법 시행규칙 [별지 제24호서식]',
  '표 준 임 대 차 계 약 서',
  '1. 계약 당사자',
  '성명(법인명)',
  `${landlordName} (서명 또는 인)`,
  '주소',
  '서울특별시 중구 가상로 12, 3층(가상동)',
  '(대표 사무소 소재지)',
  '임대사업자',
  '주민등록번호',
  `${landlordNumber} 전화번호 02-0000-0000`,
  '(사업자등록번호)',
  '임대사업자',
  '2020-서울중구-00123',
  '등록번호',
  '성명(법인명) 이가상 (서명 또는 인)',
  '임차인 주소 경기도 고양시 일산동구 가상로 1234, 101동 1001호',
  '주민등록번호 040404-3123456 전화번호 010-0000-2222',
];

/** @param {string[]} lines */
const analyze = (lines) => {
  const r = analyzeReadDocuments({ files: [], documents: [doc(lines)] });
  if (!r.ok) throw new Error(`stopped at ${r.step}`);
  return r.data;
};
/** @param {any} data @param {string} value */
const typeOf = (data, value) => data.findings.find((/** @type {any} */ f) => f.value === value)?.type;

describe('PART 2 법인 임대사업자 칸의 법인등록번호', () => {
  it('회사 이름 칸 아래 번호는 외국인등록번호가 아니라 REGISTRY_ID다 (뒷자리가 5-8로 시작해도)', () => {
    const data = analyze(lease());
    expect(typeOf(data, '110111-6000000')).toBe(PII_TYPE.REGISTRY_ID);
    // 뒷자리가 1-4로 시작하는 법인등록번호도 같다
    expect(typeOf(analyze(lease(undefined, '110111-1000000')), '110111-1000000')).toBe(PII_TYPE.REGISTRY_ID);
  });

  it('임차인 번호는 그대로 주민등록번호이고 생년월일도 읽는다', () => {
    const data = analyze(lease());
    expect(typeOf(data, '040404-3123456')).toBe(PII_TYPE.RESIDENT_ID);
    expect(data.fields.contract.tenants[0]).toMatchObject({ name: '이가상', birthDate: '040404' });
  });

  it('개인 임대사업자(사람 이름)면 번호는 그대로 사람 번호다', () => {
    const data = analyze(lease('김가상', '750315-1234567'));
    expect(typeOf(data, '750315-1234567')).toBe(PII_TYPE.RESIDENT_ID);
    expect(data.fields.contract.landlords[0]).toMatchObject({ name: '김가상', birthDate: '750315' });
  });

  it('회사 이름 칸 뒤에 대표자 이름이 먼저 오면 그 뒤 번호는 바꾸지 않는다 (대표자 번호일 수 있다)', () => {
    const lines = lease();
    const at = lines.indexOf('주민등록번호');
    lines.splice(at, 0, '대표이사 성명 김대표');
    const data = analyze(lines);
    expect(typeOf(data, '110111-6000000')).not.toBe(PII_TYPE.REGISTRY_ID);
  });

  it('바뀐 번호도 세 목적 모두 가려지고 보내기 전 검사를 통과한다', () => {
    const data = analyze(lease());
    for (const purpose of Object.values(MASKING_PURPOSE)) {
      const r = prepareForAi(data, purpose);
      expect(r.ok, r.ok ? '' : r.error.message).toBe(true);
      if (r.ok) expect(Object.values(r.data.maskedText).join('\n')).not.toContain('110111-6000000');
    }
  });
});
