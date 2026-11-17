// PART 5. 빽빽한 가짜 서류에서 마스킹 상자가 가리지 않는 옆 줄·옆 칸 글자를 덮지 않는지 (#139)
// tests/fixtures/dense-*.pdf는 공개 양식(등기사항전부증명서 견본, 주택임대차표준계약서) 구조를 따라 만든 가짜 서류다.
// 실제 서류에서 가져온 값은 없다. 다시 만들기: node scripts/make-sample-pdfs.mjs "<Chrome 경로>" --dense
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { readDocuments, analyzeReadDocuments } from '../src/app/pipeline.js';
import { createMaskingPlan } from '../src/features/masking/index.js';
import { planRedactions } from '../src/features/pdf-export/apply-redactions.js';
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

/** 픽셀 상자 겹침 넓이 */
const overlap = (a, b) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/**
 * 모든 페이지에서 상자가 덮은, 가리지 않는 줄 목록
 * @param {any} plan
 * @param {boolean} withNeighbors  옆 글자를 보고 여유를 줄일지 (false면 이전처럼 줄 높이만 봄)
 */
function coveredFreeLines(plan, withNeighbors) {
  const hits = [];
  for (const d of analysis.documents) {
    for (const p of d.pages) {
      const W = p.width * SCALE;
      const H = p.height * SCALE;
      const toPx = (b) => ({ x: b.x * W, y: b.y * H, width: b.width * W, height: b.height * H });
      const masked = plan.items
        .filter((i) => i.documentId === d.documentId && i.pageIndex === p.pageIndex && i.action !== 'KEEP')
        .map((i) => toPx(i.bbox));
      const free = p.blocks
        .map((b) => ({ text: b.text, r: toPx(b.bbox) }))
        .filter(({ r }) => !masked.some((m) => overlap(m, r) > 0.5 * r.width * r.height));
      const draws = planRedactions(plan, {
        documentId: d.documentId,
        pageIndex: p.pageIndex,
        width: W,
        height: H,
        textBoxes: withNeighbors ? p.blocks.map((b) => b.bbox) : [],
      });
      for (const di of draws) for (const f of free) if (overlap(di.rect, f.r) > 0) hits.push(f.text);
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
    it(`${purpose}: 가리지 않는 줄·칸을 하나도 덮지 않는다`, () => {
      const plan = createMaskingPlan(analysis.findings, analysis.personGroups, purpose).data;
      expect(plan.items.length).toBeGreaterThan(0);
      expect(coveredFreeLines(plan, true)).toEqual([]);
    });
  }
});
