import {
  aggregateStats,
  currentNightKey,
  gamesOnNight,
  nightBounds,
  nightsWithGames,
  playersOnNight,
  tiebreakRank,
  type PlayerStats,
} from "@crokinole/core";
import { useMemo, useState, type ReactNode } from "react";

import { useStore, useVisibleGames } from "../../data/store";
import { Card, Empty, Money } from "../../ui/components";

interface Row extends PlayerStats {
  displayName: string;
  present: boolean;
  /** Played tonight, whether or not they're still here. */
  played: boolean;
}

/**
 * Daily standings (§3.5, route `/`).
 *
 * A "day" runs to 3am, so a game logged at 1am still counts toward the night it
 * was played on.
 *
 * Tap a row to mark someone in or out. That set drives the seat pickers on the
 * new-game screen, so you're never scrolling past people who aren't at the
 * table.
 */
export function LeaderboardScreen(): ReactNode {
  const games = useVisibleGames();
  const { players, presentIds, togglePresent } = useStore();
  const [showAbsent, setShowAbsent] = useState(true);

  const tonight = currentNightKey();
  const nights = useMemo(() => {
    const withGames = nightsWithGames(games);
    return withGames[0] === tonight ? withGames : [tonight, ...withGames];
  }, [games, tonight]);

  const [index, setIndex] = useState(0);
  const viewing = nights[index] ?? tonight;
  const isTonight = viewing === tonight;

  const nightGames = useMemo(() => gamesOnNight(games, viewing), [games, viewing]);

  const rows = useMemo<Row[]>(() => {
    const { since, until } = nightBounds(viewing);
    const playedTonight = new Set(playersOnNight(games, viewing));
    const names = new Map(players.map((player) => [player.id, player.displayName]));

    // Past nights list only who actually played. Tonight lists every active
    // player so you can mark people in before their first game.
    const candidates = isTonight
      ? players.filter((player) => player.isActive).map((player) => player.id)
      : [...playedTonight];

    const stats = aggregateStats(games, {
      since,
      until,
      includePlayerIds: candidates,
    });

    return stats
      .filter((row) => candidates.includes(row.playerId))
      .map((row) => ({
        ...row,
        displayName: names.get(row.playerId) ?? "Unknown",
        present: isTonight ? presentIds.includes(row.playerId) : true,
        played: playedTonight.has(row.playerId),
      }))
      .sort(compare(viewing));
  }, [games, viewing, isTonight, presentIds, players]);

  // Someone who played and then went home still ranks on merit; only people who
  // never played and aren't here drop to the bottom.
  const ranked = rows.filter((row) => row.present || row.played);
  const sittingOut = rows.filter((row) => !row.present && !row.played);
  const visible = showAbsent ? [...ranked, ...sittingOut] : ranked;

  return (
    <div className="stack">
      <div className="daynav">
        <button
          type="button"
          className="daynav__btn"
          aria-label="Earlier night"
          disabled={index >= nights.length - 1}
          onClick={() => setIndex((current) => current + 1)}
        >
          ‹
        </button>
        <span className="daynav__label">
          {isTonight ? "Tonight" : formatNight(viewing)}
          <span className="daynav__sub">
            {nightGames.length} {nightGames.length === 1 ? "game" : "games"}
          </span>
        </span>
        <button
          type="button"
          className="daynav__btn"
          aria-label="Later night"
          disabled={index === 0}
          onClick={() => setIndex((current) => current - 1)}
        >
          ›
        </button>
      </div>

      <Card>
        {visible.length === 0 ? (
          <Empty>Nobody played.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table table--standings">
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">Net</th>
                  <th scope="col">GP</th>
                  <th scope="col">W</th>
                  <th scope="col">L</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr
                    key={row.playerId}
                    className={row.present ? "" : "row--absent"}
                    onClick={isTonight ? () => togglePresent(row.playerId) : undefined}
                    style={isTonight ? { cursor: "pointer" } : undefined}
                  >
                    <td>{row.displayName}</td>
                    <td>
                      <Money cents={row.netCents} />
                    </td>
                    <td className="num">{row.gamesPlayed}</td>
                    <td className="num">{row.gamesWon}</td>
                    <td className="num">{row.gamesLost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {isTonight ? (
          <>
            <p className="faint" style={{ margin: "0.75rem 0 0.4rem" }}>
              Tap a name to mark who's here. Only those players show up when you start a game.
            </p>
            <label className="toggle">
              <input
                type="checkbox"
                checked={showAbsent}
                onChange={(event) => setShowAbsent(event.target.checked)}
              />
              Show everyone else
            </label>
          </>
        ) : null}
      </Card>
    </div>
  );
}

/**
 * Winnings first, then most wins, then fewest losses, then an arbitrary but
 * stable order — see `tiebreakRank` for why it isn't `Math.random()`.
 */
function compare(nightKeyValue: string): (a: Row, b: Row) => number {
  return (a, b) =>
    b.netCents - a.netCents ||
    b.gamesWon - a.gamesWon ||
    a.gamesLost - b.gamesLost ||
    tiebreakRank(a.playerId, nightKeyValue) - tiebreakRank(b.playerId, nightKeyValue);
}

/** "2026-08-12" -> "Wed 12 Aug". */
function formatNight(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) return key;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
