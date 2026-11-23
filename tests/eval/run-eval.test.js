// PART 5. 평가 세트로 지표를 계산해 docs/EVALUATION.md에 쓴다 (#251, 지도 교수님 피드백 ②)
//
// 실행: npm run eval   (= vitest run tests/eval/run-eval.test.js --mode eval)
// 보통 테스트(npm test)에서는 건너뛴다. 서류를 모두 읽어 시간이 걸리고, 결과 파일을 고쳐 쓰기 때문이다.
// 서류·정답표는 모두 가짜 데이터다 (tests/eval/truth/*.json, tests/eval/set.json).
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { analyzeDocuments, prepareForAi } from '../../src/app/pipeline.js';
import { createMaskingPlan, applyMaskingPlan } from '../../src/features/masking/index.js';
import { emptyEdits, normalizeEdits } from '../../src/app/masking-edits.js';
import { MASKING_PURPOSE, PII_TYPE, RISK_STATUS } from '../../src/shared/document-model.js';
import { isVisible, isFalsePositive, countByType, rate, percent, checkTruthDoc } from './metrics.js';

const ROOT = new URL('../../', import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, ROOT), 'utf8'));
const set = readJson('tests/eval/set.json');
/** @type {Record<string, import('./metrics.js').TruthDoc>} */
const truth = {};
for (const pair of set.pairs) for (const name of pair.documents) truth[name] ??= readJson(`tests/eval/truth/${name}.json`);

const fileOf = (doc) => new File([readFileSync(new URL(doc.file, ROOT))], `${doc.document}.pdf`, { type: 'application/pdf' });
const PURPOSES = Object.values(MASKING_PURPOSE);
/** 가장 많이 가리는 목적 (이름·주소·번호를 모두 가림). 미탐지는 이 목적의 가린 글로 본다 */
const STRICT = MASKING_PURPOSE.CONTRACT_EXPLANATION;
const TYPE_ORDER = Object.values(PII_TYPE);

describe.runIf(import.meta.env.MODE === 'eval')('평가 세트 지표 (#251)', () => {
  it('정답표 형식이 맞다', () => {
    for (const doc of Object.values(truth)) expect(checkTruthDoc(doc, TYPE_ORDER), doc.document).toEqual([]);
  });

  it('지표를 계산해 docs/EVALUATION.md에 쓴다', async () => {
    const counted = new Set();
    /** @type {{ doc: string, item: any, missed: boolean }[]} */
    const detection = [];
    /** @type {{ doc: string, total: number, fp: number, fpValues: string[] }[]} */
    const overMask = [];
    /** @type {Record<string, { visible: number, total: number, stopped: number, pairs: number }>} */
    const residual = Object.fromEntries(PURPOSES.map((p) => [p, { visible: 0, total: 0, stopped: 0, pairs: 0 }]));
    /** @type {{ pair: string, label: string, counts: Record<string, number>, total: number }[]} */
    const risks = [];
    /** @type {string[]} */
    const residualDetails = [];

    for (const pair of set.pairs) {
      const docs = pair.documents.map((n) => truth[n]);
      const analyzed = await analyzeDocuments({ files: docs.map(fileOf) });
      expect(analyzed.ok, `${pair.id}: ${analyzed.step}`).toBe(true);
      const a = analyzed.data;
      const idOf = Object.fromEntries(docs.map((d, i) => [d.document, a.documents[i].documentId]));

      // 1) 미탐지: 가장 많이 가리는 목적으로, 보내기 전 검사(validateMaskedText) 전의 가린 글에 남는지
      const edits = normalizeEdits(emptyEdits());
      const plan = createMaskingPlan(a.findings, a.personGroups, STRICT, edits);
      const masked = applyMaskingPlan(a.documents, plan.data, a.findings, a.personGroups, edits);
      for (const d of docs) {
        if (counted.has(d.document)) continue;
        const text = masked.data.maskedText[idOf[d.document]] ?? '';
        for (const item of d.pii) detection.push({ doc: d.document, item, missed: isVisible(item, text) });
        // 2) 과잉 마스킹: 이 서류의 탐지 결과 중 어느 정답과도 겹치지 않는 것
        const findings = a.findings.filter((f) => f.documentId === idOf[d.document]);
        const fps = findings.filter((f) => isFalsePositive(f, d.pii));
        overMask.push({ doc: d.document, total: findings.length, fp: fps.length, fpValues: fps.map((f) => `${f.type}:${f.value}`) });
        counted.add(d.document);
      }

      // 3) AI 전송 직전 남은 개인정보: 목적마다 prepareForAi()(보내기 전 검사 포함)가 만든 프롬프트·가린 글
      const items = docs.flatMap((d) => d.pii.map((item) => ({ doc: d.document, item })));
      for (const purpose of PURPOSES) {
        const r = prepareForAi(a, purpose);
        const res = residual[purpose];
        res.pairs += 1;
        res.total += items.length;
        if (!r.ok) {
          res.stopped += 1;
          continue;
        }
        const shared = [r.data.prompt, ...Object.values(r.data.maskedText)].join('\n');
        for (const { doc, item } of items) {
          if (isVisible(item, shared)) {
            res.visible += 1;
            residualDetails.push(`${purpose} · ${doc} · ${item.type}`);
          }
        }
      }

      // 4) "확인 불가" 비율: 이 묶음의 위험 점검 결과
      const counts = Object.fromEntries(Object.values(RISK_STATUS).map((s) => [s, 0]));
      for (const r of a.riskResults) counts[r.status] = (counts[r.status] ?? 0) + 1;
      risks.push({ pair: pair.id, label: pair.label, counts, total: a.riskResults.length });
    }

    const md = report({ detection, overMask, residual, residualDetails, risks });
    writeFileSync(new URL('docs/EVALUATION.md', ROOT), md);
    console.log(md);
    expect(detection.length).toBeGreaterThan(0);
  }, 300_000);
});

