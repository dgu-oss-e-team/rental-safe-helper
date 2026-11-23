// @ts-check
/**
 * PART 2. 개인정보 정규식 탐지
 * 글자(text)를 받아서 개인정보가 어디 있는지 찾아 준다.
 * 결과의 start/end는 "몇 번째 글자부터 몇 번째 글자까지"인지를 뜻한다.
 *
 * 규칙 참고: ko-pii (MIT License, Copyright (c) 2026 Marker Inc.)
 *   https://github.com/Marker-Inc-Korea/ko-pii
 *   Python 라이브러리라 실행하지 않고, 아래 규칙만 JavaScript로 옮겼다.
 *   - 주민·외국인등록번호 구분 기호(- . / 공백), 지역번호 목록, +82 국제번호 형식
 *   - 계좌번호 자릿수(10-16)와 은행 이름 키워드, 여권번호 앞글자 목록
 *   우리가 따로 추가한 것: 가려진 번호(*), 안심번호(050X), 등기 고유번호, uncertain 표시
 */
import { PII_TYPE } from '../../shared/document-model.js';

/**
 * 주민등록번호 / 외국인등록번호
 * 형식: 생년월일 6자리 + (구분 기호) + 뒷자리 7자리
 * - 구분 기호는 - . / 공백 중 하나이거나 없어도 된다. (1번 괄호, ko-pii 규칙)
 * - 뒷자리는 *로 가려져 있어도 된다. (예: 800101-1******, 800101-*******)
 * - (?<!\d), (?![\d*]): 앞뒤에 숫자가 더 붙어 있으면 잡지 않는다 (긴 계좌번호 오탐 방지)
 */
const ID_NUMBER_REGEX =
  /(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(\s?[-./]\s?|[-./\s]{0,2})([1-8*])[\d*]{6}(?![\d*])/g;

/**
 * 한국 여권번호
 * 옛 형식: 영문 1자 + 숫자 8자리   (예: M12345678)
 * 새 형식: 영문 1자 + 숫자 3자리 + 영문 1자 + 숫자 4자리 (예: M123A4567)
 * 앞글자: M 복수여권, S 단수여권, G·O 관용, D 외교관, R 거주, T 여행증명서 (ko-pii 규칙)
 * 일련번호가 00000000이면 버린다.
 */
const PASSPORT_REGEX =
  /(?<![A-Za-z0-9])(?:[MSGODRT](?!0{8})\d{8}|[MSROD]\d{3}[A-Z]\d{4})(?![A-Za-z0-9])/g;

/**
 * 전화번호
 * 휴대폰: 010, 011, 016-019 / 서울: 02 / 지역: 031-033, 041-044, 051-055, 061-064 (ko-pii 목록)
 * 인터넷전화: 070 / 안심번호: 050X
 * 가운데 3-4자리, 끝 4자리. 구분 기호(- . 공백)는 있어도 되고 없어도 된다.
 * 지역번호 뒤 괄호도 허용한다. 예: (02) 123-4567
 */
const PHONE_REGEX =
  /(?<![0-9+])(?:01[016-9]|02|03[1-3]|04[1-4]|05[1-5]|06[1-4]|070|050\d)[-.\s)\]]{0,3}\d{3,4}[-.\s]{0,3}\d{4}(?!\d)/g;

/**
 * 국제 형식 전화번호 (외국인 유학생이 자주 씀). 예: +82 10-1234-5678, +82-2-123-4567
 * +82나 0082 뒤에는 맨 앞 0이 빠진다. (ko-pii 규칙)
 */
const PHONE_INTL_REGEX =
  /(?<!\d)(?:\+82|0082)[-.\s]?(?:\(0\)[-.\s]?)?(?:1[016-9]|2|3[1-3]|4[1-4]|5[1-5]|6[1-4]|70)[-.\s]{0,3}\d{3,4}[-.\s]{0,3}\d{4}(?!\d)/g;

/** 등기 고유번호: 4자리-4자리-6자리 (예: 1101-2024-123456) */
const REGISTRY_ID_REGEX = /(?<!\d)\d{4}-\d{4}-\d{6}(?!\d)/g;

