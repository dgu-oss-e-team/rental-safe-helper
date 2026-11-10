// @ts-check
/**
 * PART 2. 문서 분석 및 개인정보 탐지
 * 담당: docs/OWNERS.md 참고
 *
 * 공개 함수
 *   classifyDocument(document)          → Result<{ documentId, documentType, score }>
 *   detectPII(document)                 → Result<PiiFinding[]>
 *   extractFields(documents, findings)  → Result<ExtractedFields>   (비교용 추출 데이터, PART 3·4가 사용)
 *
 * 현재 상태: detectPII()는 번호류(pii-patterns.js) + 이름·주소(name-detector.js)를 실제로 찾는다.
 *           classifyDocument()는 키워드 개수 비교(띄어쓰기 무시, 동점이면 UNKNOWN).
 *           extractFields()는 사람 정보·주소를 실제 탐지 결과에서 만들고, 보증금·월세·특약·권리는 아직 Mock.
 * TODO(PART 2 이슈 ⑤): 항목 추출(field-extractor.js)로 extractFields()의 남은 Mock을 교체한다.
 */

import { ok, fail, ERROR_CODE, DOCUMENT_TYPE, PII_TYPE, REVIEW_STATUS } from '../../shared/document-model.js';
import { findPatternPII } from './pii-patterns.js';
import { findPeople, findAddresses, lastRoleIn } from './name-detector.js';
import { mockExtractedFields } from '../../shared/mock-data.js';

/** @typedef {import('../../shared/document-model.js').DocumentModel} DocumentModel */
/** @typedef {import('../../shared/document-model.js').PiiFinding} PiiFinding */
/** @typedef {{ findingId: string, name: string, birthDate: string | null, role: string | null }} Person */

/**
 * 판별 키워드 (TODO(PART 2): src/config/templates/*.yaml로 옮기기)
 * 띄어쓰기를 지우고 비교하므로 '갑 구'와 '갑구'를 따로 넣지 않는다(두 번 세어짐).
 * 키워드·띄어쓰기 처리 참고: PR #18 (Garid1016)
 */
const KEYWORDS = {
  [DOCUMENT_TYPE.REGISTRY]: ['등기사항', '등기부등본', '표제부', '갑구', '을구', '고유번호'],
  [DOCUMENT_TYPE.LEASE_CONTRACT]: ['임대차', '부동산임대차계약서', '임대인', '임차인', '보증금', '특약'],
};

/** @param {string} s */
const removeSpaces = (s) => s.replace(/\s+/g, '');

/**
 * @param {DocumentModel} document
 * @returns {string}
 */
function fullText(document) {
  return document.pages.flatMap((p) => p.blocks.map((b) => b.text)).join('\n');
}

/**
 * 등기부인지 계약서인지 판별한다.
 * 문서 종류별 키워드가 몇 개 들어 있는지 세서 더 많은 쪽으로 정한다.
 * 계약서에 "등기사항전부증명서 확인"이 들어가도 계약서 키워드가 더 많으면 계약서가 된다.
 * OCR이 "갑 구"처럼 띄어 읽어도 잡히도록 띄어쓰기를 지우고 비교한다.
 * 개수가 같으면(0개 포함) 어느 쪽인지 알 수 없으므로 UNKNOWN.
 * @param {DocumentModel} document
 */
export function classifyDocument(document) {
  if (!document?.pages) return fail(ERROR_CODE.INVALID_INPUT, 'Document is missing.');

  const text = removeSpaces(fullText(document));
  const scores = Object.entries(KEYWORDS).map(([type, words]) => ({
    type,
    score: words.filter((w) => text.includes(removeSpaces(w))).length,
  }));
  scores.sort((a, b) => b.score - a.score);
  const [best, second] = scores;
  const isTie = best.score === second.score;
  const documentType = best.score > 0 && !isTie ? best.type : DOCUMENT_TYPE.UNKNOWN;

  return ok({ documentId: document.documentId, documentType, score: best.score });
}

/** OCR 신뢰도가 이 값보다 낮으면 사용자 확인이 필요하다고 표시한다. */
const LOW_CONFIDENCE = 0.8;

/**
 * 문서 하나를 훑어서 개인정보 위치를 모두 찾는다. detectPII()와 extractFields()가 같이 쓴다.
 * - 블록마다 번호류(정규식) → 이름(라벨) → 주소 순서로 찾고, 이미 찾은 구간과 겹치면 버린다.
 * - ID는 문서에 나오는 순서대로 PII_{documentId}_{001, 002 ...}로 붙인다.
 *   같은 문서를 다시 훑으면 항상 같은 ID가 나와서, 두 함수의 결과가 서로 맞는다.
 * - 역할 라벨("임대인")과 "성명" 칸이 다른 블록에 있어도 이어지도록, 앞 블록의 마지막 역할을 다음 블록에 넘긴다.
 * @param {DocumentModel} document
 */
