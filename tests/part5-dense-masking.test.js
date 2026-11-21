// PART 5. 빽빽한 가짜 서류에서 마스킹 상자가 가리지 않는 옆 줄·옆 칸 글자를 덮지 않는지 (#139, #256)
// tests/fixtures/dense-*.pdf는 공개 양식(등기사항전부증명서 견본, 주택임대차표준계약서) 구조를 따라 만든 가짜 서류다.
// 실제 서류에서 가져온 값은 없다. 다시 만들기: node scripts/make-sample-pdfs.mjs "<Chrome 경로>" --dense
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { readDocuments, analyzeReadDocuments } from '../src/app/pipeline.js';
import { createMaskingPlan } from '../src/features/masking/index.js';
import { planRedactions, textBoxesOf, PAD_MIN } from '../src/features/pdf-export/apply-redactions.js';
import { MASKING_PURPOSE } from '../src/shared/document-model.js';

const fixture = (name) =>
  new File([readFileSync(new URL(`./fixtures/${name}`, import.meta.url))], name, { type: 'application/pdf' });

/** PDF를 그리는 배율 (render-pages.js와 비슷하게) */
const SCALE = 2;

/** @type {any} */
let analysis;

beforeAll(async () => {
  const read = await readDocuments({ files: [fixture('dense-registry.pdf'), fixture('dense-lease.pdf')] });
  expect(read.ok).toBe(true);
  const r = analyzeReadDocuments(/** @type {any} */ (read).data);
  expect(r.ok).toBe(true);
  analysis = /** @type {any} */ (r).data;
});

/**
 * 상자를 개인정보 글자 조각(spans)만 감싸게 좁힌 계획 (#256)
 * PART 2가 탐지 결과 bbox를 spans로 좁히는 것과 같은 모양을 여기서 만든다.
 * 값의 글자 위치(block.text 안)와 겹치는 span들을 합친다. 값을 블록에서 못 찾으면 그대로 둔다.
 * @param {any} plan
 */
function narrowedPlan(plan) {
  const items = plan.items.map((i) => {
    const f = analysis.findings.find((x) => x.id === i.findingId);
    const d = analysis.documents.find((x) => x.documentId === i.documentId);
    const b = d?.pages.find((pg) => pg.pageIndex === i.pageIndex)?.blocks.find((x) => x.blockId === f?.blockId);
    const start = f && b?.spans ? b.text.indexOf(f.value) : -1;
    if (start < 0) return i;
    const end = start + f.value.length;
    const hit = b.spans.filter((sp) => sp.start < end && sp.end > start).map((sp) => sp.bbox);
    if (hit.length === 0) return i;
    const x = Math.min(...hit.map((h) => h.x));
    const y = Math.min(...hit.map((h) => h.y));
    const x1 = Math.max(...hit.map((h) => h.x + h.width));
    const y1 = Math.max(...hit.map((h) => h.y + h.height));
    return { ...i, bbox: { x, y, width: x1 - x, height: y1 - y } };
  });
  return { ...plan, items };
}

/**
 * 페이지의 글자 조각 (글자 PDF는 spans, 없으면 블록 전체)
 * @param {any} page
 */
const piecesOf = (page) =>
  page.blocks.flatMap((b) =>
    b.spans?.length
      ? b.spans.map((sp) => ({ text: b.text.slice(sp.start, sp.end), bbox: sp.bbox }))
      : [{ text: b.text, bbox: b.bbox }],
  );

/** 픽셀 상자 겹침 넓이 */
const overlap = (a, b) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/**
 * 모든 페이지에서 상자가 덮은, 가리지 않는 글자 조각 목록 (같은 줄의 옆 칸도 따로 센다, #256)
 * @param {any} plan
 * @param {boolean} withNeighbors  옆 글자를 보고 여유를 줄일지 (false면 이전처럼 줄 높이만 봄)
 * @param {boolean} [allowMinPad]  가장 작은 여유(페이지의 0.2%) 안에서 닿는 것은 덮은 것으로 세지 않는다
 */