/**
 * 임대사업자 등록번호: 등록 연도-시·군·구 이름-일련번호 (예: 2017-서울중구-00999, 실제 민간임대 계약서로 확인)
 * 공개 번호지만 임대인을 찾아낼 수 있어서 가린다. 새 종류를 만들지 않고 REGISTRY_ID로 돌려준다. (팀 합의)
 * 주민번호 모양이 아니라서 ④에서 가림을 풀 수 있다. (#201 잠금 대상 아님)
 * 가운데가 한글이라 날짜("2024-01-05")나 다른 번호와 겹치지 않는다.
 * 앞에 "제"가 붙은 "제2017-서울중구-00999호"도 찾는다. ("제"와 "호"는 값에 넣지 않는다, #220 리뷰)
 * 그 밖에 앞에 한글·숫자가 붙어 있으면 다른 낱말의 일부라서 찾지 않는다.
 */
/**
 * 사업자등록번호: 3자리-2자리-5자리 (예: 214-86-35071, 상욱님 평가 세트 #302)
 * 민간임대 계약서 "주민등록번호(사업자등록번호)" 칸에 법인·개인 임대사업자 번호를 적는다.
 * 개인 임대사업자는 이 번호로 사람을 찾아낼 수 있어서 가린다. 법인 관련 번호와 같이 REGISTRY_ID로 돌려준다. (INTERFACES.md)
 * - 앞뒤에 숫자·하이픈이 더 붙어 있으면 다른 번호의 일부라서 찾지 않는다.
 * - 번호 근처에 은행 관련 단어가 있으면 계좌번호일 수 있어서 여기서 찾지 않는다. (계좌번호 찾기가 맡는다, 상욱님 리뷰)
 */
const BUSINESS_ID_REGEX = /(?<![\d-])\d{3}\s?-\s?\d{2}\s?-\s?\d{5}(?![\d-])/g;

const RENTAL_BUSINESS_ID_REGEX =
  /(?:(?<=(?<![가-힣])제\s?)|(?<![\d가-힣]))(?:19|20)\d{2}\s*-\s*[가-힣]{2,8}\s*-\s*\d{3,6}(?!\d)/g;

/**
 * 계좌번호 후보: 하이픈이나 공백으로 나뉜 숫자 덩어리(예: 123-45-678901) 또는 10-16자리 연속 숫자
 * 은행마다 형식이 달라서 모양만으로는 판단하기 어렵다.
 * 그래서 번호 앞이나 뒤에 은행 관련 단어가 있을 때만 계좌번호로 본다.
 */
const BANK_CANDIDATE_REGEX = /(?<!\d)(?:\d{2,7}(?:[-\s]\d{2,7}){1,4}|\d{10,16})(?!\d)/g;
/**
 * 은행 관련 단어. "은행"이 안 붙는 이름(농협, 카카오뱅크, 우체국 등)은 ko-pii 목록에서 가져왔다.
 * "국민", "신한", "우리", "하나", "KB", "NH"만 단독으로 쓰는 건 넣지 않았다.
 * 일반 단어나 부동산 용어(예: KB시세)와 겹쳐서 엉뚱한 숫자를 계좌로 잡기 때문이다.
 */
const BANK_KEYWORD_REGEX =
  /계좌|은행|예금주|입금|뱅크|농협|수협|우체국|새마을금고|신협|카뱅|토스|IBK|account|bank/i;
const BANK_KEYWORD_BEFORE = 20; // 번호 앞 20글자 (예: 입금계좌: 110-123-456789)
const BANK_KEYWORD_AFTER = 10; // 번호 뒤 10글자 (예: 110-123-456789 (신한은행))

/**
 * 정규식 하나로 찾은 결과를 공통 모양으로 만든다.
 * @param {string} text
 * @param {RegExp} regex
 * @param {string} type
 */
