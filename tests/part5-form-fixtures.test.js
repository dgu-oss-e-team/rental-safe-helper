// PART 5. 실제 양식 모양의 가짜 서류로 5개 파트를 통과시킨다 (#165)
// 서류: tests/fixtures/form-*.pdf (scripts/sample-docs/form-*.html → node scripts/make-sample-pdfs.mjs <Chrome> --forms)
//   - form-trust-registry + form-private-lease: 법인(부동산투자회사) 소유, 신탁, 민간임대 계약서. 같은 집·같은 법인
//   - form-coowner-registry: 개인 공유 → 공유자 전원 지분 이전
// 이름·번호·주소·회사는 모두 가짜다. 실제 서류에서 가져온 값은 없다.
//
// it(...)      : 지금 잘 되는 것. 깨지면 안 된다.
// it.fails(...): 실제 서류 점검에서 나온, 아직 안 고친 문제. 지금은 "실패해야 통과"한다.
//   담당 파트가 고치면 이 테스트가 빨갛게 바뀐다 → 그 PR에서 it.fails를 it으로 바꿔 주세요.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeDocuments, prepareForAi } from '../src/app/pipeline.js';
import { DOCUMENT_TYPE, SOURCE_TYPE, RISK_STATUS, MASKING_PURPOSE } from '../src/shared/document-model.js';

const fixturePdf = (name) =>
  new File([readFileSync(new URL(`./fixtures/${name}.pdf`, import.meta.url))], `${name}.pdf`, {
    type: 'application/pdf',
  });

const analyze = async (names) => {
  const r = await analyzeDocuments({ files: names.map(fixturePdf) });
  if (!r.ok) throw new Error(`analyzeDocuments stopped at ${r.step}: ${r.error.code}`);
  return r.data;
};

const statusOf = (a, ruleId) => a.riskResults.find((r) => r.ruleId === ruleId)?.status;
const findingsOf = (a, type) => a.findings.filter((f) => f.type === type).map((f) => f.value);
/** 프롬프트와 가린 글 전체. 멈추면(ok:false) 보낼 글이 없으므로 빈 글 */
const sharedText = (a, purpose = MASKING_PURPOSE.FRAUD_CHECK) => {
  const r = prepareForAi(a, purpose);
  return r.ok ? [r.data.prompt, ...Object.values(r.data.maskedText)].join('\n') : '';
};

/** 계약서 임차인 칸: 입력칸 두 개가 겹쳐서 붙어 읽히는 값 */
const STUCK_IDS = '960712-2583914881023-1647205';
const STUCK_PHONES = '010-0000-4826010-0000-9173';
/** 법인등록번호 (개인의 주민·외국인등록번호가 아니다) */
const CORPORATE_NUMBERS = ['110111-3579246', '110111-6802467'];

/** @type {any} */ let trust;
/** @type {any} */ let coowner;

beforeAll(async () => {
  trust = await analyze(['form-trust-registry', 'form-private-lease']);
  coowner = await analyze(['form-coowner-registry']);
});

describe('#165 실제 양식 가짜 서류: 읽기·판별', () => {
  it('세 서류를 글자 PDF로 읽고 등기부·계약서로 판별한다', () => {
    expect(trust.documents.map((d) => d.documentType)).toEqual([DOCUMENT_TYPE.REGISTRY, DOCUMENT_TYPE.LEASE_CONTRACT]);
    expect(coowner.documents.map((d) => d.documentType)).toEqual([DOCUMENT_TYPE.REGISTRY]);
    for (const d of [...trust.documents, ...coowner.documents]) expect(d.sourceType).toBe(SOURCE_TYPE.TEXT_PDF);
  });

  it('실제 서류처럼 겹친 입력칸의 두 값이 한 줄에 붙어 읽힌다 (재현 확인)', () => {
    const text = trust.documents[1].pages.flatMap((p) => p.blocks.map((b) => b.text)).join('\n');
    expect(text).toContain(STUCK_IDS);
    expect(text).toContain(STUCK_PHONES);
  });
});

describe('#165 지금 잘 되는 것', () => {
  it('신탁 등기부 → TRUST_REGISTERED는 STOP', () => {
    expect(statusOf(trust, 'TRUST_REGISTERED')).toBe(RISK_STATUS.STOP);
  });

  it('계약일(2026-11-10)과 신탁 소유권이전 접수일(2024-03-08)을 읽는다', () => {
    expect(trust.fields.contract.contractDate).toBe('2026-11-10');
    expect(trust.fields.registry.lastTransferDate).toBe('2024-03-08');
  });

  it('신탁 등기부에 근저당이 없으면 MORTGAGE_EXISTS는 NO_FLAG', () => {
    expect(statusOf(trust, 'MORTGAGE_EXISTS')).toBe(RISK_STATUS.NO_FLAG);
  });

  // 붙은 번호는 탐지해서 가리거나(#166), 탐지 못 하면 보내기 전 검사가 멈춘다(#163). 어느 쪽이든 AI로 가지 않는다.
  it('붙어 읽힌 주민번호·전화번호는 어떤 목적에서도 AI로 가지 않는다 (가리거나 멈춤)', () => {
    const parts = ['960712', '2583914', '881023', '1647205', '010-0000-4826', '010-0000-9173'];
    for (const purpose of Object.values(MASKING_PURPOSE)) {
      const r = prepareForAi(trust, purpose);
      if (!r.ok) {
        expect(r.step).toBe('validateMaskedText');
        continue;
      }
      const shared = [r.data.prompt, ...Object.values(r.data.maskedText)].join('\n');
      for (const p of parts) expect(shared, `"${p}" is still visible (${purpose})`).not.toContain(p);
    }
  });

  it('공유 등기부의 주민번호(뒷자리 *)는 모두 가린다', () => {
    const shared = sharedText(coowner);
    expect(shared).not.toBe('');
    for (const birth of ['790521', '830917', '820914']) expect(shared).not.toContain(birth);
  });
});

