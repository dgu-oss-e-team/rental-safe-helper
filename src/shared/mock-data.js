// @ts-check
/**
 * Mock Data: 실제 기능이 완성되기 전까지 각 파트가 대신 사용하는 가짜 데이터.
 *
 * - 모든 이름·번호·주소·계좌는 지어낸 값이다. 실제 개인정보를 절대 넣지 않는다.
 * - 반드시 src/shared/document-model.js의 형식을 그대로 따른다.
 * - 시나리오: 등기부 소유자 "김철수(800101)"와 계약서 임대인 "김철수(750315)"는 이름만 같은 다른 사람(동명이인).
 *   → 사기 위험 확인에서 OWNER_MISMATCH(STOP)가 나와야 한다.
 */

import {
  DOCUMENT_TYPE,
  SOURCE_TYPE,
  PII_TYPE,
  REVIEW_STATUS,
  RISK_STATUS,
} from './document-model.js';

/** @typedef {import('./document-model.js').DocumentModel} DocumentModel */
/** @typedef {import('./document-model.js').PiiFinding} PiiFinding */

/** @type {DocumentModel} */
export const mockRegistryDocument = {
  documentId: 'DOC_REGISTRY',
  documentType: DOCUMENT_TYPE.UNKNOWN,
  sourceType: SOURCE_TYPE.TEXT_PDF,
  pages: [
    {
      pageIndex: 0,
      width: 2480,
      height: 3508,
      blocks: [
        {
          blockId: 'R_001',
          text: '등기사항전부증명서(말소사항 포함) - 집합건물',
          bbox: { x: 0.1, y: 0.05, width: 0.8, height: 0.03 },
          confidence: null,
        },
        {
          blockId: 'R_002',
          text: '고유번호 0000-0000-000000',
          bbox: { x: 0.6, y: 0.09, width: 0.3, height: 0.02 },
          confidence: null,
        },
        {
          blockId: 'R_003',
          text: '서울특별시 중구 필동로 00, 101호',
          bbox: { x: 0.1, y: 0.13, width: 0.6, height: 0.02 },
          confidence: null,
        },
        {
          blockId: 'R_004',
          text: '【 갑 구 】 (소유권에 관한 사항)',
          bbox: { x: 0.1, y: 0.2, width: 0.5, height: 0.02 },
          confidence: null,
        },
        {
          blockId: 'R_005',
          text: '소유자 김철수 800101-1******',
          bbox: { x: 0.1, y: 0.24, width: 0.45, height: 0.02 },
          confidence: null,
        },
        {
          blockId: 'R_006',
          text: '【 을 구 】 (소유권 이외의 권리에 관한 사항)',
          bbox: { x: 0.1, y: 0.32, width: 0.6, height: 0.02 },
          confidence: null,
        },
        {
          blockId: 'R_007',
          text: '근저당권설정 채권최고액 금120,000,000원',
          bbox: { x: 0.1, y: 0.36, width: 0.6, height: 0.02 },
          confidence: null,
        },
      ],
    },
  ],
};

/** @type {DocumentModel} */
export const mockLeaseDocument = {
  documentId: 'DOC_LEASE',
  documentType: DOCUMENT_TYPE.UNKNOWN,
  sourceType: SOURCE_TYPE.TEXT_PDF,
  pages: [
    {
      pageIndex: 0,
      width: 2480,
      height: 3508,
      blocks: [
        {
          blockId: 'L_001',
          text: '주택임대차표준계약서',
          bbox: { x: 0.3, y: 0.05, width: 0.4, height: 0.03 },
          confidence: null,
        },
        {
          blockId: 'L_002',
          text: '소재지 서울특별시 중구 필동로 00, 101호',
          bbox: { x: 0.1, y: 0.12, width: 0.7, height: 0.02 },
          confidence: null,
        },
        {
          blockId: 'L_003',
          text: '보증금 금50,000,000원 월세 금500,000원',
          bbox: { x: 0.1, y: 0.18, width: 0.6, height: 0.02 },
          confidence: null,
        },
        {
          blockId: 'L_004',
          text: '임대인 김철수 750315-1******',
          bbox: { x: 0.1, y: 0.7, width: 0.45, height: 0.02 },
          confidence: null,
        },
        {
          blockId: 'L_005',
          text: '임차인 NGUYEN VAN A 990505-5******',
          bbox: { x: 0.1, y: 0.75, width: 0.55, height: 0.02 },
          confidence: null,
        },
        {
          blockId: 'L_006',
          text: '연락처 010-0000-0000',
          bbox: { x: 0.1, y: 0.79, width: 0.35, height: 0.02 },
          confidence: null,
        },
        {
          blockId: 'L_007',
          text: '입금 계좌 가상은행 000-000000-00000 예금주 김철수',
          bbox: { x: 0.1, y: 0.83, width: 0.7, height: 0.02 },
          confidence: null,
        },
        {
          blockId: 'L_008',
          text: '특약사항: 월세는 현금으로 지급한다.',
          bbox: { x: 0.1, y: 0.88, width: 0.6, height: 0.02 },
          confidence: null,
        },
      ],
    },
  ],
};

/**
 * 탐지 결과 한 건을 만든다. bbox는 해당 블록 좌표를 그대로 쓴다(Mock이라 단순화).
 * @param {string} id
 * @param {string} type
 * @param {string} value
 * @param {DocumentModel} doc
 * @param {string} blockId
 * @returns {PiiFinding}
 */
function finding(id, type, value, doc, blockId) {
  const page = doc.pages[0];
  const block = page.blocks.find((b) => b.blockId === blockId);
  if (!block) throw new Error(`mock block not found: ${blockId}`);
  return {
    id,
    type,
    value,
    documentId: doc.documentId,
    pageIndex: page.pageIndex,
    blockId,
    bbox: { ...block.bbox },
    confidence: block.confidence,
    reviewStatus: REVIEW_STATUS.DETECTED,
  };
}

