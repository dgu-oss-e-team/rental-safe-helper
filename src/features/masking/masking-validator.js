// @ts-check
/**
 * PART 4. 외부로 보내기 전 검사 (masking-validator)
 *
 *   validateMaskedText(maskedText, findings, plan, edits?, options?) → Result<{ checked: number }>
 *   가려야 하는 원본 값이 가린 글에 남아 있으면 실패한다. 실패 메시지에는 실제 값을 넣지 않는다.
 *   OCR이 숫자를 비슷한 글자로 잘못 읽은 번호("75O315-1")가 남아 있어도 실패한다. (안전망, 아래 findLookalikeNumber)
 */

import { ok, fail, ERROR_CODE, MASKING_ACTION, PII_TYPE } from '../../shared/document-model.js';
import { validAdds, isNonRemovable } from './user-edits.js';
import personLabels from '../../config/templates/person-labels.json';

/** @typedef {import('../../shared/document-model.js').PiiFinding} PiiFinding */
/** @typedef {import('../../shared/document-model.js').MaskingPlan} MaskingPlan */

/*
 * OCR 오독 안전망 (#97에서 발견, PART 2는 #108에서 탐지하도록 고침)
 * 스캔 서류에서 OCR이 0을 O로, 1을 l로 읽으면 PART 2 탐지가 놓칠 수 있다. 탐지 결과에 없는 값은 위 검사도 못 찾는다.
 * 그래서 보내기 직전, 가린 글에서 비슷한 글자를 숫자로 바꿔 봤을 때 주민·외국인등록번호, 전화번호, 계좌번호 모양이
 * 남아 있으면 멈춘다. PART 2가 놓쳐도 마지막에 막아 주는 그물이다.
 * - 비슷한 글자가 실제로 섞인 번호만 본다. (정상 숫자는 위 검사와 PART 2 탐지가 맡는다)
 * - 번호의 숫자 자리 중 진짜 숫자가 절반 이상일 때만 본다. (영어 단어 오탐 방지)
 * - 날짜(2026-08-03)는 숫자가 8개라 계좌번호(10~16개)로 보지 않는다. 등기 고유번호(4-4-6) 모양은 뺀다.
 * - 계좌번호는 앞 20글자·뒤 10글자 안에 계좌·은행·입금 같은 말이 있을 때만 본다. (PART 2 findBankAccounts와 같은 기준)
 *   표 테두리(|2026-08-03|), 중개사무소 등록번호, 사업자등록번호 같은 숫자 덩어리에서 멈추지 않게 한다.
 */
/** OCR이 숫자 대신 자주 읽는 글자 → 숫자 */
const LOOKALIKE_DIGITS = { O: '0', o: '0', l: '1', I: '1', '|': '1' };
const LOOKALIKE_CHARS = /[OolI|]/g;
/** 숫자로 바꾼 글에서 찾는 번호 모양 */
const NUMBER_SHAPES = [
  // 주민·외국인등록번호: 6자리 + 구분 기호 + 뒷자리 7자리 (뒷자리는 *로 가려져 있어도 됨)
  /(?<!\d)\d{6}\s?[-./]?\s?[1-8*][\d*]{6}(?![\d*])/g,
  // 전화번호: 휴대폰·지역번호·070·050X + 3~4자리 + 4자리
  /(?<!\d)(?:01[016-9]|02|0[3-6]\d|070|050\d)[-.\s)]{0,3}\d{3,4}[-.\s]{0,3}\d{4}(?!\d)/g,
  // 계좌번호: 하이픈·공백으로 나뉜 숫자 덩어리 (숫자 10~16개인지는 아래에서 확인)
  /(?<!\d)\d{2,7}(?:[-\s]\d{2,7}){1,4}(?!\d)/g,
];
/** 등기 고유번호 모양 (개인정보가 아니라 남겨도 되는 번호) */
const REGISTRY_ID_SHAPE = /^\d{4}-\d{4}-\d{6}$/;
/** 계좌번호 근처에 있는 말 (PART 2 pii-patterns.js의 BANK_KEYWORD_REGEX와 같은 목록) */
const BANK_KEYWORD =
  /계좌|은행|예금주|입금|뱅크|농협|수협|우체국|새마을금고|신협|카뱅|토스|IBK|account|bank/i;
