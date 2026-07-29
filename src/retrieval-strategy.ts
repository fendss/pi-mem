export type EvidenceFocus =
  | "aggregate"
  | "comparison"
  | "knowledge-update"
  | "preference"
  | "temporal";

export interface MemoryQuestionGuidance {
  cleanedQuestion: string;
  defaultLimit: 20;
  defaultMaxPerSession: 4;
  defaultOrder: "relevance";
  evidenceFocus: EvidenceFocus[];
}

const QUESTION_PREFIX =
  /^\s*now is\s+\d{4}[/-]\d{2}[/-]\d{2}(?:\s*\([^)]*\))?(?:\s+\d{2}:\d{2})?\.?\s*(?:please answer the question:\s*)?/iu;

export function cleanMemoryQuestion(question: string): string {
  return question
    .normalize("NFKC")
    .replace(QUESTION_PREFIX, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function inferEvidenceFocus(question: string): EvidenceFocus[] {
  const focus = new Set<EvidenceFocus>();
  if (/\b(?:how many|total|all|every|list|number of|times did)\b/iu.test(question)) {
    focus.add("aggregate");
  }
  if (/\b(?:compare|compared|comparison|difference|more than|less than|versus|vs\.?|between|both|which .* first)\b/iu.test(question)) {
    focus.add("comparison");
  }
  if (/\b(?:current|currently|latest|most recent|initial|initially|previous|previously|before I|after I|state|personal best|record)\b/iu.test(question)) {
    focus.add("knowledge-update");
  }
  if (/\b(?:recommend|recommendation|suggest|suggestion|tips?|activities|recipes?|could there be a reason|might it be)\b/iu.test(question)) {
    focus.add("preference");
  }
  if (/\b(?:when|date|day|days|week|weeks|month|months|year|years|ago|before|after|first|last|order|passed|earlier|later)\b/iu.test(question)) {
    focus.add("temporal");
  }
  return [...focus];
}

export function planMemoryQuestion(question: string): MemoryQuestionGuidance {
  const cleanedQuestion = cleanMemoryQuestion(question);
  return {
    cleanedQuestion,
    defaultLimit: 20,
    defaultMaxPerSession: 4,
    defaultOrder: "relevance",
    evidenceFocus: inferEvidenceFocus(cleanedQuestion),
  };
}

const FOCUS_GUIDANCE: Record<EvidenceFocus, string> = {
  aggregate:
    "aggregate attention: distinguish explicit cumulative totals from distinct items or occurrences; seek coverage beyond duplicate mentions",
  comparison:
    "comparison attention: recover direct evidence for each side and the requested relation",
  "knowledge-update":
    "update attention: keep the entity and attribute fixed while reconstructing earlier, previous, initial, or current states",
  preference:
    "preference attention: retrieve direct personal constraints, routines, and prior experiences rather than generic advice",
  temporal:
    "temporal attention: recover each required event and source timestamp; chronological views and relation-bearing neighbors may expose the needed order or interval",
};

export function renderMemoryQuestionPlan(question: string): string {
  const guidance = planMemoryQuestion(question);
  return [
    "Question-shaped retrieval attention:",
    `- suggested broad starting query: ${JSON.stringify(guidance.cleanedQuestion)}`,
    `- starting defaults: limit ${guidance.defaultLimit}, ${guidance.defaultOrder} order, maxPerSession ${guidance.defaultMaxPerSession}`,
    "- inspect the first result before expanding; query shape, filters, ordering, and search depth remain adaptive",
    ...guidance.evidenceFocus.map((focus) => `- ${FOCUS_GUIDANCE[focus]}`),
    "- preserve direct source roles and check exact-entity hard negatives when similar memories could transfer a value incorrectly",
    "Return the smallest cited evidence package that covers the question, or identify the unsupported slot.",
  ].join("\n");
}