/** 결과를 Markdown으로 */
function report({ detection, overMask, residual, residualDetails, risks }) {
  let commit = '';
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: new URL('../../', import.meta.url) }).toString().trim();
  } catch {
    commit = '(알 수 없음)';
  }
  const docs = Object.values(truth);
  const byType = countByType(detection);
  const types = TYPE_ORDER.filter((t) => byType[t]);
  const totalItems = detection.length;
  const totalMissed = detection.filter((r) => r.missed).length;
  const fpTotal = overMask.reduce((s, r) => s + r.fp, 0);
  const findingTotal = overMask.reduce((s, r) => s + r.total, 0);
  const lines = [];
  const p = (s = '') => lines.push(s);

  p('# 평가 결과 (Evaluation)');
  p();
  p('> 이 파일은 `npm run eval`이 만든다. 직접 고치지 말고 다시 실행한다. (#251, 지도 교수님 피드백 ②)');
  p(`> 커밋 \`${commit}\` · 서류 ${docs.length}건 · 정답 개인정보 ${totalItems}개 · 모든 서류와 값은 가짜다.`);
  p();
  p('## 평가 세트');
  p();
  p('| 서류 | 종류 | 양식 | 정답 개인정보 |');
  p('|---|---|---|---|');
  for (const d of docs) p(`| ${d.document} | ${d.documentType === 'REGISTRY' ? '등기부' : '계약서'} | ${d.form} | ${d.pii.length} |`);
  p();
  p('정답 개인정보의 종류별 수: ' + types.map((t) => `${t} ${byType[t].total}`).join(', '));
  p();
  p('## 1. 개인정보 유형별 미탐지율');
  p();
  p(`가장 많이 가리는 목적(${STRICT})으로 가린 글(보내기 전 검사 전)에 정답 값이 그대로 남으면 "미탐지"로 센다.`);
  p();
  p('| 종류 | 정답 | 미탐지 | 미탐지율 |');
  p('|---|---|---|---|');
  for (const t of types) p(`| ${t} | ${byType[t].total} | ${byType[t].missed} | ${percent(rate(byType[t].missed, byType[t].total))} |`);
  p(`| **전체** | **${totalItems}** | **${totalMissed}** | **${percent(rate(totalMissed, totalItems))}** |`);
  const missed = detection.filter((r) => r.missed);
  if (missed.length) {
    p();
    p('미탐지 항목 (가짜 값):');
    for (const r of missed) p(`- ${r.doc} · ${r.item.type} · \`${r.item.value}\``);
  }
  p();
  p('## 2. 과잉 마스킹 비율');
  p();
  p('탐지 결과 중 어느 정답 개인정보와도 겹치지 않는 것(개인정보가 아닌데 가린 것)의 비율이다.');
  p();
  p('| 서류 | 탐지 | 과잉 | 비율 |');
  p('|---|---|---|---|');
  for (const r of overMask) p(`| ${r.doc} | ${r.total} | ${r.fp} | ${percent(rate(r.fp, r.total))} |`);
  p(`| **전체** | **${findingTotal}** | **${fpTotal}** | **${percent(rate(fpTotal, findingTotal))}** |`);
  const fpList = overMask.flatMap((r) => r.fpValues.map((v) => `${r.doc} · ${v}`));
  if (fpList.length) {
    p();
    p('과잉 마스킹 항목 (가짜 값):');
    for (const v of fpList) p(`- \`${v}\``);
  }
  p();
  p('## 3. AI 전송 직전까지 남은 개인정보 (목표 0)');
  p();
  p('목적마다 prepareForAi()가 만든 프롬프트와 가린 글(보내기 전 검사까지 통과한 것)에 정답 값이 남은 수다. 보내기 전 검사가 멈추면 보낼 글이 없으므로 "멈춤"으로 따로 센다.');
  p();
  p('| 목적 | 서류 묶음 | 남은 개인정보 | 멈춤 |');
  p('|---|---|---|---|');
  for (const [purpose, r] of Object.entries(residual)) p(`| ${purpose} | ${r.pairs} | ${r.visible} / ${r.total} | ${r.stopped} |`);
  if (residualDetails.length) {
    p();
    for (const d of residualDetails) p(`- ${d}`);
  }
  p();
  p('## 4. 양식별 "확인 불가" 비율');
  p();
  p('서류 묶음마다 위험 점검 결과 중 UNVERIFIABLE의 비율이다.');
  p();
  p('| 묶음 | STOP | CHECK | UNVERIFIABLE | NO_FLAG | 확인 불가 비율 |');
  p('|---|---|---|---|---|---|');
  for (const r of risks) {
    const c = r.counts;
    p(`| ${r.label} | ${c.STOP} | ${c.CHECK} | ${c.UNVERIFIABLE} | ${c.NO_FLAG} | ${percent(rate(c.UNVERIFIABLE, r.total))} |`);
  }
  p();
  p('## 한계');
  p();
  p('- 글자가 들어 있는 PDF만 평가한다. 사진·스캔(OCR)은 포함하지 않는다.');
  p('- 미탐지는 "가린 글에 값이 남았는지"로 본다. PDF 위 가림 상자의 위치·넓이는 따로 평가하지 않는다.');
  p(`- 서류는 실제 서식(인터넷등기소 열람본, 민간임대 표준임대차계약서)과 쪽 구성·글꼴이 같은 가짜 서류 ${docs.length}건이라, 실제 서류의 다양한 모양을 모두 대표하지는 않는다.`);
  p('- 주택임대차 표준계약서(법무부) 양식과 소유자가 여러 명인 공유 등기부(지금 공유)는 평가 세트에 없다.');
  p('- 사업자등록번호는 개인정보 종류에 없어 정답표에 넣지 않았다 (법인 번호는 공개 정보). 개인 임대사업자의 사업자번호는 따로 다룰 일이다.');
  p();
  return lines.join('\n');
}