const BANK_KEYWORD_BEFORE = 20; // 번호 앞 20글자
const BANK_KEYWORD_AFTER = 10; // 번호 뒤 10글자

/**
 * 가린 글 한 줄에서 비슷한 글자가 섞인 번호를 찾는다. 없으면 null.
 * 글자 수를 그대로 두고 바꾸므로, 찾은 위치로 원래 글자를 다시 볼 수 있다.
 * @param {string} line
 * @returns {string | null}  찾은 번호의 원래 글자 (검사용, 메시지에는 넣지 않음)
 */
export function findLookalikeNumber(line) {
  const digits = line.replace(LOOKALIKE_CHARS, (ch) => LOOKALIKE_DIGITS[/** @type {keyof typeof LOOKALIKE_DIGITS} */ (ch)]);
  if (digits === line) return null;
  for (const shape of NUMBER_SHAPES) {
    for (const m of digits.matchAll(shape)) {
      const original = line.slice(m.index, m.index + m[0].length);
      const lookalikes = (original.match(LOOKALIKE_CHARS) ?? []).length;
      if (lookalikes === 0) continue;
      const real = (original.match(/\d/g) ?? []).length;
      if (real / (real + lookalikes) < 0.5) continue;
      if (shape === NUMBER_SHAPES[2]) {
        const count = m[0].replace(/\D/g, '').length;
        if (count < 10 || count > 16 || REGISTRY_ID_SHAPE.test(m[0])) continue;
        const end = m.index + m[0].length;
        const near =
          line.slice(Math.max(0, m.index - BANK_KEYWORD_BEFORE), m.index) + ' ' + line.slice(end, end + BANK_KEYWORD_AFTER);
        if (!BANK_KEYWORD.test(near)) continue;
      }
      return original;
    }
  }
  return null;
}

/*
 * 이중 안전장치 (실제 양식 서류 점검에서 발견)
 * 위 검사는 탐지한 값(findings)이 남았는지만 본다. PART 2가 못 찾은 번호는 그대로 지나간다.
 * 예: 입력칸이 겹쳐 두 번호가 띄어쓰기 없이 붙어 읽힌 경우 "900101-1234567800202-2345678", "010-1111-2222010-3333-4444"
 * 그래서 탐지 목록과 상관없이, 가린 글(일부러 남긴 자리는 뺌)에 아래 모양이 남아 있으면 멈춘다.
 * - 주민·외국인등록번호: 6자리-뒷자리 7자리 (뒷자리 *도 포함). 앞뒤에 숫자가 붙어 있어도 찾는다.
 *   뒷자리를 *로 가린 모양은 별표가 1개 이상이면 개수가 틀려도 찾는다 ("760423-******", 사진 OCR). 생년월일이 남기 때문이다.
 *   PART 2 주민번호 탐지(#270)와 같은 기준이다.
 *   숫자만 7자리가 아닌 경우("123456-1234")는 계좌번호 등과 헷갈려 찾지 않는다.
 *   뒷자리 별표가 엉뚱한 글자로 읽힌 "760423-#xwssnr", 뒷자리를 못 읽은 "760423-"도 찾는다. 생년월일 모양 6자리(월 01~12, 일 01~31)
 *   + 하이픈(–·— 포함) + 띄어쓰기 없는 뒷자리 0~12글자이고, 뒷자리가 숫자·하이픈만은 아닐 때. (PART 2 #291과 같은 기준)
 *   뒷자리 첫 글자가 한글이면 찾지 않는다 ("180314-등기", PART 2 #297과 같은 기준).
 * - 휴대폰 번호: 01X-XXXX-XXXX. 뒤에 숫자가 붙어 있어도 찾는다.
 * - 계좌번호: 계좌·은행·입금 같은 말 근처의 숫자 덩어리 10~16자리만 (오탐이 많아서, 위 OCR 안전망과 같은 기준)
 * 이름이 탐지되지 않았어도 바로 뒤의 주민번호 모양에서 멈추므로 "이름 + 주민번호" 줄도 함께 막힌다.
 * - 집 주소: 도로 이름·동 + 번지 다음에 "○○호"까지 이어지는 모양 ("서물특별시 중구 가상로 30, 2층 204호(가상동)")
 *   사진(OCR)이 "서울"을 "서물"로 읽어 주소 탐지가 놓치면 호수까지 그대로 나가서다. 시·구까지만 남긴 주소, "제702호"만 있는 줄은 멈추지 않는다.
 */
