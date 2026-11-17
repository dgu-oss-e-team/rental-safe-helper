// @ts-check
/**
 * PART 5. "같은 사람인가요?" 질문을 같은 두 사람마다 한 번만 보이고, 답을 화면과 맞춘다. (#171, #164)
 *
 * PART 4 buildPersonQuestions()는 확인이 필요한(AMBIGUOUS) 사람마다 질문을 만든다.
 * 그래서 A와 C가 둘 다 확인 필요면 A 카드에서 C를, C 카드에서 또 A를 묻는다 (같은 질문 두 번).
 * 여기서는 원래 질문 목록과 답을 받아 화면에 보일 질문만 고른다. (PART 4 질문 계산은 그대로 둔다)
 *
 * 규칙 (앞 순서 = PART 4 질문 순서)
 * - 두 사람의 질문은 앞 사람 카드에서만 묻는다. 뒤 사람 카드에서는 앞 사람 후보를 뺀다.
 *   - 단, 앞 사람이 "다른 후보와 같다"고 답했으면 두 사람 사이는 아직 모르므로 뒤 카드에 다시 보인다.
 * - 후보가 하나도 남지 않은 카드는 숨긴다. 그 사람의 답은 앞 카드의 답으로 정해진다.
 *   - 앞 사람이 "이 사람과 같다" → 둘이 합쳐진다 (따로 답할 필요 없음)
 *   - 앞 사람이 모두 "다른 사람" → 이 사람도 "다른 사람"으로 본다 (impliedAnswers, 저장하지 않고 계산할 때만 더함)
 *   - 앞 사람이 아직 안 답함 → 이 사람도 아직 안 답함
 * - 숨긴 카드의 답, 화면에 없는 후보를 가리키는 답은 지운다 (엇갈린 답 방지: A는 "C와 다른 사람", C는 "A와 같다").
 *
 * 이름은 다루지 않는다 (질문 객체를 그대로 넘긴다). 계산만 하고 화면은 그리지 않는다.
 */

/** @typedef {import('../features/masking/person-answers.js').PersonQuestion} PersonQuestion */
/** @typedef {Record<string, string | null>} PersonAnswers */

/**
 * 보일 질문과 숨긴 질문을 나눈다.
 * @param {PersonQuestion[]} questions  PART 4 buildPersonQuestions() 결과 (원래 판정 기준)
 * @param {PersonAnswers} answers
 * @returns {{ shown: PersonQuestion[], hidden: { personId: string, coveredBy: string[] }[] }}
 */
function layout(questions, answers) {
  /** @type {Map<string, PersonQuestion>} */
  const shownById = new Map();
  /** @type {PersonQuestion[]} */
  const shown = [];
  /** @type {{ personId: string, coveredBy: string[] }[]} */
  const hidden = [];

  for (const q of questions) {
    /** @type {string[]} 이 사람과의 질문을 대신 묻는 앞 카드 */
    const coveredBy = [];
    const candidates = q.candidates.filter((c) => {
      const earlier = shownById.get(c.personId);
      // 앞 카드가 없거나, 앞 카드에서 이 사람을 묻지 않으면 여기서 묻는다
      if (!earlier || !earlier.candidates.some((x) => x.personId === q.personId)) return true;
      const a = answers[c.personId];
      // 앞 사람이 다른 후보와 같다고 답했으면 두 사람 사이는 아직 모른다 → 여기서 다시 묻는다
      if (typeof a === 'string' && a !== q.personId) return true;
      coveredBy.push(c.personId);
      return false;
    });
    // 처음부터 후보가 없던 카드("다른 사람 / 모름"만 있음)는 그대로 보인다. 앞 카드가 대신 물어서 후보가 다 빠진 카드만 숨긴다.
    if (candidates.length > 0 || coveredBy.length === 0) {
      const visible = { ...q, candidates };
      shownById.set(q.personId, visible);
      shown.push(visible);
    } else {
      hidden.push({ personId: q.personId, coveredBy });
    }
  }
  return { shown, hidden };
}

/**
 * 화면에 보일 질문 (같은 두 사람은 한 번만)
 * @param {PersonQuestion[]} questions
 * @param {PersonAnswers | null | undefined} answers
 * @returns {PersonQuestion[]}
 */
export function visiblePersonQuestions(questions, answers) {
  return layout(questions, answers ?? {}).shown;
}

/**
 * 답을 화면과 맞춘다.
 * - answers: 저장할 답 (숨긴 카드의 답, 화면에 없는 후보를 가리키는 답을 뺌)
 * - effective: 위험 점검에 쓸 답 (answers + 숨긴 카드의 "다른 사람" 답)
 * 질문이 없는 사람의 답(예: 이미 확인된 사람)은 건드리지 않는다 → PART 4 applyPersonAnswers가 그대로 실패시킨다.
 * @param {PersonQuestion[]} questions
 * @param {PersonAnswers | null | undefined} answers
 * @returns {{ answers: PersonAnswers, effective: PersonAnswers }}
 */
export function settlePersonAnswers(questions, answers) {
  /** @type {PersonAnswers} */
  const kept = { ...(answers ?? {}) };
  // 답을 지우면 뒤 카드가 보이거나 숨겨질 수 있으므로, 더 지울 것이 없을 때까지 반복한다 (질문 수만큼이면 충분)
  for (let i = 0; i <= questions.length; i++) {
    const { shown, hidden } = layout(questions, kept);
    let removed = false;
    for (const h of hidden) {
      if (h.personId in kept) {
        delete kept[h.personId];
        removed = true;
      }
    }
    for (const q of shown) {
      const a = kept[q.personId];
      if (typeof a === 'string' && !q.candidates.some((c) => c.personId === a)) {
        delete kept[q.personId];
        removed = true;
      }
    }
    if (!removed) break;
  }

  /** @type {PersonAnswers} */
  const effective = { ...kept };
  for (const h of layout(questions, kept).hidden) {
    if (h.coveredBy.length > 0 && h.coveredBy.every((id) => kept[id] === null)) effective[h.personId] = null;
  }
  return { answers: kept, effective };
}

/**
 * 결과 화면 안내용 개수: 보이는 질문 수, 그중 답한 수
 * @param {PersonQuestion[]} questions
 * @param {PersonAnswers | null | undefined} answers
 */
export function countPersonQuestions(questions, answers) {
  const shown = visiblePersonQuestions(questions, answers);
  const a = answers ?? {};
  return { asked: shown.length, answered: shown.filter((q) => q.personId in a).length };
}
