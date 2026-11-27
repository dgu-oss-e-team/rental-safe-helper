// PART 3. 등기부 요약(Registry (extracted)) 이름표와 안전 단정 금지 규칙 (#361)
// 요약 예시는 PR #355 형식의 Mock. 가짜 데이터만 사용.
import { describe, it, expect } from 'vitest';
import {
  buildPrompt,
  REGISTRY_SUMMARY_LABEL,
  REGISTRY_SUMMARY_RULE,
  REGISTRY_NOT_PROVIDED_LINE,
} from '../src/features/risk-check/prompt-builder.js';
import { MASKING_PURPOSE } from '../src/shared/document-model.js';

const { FRAUD_CHECK, CLAUSE_EXPLANATION, CONTRACT_EXPLANATION } = MASKING_PURPOSE;

const REGISTRY_TITLE = 'Property register (등기부등본)';
const LEASE_TITLE = 'Lease contract (임대차계약서)';

// 계약서는 인적사항 칸이 요약(PARTY_SUMMARY)으로 바뀐 글
const PARTY_SUMMARY_LEASE = [
  'Parties (summary): landlord [Landlord_A], tenant [Tenant_A]',
  '제3조 (존속기간) 임대차 기간은 2년으로 한다.',
].join('\n');

const REGISTRY_SUMMARY = [
  'Extracted items from the property register (the original register text is not sent).',
  'Owner: [Owner_A]',
  'Rights and restrictions: Could not read',
  'Unconfirmed register records: 1 (could not read what they are, check the original register)',
].join('\n');

const legend = { '[Landlord_A]': 'landlord', '[Tenant_A]': 'tenant', '[Owner_A]': 'owner' };

const build = (purpose, maskedText, registry) =>
  buildPrompt({ purpose, riskResults: [], maskedText, legend, registry });

describe('PART 3 프롬프트: 등기부 요약 이름표·규칙 (#361)', () => {
  it('사기 위험 확인: Registry (extracted) 이름표와 규칙 문구가 들어간다', () => {
    const r = build(
      FRAUD_CHECK,
      { [REGISTRY_TITLE]: REGISTRY_SUMMARY, [LEASE_TITLE]: PARTY_SUMMARY_LEASE },
      { summaryTitle: REGISTRY_TITLE },
    );
    expect(r.ok).toBe(true);
    expect(r.data).toContain(`### ${REGISTRY_SUMMARY_LABEL}\n`);
    expect(r.data).toContain(REGISTRY_SUMMARY_RULE);
    // 요약 글과 PARTY_SUMMARY로 바뀐 계약서가 모두 그대로 들어간다
    expect(r.data).toContain('Could not read');
    expect(r.data).toContain('Parties (summary): landlord [Landlord_A], tenant [Tenant_A]');
    expect(r.data).toContain(`### ${LEASE_TITLE}\n`);
    // 요약은 이름표로 나가고, 같은 서류 이름 제목은 따로 나오지 않는다
    expect(r.data).not.toContain(`### ${REGISTRY_TITLE}\n`);
  });

  it('규칙 문구에 표시 6개와 "원본 확인 안내"가 모두 있다', () => {
    for (const mark of ['Could not read', 'could not check', 'Unconfirmed register records', 'details hidden', 'cancellation unclear', 'check the original']) {
      expect(REGISTRY_SUMMARY_RULE).toContain(`"${mark}"`);
    }
    expect(REGISTRY_SUMMARY_RULE).toContain('check the original registry');
  });

  it('계약 조건 설명: 등기부가 없으면 이름표도 규칙도 없다', () => {
    const r = build(CONTRACT_EXPLANATION, { [LEASE_TITLE]: PARTY_SUMMARY_LEASE });
    expect(r.ok).toBe(true);
    expect(r.data).not.toContain(REGISTRY_SUMMARY_LABEL);
    expect(r.data).not.toContain(REGISTRY_SUMMARY_RULE);
    expect(r.data).not.toContain(REGISTRY_NOT_PROVIDED_LINE);
  });

  it('조항·용어 설명: 등기부는 가린 원문 그대로, 이름표 없음', () => {
    const r = build(CLAUSE_EXPLANATION, { [REGISTRY_TITLE]: '소유자 [Owner_A] 가린 원문', [LEASE_TITLE]: PARTY_SUMMARY_LEASE });
    expect(r.ok).toBe(true);
    expect(r.data).not.toContain(REGISTRY_SUMMARY_LABEL);
    expect(r.data).not.toContain(REGISTRY_SUMMARY_RULE);
    expect(r.data).toContain(`### ${REGISTRY_TITLE}\n`);
  });

  it('요약 없음(요약 실패로 등기부 제외): 오류 없이 만들고 "등기부 정보 없음" 한 줄을 넣는다', () => {
    const r = build(FRAUD_CHECK, { [LEASE_TITLE]: PARTY_SUMMARY_LEASE }, { unavailable: true });
    expect(r.ok).toBe(true);
    expect(r.data).toContain(REGISTRY_NOT_PROVIDED_LINE);
    expect(r.data).not.toContain(REGISTRY_SUMMARY_LABEL);
  });

  it('"등기부 정보 없음" 한 줄은 사기 위험 확인에만 들어간다', () => {
    for (const purpose of [CLAUSE_EXPLANATION, CONTRACT_EXPLANATION]) {
      const r = build(purpose, { [LEASE_TITLE]: PARTY_SUMMARY_LEASE }, { unavailable: true });
      expect(r.ok).toBe(true);
      expect(r.data).not.toContain(REGISTRY_NOT_PROVIDED_LINE);
    }
  });

  it('registry를 안 넘기면 기존 프롬프트와 똑같다', () => {
    const maskedText = { [LEASE_TITLE]: PARTY_SUMMARY_LEASE };
    const a = buildPrompt({ purpose: FRAUD_CHECK, riskResults: [], maskedText, legend });
    const b = buildPrompt({ purpose: FRAUD_CHECK, riskResults: [], maskedText, legend, registry: {} });
    expect(b.data).toBe(a.data);
  });

  it('마스킹 검증: 입력에 없던 이름·주소·번호는 프롬프트에 나타나지 않는다', () => {
    const r = build(
      FRAUD_CHECK,
      { [REGISTRY_TITLE]: REGISTRY_SUMMARY, [LEASE_TITLE]: PARTY_SUMMARY_LEASE },
      { summaryTitle: REGISTRY_TITLE },
    );
    for (const sample of ['김철수', '이영희', '서울특별시 강남구 테헤란로 123', '900101-1234567', '010-1234-5678', '110-123-456789']) {
      expect(r.data).not.toContain(sample);
    }
  });
});
