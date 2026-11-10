// @ts-check
/**
 * PART 5. 전체 처리 흐름 (파이프라인)
 *
 * 각 파트의 공개 함수만 순서대로 호출한다. 파트 내부 파일을 직접 import하지 않는다.
 * 어느 단계든 { ok: false }가 나오면 거기서 멈추고 어느 단계에서 실패했는지 알려준다.
 * (PDF 생성은 실패해도 나머지 결과는 보여준다)
 */

import { ok, fail, ERROR_CODE } from '../shared/document-model.js';
import { readDocument } from '../features/document-input/index.js';
import { classifyDocument, detectPII, extractFields } from '../features/document-analysis/index.js';
import { assessRisks, buildPrompt } from '../features/risk-check/index.js';
import {
  matchPeople,
  createMaskingPlan,
  applyMaskingPlan,
  validateMaskedText,
} from '../features/masking/index.js';
import { exportMaskedPDF } from '../features/pdf-export/index.js';

/**
 * 실패 결과에 단계 이름을 붙여 돌려준다.
 * @param {string} step
 * @param {{ ok: false, error: { code: string, message: string } }} result
 */
function stoppedAt(step, result) {
  return { ok: false, step, error: result.error };
}

/**
 * @param {{ files: File[], purpose: string }} input
 */
export async function runPipeline({ files, purpose }) {
  if (!Array.isArray(files) || files.length === 0) {
    return { ...fail(ERROR_CODE.INVALID_INPUT, 'Please choose at least one file.'), step: 'input' };
  }

  // 1) 문서 읽기 (PART 1)
  const documents = [];
  for (const file of files) {
    const r = await readDocument(file);
    if (!r.ok) return stoppedAt('readDocument', r);
    documents.push(r.data);
  }

  // 2) 문서 판별 + 개인정보 탐지 (PART 2)
  const findings = [];
  for (const doc of documents) {
    const c = classifyDocument(doc);
    if (!c.ok) return stoppedAt('classifyDocument', c);
    doc.documentType = c.data.documentType;

    const d = detectPII(doc);
    if (!d.ok) return stoppedAt('detectPII', d);
    findings.push(...d.data);
  }

  const fields = extractFields(documents, findings);
  if (!fields.ok) return stoppedAt('extractFields', fields);

  // 3) 인물 판별 (PART 4)
  const people = matchPeople(fields.data);
  if (!people.ok) return stoppedAt('matchPeople', people);

  // 4) 위험 점검 (PART 3)
  const risks = assessRisks(fields.data, people.data);
  if (!risks.ok) return stoppedAt('assessRisks', risks);

  // 5) 목적별 마스킹 (PART 4)
  const plan = createMaskingPlan(findings, people.data, purpose);
  if (!plan.ok) return stoppedAt('createMaskingPlan', plan);

  const masked = applyMaskingPlan(documents, plan.data, findings, people.data);
  if (!masked.ok) return stoppedAt('applyMaskingPlan', masked);

  const check = validateMaskedText(masked.data.maskedText, findings, plan.data);
  if (!check.ok) return stoppedAt('validateMaskedText', check);

  // 6) AI 상담 프롬프트 (PART 3) - 마스킹 완료 텍스트와 범례만 사용
  const prompt = buildPrompt({
    purpose,
    riskResults: risks.data,
    maskedText: masked.data.maskedText,
    legend: masked.data.legend,
  });
  if (!prompt.ok) return stoppedAt('buildPrompt', prompt);

  // 7) 마스킹 PDF (PART 5) - 실패해도 나머지 결과는 유지
  //    documents[i]는 files[i]를 읽은 결과라 같은 순서로 원본 파일을 넘긴다
  const pdfs = [];
  for (const [i, doc] of documents.entries()) {
    const docPlan = { ...plan.data, items: plan.data.items.filter((item) => item.documentId === doc.documentId) };
    pdfs.push({
      documentId: doc.documentId,
      documentType: doc.documentType,
      result: await exportMaskedPDF(doc, docPlan, { file: files[i] }),
    });
  }

  return ok({
    documents,
    findings,
    fields: fields.data,
    personGroups: people.data,
    riskResults: risks.data,
    maskingPlan: plan.data,
    maskedText: masked.data.maskedText,
    legend: masked.data.legend,
    prompt: prompt.data,
    pdfs,
  });
}