function scanDocument(document) {
  const hits = [];
  let seq = 0;
  /** @type {string | null} 앞 블록에서 이어받은 역할 ("성명" 칸 이름에 붙인다) */
  let role = null;
  for (const page of document.pages) {
    for (const block of page.blocks) {
      const text = block.text ?? '';
      /** @type {any[]} */
      const found = [...findPatternPII(text)];
      for (const r of [...findPeople(text, role), ...findAddresses(text)]) {
        const overlaps = found.some((prev) => r.start < prev.end && prev.start < r.end);
        if (!overlaps) found.push(r);
      }
      role = lastRoleIn(text, role);
      found.sort((a, b) => a.start - b.start);
      for (const hit of found) {
        seq += 1;
        hits.push({ ...hit, page, block, id: `PII_${document.documentId}_${String(seq).padStart(3, '0')}` });
      }
    }
  }
  return hits;
}

/**
 * 문서에서 개인정보를 찾는다.
 * @param {DocumentModel} document
 */
export function detectPII(document) {
  if (!document?.pages) return fail(ERROR_CODE.INVALID_INPUT, 'Document is missing.');

  /** @type {PiiFinding[]} */
  const findings = scanDocument(document).map((hit) => {
    const { block, page } = hit;
    const lowConfidence = block.confidence !== null && block.confidence < LOW_CONFIDENCE;
    return {
      id: hit.id,
      type: hit.type,
      value: hit.value,
      documentId: document.documentId,
      pageIndex: page.pageIndex,
      blockId: block.blockId,
      // TODO(PART 2): PART 1이 단어 단위 좌표(words)를 주면 개인정보 부분만 가리도록 좁힌다.
      // 지금은 블록 전체 좌표를 쓴다. 더 넓게 가리는 쪽이라 개인정보가 새지 않는다.
      bbox: { ...block.bbox },
      confidence: block.confidence,
      reviewStatus:
        hit.uncertain || lowConfidence ? REVIEW_STATUS.NEEDS_REVIEW : REVIEW_STATUS.DETECTED,
    };
  });

  return ok(findings);
}

/**
 * 문서 안의 사람 목록을 만든다. (INTERFACES.md 5번 형식: findingId, name, birthDate, role)
 * 같은 문서에서 역할과 이름이 같으면 같은 사람이므로, 한쪽에만 있는 생년월일을 다른 쪽에도 채운다.
 * 예: 위쪽 "임대인 김철수 750315-1******"과 서명란 "임대인 김철수" → 둘 다 750315
 * @param {any[]} hits scanDocument() 결과
 * @param {Set<string>} rejectedIds 사용자가 "개인정보 아님"으로 해제한 결과의 id
 */
function collectPeople(hits, rejectedIds) {
  const people = hits
    .filter((h) => h.type === PII_TYPE.PERSON_NAME && !rejectedIds.has(h.id))
    .map((h) => ({ findingId: h.id, name: h.value, birthDate: h.birthDate ?? null, role: h.role }));

  /** @param {{ role: string | null, name: string }} p */
  const key = (p) => `${p.role}|${p.name.replace(/\s/g, '').toUpperCase()}`;
  /** @type {Map<string, Set<string>>} */
  const birthDatesByKey = new Map();
  for (const p of people) {
    if (!p.birthDate) continue;
    const dates = birthDatesByKey.get(key(p)) ?? new Set();
    dates.add(p.birthDate);
    birthDatesByKey.set(key(p), dates);
  }
  // 생년월일이 딱 하나로 정해질 때만 채운다. 서로 다른 값이 있으면 추측하지 않고 null로 둔다.
  return people.map((p) => {
    const dates = birthDatesByKey.get(key(p));
    return p.birthDate || !dates || dates.size !== 1 ? p : { ...p, birthDate: [...dates][0] };
  });
}

/** 집 주소 앞에 붙는 라벨. 임대인·임차인 본인 주소보다 이 라벨이 붙은 주소를 먼저 고른다. */
const PROPERTY_ADDRESS_LABEL = /소\s*재\s*지|도\s*로\s*명\s*주\s*소|지\s*번\s*주\s*소/;