/** 탐지 목록과 상관없이 남아 있으면 안 되는 번호 모양 */
const LEFTOVER_SHAPES = [
  /\d{6}\s?-\s?(?:[1-8*][\d*]{6}|[1-8]?\*+)/g, // 주민·외국인등록번호 (별표 개수가 틀려도)
  // 주민·외국인등록번호 뒷자리가 엉뚱한 글자로 읽힘 ("760423-#xwssnr", "760423-"), PART 2 MASKED_ID_GARBAGE_REGEX와 같은 모양
  /(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\s?[-–—](?:(?=[^\s가-힣])(?=[^\s]*[^\d\s-])[^\s]{1,12}|(?=\s|$))/g,
  /(?<!\d)01[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}/g, // 휴대폰 번호
  NUMBER_SHAPES[2], // 계좌번호 (아래에서 숫자 수와 근처 단어를 확인)
  // 집 주소: "가상로 30, 2층 204호", "가상동 123-4 101동 1001호" (번지 뒤 20자 안에 ○○호)
  /[가-힣0-9]+(?:로|길|동|리|가)\s?\d+(?:-\d+)?(?![\d-])[^\n]{0,20}?\d+\s?호/g,
];

/**
 * 가린 글 한 줄에서 남아 있으면 안 되는 번호 모양을 찾는다. 없으면 null.
 * @param {string} line
 * @returns {string | null}  찾은 글자 (검사용, 메시지에는 넣지 않음)
 */
export function findLeftoverNumber(line) {
  for (const shape of LEFTOVER_SHAPES) {
    for (const m of line.matchAll(shape)) {
      if (shape === NUMBER_SHAPES[2]) {
        const count = m[0].replace(/\D/g, '').length;
        if (count < 10 || count > 16 || REGISTRY_ID_SHAPE.test(m[0])) continue;
        const end = m.index + m[0].length;
        const near =
          line.slice(Math.max(0, m.index - BANK_KEYWORD_BEFORE), m.index) + ' ' + line.slice(end, end + BANK_KEYWORD_AFTER);
        if (!BANK_KEYWORD.test(near)) continue;
      }
      return m[0];
    }
  }
  return null;
}

/**
 * 값의 앞뒤가 같은 숫자의 일부인지. 숫자이거나, 쉼표·하이픈 너머에 숫자가 이어지면("740,000", "1-740") 같은 숫자로 본다.
 * "246-8, 가상아파트"처럼 쉼표 뒤에 숫자가 없으면 나열이라 경계로 본다.
 * @param {string} text
 * @param {number} at  값 바로 바깥 글자의 위치
 * @param {-1 | 1} step  앞쪽이면 -1, 뒤쪽이면 1
 */
function joinsNumber(text, at, step) {
  const c = text[at] ?? '';
  if (/[0-9]/.test(c)) return true;
  return (c === ',' || c === '-') && /[0-9]/.test(text[at + step] ?? '');
}

/**
 * text 안에서 words 각각이 나오는 모든 자리를 [시작, 끝] 목록으로 돌려준다.
 * @param {string} text
 * @param {string[]} words
 * @returns {[number, number][]}
 */
function findSpans(text, words) {
  /** @type {[number, number][]} */
  const spans = [];
  for (const word of words) {
    if (!word) continue;
    const startsWithDigit = /^\d/.test(word);
    const endsWithDigit = /\d$/.test(word);
    for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
      const end = at + word.length;
      // 숫자 경계: "740"을 "제1740호", "금740,000,000원", "246-89" 안에서 찾지 않는다 (#204)
      if (startsWithDigit && joinsNumber(text, at - 1, -1)) continue;
      if (endsWithDigit && joinsNumber(text, end, 1)) continue;
      spans.push([at, end]);
    }
  }
  return spans;
}

