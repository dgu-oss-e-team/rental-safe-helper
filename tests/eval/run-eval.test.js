// PART 5. 평가 세트로 지표를 계산해 docs/EVALUATION.md에 쓴다 (#251, 지도 교수님 피드백 ②)
//
// 실행: npm run eval   (= vitest run tests/eval/run-eval.test.js --mode eval)
// 보통 테스트(npm test)에서는 건너뛴다. 서류를 모두 읽어 시간이 걸리고, 결과 파일을 고쳐 쓰기 때문이다.
// 서류·정답표는 모두 가짜 데이터다 (tests/eval/truth/*.json, tests/eval/set.json).
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { analyzeDocuments, analyzeReadDocuments, prepareForAi, countLinesToCheck } from '../../src/app/pipeline.js';
import { createMaskingPlan, applyMaskingPlan } from '../../src/features/masking/index.js';
import { emptyEdits, normalizeEdits } from '../../src/app/masking-edits.js';
import { MASKING_PURPOSE, PII_TYPE, RISK_STATUS } from '../../src/shared/document-model.js';
import { isVisible, isNearlyVisible, isFalsePositive, countByType, rate, percent, checkTruthDoc } from './metrics.js';

const ROOT = new URL('../../', import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, ROOT), 'utf8'));
const set = readJson('tests/eval/set.json');
/** @type {Record<string, import('./metrics.js').TruthDoc>} */
const truth = {};
for (const pair of set.pairs) for (const name of pair.documents) truth[name] ??= readJson(`tests/eval/truth/${name}.json`);
/** 사진 평가 세트: 사진을 앱과 같은 코드로 OCR한 결과 (scripts/ocr-capture). 정답표는 글자 PDF와 같다 */
const photoSet = readJson('tests/eval/photo-set.json');
const photoOcr = Object.fromEntries(photoSet.documents.map((d) => [d.document, readJson(d.ocr)]));

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
    const pdf = await evaluate(set.pairs, async (docs) => analyzeDocuments({ files: docs.map(fileOf) }));
    // 사진: 확인 단계에서 표시된 줄을 고치지 않고 Confirm만 눌렀다고 본다 (OCR 글자 그대로 = 가장 나쁜 경우)
    const photo = await evaluate(
      photoSet.pairs,
      async (docs) => analyzeReadDocuments({ files: [], documents: docs.map((d) => structuredClone(photoOcr[d.document])) }),
      { near: true },
    );
    const md = report(pdf, photo);
    writeFileSync(new URL('docs/EVALUATION.md', ROOT), md);
    console.log(md);
    expect(pdf.detection.length).toBeGreaterThan(0);
    expect(photo.detection.length).toBeGreaterThan(0);
  }, 300_000);
});

/**
 * 서류 묶음마다 분석해 지표를 모은다
 * @param {{ id: string, label: string, documents: string[] }[]} pairs
 * @param {(docs: import('./metrics.js').TruthDoc[]) => Promise<any>} analyzePair
 * @param {{ near?: boolean }} [options]  near: OCR 오독으로 "비슷하게 남은" 것도 센다 (사진)
 */
