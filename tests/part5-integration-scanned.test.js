// PART 5. 통합 테스트: 사진·스캔 서류 흐름 (#97)
// 읽기 → "글자 확인" 단계(#54) → 개인정보 탐지·위험 점검 → 목적별 마스킹·프롬프트
//
// 테스트 환경(Node)에서는 실제 OCR을 돌릴 수 없으므로, 가짜 샘플 PDF(public/samples)를 읽은 결과를
// "OCR로 읽은 것처럼" 바꿔서 쓴다: sourceType을 image_pdf로, 모든 줄에 confidence를 붙이고,
// 몇 줄에는 흔한 OCR 실수(숫자 0 → 영문 O)와 낮은 confidence를 넣는다. 이름·번호·주소는 모두 가짜다.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  readDocuments,
  analyzeReadDocuments,
  prepareForAi,
  needsTextReview,
  countLinesToCheck,
} from '../src/app/pipeline.js';
import { MASKING_PURPOSE, SOURCE_TYPE, RISK_STATUS, isValidBBox } from '../src/shared/document-model.js';
import { getFlaggedBlocks } from '../src/features/document-input/index.js';

const samplePdf = (name) =>
  new File([readFileSync(new URL(`../public/samples/${name}.pdf`, import.meta.url))], `${name}.pdf`, {
    type: 'application/pdf',
  });

/** 샘플 PDF에 들어 있는 가짜 개인정보 (tests/part5-integration.test.js와 같음) */
const FAKE_PERSONAL_INFO = [
  '김철수',
  'NGUYEN VAN A',
  '박영수',
  '700101',
  '800101',
  '750315',
  '990505',
  '010-0000-1357',
  '010-0000-2468',
  '321-654987-10293',
  '0000-2019-013579',
  '필동로',
  '퇴계로',
];

/**
 * OCR 실수: [서류 순서, 원래 글자, 잘못 읽은 글자]
 * 생년월일·계좌·연락처처럼 위험 점검과 마스킹에 꼭 필요한 숫자 줄을 고른다.
 * 줄은 글자로 찾는다 (샘플을 다시 만들면 blockId가 바뀌므로, #153)
 */
const MISREADS = [
  [0, '800101-*******', '8OO1O1-*******'], // 등기부 소유자 주민번호 (뒷자리는 등기부에서 가려져 나옴)
  [1, '750315-1', '75O315-1'], // 계약서 임대인 주민번호
  [1, '321-654987-10293', '321-654987-1O293'], // 계좌번호
  [1, '010-0000-2468', '01O-0000-2468'], // 임차인 연락처 (임대인 연락처는 주민번호와 같은 줄이라 줄 수가 겹침)
];
const MISREAD_TEXT = MISREADS.map((m) => m[2]);
const OCR_CONFIDENCE = 0.93;
const MISREAD_CONFIDENCE = 0.62;

const statusOf = (risks, ruleId) => risks.find((r) => r.ruleId === ruleId)?.status;
const blocksOf = (docs) => docs.flatMap((d) => d.pages.flatMap((p) => p.blocks));
const findingKeys = (findings) => findings.map((f) => `${f.type}:${f.value}`).sort();

/** 글자 PDF로 읽은 결과 */
let read;
/** 글자 PDF 분석 결과 (기준) */
let textAnalysis;

/** 글자 PDF 결과를 "OCR로 읽은 스캔 서류"로 바꾼다 (입력은 바꾸지 않음) */
function asScanned(documents) {
  const docs = structuredClone(documents);
  for (const d of docs) {
    d.sourceType = SOURCE_TYPE.IMAGE_PDF;
    for (const b of blocksOf([d])) b.confidence = OCR_CONFIDENCE;
  }
  for (const [docIndex, from, to] of MISREADS) {
    const block = blocksOf([docs[docIndex]]).find((b) => b.text.includes(from));
    if (!block) throw new Error(`sample changed: no line with ${from}`);
    block.text = block.text.replace(from, to);
    block.confidence = MISREAD_CONFIDENCE;
  }
  return docs;
}

/** 사용자가 확인 화면에서 흐린 줄을 고친 것처럼 만든다 (PART 1 ocr-editor 규칙: 고친 줄은 confidence 1) */
function fixedByUser(scanned) {
  const docs = structuredClone(scanned);
  for (const [docIndex, from, to] of MISREADS) {
    const block = blocksOf([docs[docIndex]]).find((b) => b.text.includes(to));
    block.text = block.text.replace(to, from);
    block.confidence = 1;
  }
  return docs;
}

/** 사용자가 고치지 않고 Confirm만 누른 것처럼 만든다 (글자는 그대로, confidence 1) */
function confirmedWithoutFixing(scanned) {
  const docs = structuredClone(scanned);
  for (const b of blocksOf(docs)) if (b.confidence === MISREAD_CONFIDENCE) b.confidence = 1;
  return docs;
}

const analyze = (documents) => {
  const r = analyzeReadDocuments({ files: read.files, documents });
  if (!r.ok) throw new Error(`analyzeReadDocuments stopped at ${r.step}: ${r.error.code}`);
  return r.data;
};

beforeAll(async () => {
  const r = await readDocuments({ files: [samplePdf('sample-registry'), samplePdf('sample-lease')] });
  if (!r.ok) throw new Error(`readDocuments stopped at ${r.step}: ${r.error.code}`);
  read = r.data;
  textAnalysis = analyze(read.documents);
});

