// PART 4. 보내기 전 검사: 사진(OCR) 서류에서만 보는 안전망 (상욱님 가짜세트4 사진 점검)
// PART 2가 OCR 오독으로 놓친 "역할 낱말 옆 이름", "동 이름이 붙은 호수"가 가린 글에 남으면 멈춘다. 예시는 모두 가짜 값이다.
import { describe, it, expect } from 'vitest';
import { findPhotoLeftover, validateMaskedText } from '../src/features/masking/masking-validator.js';
import { analyzeReadDocuments, prepareForAi } from '../src/app/pipeline.js';
import { MASKING_PURPOSE, SOURCE_TYPE } from '../src/shared/document-model.js';

const EMPTY_PLAN = { purpose: MASKING_PURPOSE.FRAUD_CHECK, items: [] };

describe('PART 4 사진 서류 안전망 (findPhotoLeftover)', () => {
  it('역할 낱말 바로 옆에 남은 이름 모양을 찾는다 (표 칸 선을 "|", "⎸"로 읽어도)', () => {
    for (const line of ['개업공인 ⎸ 김삿갓 ⎸ GLEE]', '임차인 | 홍길동 |', '예금주: 이가상', '대표자 남궁가상', '임대사업자 박가상 (서명 또는 인)']) {
      expect(findPhotoLeftover(line), line).toBe('NAME');
    }
  });

  it('역할 낱말 뒤의 서식 낱말·문장 낱말·회사 이름·가명은 이름으로 보지 않는다', () => {
    for (const line of [
      '임대사업자와 임차인 간에 합의가 이루어지지 않은 경우',
      '임차인 주소 [REDACTED]',
      '임대인 성명',
      '임대사업자 등록번호',
      '임차인 전입신고',
      '임대인 가상리츠 주식회사',
      '임차인 [Tenant_A]',
    ]) {
      expect(findPhotoLeftover(line), line).toBeNull();
    }
  });

  it('평범한 계약 문구는 이름으로 보지 않는다 (#310 리뷰: 뒤에 한글 낱말이 이어지거나 조사로 끝나는 낱말)', () => {
    for (const line of [
      '수리비는 임차인 부담으로 한다',
      '임차인 명의로 전입한다',
      '임대인 소유의 주택',
      '임대인 사정으로 해지',
      '공유자 전원의 동의',
      '임차인 우선 변제',
      '임대인 본인',
      '임차인 지정 계좌',
      '임대인 변경 시',
      '임차인 부담',
      '임대인 동의 없이',
      '임차인 서명란',
      '임대인 주소지',
      '임대인 소유의',
      // 사진 OCR은 문장 중간에서 줄이 끊긴다: 줄 끝 "○○이·가"도 제외 목록 낱말이면 문장 (#328 리뷰)
      '임대인 동의가',
      '임차인 부담이',
      '임대인 명의가',
      '임차인 전원이',
      '잔금 지급 시 임대인 사정이',
      '소유자 변경이',
      '임대인 공동이',
      '임차인 가족이',
      '임차인 주소가',
      '임대인 지위가',
      '임대인 신탁이',
    ]) {
      expect(findPhotoLeftover(line), line).toBeNull();
    }
  });

  it('조사 글자로 끝나는 이름도 이름 칸 모양이거나 줄 끝의 "이·가"면 찾는다 ("임차인 | 김지은 |", "임차인 왕리웨이")', () => {
    for (const line of ['임차인 | 김지은 |', '예금주 이정의 (서명 또는 인)', '임차인 왕리웨이', '임대인 김가']) {
      expect(findPhotoLeftover(line), line).toBe('NAME');
    }
  });

  it('동 이름 괄호가 붙은 호수를 찾는다 (OCR이 502를 505로 읽어 원래 값과 비교로 안 잡히는 경우)', () => {
    for (const line of ['203호(가상동) |', '63, 505호(가상동,가[REDACTED]', '1103 호 (가상동)']) {
      expect(findPhotoLeftover(line), line).toBe('UNIT');
    }
  });

  it('한 글자씩 띄어 읽은 집 주소를 찾는다 (사진 평가 세트 #321 OCR 줄, 괄호 안이 띄어져도)', () => {
    expect(findPhotoLeftover('주택 소재지 _ ㅣ 서 물 특 별시 중구 가 상 동 2 가 47-12 기 싱 하우스')).toBe('ADDRESS');
    expect(findPhotoLeftover('서 울 특별시 동대문구 가 상 로 21, 1 층 ( 가 상 동)')).toBe('ADDRESS');
    expect(findPhotoLeftover('서 울 특별시 동대문구 가 상 로17길 9')).toBe('ADDRESS');
    expect(findPhotoLeftover('주택 소재지 _ | 서 울 특별시 동대문구 가 상 동 2125 가 상 스테이')).toBe('ADDRESS');
    expect(findPhotoLeftover('경 기 도 고양시 일산동구 가 상 로 1234')).toBe('ADDRESS');
    // 괄호 안이 띄어진 호수 "502 호 ( 가 상 동"
    expect(findPhotoLeftover('(대표 사무소 소재 서 울 특별시 성북구 가 상 로 63, 502 호 ( 가 상 동 , 가 상 맨션)')).toBe('UNIT');
  });

  it('시·도 이름이 깨지거나 빠진 주소 조각을 찾는다 (#337, #335 리뷰 후속, 사진 평가 세트)', () => {
    // OCR이 "서울특별시"를 "특변시"로 읽어 시·도가 사라진 줄
    expect(findPhotoLeftover('ee = EL 0 가상동2가 47-1')).toBe('ADDRESS');
    expect(findPhotoLeftover('중구 가상동2가 47-12')).toBe('ADDRESS');
    expect(findPhotoLeftover('동대문구 가상로17길 9')).toBe('ADDRESS');
    expect(findPhotoLeftover('근저당권자 주식회사가상은행 중구 가 상 대로 100')).toBe('ADDRESS');
    expect(findPhotoLeftover('가 상 로 63-5')).toBe('ADDRESS');
    // 군 + 리, 리 + 하이픈 지번 (#337)
    expect(findPhotoLeftover('양평군 가 상 리 12')).toBe('ADDRESS');
    expect(findPhotoLeftover('소재지 가상리 123-4')).toBe('ADDRESS');
  });

  it('구·동 이름이 있어도 번지 숫자가 없거나 숫자 동이면 주소 조각으로 보지 않는다', () => {
    for (const line of [
      '서울특별시 동대문구 2층 168.54㎡',
      '[집합건물] 서울특별시 동대문구',
      '[Owner_A]의 주소 서울특별시 성북구',
      '가상아파트 101동 1203호',
      '구분 임대보증금 월임대료',
      '공동담보 지분 전부',
      '시ㆍ군ㆍ자치구의 조례로 해당 시ㆍ군ㆍ자치구에서 적용하는 비율',
      '특별자치도지사ㆍ시장ㆍ군수ㆍ구청장이 인정하는 경우',
      '관리비는 월 6만 원으로 하며, 매월 말일까지 낸다.',
      // 특약 문장: 날짜 하이픈, 숫자 뒤 기간 단위 (#339 리뷰)
      '임대차기간은 인도일로 2026-12-01 부터',
      '임대인은 임차인에게 계좌로 2-3일 내 반환',
      '임차인의 요구사항대로 1개월 전 통지',
      '요구사항대로 2-3일 내 처리',
      '연락처 가상로 010-1234-5678',
      '열람일시 : 2026년11월21일 16시18분44초 1/3',
      '등록번호 [REDACTED] 전화번호 [REDACTED]',
    ]) {
      expect(findPhotoLeftover(line), line).toBeNull();
    }
  });

  it('시·구까지만 남긴 주소, 법령 문구는 주소로 보지 않는다', () => {
    for (const line of [
      '[집합건물] 서울특별시 중구',
      '1 1. 서울특별시 중구 2018년3월14일 등기',
      '서울특별시 동대문구 철근콘크리트구조',
      '이전 제40517호 매매 서울특별시 서초구',
      '택 이 소재한 특별시, 광역시, 특 별 자 치 시 도 또는 특 별 자 치 도 의 주 택 임차료',
      '1 특 별 자 치 도 지 사 ㆍ 특 별 자 치 시 장 ㆍ 시장 ㆍ 군 수 ㆍ 구 청 장 이 민 간 임 대 주 택 에 거 주 하기',
    ]) {
      expect(findPhotoLeftover(line), line).toBeNull();
    }
  });

  it('서식 번호·법령 번호·호수만 있는 줄은 찾지 않는다', () => {
    for (const line of ['■ 민간임대주택에 관한 특별법 시행규칙 [별지 제24호서식]', '제49조제7항제1호에 따라', '제1호(가목)', '1동의 건물의 표시 제7층 제702호']) {
      expect(findPhotoLeftover(line), line).toBeNull();
    }
  });
});

