import { describe, it, expect } from 'vitest';
import {
  findLabeledNames,
  findAddresses,
  findPeople,
  lastRoleIn,
  findAddressContinuation,
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

  it('영문 이름이 다음 줄까지 이어지지 않는다', () => {
    expect(findLabeledNames('임차인 NGUYEN VAN A\nTel 010')[0].value).toBe('NGUYEN VAN A');
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

describe('PART 2 서명란 "성명" 칸과 중개사', () => {
  it('혼자 있는 "성명" 칸 뒤 이름도 찾는다 (역할을 모르면 role은 null)', () => {
    const r = findLabeledNames('성명 김철수 서명또는날인');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ type: PII_TYPE.PERSON_NAME, value: '김철수', role: null });
  });

  it('"성명" 칸은 위쪽의 가장 최근 역할 라벨을 이어받는다 (표준계약서 서명란)', () => {
    const text =
      '임 대 인 주소 서울특별시 중구 필동로 00\n주민등록번호 750315-1****** 전화 010-0000-0000 성명 김철수\n' +
      '임 차 인 주소 서울특별시 중구 필동로 00\n외국인등록번호 990505-5****** 전화 010-0000-0000 성명 NGUYEN VAN A';
    const r = findLabeledNames(text);
    expect(r.map((p) => [p.value, p.role])).toEqual([
      ['김철수', 'LANDLORD'],
      ['NGUYEN VAN A', 'TENANT'],
    ]);
  });

  it('앞 블록에서 이어받은 역할을 쓴다', () => {
    expect(findLabeledNames('성명 김철수', 'LANDLORD')[0].role).toBe('LANDLORD');
  });

  it('글 안에 역할 라벨이 있으면 이어받은 역할보다 그걸 쓴다', () => {
    expect(findLabeledNames('임차인 주소 …\n성명 이영희', 'LANDLORD')[0].role).toBe('TENANT');
  });

  it('"임대인 성명: 이영희"는 한 번만 찾는다', () => {
    const r = findLabeledNames('임대인 성명: 이영희');
    expect(r).toHaveLength(1);
    expect(r[0].role).toBe('LANDLORD');
  });

  it('문장 속 라벨("임대인은")은 역할로 이어받지 않는다', () => {
    expect(findLabeledNames('임대인은 수리 의무를 진다\n성명 김철수')[0].role).toBeNull();
  });

  it('개업공인중개사 대표 이름을 찾는다', () => {
    const r = findLabeledNames('개업공인중개사 사무소명칭 가상공인중개사사무소 대표 홍길동');
    expect(r.map((p) => [p.value, p.role])).toEqual([['홍길동', 'BROKER']]);
  });

  it('"대표 이사"는 이름으로 잡지 않는다', () => {
    expect(findLabeledNames('대표 이사')).toHaveLength(0);
  });

  it('"공인중개사" 라벨 뒤 이름을 찾고, "개업공인중개사"와 겹쳐도 한 번만 찾는다', () => {
    expect(findLabeledNames('공인중개사 홍길동').map((p) => [p.value, p.role])).toEqual([['홍길동', 'BROKER']]);
    expect(findLabeledNames('개업공인중개사 홍길동')).toHaveLength(1);
  });

  it('중개사 칸의 항목 이름(사무소, 자격증, 소재지)은 이름으로 잡지 않는다', () => {
    expect(findLabeledNames('가상공인중개사 사무소')).toHaveLength(0);
    expect(findLabeledNames('공인중개사 자격증')).toHaveLength(0);
    expect(findLabeledNames('공인중개사 소재지 서울특별시 중구')).toHaveLength(0);
  });

  it('문장 속 "공인중개사는", "공인중개사법"은 잡지 않는다', () => {
    expect(findLabeledNames('공인중개사는 중개대상물을 확인한다')).toHaveLength(0);
    expect(findLabeledNames('공인중개사법에 따라')).toHaveLength(0);
  });

  it('lastRoleIn: 글의 마지막 역할을 돌려주고, 없으면 이어받은 역할을 그대로 돌려준다', () => {
    expect(lastRoleIn('임대인 주소 …\n임차인 주소 …')).toBe('TENANT');
    expect(lastRoleIn('주민등록번호 …', 'LANDLORD')).toBe('LANDLORD');
    expect(lastRoleIn('특약사항')).toBeNull();
  });

  it('findPeople도 "성명" 칸 이름에 이어받은 역할을 붙인다', () => {
    expect(findPeople('성명 김철수', 'LANDLORD')[0]).toMatchObject({ value: '김철수', role: 'LANDLORD' });
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

  it('줄여 쓴 시·도 이름도 찾는다', () => {
    expect(findAddresses('소재지 서울 중구 필동로 00')[0].value).toBe('서울 중구 필동로 00');
    expect(findAddresses('경기 수원시 팔달구 효원로 00')[0].value).toBe('경기 수원시 팔달구 효원로 00');
    expect(findAddresses('광주 북구 용봉로 00')[0].value).toBe('광주 북구 용봉로 00');
  });

  it('"광주시"로 시작하는 주소는 어느 광주든 찾는다 (구분은 하지 않는다)', () => {
    expect(findAddresses('광주시 북구 용봉로 00')[0].value).toBe('광주시 북구 용봉로 00');
    expect(findAddresses('광주시 오포읍 00')).toHaveLength(0); // 읍·면은 아직 시·군·구로 안 봄
  });

  it('약칭과 겹치는 일상 단어는 주소로 잡지 않는다', () => {
    expect(findAddresses('경기 도구를 챙긴다')).toHaveLength(0);
    expect(findAddresses('경기 지시에 따라')).toHaveLength(0);
    expect(findAddresses('남서울 중구')).toHaveLength(0);
  });
});

describe('PART 2 조사가 붙은 주소', () => {
  it('시·군·구 뒤에 조사가 붙어도 주소로 찾고, 값은 조사 앞까지만 잡는다', () => {
    expect(findAddresses('서울 강남구에서 계약한다')[0].value).toBe('서울 강남구');
    expect(findAddresses('서울특별시 중구에 있는 집')[0].value).toBe('서울특별시 중구');
    expect(findAddresses('경기도 수원시의 아파트')[0].value).toBe('경기도 수원시');
    expect(findAddresses('서울 중구로 이사했다')[0].value).toBe('서울 중구');
    expect(findAddresses('부산광역시 해운대구는 넓다')[0].value).toBe('부산광역시 해운대구');
  });

  it('값의 start·end가 조사 앞에서 끝난다', () => {
    const text = '임차인은 서울 강남구에서 산다';
    const [a] = findAddresses(text);
    expect(text.slice(a.start, a.end)).toBe('서울 강남구');
  });

  it('조사가 없는 기존 주소는 그대로 줄 끝까지 잡는다', () => {
    expect(findAddresses('서울특별시 중구 필동로 00, 101호')[0].value).toBe('서울특별시 중구 필동로 00, 101호');
  });

  it('조사가 아닌 글자가 붙은 단어는 주소로 보지 않는다', () => {
    expect(findAddresses('서울 마포구청 앞')).toHaveLength(0);
  });

  it('일상 단어와 겹치는 약칭(경기·대구·세종)은 조사가 붙어도 주소로 보지 않는다', () => {
    expect(findAddresses('경기 지시에 따라')).toHaveLength(0);
    expect(findAddresses('대구 지시에 따라')).toHaveLength(0);
    expect(findAddresses('세종 지시에 따라')).toHaveLength(0);
  });
});

describe('PART 2 붙여 쓴 주소 (이슈 #72)', () => {
  it('시·도로 끝나는 이름 뒤에 시·군·구가 붙어 있어도 주소로 찾는다 (값은 원문 그대로)', () => {
    expect(findAddresses('소재지 서울특별시중구 필동로 00, 101호')[0].value).toBe('서울특별시중구 필동로 00, 101호');
    expect(findAddresses('경기도수원시 팔달구 효원로 00')[0].value).toBe('경기도수원시 팔달구 효원로 00');
    expect(findAddresses('서울시중구 필동로 00')[0].value).toBe('서울시중구 필동로 00');
    expect(findAddresses('경기도광주시 오포읍 00')[0].value).toBe('경기도광주시 오포읍 00');
  });

  it('붙여 쓴 주소 뒤에 조사가 붙어도 조사 앞까지 찾는다', () => {
    expect(findAddresses('서울특별시중구에서 계약한다')[0].value).toBe('서울특별시중구');
  });

  it('줄여 쓴 이름("서울", "경기")은 붙여 쓰면 주소로 보지 않는다 (일상 문장과 헷갈림)', () => {
    expect(findAddresses('서울중구 필동로 00')).toHaveLength(0);
    expect(findAddresses('경기수원시 00')).toHaveLength(0);
  });

  it('시·도 이름 뒤에 붙은 다른 단어는 주소가 아니다', () => {
    expect(findAddresses('서울시청 앞에서 만나자')).toHaveLength(0);
    expect(findAddresses('경기도교육청 공문')).toHaveLength(0);
    expect(findAddresses('제주도시 여행')).toHaveLength(0);
    expect(findAddresses('부산시민 모두')).toHaveLength(0);
  });
});

describe('PART 2 시·군·구로 끝나는 일상 단어 (이슈 #72)', () => {
  it('일상 단어는 시·도 이름 뒤에 와도 주소로 보지 않는다', () => {
    expect(findAddresses('서울 친구와 함께 산다')).toHaveLength(0);
    expect(findAddresses('서울 친구 집에서 지낸다')).toHaveLength(0);
    expect(findAddresses('부산 가구를 옮긴다')).toHaveLength(0);
    expect(findAddresses('인천 입구에서 만나자')).toHaveLength(0);
    expect(findAddresses('서울 역시 비싸다')).toHaveLength(0);
    expect(findAddresses('서울 다시 가자')).toHaveLength(0);
    expect(findAddresses('부산 도시는 크다')).toHaveLength(0);
  });

  it('진짜 시·군·구는 그대로 찾는다 (중구·동구·남구처럼 짧은 이름 포함)', () => {
    expect(findAddresses('서울 중구 필동로 00')[0].value).toBe('서울 중구 필동로 00');
    expect(findAddresses('부산 동구에서 계약한다')[0].value).toBe('부산 동구');
    expect(findAddresses('인천광역시 남동구 00')[0].value).toBe('인천광역시 남동구 00');
    expect(findAddresses('경기도 시흥시 00')[0].value).toBe('경기도 시흥시 00');
  });

  it('일상 단어로 시작하는 긴 단어는 막지 않는다 (단어 전체가 같을 때만 뺀다)', () => {
    expect(findAddresses('경기도 도구시 00')[0].value).toBe('경기도 도구시 00'); // 가상의 지명
  });

  it('두 줄 주소의 아랫줄이 일상 단어로 시작하면 주소 조각으로 보지 않는다', () => {
    expect(findAddressContinuation('친구 집에서 지낸다', true)).toBeNull();
    expect(findAddressContinuation('중구 필동로 00', true)?.value).toBe('중구 필동로 00');
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

  it('다음 줄 사람의 번호는 가져오지 않는다', () => {
    const r = findPeople('예금주 김철수\n임대인 이영희 750315-2******');
    expect(r[0]).toMatchObject({ value: '김철수', birthDate: null });
    expect(r[1]).toMatchObject({ value: '이영희', birthDate: '750315' });
  });

  it('같은 줄의 다음 사람 번호는 가져오지 않는다', () => {
    const r = findPeople('임대인 김철수 임차인 이영희 750315-2******');
    expect(r[0]).toMatchObject({ value: '김철수', birthDate: null });
    expect(r[1]).toMatchObject({ value: '이영희', birthDate: '750315' });
  });
});