function findByRegex(text, regex, type) {
  const results = [];
  for (const match of text.matchAll(regex)) {
    results.push({
      type,
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return results;
}

/*
 * 법인등록번호 (#192)
 * "110111-3579246"처럼 모양만으로는 주민등록번호와 구분할 수 없다. 그래서 바로 앞 글자로 판단한다.
 * - "법인등록번호" 라벨이 바로 앞에 있음 (예: "법인등록번호 110111-…", "(법인등록번호) …")
 * - 바로 앞 낱말이 회사 이름: 주식회사·유한회사·㈜·(주)가 들어 있거나, 회사·법인·리츠·신탁·은행·조합·공사·재단·협회·금고로 끝남
 *   (예: "가상주택리츠주식회사 110111-…", "근저당권자 주식회사가상은행 110111-…", "…부동산투자회사 110111-…")
 * 법인등록번호는 등기 고유번호(REGISTRY_ID) 종류로 돌려준다. 가리는 건 같고(REDACT), 사람 생년월일로는 쓰지 않는다.
 * 애매하면(회사 이름이 줄 위쪽에 있는 등) 지금처럼 주민·외국인등록번호로 본다. (놓치는 것보다 넓게 가리기)
 */
const CORPORATE_LABEL_BEFORE = /법\s*인\s*등\s*록\s*번\s*호\s*\)?\s*[:：]?\s*$/;
/**
 * 회사·기관 끝말 앞에는 2글자 이상이 있어야 한다. (#197 리뷰)
 * "가상은행", "가상자산신탁"은 회사지만, "김공사", "김신탁", "법인" 하나는 사람 이름이나 낱말일 수 있다.
 * (사람 번호를 REGISTRY_ID로 잘못 보면 생년월일이 빠지고, ④에서 가림을 풀 수 있게 된다)
 */
const COMPANY_WORD_BEFORE =
  /(?:(?:주식회사|유한회사|㈜|\(주\))\s*\S*|[가-힣A-Za-z0-9]{2,}(?:회사|법인|리츠|신탁|은행|조합|공사|재단|협회|금고))\s*$/;
/** 번호 앞에서 볼 글자 수 */
const CORPORATE_LOOKBACK = 40;

/**
 * 법인등록번호 모양: 6자리-7자리. 법인번호는 뒷자리가 0·9로 시작할 수 있어서 주민번호 정규식에 안 걸린다.
 * ("소유자 주식회사가상건설 110111-0000001" → 놓침, "근저당권자 주식회사가상은행 110111-0000002" → 계좌번호로 잡힘)
 * 그래서 바로 앞이 "법인등록번호" 칸이나 회사 이름일 때(isCorporateNumber)만 따로 찾는다. (PR #253 평가)
 */
const CORPORATE_NUMBER_REGEX = /(?<!\d)\d{6}\s?-\s?\d{7}(?!\d)/g;

/**
 * 뒷자리 별표 개수가 7개가 아닌 가려진 번호 (사진·스캔 OCR, 상욱님 점검)
 * OCR은 별표 개수를 자주 틀리게 읽는다: "760423-******"(6개), "690812-*****"(5개), "680918-***져"(뒤에 엉뚱한 글자)
 * 위 정규식은 뒷자리가 정확히 7글자여야 해서 못 찾고, 생년월일이 AI 글에 남는다.
 * 생년월일 6자리 + 구분 기호 + 별표가 1개 이상 섞인 뒷자리(1~12글자)면 주민·외국인등록번호로 본다.
 * - 별표가 있으면 이미 가려진 번호라는 뜻이라 넓게 가리는 쪽이 안전하다. (숫자만 짧게 있는 "760423-12"는 다른 번호일 수 있어 잡지 않는다)
 * - 뒤의 엉뚱한 글자("져")는 개인정보가 아니라 값에 넣지 않는다. 생년월일과 별표까지 가린다.
 * - 별표 개수가 이상하므로 uncertain(사용자 확인 필요)이다.
 * OCR이 하이픈을 "–", "—", "~"로 읽는 것도 받는다. 전각 별표 "＊"도 받는다.
 */
const MASKED_ID_LOOSE_REGEX =
  /(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\s?[-./–—~]\s?(?=[\d*＊]*[*＊])([1-8*＊])[\d*＊]{0,11}(?![\d*＊])/g;

/**
 * 뒷자리 별표가 전부 엉뚱한 글자로 읽힌 번호 (사진 OCR, 상욱님 점검)
 * 예: "김선달 760423-#xwssnr" (별표 "*******"를 "#xwssnr"로 읽음), "760423-" (뒷자리를 못 읽음)
 * 생년월일 모양 6자리(월 01~12, 일 01~31) + 하이픈(–·— 포함) + 띄어쓰기 없는 뒷자리 0~12글자면 주민·외국인등록번호로 본다.
 * - 생년월일 6자리 뒤에 하이픈이 오는 것은 서류에서 주민번호 말고는 거의 없다.
 * - 뒷자리가 숫자·하이픈만이면 잡지 않는다. "110423-12-345678" 같은 계좌번호일 수 있다. (숫자만인 번호는 위 정규식들이 맡는다)
 * - 뒷자리는 하이픈에 바로 붙어 있어야 한다. 뒷자리를 하나도 못 읽은 "760423-"는 뒤가 띄어쓰기·줄 끝일 때만 잡고,
 *   띄어 쓴 다음 낱말("760423- 서울특별시"의 "서울특별시")은 번호에 넣지 않는다.
 * - "." "/" "~"는 받지 않는다. 날짜("18.03.14"), 기간("180301~180331일")과 헷갈린다. (별표가 섞이면 위 정규식이 "~"도 받는다)
 * - 뒷자리 첫 글자가 한글이면 받지 않는다. ("180314-등기") 번호 앞 이름 찾기(NAME_BEFORE_ID_REGEX)와 같은 기준이다. (#291 리뷰)
 *   별표 뒤에 한글이 붙은 "680918-***져"는 위 MASKED_ID_LOOSE_REGEX가 찾는다.
 * - uncertain(사용자 확인 필요)이다.
 */
const MASKED_ID_GARBAGE_REGEX =
  /(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\s?[-–—](?:(?=[^\s가-힣])(?=[^\s]*[^\d\s-])([^\s]{1,12})|(?=\s|$))/g;

/**
 * 주민번호 모양의 번호가 법인등록번호인지 (바로 앞 글자로 판단)
 * @param {string} text
 * @param {number} start 번호가 시작하는 위치
 */
export function isCorporateNumber(text, start) {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const before = text.slice(Math.max(lineStart, start - CORPORATE_LOOKBACK), start);
  return CORPORATE_LABEL_BEFORE.test(before) || COMPANY_WORD_BEFORE.test(before);
}

/**
 * 주민등록번호와 외국인등록번호를 찾는다.
 * 뒷자리 첫 숫자가 5-8이면 외국인, 1-4면 내국인이다.
 * 체크섬은 검사하지 않는다. (2020년 10월 이후 번호는 체크섬이 맞지 않을 수 있음)
 * 아래 경우는 uncertain(사용자 확인 필요)으로 표시한다.
 * - 뒷자리가 전부 가려져 내국인/외국인을 구분할 수 없을 때 (예: 800101-*******)
 * - 구분 기호(- . /)가 없을 때 (13자리 계좌번호일 수도 있어서)
 * @param {string} text
 */
export function findIdNumbers(text) {
  const results = [];
  for (const match of text.matchAll(ID_NUMBER_REGEX)) {
    const hasSeparator = /[-./]/.test(match[1]);
    const firstBackDigit = match[2];
    const uncertain = firstBackDigit === '*' || !hasSeparator;
    if (isCorporateNumber(text, match.index ?? 0)) {
      // 법인등록번호: 개인정보 종류는 아니지만 주민번호 모양이라 가려야 보내기 전 검사(PART 4)를 통과한다 (#192, 팀 합의 A안)
      results.push({ type: PII_TYPE.REGISTRY_ID, value: match[0], start: match.index, end: match.index + match[0].length });
      continue;
    }
    results.push({
      type: '5678'.includes(firstBackDigit) ? PII_TYPE.FOREIGNER_ID : PII_TYPE.RESIDENT_ID,
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
      uncertain,
    });
  }
  // 뒷자리가 0·9로 시작하는 법인등록번호 (위 정규식이 못 찾는 것만)
  for (const match of text.matchAll(CORPORATE_NUMBER_REGEX)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (results.some((r) => start < r.end && r.start < end)) continue;
    if (!isCorporateNumber(text, start)) continue;
    results.push({ type: PII_TYPE.REGISTRY_ID, value: match[0], start, end });
  }
  // 별표 개수가 7개가 아닌 가려진 번호 (OCR, 위 두 정규식이 못 찾는 것만)
  for (const match of text.matchAll(MASKED_ID_LOOSE_REGEX)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (results.some((r) => start < r.end && r.start < end)) continue;
    const type = isCorporateNumber(text, start)
      ? PII_TYPE.REGISTRY_ID
      : '5678'.includes(match[1])
        ? PII_TYPE.FOREIGNER_ID
        : PII_TYPE.RESIDENT_ID;
    results.push({ type, value: match[0], start, end, uncertain: true });
  }
  // 뒷자리가 엉뚱한 글자로 읽힌 번호 (OCR, 위 정규식들이 못 찾는 것만)
  for (const match of text.matchAll(MASKED_ID_GARBAGE_REGEX)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (results.some((r) => start < r.end && r.start < end)) continue;
    const firstBack = (match[1] ?? '').charAt(0);
    const type = isCorporateNumber(text, start)
      ? PII_TYPE.REGISTRY_ID
      : /^[5-8]$/.test(firstBack)
        ? PII_TYPE.FOREIGNER_ID
        : PII_TYPE.RESIDENT_ID;
    results.push({ type, value: match[0].trimEnd(), start, end: start + match[0].trimEnd().length, uncertain: true });
  }
  return results.sort((a, b) => a.start - b.start);
}

/**
 * 여권번호를 찾는다.
 * @param {string} text
 */
export function findPassportNumbers(text) {
  return findByRegex(text, PASSPORT_REGEX, PII_TYPE.PASSPORT_ID);
}

/** @param {string} text */
export function findPhoneNumbers(text) {
  return [
    ...findByRegex(text, PHONE_INTL_REGEX, PII_TYPE.PHONE_NUMBER),
    ...findByRegex(text, PHONE_REGEX, PII_TYPE.PHONE_NUMBER),
  ];
}

/**
 * 등기 고유번호와 임대사업자 등록번호 (둘 다 REGISTRY_ID)
 * @param {string} text
 */
export function findRegistryIds(text, keywordText = text) {
  return [
    ...findByRegex(text, REGISTRY_ID_REGEX, PII_TYPE.REGISTRY_ID),
    ...findByRegex(text, RENTAL_BUSINESS_ID_REGEX, PII_TYPE.REGISTRY_ID),
    ...findByRegex(text, BUSINESS_ID_REGEX, PII_TYPE.REGISTRY_ID).filter((r) => !nearBankWord(keywordText, r)),
  ].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
}

/**
 * 번호 앞뒤에 은행 관련 단어가 있는지 (계좌번호 찾기와 같은 범위)
 * @param {string} keywordText
 * @param {{ start: number, end: number }} r
 */
function nearBankWord(keywordText, r) {
  const before = keywordText.slice(Math.max(0, r.start - BANK_KEYWORD_BEFORE), r.start);
  const after = keywordText.slice(r.end, r.end + BANK_KEYWORD_AFTER);
  return BANK_KEYWORD_REGEX.test(before) || BANK_KEYWORD_REGEX.test(after);
}

/**
 * 계좌번호를 찾는다. 숫자 개수가 10-16개이고, 앞이나 뒤에 은행 관련 단어가 있을 때만 인정한다.
 * @param {string} text
 * @param {string} [keywordText] 은행 단어를 찾을 글 (같은 길이). OCR 보정한 글로 번호를 찾을 때
 *   은행 단어는 원문에서 찾는다. ("IBK"가 "1BK"로 바뀌면 안 되므로)
 */
export function findBankAccounts(text, keywordText = text) {
  return findByRegex(text, BANK_CANDIDATE_REGEX, PII_TYPE.BANK_ACCOUNT).filter((r) => {
    const digitCount = r.value.replace(/\D/g, '').length;
    if (digitCount < 10 || digitCount > 16) return false;
    const before = keywordText.slice(Math.max(0, r.start - BANK_KEYWORD_BEFORE), r.start);
    const after = keywordText.slice(r.end, r.end + BANK_KEYWORD_AFTER);
    return BANK_KEYWORD_REGEX.test(before) || BANK_KEYWORD_REGEX.test(after);
  });
}

/*
 * 붙어서 읽힌 번호 (이슈 #166)
 * 휴대폰 앱으로 채운 계약서에서 두 칸의 값이 붙어 읽히는 경우가 있다.
 * 예: "900101-1234567800202-2345678" (주민번호 2개), "010-1111-2222010-3333-4444" (전화번호 2개)
 * 위 정규식은 앞뒤에 숫자가 붙어 있으면 잡지 않으므로(긴 계좌번호 오탐 방지) 둘 다 놓친다.
 * 그래서 숫자·*·하이픈이 이어진 덩어리를 앞에서부터 "주민번호(6-7)" 또는 "전화번호(3-4-4)" 모양으로
 * 빈틈없이 나눌 수 있을 때만 각각 번호로 본다. 나눠지지 않는 덩어리(계좌번호 등)는 건드리지 않는다.
 * 하이픈이 있는 모양만 본다. (하이픈 없는 긴 숫자는 계좌번호와 구분할 수 없어서)
 */
/** 숫자·*·하이픈 덩어리. 번호 두 개가 붙어야 하므로 하이픈이 2개 이상이어야 한다. */
const GLUED_RUN_REGEX = /(?<![\d*-])[\d*](?:[\d*-]*[\d*])?(?![\d*-])/g;
/** 덩어리 안의 한 조각 (y: 정해진 위치에서만 찾는다) */
const GLUED_ID_REGEX = /\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])-([1-8*])[\d*]{6}/y;
const GLUED_PHONE_REGEX = /(?:01[016-9]|02|03[1-3]|04[1-4]|05[1-5]|06[1-4]|070|050\d)-\d{3,4}-\d{4}/y;

/**
 * 덩어리 하나를 번호 조각으로 빈틈없이 나눈다. 나눌 수 없으면 null.
 * @param {string} run
 * @returns {{type: string, start: number, end: number}[] | null}
 */
function splitGluedRun(run) {
  const pieces = [];
  let pos = 0;
  while (pos < run.length) {
    GLUED_ID_REGEX.lastIndex = pos;
    GLUED_PHONE_REGEX.lastIndex = pos;
    const id = GLUED_ID_REGEX.exec(run);
    const phone = id ? null : GLUED_PHONE_REGEX.exec(run);
    if (id) {
      const type = '5678'.includes(id[1]) ? PII_TYPE.FOREIGNER_ID : PII_TYPE.RESIDENT_ID;
      pieces.push({ type, start: pos, end: pos + id[0].length });
      pos += id[0].length;
    } else if (phone) {
      pieces.push({ type: PII_TYPE.PHONE_NUMBER, start: pos, end: pos + phone[0].length });
      pos += phone[0].length;
    } else {
      return null;
    }
  }
  return pieces;
}

/**
 * 붙어서 읽힌 주민·외국인등록번호와 전화번호를 찾는다. 찾은 번호는 uncertain(확인 필요)이다.
 * 번호가 2개 이상 붙은 덩어리만 본다. (번호 하나짜리는 위 정규식이 찾는다)
 * @param {string} text
 */
export function findGluedNumbers(text) {
  const results = [];
  for (const match of text.matchAll(GLUED_RUN_REGEX)) {
    const run = match[0];
    if ((run.match(/-/g) ?? []).length < 2) continue;
    const pieces = splitGluedRun(run);
    if (!pieces || pieces.length < 2) continue;
    const base = match.index ?? 0;
    for (const p of pieces) {
      results.push({
        type: p.type,
        value: run.slice(p.start, p.end),
        start: base + p.start,
        end: base + p.end,
        uncertain: true,
      });
    }
  }
  return results;
}

/*
 * OCR이 숫자를 비슷한 글자로 잘못 읽은 번호 (이슈 #100)
 * 스캔 서류에서 OCR이 0을 O로, 1을 l로 읽으면("8OO1O1-1******") 위 정규식이 번호를 못 찾는다.
 * 사용자가 확인 단계에서 고치지 않고 넘어가면 번호가 AI 프롬프트에 그대로 남는다.
 * 그래서 번호를 찾을 때만 비슷한 글자를 숫자로 보고 한 번 더 찾는다.
 * - 한 글자를 한 글자로 바꿔서 위치(start/end)가 원문과 같다. 값은 원문 글자 그대로 돌려준다. (마스킹이 원래 글자를 덮도록)
 * - 원문으로 찾은 결과를 먼저 쓰고, 보정한 글에서 새로 찾은 것만 더한다.
 *   (글 전체를 바꾸면 "Tel010-…"의 l이 1이 되어 원래 찾던 번호를 놓친다)
 * - 새로 찾은 것은 uncertain(확인 필요)이다.
 * - 번호의 숫자 자리 중 진짜 숫자가 절반 이상일 때만 인정한다. (영어 글자만으로 된 오탐 방지)
 * - 여권번호는 앞글자가 영문(O 등)이라 보정하지 않는다.
 * - 생년월일(동일 인물 판정용)은 원문 그대로의 번호에서만 읽는다. (name-detector.js의 findIdNumbers, 추측한 숫자로 판단하지 않음)
 */
/** @type {Record<string, string>} OCR이 숫자 대신 자주 읽는 글자 → 숫자 */
const OCR_DIGIT_LOOKALIKES = { O: '0', o: '0', l: '1', I: '1', '|': '1' };
const OCR_LOOKALIKE_REGEX = /[OolI|]/g;
/** 글자가 하나라도 있는지만 볼 때 (g 없이: .test()가 이전 위치를 기억하지 않게) */
const HAS_OCR_LOOKALIKE = /[OolI|]/;
const MIN_REAL_DIGIT_RATIO = 0.5;

/**
 * 숫자처럼 생긴 글자를 숫자로 바꾼다. 글자 수는 그대로다.
 * @param {string} text
 */
function toOcrDigits(text) {
  return text.replace(OCR_LOOKALIKE_REGEX, (ch) => OCR_DIGIT_LOOKALIKES[ch]);
}

/**
 * 번호의 숫자 자리(진짜 숫자 + 숫자처럼 생긴 글자) 중 진짜 숫자가 충분한지
 * @param {string} value 원문 글자
 */
function hasEnoughRealDigits(value) {
  const real = (value.match(/\d/g) ?? []).length;
  const lookalike = (value.match(OCR_LOOKALIKE_REGEX) ?? []).length;
  return real > 0 && real / (real + lookalike) >= MIN_REAL_DIGIT_RATIO;
}

/**
 * 탐지 함수 하나에 OCR 보정 찾기를 더한다.
 * @param {(text: string, original: string) => {type: string, value: string, start: number, end: number, uncertain?: boolean}[]} find
 * @returns {(text: string) => {type: string, value: string, start: number, end: number, uncertain?: boolean}[]}
 */
function withOcrLookalikes(find) {
  return (text) => {
    const exact = find(text, text);
    const fixed = toOcrDigits(text);
    if (fixed === text) return exact;
    const extra = find(fixed, text)
      .map((r) => ({ ...r, value: text.slice(r.start, r.end), uncertain: true }))
      .filter((r) => HAS_OCR_LOOKALIKE.test(r.value) && hasEnoughRealDigits(r.value))
      .filter((r) => !exact.some((e) => r.start < e.end && e.start < r.end));
    return [...exact, ...extra];
  };
}

/**
 * 모든 정규식 탐지를 정해진 순서로 실행한다.
 * 구체적인 패턴을 먼저 찾고, 이미 찾은 구간과 겹치는 결과는 버린다.
 * 예: 등기 고유번호를 먼저 찾았으면, 같은 숫자를 계좌번호로 다시 잡지 않는다.
 * 숫자를 비슷한 글자로 잘못 읽은 번호(OCR)도 찾는다. (위 withOcrLookalikes 설명)
 * @param {string} text
 */
export function findPatternPII(text) {
  const finders = [
    findGluedNumbers, // 0. 붙어서 읽힌 주민번호·전화번호 (아래 정규식은 이 덩어리를 못 찾는다)
    withOcrLookalikes(findIdNumbers), // 1. 주민·외국인등록번호
    withOcrLookalikes(findRegistryIds), // 2. 등기 고유번호
    findPassportNumbers, // 3. 여권번호 (영문 앞글자라 보정 안 함)
    withOcrLookalikes(findPhoneNumbers), // 4. 전화번호
    withOcrLookalikes(findBankAccounts), // 5. 계좌번호 (가장 느슨하니까 마지막)
  ];
  /** @type {{type: string, value: string, start: number, end: number, uncertain?: boolean}[]} */
  const results = [];
  for (const find of finders) {
    for (const r of find(text)) {
      const overlaps = results.some((prev) => r.start < prev.end && prev.start < r.end);
      if (!overlaps) results.push(r);
    }
  }
  return results.sort((a, b) => a.start - b.start);
}