/**
 * 계약·등기 대상 집의 주소를 고른다.
 * 1순위: 같은 블록에서 주소 앞에 "소재지", "도로명주소", "지번주소" 라벨이 있는 주소
 * 2순위: 문서에 처음 나오는 주소 (등기부 표제부처럼 라벨 없이 주소만 있는 경우)
 * 주소가 하나도 없으면 null (못 읽음)
 * @param {any[]} hits scanDocument() 결과
 */
function pickPropertyAddress(hits) {
  const addresses = hits.filter((h) => h.type === PII_TYPE.ADDRESS);
  const labelled = addresses.find((h) =>
    PROPERTY_ADDRESS_LABEL.test((h.block.text ?? '').slice(0, h.start)),
  );
  return (labelled ?? addresses[0])?.value ?? null;
}

/**
 * 위험 점검·인물 판별에 필요한 항목(소유자, 임대인, 소재지, 보증금 등)을 뽑는다.
 * 노션 함수 표에는 없지만 assessRisks()의 입력("비교용 추출 데이터")을 만들기 위해 추가한 함수 (docs/INTERFACES.md 참고)
 * - 사람 정보와 주소: 실제 탐지 결과에서 만든다. (findingId = detectPII() 결과의 id)
 * - 사용자가 해제(REJECTED)한 이름은 사람 목록에서 뺀다.
 *   TODO(PART 2): 사용자가 직접 추가(USER_ADDED)한 이름은 역할을 알 수 없어서 아직 넣지 않는다.
 *   PART 5 검토 화면에서 역할을 고르게 되면 그때 반영한다.
 * - 문서가 없으면 그 문서의 항목은 null (못 읽음), 문서는 있는데 사람이 없으면 [] (없음)
 * TODO(PART 2 이슈 ⑤): 등기부 권리(rights), 보증금·월세·특약은 아직 Mock 값이다.
 * @param {DocumentModel[]} documents
 * @param {PiiFinding[]} findings
 */
export function extractFields(documents, findings) {
  if (!Array.isArray(documents)) return fail(ERROR_CODE.INVALID_INPUT, 'Documents are missing.');

  const rejectedIds = new Set(
    (findings ?? []).filter((f) => f?.reviewStatus === REVIEW_STATUS.REJECTED).map((f) => f.id),
  );

  /** @param {string} type */
  const findDoc = (type) =>
    documents.find((d) => {
      if (!d?.pages) return false;
      const r = classifyDocument(d);
      return r.ok && r.data.documentType === type;
    }) ?? null;
  const registryDoc = findDoc(DOCUMENT_TYPE.REGISTRY);
  const leaseDoc = findDoc(DOCUMENT_TYPE.LEASE_CONTRACT);

  /** @param {any[]} people @param {string} role */
  const byRole = (people, role) => people.filter((p) => p.role === role);

  const mock = structuredClone(mockExtractedFields);
  /** @type {{ documentId: string | null, address: string | null, owners: Person[] | null, rights: any[] | null }} */
  let registry = { documentId: null, address: null, owners: null, rights: null };
  if (registryDoc) {
    const hits = scanDocument(registryDoc);
    const people = collectPeople(hits, rejectedIds);
    registry = {
      documentId: registryDoc.documentId,
      address: pickPropertyAddress(hits),
      owners: byRole(people, 'OWNER'),
      rights: mock.registry.rights, // TODO(PART 2 이슈 ⑤)
    };
  }

  /**
   * @type {{ documentId: string | null, address: string | null,
   *   landlords: Person[] | null, tenants: Person[] | null, accountHolders: Person[] | null,
   *   deposit: number | null, monthlyRent: number | null, specialTerms: string[] | null }}
   */
  let contract = {
    documentId: null,
    address: null,
    landlords: null,
    tenants: null,
    accountHolders: null,
    deposit: null,
    monthlyRent: null,
    specialTerms: null,
  };
  if (leaseDoc) {
    const hits = scanDocument(leaseDoc);
    const people = collectPeople(hits, rejectedIds);
    contract = {
      documentId: leaseDoc.documentId,
      address: pickPropertyAddress(hits),
      landlords: byRole(people, 'LANDLORD'),
      tenants: byRole(people, 'TENANT'),
      accountHolders: byRole(people, 'ACCOUNT_HOLDER'),
      deposit: mock.contract.deposit, // TODO(PART 2 이슈 ⑤)
      monthlyRent: mock.contract.monthlyRent, // TODO(PART 2 이슈 ⑤)
      specialTerms: mock.contract.specialTerms, // TODO(PART 2 이슈 ⑤)
    };
  }

  return ok({ registry, contract });
}
