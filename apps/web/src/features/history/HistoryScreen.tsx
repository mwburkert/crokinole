import {
  formatCents,
  gameStanding,
  scoreRoundInput,
  settle,
  type GameWithRounds,
  type TeamKey,
} from "@crokinole/core";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { useNights, useStore } from "../../data/store";
import { Badge, Card, Empty, Loading, Money } from "../../ui/components";

/**
 * History (§3.5), grouped by night.
 *
 * Each game reads as the two pairs stacked with the score between them —
 * winner's total in green, loser's in red, both black on a tie. Tap to expand
 * for the stakes and a round-by-round breakdown in the same colour language.
 */
export function HistoryScreen(): ReactNode {
  const nights = useNights();
  const { players, softDelete, currentEmail, isSuperAdmin, isAdmin, members, isLoading } =
    useStore();

  // Who am I, as a player id — so a game can tell whether I was in it.
  const myPlayerId = members.find((member) => member.email === currentEmail)?.playerId ?? null;

  /*
   * 🕐 The shared passphrase carries no identity, so "was I in this game?"
   * has no answer: `currentEmail` is "" and every member's email is null, so
   * the lookup above never matches and `isSuperAdmin("")` is false. That made
   * `canManage` false for everyone and silently removed Resume and Delete from
   * every row — an abandoned game could then only be deleted from its own
   * detail screen. With one shared secret everybody is equally trusted, which
   * is the same rule `convex/admin.ts` and the seam already apply when there is
   * no caller to compare against.
   */
  const anonymous = currentEmail === "";
  const [expanded, setExpanded] = useState<string | null>(null);

  const nameOf = (id: string): string =>
    players.find((player) => player.id === id)?.displayName ?? "?";

  if (isLoading || nights.length === 0) {
    return (
      <Card>
        {/* No nights yet and no nights *so far* look identical from here. */}
        {isLoading ? <Loading rows={4} /> : <Empty>Nothing logged yet.</Empty>}
      </Card>
    );
  }

  return (
    <div className="stack">
      {nights.map((night) => (
        <div className="night" key={night.date}>
          <div className="night__head">
            <span className="night__date">{formatNight(night.date)}</span>
            <span className="faint">
              {night.games.length} {night.games.length === 1 ? "game" : "games"}
            </span>
          </div>

          {night.games.map((game) => (
            <GameRow
              key={game.id}
              game={game}
              nameOf={nameOf}
              canManage={
                (anonymous && isAdmin) ||
                isSuperAdmin(currentEmail) ||
                (myPlayerId !== null &&
                  [...game.teams.A.playerIds, ...game.teams.B.playerIds].includes(myPlayerId))
              }
              onDelete={() => softDelete(game.id)}
              open={expanded === game.id}
              onToggle={() => setExpanded((current) => (current === game.id ? null : game.id))}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function GameRow({
  game,
  nameOf,
  canManage,
  onDelete,
  open,
  onToggle,
}: {
  game: GameWithRounds;
  nameOf: (id: string) => string;
  /** Super admins, and anyone who actually played in this game. */
  canManage: boolean;
  onDelete: () => void;
  open: boolean;
  onToggle: () => void;
}): ReactNode {
  const standing = gameStanding(game.rounds, game.config);
  const result = settle(game);
  const netFor = (playerId: string): number =>
    result.find((entry) => entry.playerId === playerId)?.netCents ?? 0;

  /**
   * Each side is its own two-column sub-grid: name, then money in a fixed
   * column. Keeping the money out of the name text is what makes the four rows
   * line up — inline, every row started at a different x depending on name
   * length. Names ellipsise rather than wrap for the same reason.
   */
  const side = (team: TeamKey, mirrored: boolean): ReactNode => (
    <div className={`matchup__side${mirrored ? " matchup__side--right" : ""}`}>
      {game.teams[team].playerIds.map((id) => (
        <div className="matchup__player" key={id}>
          <span className="matchup__name">{nameOf(id)}</span>
          <span className="matchup__money">
            {result.length > 0 ? <Money cents={netFor(id)} /> : null}
          </span>
        </div>
      ))}
    </div>
  );

  const unfinished = game.status === "in_progress";

  return (
    <div className={`matchup${unfinished ? " matchup--unfinished" : ""}`}>
      <button type="button" className="matchup__main" onClick={onToggle} aria-expanded={open}>
        {side("A", false)}
        <span className="matchup__score">
          <span className={`disc disc--${game.teams.A.color}`} aria-hidden="true" />
          <span className={scoreClass(standing.matchPoints.A, standing.matchPoints.B)}>
            {standing.matchPoints.A}
          </span>
          <span className="matchup__dash">–</span>
          <span className={scoreClass(standing.matchPoints.B, standing.matchPoints.A)}>
            {standing.matchPoints.B}
          </span>
          <span className={`disc disc--${game.teams.B.color}`} aria-hidden="true" />
        </span>
        {side("B", true)}
      </button>

      {open ? (
        <div className="matchup__detail">
          {/*
            Manage controls for *any* game, finished or not.
             *
             * They used to render only on an unfinished game, so a night that
             * was already scored — the one where a wrong number actually costs
             * somebody money — could not be corrected or removed from here at
             * all. "Correct" goes to the play screen, which already knows how
             * to page back through committed rounds and re-derive the standing
             * from a correction, including un-finishing a finished game.
             *
             * `canManage` is the admin check. Under the shared passphrase that
             * is everyone holding the code, because one secret cannot tell two
             * people apart — see `convex/lib/auth.ts`. It narrows to the
             * allowlist's admins the moment identities are real, with no change
             * needed here.
          */}
          {canManage || unfinished ? (
            <div className="spread" style={{ marginBottom: "0.5rem" }}>
              {unfinished ? <Badge live>Unfinished</Badge> : <span />}
              {canManage ? (
                <span className="row" style={{ gap: "0.4rem" }}>
                  <Link
                    className="btn btn--accent"
                    to={`/games/${game.id}/play`}
                    // `correct` asks for the scoreboard on arrival: correcting
                    // a finished game otherwise opens on its end-of-game
                    // scorecard. `from` is this list, so closing the sheet
                    // comes back to it instead of stranding you on the board of
                    // a game you only opened to fix.
                    //
                    // Resume sends neither. It is not a correction — it is the
                    // live board, and it must arrive the way the tab bar's
                    // Resume does.
                    state={unfinished ? undefined : { correct: true, from: "/games" }}
                  >
                    {unfinished ? "Resume" : "Correct"}
                  </Link>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={onDelete}
                    aria-label={`Delete the ${nameOf(game.teams.A.playerIds[0] ?? "")} game`}
                  >
                    Delete
                  </button>
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="spread faint">
            <span>Stakes</span>
            <span>
              {game.bets.map((bet) => `${nameOf(bet.playerId)} ${formatCents(bet.amountCents).replace("+", "")}`).join(" · ")}
            </span>
          </div>
          {game.rounds.map((round) => {
            const score = scoreRoundInput(round, game.config);
            return (
              <div className="spread" key={round.index}>
                <span className="faint">Round {round.index + 1}</span>
                <span className="num">
                  <span className={scoreClass(score.aPoints, score.bPoints)}>{score.aPoints}</span>
                  <span className="matchup__dash">–</span>
                  <span className={scoreClass(score.bPoints, score.aPoints)}>{score.bPoints}</span>
                </span>
              </div>
            );
          })}
          {game.rounds.length === 0 ? <p className="faint">No rounds yet.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Green when ahead, red when behind, plain when level. */
function scoreClass(mine: number, theirs: number): string {
  if (mine > theirs) return "num score--win";
  if (mine < theirs) return "num score--loss";
  return "num score--tie";
}

/** "2026-08-12" -> "Wed 12 Aug 2026". */
function formatNight(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) return key;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
