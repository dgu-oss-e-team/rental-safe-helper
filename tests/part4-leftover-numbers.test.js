// PART 4. 이중 안전장치: 탐지 목록과 상관없이 번호 모양이 남아 있으면 멈춘다 (실제 양식 서류 점검에서 발견)
// 예시는 모두 가짜 값이다.
import { describe, it, expect } from 'vitest';
import { findLeftoverNumber } from '../src/features/masking/masking-validator.js';
import { validateMaskedText } from '../src/features/masking/index.js';
import { MASKING_ACTION, MASKING_PURPOSE } from '../src/shared/document-model.js';

const EMPTY_PLAN = { purpose: MASKING_PURPOSE.FRAUD_CHECK, items: [] };

describe('PART 4 이중 안전장치: 남아 있으면 안 되는 번호 모양 (findLeftoverNumber)', () => {
  it('입력칸이 겹쳐 두 값이 붙어 읽힌 주민번호·휴대폰 번호도 찾는다', () => {
    expect(findLeftoverNumber('주민등록번호 900101-1234567800202-2345678')).not.toBeNull();
    expect(findLeftoverNumber('전화번호 010-1111-2222010-3333-4444')).not.toBeNull();
  });

  it('라벨 다음 줄의 "이름 + 주민번호"는 이름이 탐지되지 않았어도 주민번호 모양에서 멈춘다', () => {
    expect(findLeftoverNumber('홍길동 800101-*******')).toBe('800101-*******');
  });

  it('사진 OCR로 별표 개수가 틀린 주민번호("760423-******")도 찾는다 (별표 1개 이상, PART 2 #270과 같은 기준)', () => {
    for (const text of ['760423-******', '690812-*****', '680918-***져', '760423-*', '760423-********', '760423-1*****', '760423 - ******', '홍길동760423-******']) {
      expect(findLeftoverNumber(`주민등록번호 ${text}`), text).not.toBeNull();
    }
    // 숫자만 있고 7자리가 아니면 계좌번호 등과 헷갈려 찾지 않는다
    expect(findLeftoverNumber('관리번호 123456-1234')).toBeNull();
    expect(findLeftoverNumber('지번 123456-12')).toBeNull();
    // 이미 가린 자리
    expect(findLeftoverNumber('주민등록번호 [REDACTED]')).toBeNull();
  });

  it('보내기 전 검사: 탐지되지 않은 "760423-******"가 남으면 멈춘다', () => {
    const r = validateMaskedText({ D: '임대인 [Landlord_A] 760423-******' }, [], EMPTY_PLAN);
    expect(r.ok).toBe(false);
  });

  it('사진 OCR로 주소 탐지가 놓친 집 주소("서물특별시 … 가상로 30, 2층 204호")도 찾는다', () => {
    for (const text of [
      '서물특별시 중구 가상로 30, 2층 204호(가상동)',
      '경기도 고양시 일산동구 가상로 1234, 101동 1001호',
      '서울특별시 송파구 가상동 123-4 가상아파트 101동 1001호',
      '가상길 7-2 302호',
    ]) {
      expect(findLeftoverNumber(text), text).not.toBeNull();
    }
    // 시·구까지만 남긴 주소, 이미 가린 주소, 호수만 있는 줄, 조항 번호는 멈추지 않는다
    for (const text of [
      '[집합건물] 서울특별시 중구',
      '임차주택 [REDACTED]',
      '1동의 건물의 표시 제7층 제702호',
      '제10조 제1항 제3호에 따라 해지할 수 있다',
      '보증금 금10,000,000원 월세 금650,000원',
    ]) {
      expect(findLeftoverNumber(text), text).toBeNull();
    }
  });

  it('보내기 전 검사: 탐지되지 않은 집 주소가 남으면 멈춘다', () => {
    const r = validateMaskedText({ D: '임차인 주소 서물특별시 중구 가상로 30, 2층 204호(가상동)' }, [], EMPTY_PLAN);
    expect(r.ok).toBe(false);
  });

  it('외국인등록번호, 휴대폰 번호(하이픈 없이)도 찾는다', () => {
    expect(findLeftoverNumber('외국인등록번호 990505-5123456')).toBe('990505-5123456');
    expect(findLeftoverNumber('연락처 01012345678')).toBe('01012345678');
  });

  it('계좌번호는 계좌·은행·입금 같은 말 근처에 있을 때만 찾는다', () => {
    expect(findLeftoverNumber('입금계좌 가상은행 110-123-456789')).toBe('110-123-456789');
    expect(findLeftoverNumber('사업자등록번호 120-45-67890')).toBeNull();
    expect(findLeftoverNumber('중개사무소 등록번호 제11680-2019-00123호')).toBeNull();
  });

  it('가린 글, 날짜, 금액, 면적, 등기 고유번호, 가명은 번호로 보지 않는다', () => {
    for (const line of [
      '임대인 [Landlord_B] 주민등록번호 [REDACTED] 연락처 [REDACTED]',
      '계약일 2026-08-03 잔금일 2026.09.30',
      '보증금 금50,000,000원 월세 금500,000원 채권최고액 금120,000,000원',
      '전용면적 33.00㎡ 대지권비율 1234.5분의 33.21',
      '고유번호 1101-2019-012345',
      '소유자 [PrevOwner_E] 채무자 [PrevOwner_E?]',
    ]) {
      expect(findLeftoverNumber(line), line).toBeNull();
    }
  });
});

describe('PART 4 이중 안전장치: 보내기 전 검사 (validateMaskedText)', () => {
  it('탐지 목록이 비어 있어도 번호 모양이 남아 있으면 멈추고, 메시지에 값은 넣지 않는다', () => {
    const r = validateMaskedText({ DOC_L: '임차인 성명 [REDACTED]\n주민등록번호 900101-1234567800202-2345678' }, [], EMPTY_PLAN);
    expect(r.ok).toBe(false);
    expect(r.error.message).toContain('looks like personal information');
    expect(r.error.message).not.toMatch(/\d{6}/);
  });

  it('번호 모양이 없으면 그대로 통과한다', () => {
    expect(validateMaskedText({ DOC_L: '주민등록번호 [REDACTED]\n연락처 [REDACTED]' }, [], EMPTY_PLAN).ok).toBe(true);
  });

  it('일부러 남긴 자리(가명·사용자가 보여 준 값) 안의 글자는 빼고 본다', () => {
    // 사용자가 보여 주기로 한 글자 안에 번호 모양이 있어도 그 자리는 검사하지 않는다 (예: 메모처럼 보여 준 값)
    const finding = { id: 'F1', type: 'ADDRESS', value: '가상빌딩 010-1234-5678호', documentId: 'DOC_L', blockId: 'B1', pageIndex: 0, bbox: { x: 0, y: 0, width: 1, height: 0.1 } };
    const plan = { purpose: MASKING_PURPOSE.FRAUD_CHECK, items: [{ findingId: 'F1', action: MASKING_ACTION.KEEP, replacement: null }] };
    expect(validateMaskedText({ DOC_L: '주소 가상빌딩 010-1234-5678호' }, [finding], plan).ok).toBe(true);
  });
});
