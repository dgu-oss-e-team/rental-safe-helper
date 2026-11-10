// @ts-check
/**
 * PART 5. 전체 처리 흐름 (파이프라인)
 *
 * 각 파트의 공개 함수만 순서대로 호출한다. 파트 내부 파일을 직접 import하지 않는다.
 * 어느 단계든 { ok: false }가 나오면 거기서 멈추고 어느 단계에서 실패했는지(step) 알려준다.
 *
 * 화면 단계에 맞춰 세 부분으로 나눈다.
 *   1) analyzeDocuments(): 서류 읽기 → 판별 → 개인정보 탐지 → 인물 판별 → 위험 점검   (목적 선택 전)
 *   2) prepareForAi():     목적별 마스킹 → 남은 개인정보 검사 → AI 상담 프롬프트        (목적 선택 후)
 *   3) exportMaskedPdfs(): 마스킹 PDF 생성 (실패해도 나머지 결과는 유지)
 * runPipeline()은 세 부분을 한 번에 실행한다 (테스트·스크립트용).
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
import { emptyEdits, normalizeEdits } from './masking-edits.js';

/**
 * @typedef {Object} Analysis  analyzeDocuments()의 결과
 * @property {File[]} files  documents[i]는 files[i]를 읽은 결과 (PDF 생성 때 원본으로 씀)
 * @property {import('../shared/document-model.js').DocumentModel[]} documents
 * @property {import('../shared/document-model.js').PiiFinding[]} findings
 * @property {any} fields
 * @property {any[]} personGroups
 * @property {import('../shared/document-model.js').RiskResult[]} riskResults
 */

/**
 * @typedef {Object} Prepared  prepareForAi()의 결과
 * @property {string} purpose
 * @property {import('../shared/document-model.js').MaskingPlan} maskingPlan
 * @property {Record<string, string>} maskedText
 * @property {Record<string, string>} legend
 * @property {string} prompt
 */

/**
 * 실패 결과에 단계 이름을 붙여 돌려준다.
 * @param {string} step
 * @param {{ ok: false, error: { code: string, message: string } }} result
 */
function stoppedAt(step, result) {
  return { ok: false, step, error: result.error };
}

/**
 * 1) 서류 분석: 목적을 고르기 전에 할 수 있는 일 전부
 * @param {{ files: File[] }} input
 */
export async function analyzeDocuments({ files }) {
  if (!Array.isArray(files) || files.length === 0) {
    return { ...fail(ERROR_CODE.INVALID_INPUT, 'Please choose at least one file.'), step: 'input' };
  }

  // 서류 읽기 (PART 1)
  const documents = [];
  for (const file of files) {
    const r = await readDocument(file);
    if (!r.ok) return stoppedAt('readDocument', r);
    documents.push(r.data);
  }

  // 문서 판별 + 개인정보 탐지 (PART 2)
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

  // 인물 판별 (PART 4)
  const people = matchPeople(fields.data);
  if (!people.ok) return stoppedAt('matchPeople', people);

  // 위험 점검 (PART 3)
  const risks = assessRisks(fields.data, people.data);
  if (!risks.ok) return stoppedAt('assessRisks', risks);

  /** @type {Analysis} */
  const analysis = {
    files,
    documents,
    findings,
    fields: fields.data,
    personGroups: people.data,
    riskResults: risks.data,
  };
  return ok(analysis);
}

/**
 * 2) AI 상담 준비: 목적에 맞게 가리고, 남은 개인정보를 검사하고, 프롬프트를 만든다.
 * @param {Analysis} analysis
 * @param {string} purpose  MASKING_PURPOSE 값
 * @param {import('./masking-edits.js').MaskingEdits} [edits]  ④에서 사용자가 해제·추가한 내용 (규칙은 PART 4가 적용)
 */
export function prepareForAi(analysis, purpose, edits = emptyEdits()) {
  const { documents, findings, personGroups, riskResults } = analysis;

  // 사용자가 더 가린 글자(add)는 findings에 없으므로, 가리기·검사 단계에도 edits를 함께 넘긴다
  const userEdits = normalizeEdits(edits);

  const plan = createMaskingPlan(findings, personGroups, purpose, userEdits);
  if (!plan.ok) return stoppedAt('createMaskingPlan', plan);

  const masked = applyMaskingPlan(documents, plan.data, findings, personGroups, userEdits);
  if (!masked.ok) return stoppedAt('applyMaskingPlan', masked);

  const check = validateMaskedText(masked.data.maskedText, findings, plan.data, userEdits);
  if (!check.ok) return stoppedAt('validateMaskedText', check);

  // 프롬프트에는 마스킹 완료 텍스트와 범례만 넣는다 (PART 3)
  const prompt = buildPrompt({
    purpose,
    riskResults,
    maskedText: masked.data.maskedText,
    legend: masked.data.legend,
  });
  if (!prompt.ok) return stoppedAt('buildPrompt', prompt);

  /** @type {Prepared} */
  const prepared = {
    purpose,
    maskingPlan: plan.data,
    maskedText: masked.data.maskedText,
    legend: masked.data.legend,
    prompt: prompt.data,
  };
  return ok(prepared);
}

/**
 * 3) 서류마다 마스킹 PDF를 만든다. 한 서류가 실패해도 나머지는 계속 만든다.
 * @param {Analysis} analysis
 * @param {import('../shared/document-model.js').MaskingPlan} maskingPlan
 */
export async function exportMaskedPdfs(analysis, maskingPlan) {
  const pdfs = [];
  for (const [i, doc] of analysis.documents.entries()) {
    const docPlan = { ...maskingPlan, items: maskingPlan.items.filter((item) => item.documentId === doc.documentId) };
    pdfs.push({
      documentId: doc.documentId,
      documentType: doc.documentType,
      result: await exportMaskedPDF(doc, docPlan, { file: analysis.files[i] }),
    });
  }
  return pdfs;
}

/**
 * 세 부분을 한 번에 실행한다.
 * @param {{ files: File[], purpose: string }} input
 */
export async function runPipeline({ files, purpose }) {
  const analyzed = await analyzeDocuments({ files });
  if (!analyzed.ok) return analyzed;

  const prepared = prepareForAi(analyzed.data, purpose);
  if (!prepared.ok) return prepared;

  const { files: _files, ...analysis } = analyzed.data;
  return ok({
    ...analysis,
    ...prepared.data,
    pdfs: await exportMaskedPdfs(analyzed.data, prepared.data.maskingPlan),
  });
}
