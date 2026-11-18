// PART 4. 주민번호 모양인 등기 번호(법인등록번호 110111-…)는 ④에서 풀 수 없게 (#192 A안)
// 법인등록번호는 REGISTRY_ID로 잡히는데 주민번호와 모양이 같다. 회사 이름 판단이 틀려 진짜 주민번호가
// REGISTRY_ID로 잡혔을 때 풀 수 있으면, 보내기 전 검사도 일부러 보이게 한 자리로 보고 넘어가서 그대로 나간다.
// 예시는 모두 가짜 값이다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMaskingPlan, applyMaskingPlan, validateMaskedText } from '../src/features/masking/index.js';
import { analyzeDocuments, prepareForAi } from '../src/app/pipeline.js';
import { isNonRemovable, resolveRemovals } from '../src/features/masking/user-edits.js';
import { buildReviewRows, setRowShown } from '../src/features/masking/review-model.js';
import { MASKING_ACTION, MASKING_PURPOSE, PII_TYPE } from '../src/shared/document-model.js';

const BOX = { x: 0.1, y: 0.1, width: 0.6, height: 0.03 };
const registryId = (id, value) => ({ id, type: PII_TYPE.REGISTRY_ID, value, documentId: 'D', blockId: 'B1', pageIndex: 0, bbox: BOX });
const corporate = registryId('R1', '110111-3579246'); // 법인등록번호 (주민번호 모양)
const masked = registryId('R2', '800101-1******'); // 뒷자리가 가려진 주민번호 모양
const uniqueNo = registryId('R3', '1101-2024-123456'); // 등기 고유번호 (4-4-6)

describe('PART 4 주민번호 모양인 등기 번호는 풀 수 없다', () => {
  it('주민번호 모양(6-7자리)이면 해제할 수 없고, 등기 고유번호(4-4-6)는 지금처럼 풀 수 있다', () => {
    expect(isNonRemovable(corporate)).toBe(true);
    expect(isNonRemovable(masked)).toBe(true);
    expect(isNonRemovable(uniqueNo)).toBe(false);
  });

  it('remove에 넣어도 무시한다 (등기 고유번호만 풀린다)', () => {
    const keep = resolveRemovals([corporate, masked, uniqueNo], [], { remove: ['R1', 'R2', 'R3'], add: [] });
    expect([...keep]).toEqual(['R3']);
  });

  it('④ 목록에서 잠금으로 보이고, 켜도 바뀌지 않는다', () => {
    const list = [corporate, uniqueNo];
    const plan = createMaskingPlan(list, [], MASKING_PURPOSE.FRAUD_CHECK).data;
    const rows = buildReviewRows({ findings: list, personGroups: [], plan });
    const row = rows.find((r) => r.findingIds.includes('R1'));
    expect(row?.locked).toBe(true);
    expect(rows.find((r) => r.findingIds.includes('R3'))?.locked).toBe(false);
    expect(setRowShown({ remove: [], add: [] }, row, true).remove).toEqual([]);
  });

  it('풀려고 해도 목적 3가지 모두 가려지고 보내기 전 검사를 통과한다', () => {
    const doc = { documentId: 'D', pages: [{ pageIndex: 0, width: 1, height: 1, blocks: [
      { blockId: 'B1', text: '가상주택리츠 주식회사 110111-3579246', bbox: BOX, confidence: null },
    ] }] };
    const edits = { remove: ['R1'], add: [] };
    for (const purpose of Object.values(MASKING_PURPOSE)) {
      const plan = createMaskingPlan([corporate], [], purpose, edits).data;
      const out = applyMaskingPlan([doc], plan, [corporate], [], edits).data;
      expect(out.maskedText.D, purpose).toBe('가상주택리츠 주식회사 [REDACTED]');
      expect(validateMaskedText(out.maskedText, [corporate], plan).ok, purpose).toBe(true);
    }
  });

  it('보내기 전 검사: 해제(KEEP)로 들어와도 주민번호 모양이면 막는다 (잠금이 뚫려도 두 번째 안전장치)', () => {
    const doc = { documentId: 'D', pages: [{ pageIndex: 0, width: 1, height: 1, blocks: [
      { blockId: 'B1', text: '임차인 남궁공사 800101-1234567', bbox: BOX, confidence: null },
    ] }] };
    const wrong = registryId('R9', '800101-1234567'); // 사람 주민번호가 회사 번호로 잘못 잡힌 경우
    const plan = { purpose: MASKING_PURPOSE.FRAUD_CHECK, items: [{ findingId: 'R9', action: MASKING_ACTION.KEEP }] };
    const r = validateMaskedText({ D: doc.pages[0].blocks[0].text }, [wrong], plan);
    expect(r.ok).toBe(false);
  });
});

describe('PART 4 #168 가짜 서류: 법인등록번호를 풀어도 AI로 가지 않는다', () => {
  const pdf = (name) =>
    new File([readFileSync(new URL(`./fixtures/${name}.pdf`, import.meta.url))], `${name}.pdf`, { type: 'application/pdf' });

  it('110111-… 번호를 REGISTRY_ID로 보고 ④에서 풀어도, 목적 3가지 모두 가려져서 나간다', async () => {
    const read = await analyzeDocuments({ files: [pdf('form-trust-registry'), pdf('form-private-lease')] });
    expect(read.ok).toBe(true);
    // #197(PART 2)처럼 법인등록번호를 REGISTRY_ID로 잡은 상태를 만든다
    const findings = read.data.findings.map((f) =>
      f.value.startsWith('110111-') ? { ...f, type: PII_TYPE.REGISTRY_ID } : f,
    );
    const corp = findings.filter((f) => f.type === PII_TYPE.REGISTRY_ID && f.value.startsWith('110111-'));
    expect(corp.length).toBeGreaterThan(0);
    const analysis = { ...read.data, findings };
    for (const purpose of Object.values(MASKING_PURPOSE)) {
      const r = prepareForAi(analysis, purpose, { remove: corp.map((f) => f.id), add: [] });
      expect(r.ok, purpose).toBe(true); // 해제가 무시돼서 가려진 채로 통과
      for (const f of corp) expect(r.data.prompt, purpose).not.toContain(f.value);
    }
  }, 20000);
});