describe('PART 4 사진 서류 안전망 (validateMaskedText)', () => {
  const text = { PHOTO: '개업공인 ⎸ 김삿갓 ⎸ GLEE]', TEXT: '개업공인 ⎸ 김삿갓 ⎸ GLEE]' };

  it('사진 서류에 남아 있으면 멈춘다', () => {
    const r = validateMaskedText({ PHOTO: text.PHOTO }, [], EMPTY_PLAN, undefined, { photoDocumentIds: ['PHOTO'] });
    expect(r.ok).toBe(false);
  });

  it('글자 PDF는 보지 않는다 (서식 문구가 많아 잘못 멈추기 쉽고, PART 2 탐지가 정확하다)', () => {
    expect(validateMaskedText({ TEXT: text.TEXT }, [], EMPTY_PLAN).ok).toBe(true);
    expect(validateMaskedText({ TEXT: text.TEXT }, [], EMPTY_PLAN, undefined, { photoDocumentIds: ['PHOTO'] }).ok).toBe(true);
  });

  it('전체 흐름: 사진 계약서에 남은 호수가 있으면 prepareForAi가 멈추고, 같은 글자 PDF는 통과한다', () => {
    const lines = ['표준임대차계약서', '임대인 성명 [표 칸]', '주택 소재지 가상시 203호(가상동) |'];
    const doc = (sourceType) => ({
      documentId: 'L',
      fileName: 'L.pdf',
      sourceType,
      pages: [{ pageIndex: 0, width: 595, height: 842, blocks: lines.map((t, i) => ({
        blockId: `b${i}`, text: t, bbox: { x: 0.1, y: (i + 1) / 5, width: 0.8, height: 0.01 }, confidence: sourceType === SOURCE_TYPE.TEXT_PDF ? null : 0.9,
      })) }],
    });
    for (const [sourceType, expected] of [[SOURCE_TYPE.IMAGE_PDF, false], [SOURCE_TYPE.IMAGE, false], [SOURCE_TYPE.TEXT_PDF, true]]) {
      const a = analyzeReadDocuments({ files: [], documents: [doc(sourceType)] }).data;
      expect(prepareForAi(a, MASKING_PURPOSE.FRAUD_CHECK).ok, sourceType).toBe(expected);
    }
  });
});
