/**
 * Money settlement (§3.4, Q3).
 *
 * **Everyone pays in; the winning side splits the whole pot.** Losers get
 * nothing back. With four equal $5 bets the pot is $20, each winner receives
 * $10 — their own $5 back plus $5 of winnings — so winners are **+$5** and
 * losers **-$5**. Confirmed 2026-08-12.
 *
 * This is the rule most likely to be revised after a real night of use, which
 * is why it lives alone in one small file.
 */

import { gameStanding, teamOf } from "./scoring.js";
import type { Bet, GameWithRounds, PlayerId, Settlement, TeamKey } from "./types.js";

/** Everything wagered on a game, in cents. */
export function potCents(bets: Bet[]): number {
  return bets.reduce((sum, bet) => sum + bet.amountCents, 0);
}

/**
 * Split `pot` among `stakes` in proportion to each stake, in whole cents,
 * guaranteeing the parts sum to exactly `pot`.
 *
 * Uses largest-remainder: floor every share, then hand the leftover cents to
 * the largest fractional parts. Rounding each share independently would let the
 * total drift a cent off the pot, which over a season turns into "the ledger
 * doesn't balance" — the exact class of bug §3.2.1 exists to prevent.
 *
 * When every stake is zero the pot is split as evenly as possible instead, so
 * a $0-stakes game can't produce a divide-by-zero.
 */
function proportionalSplit(pot: number, stakes: number[]): number[] {
  const count = stakes.length;
  if (count === 0) return [];

  const total = stakes.reduce((sum, stake) => sum + stake, 0);
  const weights = total > 0 ? stakes : stakes.map(() => 1);
  const weightTotal = total > 0 ? total : count;

  const exact = weights.map((weight) => (pot * weight) / weightTotal);
  const shares = exact.map(Math.floor);
  let remainder = pot - shares.reduce((sum, share) => sum + share, 0);

  // Hand out the leftover cents, largest fractional part first. Ties break by
  // index so the result is deterministic.
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);

  for (let i = 0; remainder > 0 && i < order.length; i += 1) {
    const slot = order[i];
    if (!slot) break;
    shares[slot.index] = (shares[slot.index] ?? 0) + 1;
    remainder -= 1;
  }

  return shares;
}

/**
 * What each player nets on a finished game, in cents.
 *
 * Returns an **empty array for a game that hasn't been won yet** — there is no
 * settlement until someone reaches the target. Callers should check
 * `gameStanding(...).isComplete` (or the emptiness of this result) rather than
 * treating a missing settlement as "everyone broke even".
 *
 * The result always sums to exactly zero.
 */
export function settle(game: GameWithRounds): Settlement[] {
  const standing = gameStanding(game.rounds, game.config);
  if (!standing.winner) return [];

  const winningTeam: TeamKey = standing.winner;
  const pot = potCents(game.bets);

  const winners: Bet[] = [];
  const losers: Bet[] = [];
  for (const bet of game.bets) {
    if (teamOf(game.teams, bet.playerId) === winningTeam) winners.push(bet);
    else losers.push(bet);
  }

  // Nobody on the winning side wagered anything — there is nothing to pay out
  // against, so everyone simply keeps their money.
  if (winners.length === 0) {
    return game.bets.map((bet) => ({ playerId: bet.playerId, netCents: 0 }));
  }

  const payouts = proportionalSplit(
    pot,
    winners.map((bet) => bet.amountCents),
  );

  const byPlayer = new Map<PlayerId, number>();
  winners.forEach((bet, index) => {
    byPlayer.set(bet.playerId, (payouts[index] ?? 0) - bet.amountCents);
  });
  for (const bet of losers) {
    byPlayer.set(bet.playerId, -bet.amountCents);
  }

  // Preserve the original bet order so the UI renders players in a stable order.
  return game.bets.map((bet) => ({
    playerId: bet.playerId,
    netCents: byPlayer.get(bet.playerId) ?? 0,
  }));
}

/** Format cents as a signed dollar string: `+$5.00`, `-$5.00`, `$0.00`. */
export function formatCents(cents: number): string {
  const sign = cents > 0 ? "+" : cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars}.${remainder}`;
}