describe('PART 5 통합(스캔): ① 읽기 → 글자 확인 단계', () => {
  it('스캔 서류는 글자 확인 단계를 거친다 (글자 PDF는 건너뜀)', () => {
    const scanned = asScanned(read.documents);
    expect(scanned.every(needsTextReview)).toBe(true);
    expect(read.documents.some(needsTextReview)).toBe(false);
  });

  it('잘못 읽힌 숫자 줄이 모두 확인 대상으로 세어진다 → 다음 단계 버튼이 잠긴다', () => {
    const scanned = asScanned(read.documents);
    const flaggedText = getFlaggedBlocks(scanned).map((b) => b.text);
    for (const t of MISREAD_TEXT) expect(flaggedText.some((x) => x.includes(t))).toBe(true);
    // 편집 화면(getFlaggedBlocks)과 계속 버튼이 같은 수를 본다. 또렷해도 당사자·주소 핵심 줄은 더해진다 (#311)
    expect(countLinesToCheck(scanned)).toBe(flaggedText.length);
    expect(countLinesToCheck(scanned)).toBeGreaterThan(MISREADS.length);
  });

  it('잘못 읽힌 줄만 고치면 핵심 줄이 남아 잠긴 채이고, 모두 확인하면 0이 된다', () => {
    const fixed = fixedByUser(asScanned(read.documents));
    expect(countLinesToCheck(fixed)).toBeGreaterThan(0);
    for (const b of getFlaggedBlocks(fixed)) b.confidence = 1; // 남은 핵심 줄도 Confirm
    expect(countLinesToCheck(fixed)).toBe(0);
  });

  it('고쳐도 줄 번호(blockId)와 위치(bbox)는 그대로다 → 마스킹 PDF가 같은 곳을 가린다', () => {
    const before = blocksOf(read.documents);
    const after = blocksOf(fixedByUser(asScanned(read.documents)));
    expect(after.map((b) => [b.blockId, b.bbox])).toEqual(before.map((b) => [b.blockId, b.bbox]));
  });
});

describe('PART 5 통합(스캔): 고치기 전 결과는 안전하다고 확정하지 않는다', () => {
  /** @type {any} */
  let unfixed;
  beforeAll(() => {
    unfixed = analyze(asScanned(read.documents));
  });

  it('생년월일을 못 읽으면 소유자·임대인 비교는 STOP·NO_FLAG가 아니라 확인 불가', () => {
    expect(statusOf(unfixed.riskResults, 'OWNER_MISMATCH')).toBe(RISK_STATUS.UNVERIFIABLE);
    expect(statusOf(unfixed.riskResults, 'ACCOUNT_HOLDER_MISMATCH')).not.toBe(RISK_STATUS.NO_FLAG);
  });

  // 확인 단계에서 고치지 않고 Confirm만 누르면 잘못 읽힌 번호가 프롬프트에 남던 문제 (#97에서 발견)
  // → PART 2 탐지가 숫자 자리의 O·l을 숫자로 보고 찾아서 막는다 (이슈 #100)
  it('고치지 않고 Confirm만 눌러도 잘못 읽힌 번호가 프롬프트에 남지 않는다', () => {
    const r = prepareForAi(analyze(confirmedWithoutFixing(asScanned(read.documents))), MASKING_PURPOSE.FRAUD_CHECK);
    expect(r.ok).toBe(true);
    for (const t of MISREAD_TEXT) expect(r.data.prompt).not.toContain(t);
  });
});

describe('PART 5 통합(스캔): 고친 뒤 ②~⑤는 글자 PDF와 같다', () => {
  /** @type {any} */
  let fixed;
  beforeAll(() => {
    fixed = analyze(fixedByUser(asScanned(read.documents)));
  });

  it('글자 PDF와 같은 개인정보를 찾는다', () => {
    expect(findingKeys(fixed.findings)).toEqual(findingKeys(textAnalysis.findings));
  });

  it('글자 PDF와 같은 위험 결과가 나온다 (시연 시나리오 STOP 포함)', () => {
    expect(fixed.riskResults.map((r) => [r.ruleId, r.status])).toEqual(
      textAnalysis.riskResults.map((r) => [r.ruleId, r.status]),
    );
    expect(statusOf(fixed.riskResults, 'OWNER_MISMATCH')).toBe(RISK_STATUS.STOP);
  });

  for (const purpose of Object.values(MASKING_PURPOSE)) {
    it(`${purpose}: 프롬프트와 가린 글에 가짜 개인정보가 하나도 남지 않는다`, () => {
      const r = prepareForAi(fixed, purpose);
      expect(r.ok, r.ok ? '' : `stopped at ${r.step}: ${r.error.code}`).toBe(true);
      const shared = [r.data.prompt, ...Object.values(r.data.maskedText)].join('\n');
      for (const secret of [...FAKE_PERSONAL_INFO, ...MISREAD_TEXT])
        expect(shared, `"${secret}" is still visible`).not.toContain(secret);
    });

    it(`${purpose}: PDF용 마스킹 계획의 위치가 모두 올바른 서류·페이지 안에 있다`, () => {
      const plan = prepareForAi(fixed, purpose).data.maskingPlan;
      const pagesByDoc = new Map(fixed.documents.map((d) => [d.documentId, d.pages.length]));
      for (const item of plan.items.filter((i) => i.action !== 'KEEP')) {
        expect(pagesByDoc.has(item.documentId)).toBe(true);
        expect(item.pageIndex).toBeLessThan(pagesByDoc.get(item.documentId));
        expect(isValidBBox(item.bbox)).toBe(true);
      }
    });
  }
});
