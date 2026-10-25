interface AccountingAttempt {
  kind: string;
  creditsReserved: number;
  creditsUsed: number | null;
  settlementReceipt?: { credits: number } | null;
}

/** Quota exposure includes estimates; a verified debit never does. */
export function summarizeAttemptAccounting(fixedCredits: number, attempts: AccountingAttempt[]) {
  let units = attempts.length ? fixedCredits : 0;
  let confirmedUnits = units;
  let unconfirmedUnits = 0;
  let unconfirmed = false;
  for (const attempt of attempts) {
    const confirmed = attempt.settlementReceipt?.credits ?? attempt.creditsUsed;
    units += confirmed ?? attempt.creditsReserved;
    confirmedUnits += confirmed ?? 0;
    if (attempt.kind === 'generation' && confirmed === null) {
      unconfirmed = true;
      unconfirmedUnits += attempt.creditsReserved;
    }
  }
  return { units, confirmedUnits, unconfirmedUnits, unconfirmed };
}
