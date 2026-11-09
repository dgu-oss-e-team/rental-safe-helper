import { describe, it, expect } from 'vitest';
import {
  findLabeledNames,
  findAddresses,
  findPeople,
} from '../src/features/document-analysis/name-detector.js';
import { PII_TYPE } from '../src/shared/document-model.js';

// 모든 이름과 번호는 가짜다.

describe('PART 2 라벨 기반 이름 탐지', () => {
  it('임대인 뒤 이름을 찾고 역할을 붙인다', () => {
    const r = findLabeledNames('임대인 김철수 750315-1******');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ type: PII_TYPE.PERSON_NAME, value: '김철수', role: 'LANDLORD' });
  });

  it('찾은 위치(start, end)가 정확하다', () => {
    const text = '임대인 김철수 750315-1******';
    const r = findLabeledNames(text);
    expect(text.slice(r[0].start, r[0].end)).toBe('김철수');
  });

  it('외국인 영문 이름을 찾는다', () => {
    const r = findLabeledNames('임차인 NGUYEN VAN A 990505-5******');
    expect(r[0]).toMatchObject({ value: 'NGUYEN VAN A', role: 'TENANT' });
  });

  it('줄 중간의 예금주도 찾는다', () => {
    const r = findLabeledNames('입금 계좌 가상은행 000-000000-00000 예금주 김철수');
    expect(r[0]).toMatchObject({ value: '김철수', role: 'ACCOUNT_HOLDER' });
  });

  it('등기부 소유자를 찾는다', () => {
    expect(findLabeledNames('소유자 김철수 800101-1******')[0].role).toBe('OWNER');
  });

  it('"성명:"이 붙은 양식도 찾는다', () => {
    expect(findLabeledNames('임대인 성명: 이영희')[0].value).toBe('이영희');
  });

  it('OCR이 라벨 글자 사이에 공백을 넣어도 찾는다', () => {
    expect(findLabeledNames('임 대 인  박민수')[0].value).toBe('박민수');
  });

  it('문장 속 라벨은 이름으로 잡지 않는다', () => {
    expect(findLabeledNames('임대인과 임차인은 다음과 같이 합의한다')).toHaveLength(0);
    expect(findLabeledNames('임대인 및 임차인은 서명한다')).toHaveLength(0);
    expect(findLabeledNames('임대인 측은 수리 의무를 진다')).toHaveLength(0);
  });

  it('라벨 뒤가 항목 이름이면 잡지 않는다', () => {
    expect(findLabeledNames('임대인 주소 서울특별시 중구')).toHaveLength(0);
  });
});

describe('PART 2 주소 탐지', () => {
  it('라벨 있는 주소를 찾는다', () => {
    const r = findAddresses('소재지 서울특별시 중구 필동로 00, 101호');
    expect(r).toHaveLength(1);
    expect(r[0].value).toBe('서울특별시 중구 필동로 00, 101호');
  });

  it('등기부처럼 라벨 없는 주소도 찾는다', () => {
    expect(findAddresses('서울특별시 중구 필동로 00, 101호')).toHaveLength(1);
  });

  it('괄호 앞에서 끝낸다', () => {
    expect(findAddresses('경기도 수원시 팔달구 효원로 00 (인계동)')[0].value).toBe('경기도 수원시 팔달구 효원로 00');
  });

  it('시·군·구 없이 시·도 이름만 있으면 잡지 않는다', () => {
    expect(findAddresses('서울특별시 조례에 따라')).toHaveLength(0);
  });
});

describe('PART 2 사람 정보 (extractFields 재료)', () => {
  it('같은 줄의 주민번호에서 생년월일을 가져온다', () => {
    const r = findPeople('임대인 김철수 750315-1******');
    expect(r[0]).toMatchObject({ value: '김철수', role: 'LANDLORD', birthDate: '750315' });
  });

  it('외국인등록번호에서도 생년월일을 가져온다', () => {
    expect(findPeople('임차인 NGUYEN VAN A 990505-5******')[0].birthDate).toBe('990505');
  });

  it('번호가 없으면 생년월일은 null이다 (못 읽음 규칙)', () => {
    expect(findPeople('예금주 김철수')[0].birthDate).toBeNull();
  });

  it('이름 앞에 있는 번호는 쓰지 않는다', () => {
    expect(findPeople('계좌 000-000000-00000 예금주 김철수')[0].birthDate).toBeNull();
  });
});