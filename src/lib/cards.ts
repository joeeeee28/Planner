// ─────────────────────────────────────────────────────────────────────────────
// Credit cards — tracking a card as part of Money, not as a bank app (V4.1)
//
// Two ideas, kept strictly apart:
//
//   PURCHASE  a `Transaction` of type 'expense' with `cardId` set.
//             It counts once, as an expense, and appears in card spending.
//
//   PAYMENT   a `CardPayment` (its own record, outside `transactions`).
//             It settles card balance and NEVER becomes an expense, so a
//             ₹5,000 purchase plus a ₹5,000 payment is ₹5,000 of expenses —
//             never ₹10,000.
//
// Privacy: only the last four digits are ever stored or displayed. Nothing in
// this module reads, writes or logs a full card number, expiry, CVV, PIN or OTP.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppData, CardPayment, CreditCard, DateStr, ID, MonthKey, Transaction } from './types';
import { monthKeyOf, parseDateStr, todayStr } from './dates';
import { safeAmount } from './finance';

export const MAX_LAST4 = 4;

/**
 * Reduce any user input to *at most* the last four digits.
 * A pasted full card number is truncated to its last four — the rest is
 * discarded immediately and never stored anywhere.
 */
export function last4FromInput(input: string): string {
  const digits = (input ?? '').replace(/\D/g, '');
  return digits.slice(-MAX_LAST4);
}

/** True when the value is a safe, complete last-4 (exactly four digits). */
export function isValidLast4(value: string): boolean {
  return /^\d{4}$/.test(value ?? '');
}

/** Safe display form — always masked, never the raw input. */
export function maskCard(last4: string): string {
  return `••••${last4FromInput(last4).padStart(MAX_LAST4, '•')}`;
}

/** "HDFC ••••4521" */
export function cardLabel(card: Pick<CreditCard, 'name' | 'last4' | 'issuer'>): string {
  const brand = card.issuer?.trim();
  const base = brand && !card.name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${card.name}` : card.name;
  return `${base} ${maskCard(card.last4)}`.replace(/\s+/g, ' ').trim();
}

/** A purchase is a card-linked expense. */
export function isCardPurchase(tx: Transaction): boolean {
  return tx.type === 'expense' && !!tx.cardId;
}

/** Purchases for one card in a month. */
export function cardSpendInMonth(txs: readonly Transaction[], cardId: ID, mk: MonthKey): number {
  return txs
    .filter((t) => t.cardId === cardId && t.type === 'expense' && monthKeyOf(t.date) === mk)
    .reduce((a, t) => a + (safeAmount(t.amount) || 0), 0);
}

/** Payments made to one card in a month. */
export function cardPaymentsInMonth(payments: readonly CardPayment[], cardId: ID, mk: MonthKey): CardPayment[] {
  return payments.filter((p) => p.cardId === cardId && monthKeyOf(p.date) === mk);
}

export function cardPaymentsTotalInMonth(payments: readonly CardPayment[], cardId: ID, mk: MonthKey): number {
  return cardPaymentsInMonth(payments, cardId, mk).reduce((a, p) => a + (safeAmount(p.amount) || 0), 0);
}

export type CardState = 'clear' | 'due-soon' | 'overdue' | 'no-activity';

export interface CardSummary {
  card: CreditCard;
  /** Purchases this month (spending tracked against the card). */
  spentThisMonth: number;
  /** Payments made this month. */
  paidThisMonth: number;
  /** Outstanding balance across all time: purchases − payments (never below 0). */
  outstanding: number;
  /** Next due date (if the card has a due day). */
  dueDate?: DateStr;
  /** Days until due (negative = overdue). */
  daysUntilDue?: number;
  state: CardState;
}

function daysBetween(from: DateStr, to: DateStr): number {
  const a = parseDateStr(from).getTime();
  const b = parseDateStr(to).getTime();
  return Math.round((b - a) / 86400000);
}

/** Next occurrence of `dueDay` on/after `from` (months without that day clamp to their last). */
export function nextDueDate(dueDay: number | undefined, from: DateStr = todayStr()): DateStr | undefined {
  if (!dueDay || dueDay < 1 || dueDay > 31) return undefined;
  const base = parseDateStr(from);
  const build = (year: number, month: number): DateStr => {
    const lastDay = new Date(year, month + 1, 0).getDate();
    const d = new Date(year, month, Math.min(dueDay, lastDay));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const thisMonth = build(base.getFullYear(), base.getMonth());
  if (thisMonth >= from) return thisMonth;
  return build(base.getFullYear(), base.getMonth() + 1);
}

export function summarizeCard(
  card: CreditCard,
  txs: readonly Transaction[],
  payments: readonly CardPayment[],
  today: DateStr = todayStr(),
): CardSummary {
  const mk = monthKeyOf(today);
  const spentThisMonth = cardSpendInMonth(txs, card.id, mk);
  const paidThisMonth = cardPaymentsTotalInMonth(payments, card.id, mk);

  const allSpend = txs.filter((t) => t.cardId === card.id && t.type === 'expense').reduce((a, t) => a + (safeAmount(t.amount) || 0), 0);
  const allPaid = payments.filter((p) => p.cardId === card.id).reduce((a, p) => a + (safeAmount(p.amount) || 0), 0);
  const outstanding = Math.max(0, Math.round((allSpend - allPaid) * 100) / 100);

  const dueDate = nextDueDate(card.dueDay, today);
  const daysUntilDue = dueDate ? daysBetween(today, dueDate) : undefined;
  let state: CardState = 'no-activity';
  if (outstanding > 0 && daysUntilDue !== undefined) state = daysUntilDue < 0 ? 'overdue' : daysUntilDue <= 7 ? 'due-soon' : 'clear';
  else if (outstanding > 0) state = 'clear';

  return { card, spentThisMonth, paidThisMonth, outstanding, dueDate, daysUntilDue, state };
}

export function summarizeCards(data: AppData, today: DateStr = todayStr()): CardSummary[] {
  const cards = (data.creditCards ?? []).filter((c) => !c.archived);
  const txs = data.transactions ?? [];
  const payments = data.cardPayments ?? [];
  return cards.map((c) => summarizeCard(c, txs, payments, today));
}

/** Purchases belonging to a card, newest first (never mutates the source). */
export function cardTransactions(txs: readonly Transaction[], cardId: ID): Transaction[] {
  return txs.filter((t) => t.cardId === cardId).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * A card-payment record from a draft. Kept here so Money and Quick-add build
 * payments identically, always outside `transactions`.
 */
export function makeCardPayment(input: {
  id: ID;
  cardId: ID;
  amount: number;
  date: DateStr;
  fromAccount?: string;
  note?: string;
}): CardPayment {
  return {
    id: input.id,
    cardId: input.cardId,
    amount: safeAmount(input.amount),
    date: input.date,
    fromAccount: input.fromAccount?.trim() || undefined,
    note: input.note?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Guard used by every card form: only a safe 4-digit tail may be persisted.
 * Returns `null` when the input cannot be reduced to a valid last-4.
 */
export function safeCardLast4(input: string): string | null {
  const last4 = last4FromInput(input);
  return isValidLast4(last4) ? last4 : null;
}

/** Never let a full card number reach storage — audits tests / import paths. */
export function cardContainsFullPan(value: unknown): boolean {
  const text = JSON.stringify(value ?? '');
  return /\b(?:\d[ -]?){13,19}\b/.test(text.replace(/"(?:last4)":"\d{4}"/g, ''));
}
