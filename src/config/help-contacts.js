// @ts-check
/**
 * PART 3. 결과 카드의 "도움받을 곳" 연락처 (#377)
 * 연락처는 이 파일에서만 바꾼다. 코드(risk-result-ui.js 등)에 번호를 직접 쓰지 않는다.
 * STOP·CHECK 카드에만 보여 준다.
 *
 * 공식 사이트 확인일: 2026-11-27
 *  - 1345: 법무부 출입국·외국인정책본부 안내 페이지 (20개 언어, 평일 09:00~22:00, 18시 이후는 한국어·영어·중국어)
 *  - 132: 법무부 법률구조제도 안내, 대한법률구조공단(klac.or.kr). 외국어 상담 지원은 확인하지 못해서 적지 않았다.
 */

export const HELP_CONTACTS_VERIFIED = '2026-11-27';

/** @type {{ id: string, name: string, phone: string | null, note: string }[]} */
export const HELP_CONTACTS = [
  {
    id: 'immigration-1345',
    name: 'Immigration Contact Center (1345)',
    phone: '1345',
    note: 'Counseling in 20 languages, including English. Weekdays 09:00–22:00 (after 18:00: Korean, English and Chinese only).',
  },
  {
    id: 'klac-132',
    name: 'Korea Legal Aid Corporation (132)',
    phone: '132',
    note: 'Free legal advice by phone, in Korean. Weekdays about 09:00–17:50.',
  },
  {
    id: 'school-international-office',
    name: 'The international student office at your school',
    phone: null,
    note: 'Ask them for advice or for someone who can help you in your language.',
  },
];
