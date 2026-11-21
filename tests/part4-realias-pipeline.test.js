// PART 4. 답으로 합친 뒤 다시 매긴 가명이 ② 위험 점검 설명·④·⑤·범례에서 모두 같은지 (빽빽한 가짜 서류)
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeDocuments, recheckPeople, prepareForAi } from '../src/app/pipeline.js';
import { MASKING_PURPOSE } from '../src/shared/document-model.js';

const pdf = (name) =>
  new File([readFileSync(new URL(`./fixtures/${name}.pdf`, import.meta.url))], `${name}.pdf`, { type: 'application/pdf' });
/** @param {unknown} x */
const aliasesIn = (x) => new Set(JSON.stringify(x).match(/\[[A-Za-z]+_[A-Z]\??\]/g) ?? []);

describe('PART 4 다시 매긴 가명이 화면마다 같다', () => {
  let analysis;
  beforeAll(async () => {
    analysis = (await analyzeDocuments({ files: [pdf('dense-registry'), pdf('dense-lease')] })).data;
  }, 20000);

  it('예금주를 소유자로 답하면 [PrevOwner_E]가 [PrevOwner_D]가 되고, 위험 점검 설명과 범례가 같은 글자를 쓴다', () => {
    // 샘플: P4 예금주 [AccountHolder_D]가 AMBIGUOUS
    const checked = recheckPeople(analysis, { P4: 'P1' }).data;
    expect(checked.personGroups.map((g) => g.alias)).toEqual(['[Owner_A]', '[Landlord_B]', '[Tenant_C]', '[PrevOwner_D]']);

    const prepared = prepareForAi(
      { ...analysis, personGroups: checked.personGroups, riskResults: checked.riskResults },
      MASKING_PURPOSE.FRAUD_CHECK,
    ).data;
    const legend = new Set(Object.keys(prepared.legend));
    // ② 위험 점검 설명(답한 뒤 다시 계산)에 나오는 가명은 모두 ④·⑤·AI 글 범례에 있다
    for (const alias of aliasesIn(checked.riskResults)) expect(legend.has(alias), alias).toBe(true);
    // 예전 글자는 어디에도 없다
    expect(legend.has('[PrevOwner_E]')).toBe(false);
    expect(prepared.prompt).not.toContain('[PrevOwner_E]');
  });
});