async function evaluate(pairs, analyzePair, { near = false } = {}) {
  const counted = new Set();
  /** @type {{ doc: string, item: any, missed: boolean, nearMissed: boolean, readExactly: boolean }[]} */
  const detection = [];
  /** @type {{ doc: string, total: number, fp: number, fpValues: string[] }[]} */
  const overMask = [];
  /** @type {Record<string, { visible: number, nearVisible: number, total: number, stopped: number, pairs: number }>} */
  const residual = Object.fromEntries(PURPOSES.map((p) => [p, { visible: 0, nearVisible: 0, total: 0, stopped: 0, pairs: 0 }]));
  /** @type {{ pair: string, label: string, counts: Record<string, number>, total: number }[]} */
  const risks = [];
  /** @type {string[]} */
  const residualDetails = [];
  /** @type {{ doc: string, lines: number, toCheck: number }[]} */
  const review = [];

  for (const pair of pairs) {
    const docs = pair.documents.map((n) => truth[n]);
    const analyzed = await analyzePair(docs);
    expect(analyzed.ok, `${pair.id}: ${analyzed.step}`).toBe(true);
    const a = analyzed.data;
    const idOf = Object.fromEntries(docs.map((d, i) => [d.document, a.documents[i].documentId]));

    // 1) 미탐지: 가장 많이 가리는 목적으로, 보내기 전 검사(validateMaskedText) 전의 가린 글에 남는지
    const edits = normalizeEdits(emptyEdits());
    const plan = createMaskingPlan(a.findings, a.personGroups, STRICT, edits);
    const masked = applyMaskingPlan(a.documents, plan.data, a.findings, a.personGroups, edits);
    for (const [i, d] of docs.entries()) {
      if (counted.has(d.document)) continue;
      const text = masked.data.maskedText[idOf[d.document]] ?? '';
      const raw = a.documents[i].pages.flatMap((pg) => pg.blocks.map((b) => b.text)).join('\n');
      for (const item of d.pii) {
        const missed = isVisible(item, text);
        detection.push({ doc: d.document, item, missed, nearMissed: near && !missed && isNearlyVisible(item, text), readExactly: isVisible(item, raw) });
      }
      // 2) 과잉 마스킹: 이 서류의 탐지 결과 중 어느 정답과도 겹치지 않는 것
      const findings = a.findings.filter((f) => f.documentId === idOf[d.document]);
      const fps = findings.filter((f) => isFalsePositive(f, d.pii));
      overMask.push({ doc: d.document, total: findings.length, fp: fps.length, fpValues: fps.map((f) => `${f.type}:${f.value}`) });
      const lines = a.documents[i].pages.reduce((n, pg) => n + pg.blocks.length, 0);
      review.push({ doc: d.document, lines, toCheck: near ? countLinesToCheck([photoOcr[d.document]]) : 0 });
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
        } else if (near && isNearlyVisible(item, shared)) {
          res.nearVisible += 1;
          residualDetails.push(`${purpose} · ${doc} · ${item.type} (비슷하게 남음)`);
        }
      }
    }

    // 4) "확인 불가" 비율: 이 묶음의 위험 점검 결과
    const counts = Object.fromEntries(Object.values(RISK_STATUS).map((s) => [s, 0]));
    for (const r of a.riskResults) counts[r.status] = (counts[r.status] ?? 0) + 1;
    risks.push({ pair: pair.id, label: pair.label, counts, total: a.riskResults.length });
  }
  return { detection, overMask, residual, residualDetails, risks, review };
}

/** 결과를 Markdown으로 */
function report({ detection, overMask, residual, residualDetails, risks }, photo) {
  let commit = '';
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: new URL('../../', import.meta.url) }).toString().trim();
  } catch {
    commit = '(알 수 없음)';
  }
  const docs = Object.values(truth).filter((d) => set.pairs.some((pr) => pr.documents.includes(d.document)));
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
  photoReport(p, photo);
  p('## 한계');
  p();
  p('- 1~4는 글자가 들어 있는 PDF 평가다. 사진은 5에서 가짜세트 1·4만 따로 평가한다 (스캔 PDF는 사진과 같은 OCR 경로라 따로 재지 않았다).');
  p('- 사진 평가는 인쇄한 가짜 서류를 휴대폰 한 대로 실내에서 찍은 사진 19장이다. 조명·각도·기기가 달라지면 결과가 달라질 수 있다.');
  p('- 미탐지는 "가린 글에 값이 남았는지"로 본다. PDF 위 가림 상자의 위치·넓이는 따로 평가하지 않는다.');
  p(`- 서류는 실제 서식(인터넷등기소 열람본, 민간임대 표준임대차계약서)과 쪽 구성·글꼴이 같은 가짜 서류 ${docs.length}건이라, 실제 서류의 다양한 모양을 모두 대표하지는 않는다.`);
  p('- 주택임대차 표준계약서(법무부) 양식은 평가 세트에 없다. 계약서는 모두 민간임대 표준임대차계약서다.');
  p();
  return lines.join('\n');
}

/**
 * 5. 사진(OCR) 평가 세트
 * @param {(s?: string) => void} p
 * @param {Awaited<ReturnType<typeof evaluate>>} r
 */
