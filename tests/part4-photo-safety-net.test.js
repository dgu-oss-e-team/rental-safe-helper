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
    ]) {
      expect(findPhotoLeftover(line), line).toBeNull();
    }
  });

  it('조사 글자로 끝나는 이름도 이름 칸 모양이면 찾는다 ("임차인 | 김지은 |", "예금주 이정의 (서명")', () => {
    for (const line of ['임차인 | 김지은 |', '예금주 이정의 (서명 또는 인)']) {
      expect(findPhotoLeftover(line), line).toBe('NAME');
    }
  });

  it('동 이름 괄호가 붙은 호수를 찾는다 (OCR이 502를 505로 읽어 원래 값과 비교로 안 잡히는 경우)', () => {
    for (const line of ['203호(가상동) |', '63, 505호(가상동,가[REDACTED]', '1103 호 (가상동)']) {
      expect(findPhotoLeftover(line), line).toBe('UNIT');
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
