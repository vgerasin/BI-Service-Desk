// 5 вопросов CSI-опроса — общие для отдельной страницы-опроса (SurveyPage.tsx, публичная
// ссылка по токену) и встроенной формы на карточке заявки (RequestDetailPage.tsx). Меняются
// синхронно с backend/src/ratings/ratings.service.ts (там же — расчёт итогового балла).
export interface CsiQuestion {
  key: string;
  text: string;
  hint?: string;
}

export const CSI_QUESTIONS: CsiQuestion[] = [
  { key: 'q1', text: 'Команда оперативно и понятно отвечала на мои вопросы по этой заявке и помогала разобраться, если возникали сложности?' },
  { key: 'q2', text: 'Мне было понятно, в какие сроки заявка будет взята в работу и когда ожидать результат?' },
  { key: 'q3', text: 'Итоговый результат по заявке полностью соответствовал согласованным ранее требованиям?' },
  {
    key: 'q4',
    text: 'Если сроки по заявке сдвигались или она была отклонена — мне дали чёткое и понятное объяснение причин?',
    hint: 'Если задержек и отказов не было — выберите «Да» и, если хотите, поясните в комментарии',
  },
  { key: 'q5', text: 'В целом вы удовлетворены тем, как была выполнена эта заявка (консультации, коммуникация, результат)?' },
];

// «Свой вариант» used to be a third answer that replaced Да/Нет entirely — and silently scored as
// 0, same as «Нет», even when the free-text comment was actually a positive/non-applicable note
// (e.g. "сдвигов не было" on the "если сроки сдвигались..." question). Да/Нет is now mandatory;
// a comment is just an optional note that can go with either answer, never a substitute for one.
export type CsiAnswerValue = 'yes' | 'no';

export interface CsiAnswerState {
  answer: CsiAnswerValue | null;
  text: string;
}

export type CsiAnswers = Record<string, CsiAnswerState>;

export function makeCsiInitialAnswers(): CsiAnswers {
  return Object.fromEntries(CSI_QUESTIONS.map(q => [q.key, { answer: null, text: '' }]));
}

export function csiAllAnswered(answers: CsiAnswers): boolean {
  return CSI_QUESTIONS.every(q => !!answers[q.key]?.answer);
}

// «Да» = 1, «нет» и «свой вариант» = 0 — знаменатель фиксирован на 5 вопросах (согласованная
// методика, см. backend/src/ratings/ratings.service.ts submitSurvey). Client-side only for the
// live counter shown while answering — the score that actually gets saved is recomputed by the
// backend from the submitted answers, never trusted from the client.
export function csiScore(answers: CsiAnswers): number {
  return CSI_QUESTIONS.reduce((sum, q) => sum + (answers[q.key]?.answer === 'yes' ? 1 : 0), 0);
}

export function csiAnsweredCount(answers: CsiAnswers): number {
  return CSI_QUESTIONS.filter(q => !!answers[q.key]?.answer).length;
}

export function toCsiAnswerPayload(answers: CsiAnswers) {
  return CSI_QUESTIONS.map(q => ({
    key: q.key,
    answer: answers[q.key].answer as CsiAnswerValue,
    text: answers[q.key].text || undefined,
  }));
}