// ---- 아직 안 고친 문제 (실제 서류 점검, 11/17) ----

describe('#165 남은 문제: PART 2 개인정보 탐지', () => {
  it('붙어 읽힌 주민번호 두 개를 각각 RESIDENT_ID로 찾는다', () => {
    expect(findingsOf(trust, 'RESIDENT_ID')).toEqual(expect.arrayContaining(['960712-2583914', '881023-1647205']));
  });

  it('붙어 읽힌 전화번호 두 개를 각각 PHONE_NUMBER로 찾는다', () => {
    expect(findingsOf(trust, 'PHONE_NUMBER')).toEqual(expect.arrayContaining(['010-0000-4826', '010-0000-9173']));
  });

  it.fails('법인등록번호(110111-…)를 주민·외국인등록번호로 보지 않는다', () => {
    const personalIds = [...findingsOf(trust, 'RESIDENT_ID'), ...findingsOf(trust, 'FOREIGNER_ID')];
    for (const n of CORPORATE_NUMBERS) expect(personalIds).not.toContain(n);
  });

  it('"공유자" 라벨 다음 줄의 공유자 이름(이몽룡·심청)이 AI로 가지 않는다', () => {
    const shared = sharedText(coowner);
    expect(shared).not.toBe('');
    for (const name of ['이몽룡', '심청']) expect(shared).not.toContain(name);
  });

  it('두 줄 주소의 둘째 줄("61,107동602호(가상동,가상아파트)")이 AI로 가지 않는다', () => {
    const shared = sharedText(coowner);
    expect(shared).not.toBe('');
    expect(shared).not.toContain('107동602호');
  });

  it('계약서 "대표이사" 다음 이름(홍길동)을 PERSON_NAME으로 찾는다', () => {
    expect(findingsOf(trust, 'PERSON_NAME')).toContain('홍길동');
  });
});

describe('#165 남은 문제: PART 3 항목 추출·위험 점검', () => {
  it.fails('"임대사업자 / 성명(법인명)" 다음 줄의 법인명을 임대인으로 읽는다', () => {
    expect(trust.fields.contract.landlords?.length).toBeGreaterThan(0);
  });

  it.fails('금액 표의 제목 줄 / 금액 줄에서 보증금 3천만 원을 읽는다 (계약금 ₩0과 헷갈리지 않음)', () => {
    expect(trust.fields.contract.deposit).toBe(30000000);
  });

  it.fails('"4. 특약" 칸을 찾아 위험 특약(전입신고 제한)을 점검한다', () => {
    expect(trust.fields.contract.specialTerms).not.toBeNull();
    expect(statusOf(trust, 'RISKY_SPECIAL_TERM')).not.toBe(RISK_STATUS.UNVERIFIABLE);
  });

  it.fails('신탁 1건(소유권이전 신탁 + 신탁원부 + 신탁주의사항)을 1건으로 센다', () => {
    expect(trust.fields.registry.rights.filter((r) => r.kind === 'TRUST')).toHaveLength(1);
  });

  it.fails('법인 소유자(가상주택리츠주식회사)를 소유자로 읽는다', () => {
    expect(trust.fields.registry.owners?.length).toBeGreaterThan(0);
  });

  it.fails('지번 주소 등기부와 도로명 주소 계약서가 같은 집이면 소재지 비교가 확인 불가가 아니다', () => {
    expect(statusOf(trust, 'ADDRESS_MISMATCH')).not.toBe(RISK_STATUS.UNVERIFIABLE);
  });

  it('두 줄로 나뉜 등기목적("공유자전원지분전부" / "이전")을 소유권 이전으로 읽는다', () => {
    expect(coowner.fields.registry.lastTransferDate).toBe('2025-09-15');
    expect(coowner.fields.registry.owners?.map((o) => o.name)).toEqual(['박문수']);
  });
});

describe('#165 남은 문제: PART 4 인물 판별', () => {
  it.fails('계약서에 두 번 나오는 임차인 성춘향은 같은 가명 하나로 묶는다', () => {
    const tenants = trust.personGroups.filter((g) => g.roles.includes('TENANT'));
    expect(tenants).toHaveLength(1);
  });
});
