import {
  aggregateStats,
  currentNightKey,
  gamesOnNight,
  nightBounds,
  nightsWithGames,
  playersOnNight,
} from "@crokinole/core";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { useStore, useVisibleGames } from "../../data/store";
import { Card, Empty, Money } from "../../ui/components";

/**
 * Daily standings (§3.5, route `/`).
 *
 * A "day" here runs to 3am, so a game logged at 1am still counts toward the
 * night it was played on and the board resets while everyone's asleep rather
 * than mid-evening.
 *
 * On tonight's page every player starts **greyed out**; tap to mark them in.
 * That set drives the standings *and* the seat pickers on the new-game screen,
 * so you're never scrolling past people who aren't at the table. Past nights
 * show only who actually played and can't be edited.
 */
export function LeaderboardScreen(): ReactNode {
  const games = useVisibleGames();
  const { players, presentIds, togglePresent } = useStore();

  const tonight = currentNightKey();
  // Tonight is always page 0, even before a game exists on it.
  const nights = useMemo(() => {
    const withGames = nightsWithGames(games);
    return withGames[0] === tonight ? withGames : [tonight, ...withGames];
  }, [games, tonight]);

  const [index, setIndex] = useState(0);
  const nightKeyViewed = nights[index] ?? tonight;
  const isTonight = nightKeyViewed === tonight;

  const nightGames = useMemo(
    () => gamesOnNight(games, nightKeyViewed),
    [games, nightKeyViewed],
  );

  const rows = useMemo(() => {
    const { since, until } = nightBounds(nightKeyViewed);
    // Past nights list only who played. Tonight lists whoever is marked in, so
    // people show up before their first game.
    const include = isTonight ? presentIds : playersOnNight(games, nightKeyViewed);
    const stats = aggregateStats(games, { since, until, includePlayerIds: include });
    const names = new Map(players.map((player) => [player.id, player.displayName]));
    return stats
      .filter((row) => include.includes(row.playerId))
      .map((row) => ({ ...row, displayName: names.get(row.playerId) ?? "Unknown" }));
  }, [games, nightKeyViewed, isTonight, presentIds, players]);

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
          {isTonight ? "Tonight" : formatNight(nightKeyViewed)}
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

      {isTonight ? (
        <Card title="Who's here">
          <div className="chips">
            {players
              .filter((player) => player.isActive)
              .map((player) => (
                <button
                  key={player.id}
                  type="button"
                  className="chip"
                  aria-pressed={presentIds.includes(player.id)}
                  onClick={() => togglePresent(player.id)}
                >
                  {player.displayName}
                </button>
              ))}
          </div>
        </Card>
      ) : null}

      <Card title={isTonight ? "Tonight's standings" : "Standings that night"}>
        {rows.length === 0 ? (
          <Empty>
            {isTonight ? "Tap whoever's here to start the night." : "Nobody played."}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">GP</th>
                  <th scope="col">W</th>
                  <th scope="col">L</th>
                  <th scope="col">Net</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.playerId}>
                    <td>{row.displayName}</td>
                    <td className="num">{row.gamesPlayed}</td>
                    <td className="num">{row.gamesWon}</td>
                    <td className="num">{row.gamesLost}</td>
                    <td>
                      <Money cents={row.netCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {isTonight ? (
        <Link className="btn btn--accent btn--block btn--lg" to="/games/new">
          New game
        </Link>
      ) : null}
    </div>
  );
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