function coveredFreeLines(plan, withNeighbors, allowMinPad = false) {
  const hits = [];
  for (const d of analysis.documents) {
    for (const p of d.pages) {
      const W = p.width * SCALE;
      const H = p.height * SCALE;
      const toPx = (b) => ({ x: b.x * W, y: b.y * H, width: b.width * W, height: b.height * H });
      const masked = plan.items
        .filter((i) => i.documentId === d.documentId && i.pageIndex === p.pageIndex && i.action !== 'KEEP')
        .map((i) => toPx(i.bbox));
      const free = piecesOf(p)
        .map((b) => ({ text: b.text, r: toPx(b.bbox) }))
        .filter(({ r }) => !masked.some((m) => overlap(m, r) > 0.5 * r.width * r.height));
      const draws = planRedactions(plan, {
        documentId: d.documentId,
        pageIndex: p.pageIndex,
        width: W,
        height: H,
        textBoxes: withNeighbors ? textBoxesOf(p) : [],
      });
      // 옆 글자 안으로 들어간 깊이 (위·아래 줄이면 세로, 옆 칸이면 가로). 반올림 1px은 허용
      const minX = allowMinPad ? PAD_MIN * W + 1 : 0;
      const minY = allowMinPad ? PAD_MIN * H + 1 : 0;
      for (const di of draws) {
        for (const f of free) {
          const dx = Math.min(di.rect.x + di.rect.width, f.r.x + f.r.width) - Math.max(di.rect.x, f.r.x);
          const dy = Math.min(di.rect.y + di.rect.height, f.r.y + f.r.height) - Math.max(di.rect.y, f.r.y);
          if (dx > minX && dy > minY) hits.push(f.text);
        }
      }
    }
  }
  return hits;
}

describe('PART 5 빽빽한 가짜 서류: 마스킹 상자가 옆 글자를 덮지 않는다 (#139)', () => {
  it('서류를 읽고 개인정보를 찾는다 (등기부·계약서 각 1쪽)', () => {
    expect(analysis.documents.map((d) => d.documentType).sort()).toEqual(['LEASE_CONTRACT', 'REGISTRY']);
    expect(analysis.findings.some((f) => f.type === 'RESIDENT_ID')).toBe(true);
    expect(analysis.findings.some((f) => f.type === 'FOREIGNER_ID')).toBe(true);
  });

  it('옆 글자를 보지 않으면 실제로 덮는 곳이 생긴다 (이 서류가 충분히 빽빽하다는 확인)', () => {
    const plan = createMaskingPlan(analysis.findings, analysis.personGroups, MASKING_PURPOSE.FRAUD_CHECK).data;
    expect(coveredFreeLines(plan, false).length).toBeGreaterThan(0);
  });

  for (const purpose of Object.values(MASKING_PURPOSE)) {
    it(`${purpose}: 가리지 않는 줄·칸은 가장 작은 여유(페이지의 0.2%)보다 깊게 덮지 않는다`, () => {
      const plan = createMaskingPlan(analysis.findings, analysis.personGroups, purpose).data;
      expect(plan.items.length).toBeGreaterThan(0);
      expect(coveredFreeLines(plan, true, true)).toEqual([]);
    });

    it(`${purpose}: 상자를 개인정보 글자 조각으로 좁혀도 같은 줄 옆 칸을 가장 작은 여유보다 깊게 덮지 않는다 (#256)`, () => {
      const plan = narrowedPlan(createMaskingPlan(analysis.findings, analysis.personGroups, purpose).data);
      expect(coveredFreeLines(plan, true, true)).toEqual([]);
    });
  }

  it('좁힌 상자가 실제로 줄보다 작다 (이 검사가 의미가 있다는 확인)', () => {
    const plan = createMaskingPlan(analysis.findings, analysis.personGroups, MASKING_PURPOSE.CONTRACT_EXPLANATION).data;
    const narrowed = narrowedPlan(plan);
    const shrunk = narrowed.items.filter((it, k) => it.bbox.width < plan.items[k].bbox.width - 1e-6);
    expect(shrunk.length).toBeGreaterThan(10);
  });
});