/**
 * 숫자(와 하이픈)만 있는 짧은 주소 조각인지. 6자리 이상은 숫자만 비교로 모든 서류에서 계속 찾는다.
 * @param {PiiFinding} f
 */
function isShortNumberPiece(f) {
  return f.type === PII_TYPE.ADDRESS && /^\d[\d-]*$/.test(f.value) && f.value.replace(/-/g, '').length < 6;
}

/** 사진 서류에서 바로 옆에 이름이 오는 역할 낱말 (person-labels.json + 줄여 읽힌 "개업공인", 등기부 "채무자" 등) */
const ROLE_WORDS = [
  ...new Set([
    ...(personLabels.persons ?? []).flatMap((p) => p.labels),
    ...(personLabels.otherPersonLabels ?? []),
    '개업공인',
    '중개사',
    '대표자',
  ]),
].sort((a, b) => b.length - a.length);
/** 역할 낱말 뒤에 와도 이름이 아닌 낱말 (PART 2 notNames, 이름 칸 낱말, 역할 낱말) */
const NOT_NAME_AFTER_ROLE = new Set([
  ...(personLabels.notNames ?? []),
  ...(personLabels.nameFieldWords ?? []),
  ...(personLabels.addressStopWords ?? []),
  ...ROLE_WORDS,
  // 계약서에서 역할 낱말 뒤에 자주 오는 낱말
  '전입', '전입신고', '전세', '확정일자', '주민센터', '명도', '원상복구', '정보', '사항', '신청', '상호', '사업자',
  '부담', '명의', '소유', '사정', '전원', '우선', '동의', '본인', '지정', '변경', '전부', '일부', '모두', '각각', '공동',
]);
/** 흔한 성씨 (이름 모양인지 볼 때 첫 글자). "임차인 간에"의 "간에" 같은 문장 낱말이 이름으로 보이지 않게 한다. */
const SURNAMES = new Set(
  '김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구나민진지엄채원천방공현함변염여추도소석선설마길연위표명기반라왕금옥육인맹제모탁국어은편용예경봉사부가복태목형피두감음빈동온호범좌갈'.split(''),
);
const TWO_LETTER_SURNAMES = ['남궁', '황보', '제갈', '선우', '독고', '사공', '서문'];
/** @param {string} word */
const looksLikeName = (word) => SURNAMES.has(word[0]) || TWO_LETTER_SURNAMES.some((x) => word.startsWith(x));
/** 조사로 끝나는 낱말 ("부담으로", "소유의") → 문장 낱말 (PART 2 nameParticles) */
const ENDS_WITH_PARTICLE = new RegExp(`(?:${(personLabels.nameParticles ?? []).join('|')})$`);
/** 이름 뒤에 오면 회사 이름으로 보는 낱말 ("임대인 가상리츠 주식회사") */
const COMPANY_AFTER = /^\s*(?:주식회사|유한회사|회사|법인|㈜|\(주\))/;
/** 역할 낱말 + (띄어쓰기·세로줄·쌍점) + 한글 2~4자 낱말. OCR이 표 칸 선을 "|", "⎸"로 읽는다. */
const ROLE_NEXT_WORD = new RegExp(`(?:${ROLE_WORDS.join('|')})[\\s|⎸│:：·]+([가-힣]{2,4})(?![가-힣])`, 'g');
/** "203호(가상동)"처럼 호수 바로 뒤에 동 이름 괄호. "제24호서식", "제1호"는 앞에 "제"가 붙거나 괄호가 없어서 빠진다. */
const UNIT_WITH_DONG = /(?<![제\d])\d{1,4}\s?호\s?\([가-힣]/;

/**
 * 사진(OCR) 서류에서만 보는 남은 개인정보 모양 (PART 2가 OCR 오독으로 놓친 것, 상욱님 가짜세트4 사진 점검)
 * - 역할 낱말 바로 옆에 가려지지 않은 이름 모양 ("개업공인 ⎸ 김삿갓 ⎸ GLEE]")
 * - 동 이름 괄호가 붙은 호수 ("203호(가상동)", OCR이 502를 505로 읽어 원래 값과 비교로도 안 잡힘)
 * 글자 PDF에서는 보지 않는다. 서식 문구가 많아 잘못 멈추기 쉽고, 글자 PDF는 PART 2 탐지가 정확하다.
 * @param {string} line  일부러 남긴 자리(가명 등)를 뺀 줄
 * @returns {'NAME' | 'UNIT' | null}
 */
export function findPhotoLeftover(line) {
  for (const m of line.matchAll(ROLE_NEXT_WORD)) {
    if (NOT_NAME_AFTER_ROLE.has(m[1]) || !looksLikeName(m[1])) continue;
    const rest = line.slice((m.index ?? 0) + m[0].length);
    if (COMPANY_AFTER.test(rest)) continue;
    // 서식의 이름 칸은 이름 뒤에 줄 끝, 칸 선("|"), "(서명", 번호가 온다. 뒤에 한글 낱말이 이어지면 문장이다.
    // ("수리비는 임차인 부담으로 한다", "임차인 우선 변제", #310 리뷰)
    if (/^\s*[가-힣]/.test(rest)) continue;
    // 조사로 끝나는 낱말은 문장 낱말이다. 단, 이름 칸 모양(뒤에 칸 선·"(")이면 "김지은"처럼 조사 글자로 끝나는 이름일 수 있어 본다.
    if (ENDS_WITH_PARTICLE.test(m[1]) && !/^\s*[|⎸│(（]/.test(rest)) continue;
    return 'NAME';
  }
  return UNIT_WITH_DONG.test(line) ? 'UNIT' : null;
}

/**
 * 외부로 보내기 전에, 가려야 하는 원본 값이 남아 있지 않은지 검사한다.
 * @param {Record<string, string>} maskedText
 * @param {PiiFinding[]} findings
 * @param {MaskingPlan} plan
 * @param {import('./user-edits.js').MaskingEdits} [edits]  사용자가 더 가린 글자(add)도 검사한다
 * @param {{ photoDocumentIds?: Iterable<string> }} [options]  사진(OCR) 서류 id. 이 서류에서는 findPhotoLeftover도 본다.
 */
export function validateMaskedText(maskedText, findings, plan, edits, options) {
  const all = Object.values(maskedText).join('\n');
  // 서류마다 all 안에서 차지하는 자리 [시작, 끝]
  /** @type {Map<string, [number, number]>} */
  const docRange = new Map();
  let offset = 0;
  for (const [documentId, text] of Object.entries(maskedText)) {
    docRange.set(documentId, [offset, offset + text.length]);
    offset += text.length + 1;
  }
  // 일부러 남긴 글자(가명, 줄인 주소)가 있는 자리. 원래 값이 이 자리 "안에서만" 보이면 새어 나간 게 아니다.
  // 예: 두 줄 주소 조각 "서울특별시"는 줄인 주소 "서울특별시 중구" 안에 들어 있다.
  // 사용자가 해제한(KEEP) 값도 일부러 보이는 글자다. 같은 글자의 다른 항목(예: 동명이인)이 이 자리 때문에 걸리지 않게 한다.
  const findingById = new Map(findings.map((f) => [f.id, f]));
  const allowedTexts = plan.items.flatMap((i) => {
    if (i.action === MASKING_ACTION.REPLACE && i.replacement) return [String(i.replacement)];
    if (i.action === MASKING_ACTION.KEEP) {
      // 풀 수 없는 값(주민번호 모양인 등기 번호 등)은 KEEP으로 들어와도 일부러 남긴 자리로 보지 않는다 (#192)
      const f = findingById.get(i.findingId);
      return f && !isNonRemovable(f) ? [f.value] : [];
    }
    return [];
  });
  const allowedSpans = findSpans(all, allowedTexts);
  // 하이픈·공백을 뺀 숫자열로도 비교한다 (줄 단위로 비교해 다른 줄의 숫자가 이어 붙지 않게 함)
  // 이때 일부러 남긴 자리(allowedSpans)의 글자는 빼고 본다. 글자 비교와 같은 기준이다.
  // 예: 쪽마다 머리글에 같은 주소가 있을 때 하나를 보여 주면(KEEP), 그 주소의 숫자 때문에 다른 쪽 머리글이 새는 것으로 보지 않게 한다.
  // 뺀 자리는 줄바꿈으로 바꿔서 양옆 숫자가 이어 붙지 않게 한다.
  const outside = all.split(''); // 글자 하나씩 (allowedSpans의 위치와 같은 기준)
  for (const [a, b] of allowedSpans) outside.fill('\n', a, b);
  const outsideLines = outside.join('').split('\n');
  const digitLines = outsideLines.map((line) => line.replace(/[^0-9]/g, ''));
  const actionById = new Map(plan.items.map((i) => [i.findingId, i.action]));
  let checked = 0;
  for (const f of findings) {
    const action = actionById.get(f.id);
    if (action === MASKING_ACTION.KEEP) continue;
    checked += 1;
    const digitsOnly = f.value.replace(/[^0-9]/g, '');
    // 숫자만 있는 짧은 주소 조각("15", "246-8")은 그 조각이 나온 서류 안에서만 찾는다 (#221)
    // 등기부 건물번호 "15"가 계약서 "제15조"와 부딪히지 않게. 같은 서류에 혼자 남으면 그대로 멈춘다.
    const range = isShortNumberPiece(f) ? docRange.get(f.documentId) : undefined;
    const spans = findSpans(all, [f.value]).filter(([a, b]) => !range || (range[0] <= a && b <= range[1]));
    const leaked =
      spans.some(([a, b]) => !allowedSpans.some(([x, y]) => x <= a && b <= y)) ||
      (digitsOnly.length >= 6 && digitLines.some((line) => line.includes(digitsOnly)));
    if (leaked) {
      // 메시지에 실제 값을 넣지 않는다
      return fail(ERROR_CODE.INVALID_INPUT, `Masking check failed: a ${f.type} value is still visible.`);
    }
  }
  // OCR이 잘못 읽은 번호가 남아 있으면 안 된다 (탐지 결과에 없어도)
  if (all.split('\n').some((line) => findLookalikeNumber(line) !== null)) {
    return fail(
      ERROR_CODE.INVALID_INPUT,
      'Masking check failed: a number that may be misread (for example O instead of 0) is still visible.',
    );
  }
  // 탐지 목록과 상관없이 번호 모양이 남아 있으면 안 된다 (이중 안전장치, 일부러 남긴 자리는 뺌)
  if (outsideLines.some((line) => findLeftoverNumber(line) !== null)) {
    return fail(ERROR_CODE.INVALID_INPUT, 'Masking check failed: a number that looks like personal information is still visible.');
  }
  // 사진(OCR) 서류: 역할 낱말 옆 이름, 동 이름이 붙은 호수가 남아 있으면 안 된다 (탐지가 OCR 오독으로 놓친 것)
  const outsideText = outside.join('');
  for (const id of options?.photoDocumentIds ?? []) {
    const range = docRange.get(id);
    if (!range) continue;
    const kind = outsideText.slice(range[0], range[1]).split('\n').map(findPhotoLeftover).find((k) => k !== null);
    if (kind) {
      return fail(
        ERROR_CODE.INVALID_INPUT,
        kind === 'NAME'
          ? 'Masking check failed: a name next to a role word may still be visible in a photo document.'
          : 'Masking check failed: a unit number of an address may still be visible in a photo document.',
      );
    }
  }
  // 사용자가 더 가린 글자도 남아 있으면 안 된다
  for (const a of validAdds(edits)) {
    checked += 1;
    if (findSpans(all, [a.value]).some(([x0, x1]) => !allowedSpans.some(([x, y]) => x <= x0 && x1 <= y))) {
      return fail(ERROR_CODE.INVALID_INPUT, 'Masking check failed: a user-selected value is still visible.');
    }
  }
  return ok({ checked });
}