/** PART 2 detectPII()가 나중에 실제로 만들어야 하는 결과의 예시 */
export const mockRegistryFindings = [
  finding('PII_R01', PII_TYPE.REGISTRY_ID, '0000-0000-000000', mockRegistryDocument, 'R_002'),
  finding('PII_R02', PII_TYPE.ADDRESS, '서울특별시 중구 필동로 00, 101호', mockRegistryDocument, 'R_003'),
  finding('PII_R03', PII_TYPE.PERSON_NAME, '김철수', mockRegistryDocument, 'R_005'),
  finding('PII_R04', PII_TYPE.RESIDENT_ID, '800101-1******', mockRegistryDocument, 'R_005'),
];

export const mockLeaseFindings = [
  finding('PII_L01', PII_TYPE.ADDRESS, '서울특별시 중구 필동로 00, 101호', mockLeaseDocument, 'L_002'),
  finding('PII_L02', PII_TYPE.PERSON_NAME, '김철수', mockLeaseDocument, 'L_004'),
  finding('PII_L03', PII_TYPE.RESIDENT_ID, '750315-1******', mockLeaseDocument, 'L_004'),
  finding('PII_L04', PII_TYPE.PERSON_NAME, 'NGUYEN VAN A', mockLeaseDocument, 'L_005'),
  finding('PII_L05', PII_TYPE.FOREIGNER_ID, '990505-5******', mockLeaseDocument, 'L_005'),
  finding('PII_L06', PII_TYPE.PHONE_NUMBER, '010-0000-0000', mockLeaseDocument, 'L_006'),
  finding('PII_L07', PII_TYPE.BANK_ACCOUNT, '000-000000-00000', mockLeaseDocument, 'L_007'),
  finding('PII_L08', PII_TYPE.PERSON_NAME, '김철수', mockLeaseDocument, 'L_007'),
];

/**
 * PART 2 extractFields()가 나중에 실제로 만들어야 하는 결과의 예시.
 * 사람 정보는 findingId로 탐지 결과를 가리키고, 생년월일은 동일 인물 판정에만 쓴다(AI로 보내지 않음).
 */
export const mockExtractedFields = {
  registry: {
    documentId: 'DOC_REGISTRY',
    address: '서울특별시 중구 필동로 00, 101호',
    owners: [{ findingId: 'PII_R03', name: '김철수', birthDate: '800101', role: 'OWNER' }],
    rights: [
      { kind: 'MORTGAGE', maxClaimAmount: 120000000, cancelled: false, receivedAt: null },
    ],
  },
  contract: {
    documentId: 'DOC_LEASE',
    address: '서울특별시 중구 필동로 00, 101호',
    landlords: [{ findingId: 'PII_L02', name: '김철수', birthDate: '750315', role: 'LANDLORD' }],
    tenants: [{ findingId: 'PII_L04', name: 'NGUYEN VAN A', birthDate: '990505', role: 'TENANT' }],
    accountHolders: [{ findingId: 'PII_L08', name: '김철수', birthDate: null, role: 'ACCOUNT_HOLDER' }],
    deposit: 50000000,
    monthlyRent: 500000,
    specialTerms: ['월세는 현금으로 지급한다.'],
  },
};

/** PART 4 matchPeople()가 나중에 실제로 만들어야 하는 결과의 예시 */
export const mockPersonGroups = [
  { personId: 'P1', alias: '[Owner_A]', roles: ['OWNER'], findingIds: ['PII_R03'], status: 'CONFIRMED' },
  { personId: 'P2', alias: '[Landlord_B]', roles: ['LANDLORD'], findingIds: ['PII_L02'], status: 'CONFIRMED' },
  { personId: 'P3', alias: '[Tenant_C]', roles: ['TENANT'], findingIds: ['PII_L04'], status: 'CONFIRMED' },
  // 예금주는 생년월일이 없어서 임대인과 같은 사람인지 확정할 수 없음 → 사용자에게 확인 필요
  { personId: 'P4', alias: '[AccountHolder_D]', roles: ['ACCOUNT_HOLDER'], findingIds: ['PII_L08'], status: 'AMBIGUOUS' },
];

/** PART 3 assessRisks()가 나중에 실제로 만들어야 하는 결과의 예시 */
export const mockRiskResults = [
  {
    ruleId: 'OWNER_MISMATCH',
    status: RISK_STATUS.STOP,
    title: 'Owner and landlord may be different people',
    explanation:
      'The owner on the register and the landlord on the contract have the same name but different birth dates.',
    action: "Ask to see the landlord's ID and compare it with the register.",
  },
  {
    ruleId: 'MORTGAGE_EXISTS',
    status: RISK_STATUS.CHECK,
    title: 'A mortgage is registered on this home',
    explanation: 'Maximum claim amount: 120,000,000 KRW. Your deposit: 50,000,000 KRW.',
    action: 'Compare the two amounts and ask how the deposit will be protected.',
  },
  {
    ruleId: 'ACCOUNT_HOLDER_MISMATCH',
    status: RISK_STATUS.UNVERIFIABLE,
    title: 'Could not confirm the account holder',
    explanation: 'The account holder has no birth date, so we could not tell whether it is the landlord.',
    action: 'Send money only to an account in the landlord’s own name.',
  },
  {
    ruleId: 'RISKY_SPECIAL_TERM',
    status: RISK_STATUS.CHECK,
    title: 'Special term about cash payment',
    explanation: 'The contract says the monthly rent is paid in cash. Cash payments are hard to prove later.',
    action: 'Ask to pay by bank transfer, or always get a receipt.',
  },
];