function photoReport(p, r) {
  const byType = countByType(r.detection);
  const types = TYPE_ORDER.filter((t) => byType[t]);
  const near = (t) => r.detection.filter((x) => x.item.type === t && x.nearMissed).length;
  const unread = (t) => r.detection.filter((x) => x.item.type === t && !x.readExactly).length;
  const total = r.detection.length;
  const missed = r.detection.filter((x) => x.missed).length;
  const nearTotal = r.detection.filter((x) => x.nearMissed).length;
  const unreadTotal = r.detection.filter((x) => !x.readExactly).length;
  const fp = r.overMask.reduce((s, x) => s + x.fp, 0);
  const found = r.overMask.reduce((s, x) => s + x.total, 0);

  p('## 5. 사진(OCR) 평가 세트');
  p();
  p('가짜세트 1·4를 인쇄해 휴대폰으로 찍은 사진(등기부 3장씩, 계약서 6·7장)을 앱과 같은 코드(`slotToSource` → `readDocuments`)로 읽은 결과다.');
  p('OCR 결과는 `tests/eval/ocr/*.json`에 저장해 두고 다시 쓴다 (`scripts/ocr-capture`로 만듦). 사진 원본은 저장소에 없다.');
  p('PART 1 OCR 코드(`src/features/document-input/`)가 바뀌면 OCR 결과를 다시 만들어야 한다. 지금 결과는 #333(OCR 띄어쓰기 수정) 이후 코드로 만들었다.');
  p('사용자가 "Confirm text" 단계에서 표시된 줄을 **고치지 않고 확인만 눌렀다**고 보고 OCR 글자 그대로 분석했다 (가장 나쁜 경우).');
  p('OCR이 값을 한두 글자 잘못 읽으면 정답과 정확히 맞지 않으므로, 정답의 70% 이상이 이어서 남은 것은 "비슷하게 남음"으로 따로 센다.');
  p();
  p('| 서류 | OCR 줄 | 확인할 줄 | 탐지 | 과잉 |');
  p('|---|---|---|---|---|');
  for (const [i, v] of r.review.entries()) p(`| ${v.doc} | ${v.lines} | ${v.toCheck} | ${r.overMask[i].total} | ${r.overMask[i].fp} |`);
  p();
  p('| 종류 | 정답 | OCR이 정확히 못 읽음 | 미탐지(그대로 남음) | 비슷하게 남음 |');
  p('|---|---|---|---|---|');
  for (const t of types) p(`| ${t} | ${byType[t].total} | ${unread(t)} | ${byType[t].missed} | ${near(t)} |`);
  p(`| **전체** | **${total}** | **${unreadTotal}** | **${missed} (${percent(rate(missed, total))})** | **${nearTotal} (${percent(rate(nearTotal, total))})** |`);
  const listed = r.detection.filter((x) => x.missed || x.nearMissed);
  if (listed.length) {
    p();
    p('남은 항목 (가짜 값):');
    for (const x of listed) p(`- ${x.doc} · ${x.item.type} · \`${x.item.value}\`${x.missed ? '' : ' (비슷하게)'}`);
  }
  p();
  p(`과잉 마스킹: 탐지 ${found}개 중 ${fp}개 (${percent(rate(fp, found))})`);
  const fpList = r.overMask.flatMap((x) => x.fpValues.map((v) => `${x.doc} · ${v}`));
  if (fpList.length) for (const v of fpList) p(`- \`${v}\``);
  p();
  p('AI 전송 직전까지 남은 개인정보 (보내기 전 검사 통과 후):');
  p();
  p('| 목적 | 서류 묶음 | 그대로 남음 | 비슷하게 남음 | 멈춤 |');
  p('|---|---|---|---|---|');
  for (const [purpose, x] of Object.entries(r.residual)) p(`| ${purpose} | ${x.pairs} | ${x.visible} / ${x.total} | ${x.nearVisible} | ${x.stopped} |`);
  if (r.residualDetails.length) {
    p();
    for (const d of r.residualDetails) p(`- ${d}`);
  }
  p();
  p('| 묶음 | STOP | CHECK | UNVERIFIABLE | NO_FLAG | 확인 불가 비율 |');
  p('|---|---|---|---|---|---|');
  for (const x of r.risks) {
    const c = x.counts;
    p(`| ${x.label} | ${c.STOP} | ${c.CHECK} | ${c.UNVERIFIABLE} | ${c.NO_FLAG} | ${percent(rate(c.UNVERIFIABLE, x.total))} |`);
  }
  p();
}
