import { useMemo, useState, type ReactNode } from "react";

import { useLeaderboard } from "../../data/store";
import { Card, Empty, Money } from "../../ui/components";

type SortKey =
  | "displayName"
  | "gamesPlayed"
  | "gamesWon"
  | "gamesLost"
  | "winPct"
  | "matchPointsFor"
  | "matchPointsAgainst"
  | "roundPointsFor"
  | "roundPointsAgainst"
  | "pointsPerRound"
  | "twenties"
  | "twentiesPerGame"
  | "netCents";

/** Column abbreviations, spelled out behind the ⓘ rather than as helper text. */
const LEGEND: [string, string][] = [
  ["Net", "Money won or lost, all-time"],
  ["GP", "Games played"],
  ["W / L", "Games won / lost"],
  ["Win %", "Share of decided games won"],
  ["MP+ / MP−", "Match points for / against"],
  ["Pts+ / Pts−", "Round points for / against"],
  ["Pts/rd", "Average round points — over rounds where points were recorded. — means none were."],
  ["20s", "Discs sunk in the centre hole"],
  ["20s/gm", "Twenties per game"],
];

/**
 * Name and Net are frozen to the left; everything else scrolls under them.
 * The two things you're always comparing against stay on screen no matter how
 * far right you go.
 */
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "gamesPlayed", label: "GP" },
  { key: "gamesWon", label: "W" },
  { key: "gamesLost", label: "L" },
  { key: "winPct", label: "Win %" },
  { key: "matchPointsFor", label: "MP+" },
  { key: "matchPointsAgainst", label: "MP−" },
  { key: "roundPointsFor", label: "Pts+" },
  { key: "roundPointsAgainst", label: "Pts−" },
  { key: "pointsPerRound", label: "Pts/rd" },
  { key: "twenties", label: "20s" },
  { key: "twentiesPerGame", label: "20s/gm" },
];

/**
 * Per-player lifetime stats (§3.5), one sortable table.
 *
 * Partner and opponent breakdowns are Phase 2 (§4.2) and are deliberately not
 * here — and when they arrive they must exclude singles games, since a 1v1 has
 * no partner.
 */
export function StatsScreen(): ReactNode {
  const rows = useLeaderboard();
  const [sort, setSort] = useState<SortKey>("netCents");
  const [showLegend, setShowLegend] = useState(false);

  // Derived-on-read like everything else — these are folds over the same rows,
  // never stored (§3.2.1).
  const enriched = useMemo(
    () =>
      rows
        .filter((row) => row.gamesPlayed > 0)
        .map((row) => {
          return {
            ...row,
            // Divided by rounds that CARRY points, not rounds played. A night
            // logged outcome-only has no points to average, and showing 0 would
            // read as "scored nothing" rather than "not recorded".
            pointsPerRound:
              row.roundsScored > 0 ? row.roundPointsFor / row.roundsScored : null,
            twentiesPerGame: row.gamesPlayed > 0 ? row.twenties / row.gamesPlayed : 0,
          };
        }),
    [rows],
  );

  const sorted = useMemo(
    () =>
      [...enriched].sort((a, b) =>
        sort === "displayName"
          ? a.displayName.localeCompare(b.displayName)
          : Number(b[sort]) - Number(a[sort]),
      ),
    [enriched, sort],
  );

  if (sorted.length === 0) {
    return (
      <Card title="Stats">
        <Empty>Play a game and the numbers start here.</Empty>
      </Card>
    );
  }

  return (
    <div className="stack">
      <Card
        title="Lifetime"
        action={
          <button
            type="button"
            className="infobtn"
            aria-label="What the columns mean"
            aria-expanded={showLegend}
            onClick={() => setShowLegend((current) => !current)}
          >
            ⓘ
          </button>
        }
      >
        {showLegend ? (
          <dl className="legend">
            {LEGEND.map(([term, meaning]) => (
              <div className="legend__row" key={term}>
                <dt>{term}</dt>
                <dd>{meaning}</dd>
              </div>
            ))}
            <p className="faint legend__note">
              Every figure is derived from the stored rounds — nothing here is a saved total. Tap a
              column to sort; Name and Net stay put as you scroll.
            </p>
          </dl>
        ) : null}
        <div className="table-wrap">
          <table className="table table--frozen">
            <thead>
              <tr>
                <th scope="col" className="col-name" onClick={() => setSort("displayName")}>
                  Player
                </th>
                <th scope="col" className="col-net" onClick={() => setSort("netCents")}>
                  Net
                </th>
                {COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={sort === column.key ? "descending" : "none"}
                    onClick={() => setSort(column.key)}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.playerId}>
                  <td className="col-name name">{row.displayName}</td>
                  <td className="col-net">
                    <Money cents={row.netCents} />
                  </td>
                  <td className="num">{row.gamesPlayed}</td>
                  <td className="num">{row.gamesWon}</td>
                  <td className="num">{row.gamesLost}</td>
                  <td className="num">{Math.round(row.winPct * 100)}%</td>
                  <td className="num">{row.matchPointsFor}</td>
                  <td className="num">{row.matchPointsAgainst}</td>
                  <td className="num">{row.roundPointsFor}</td>
                  <td className="num">{row.roundPointsAgainst}</td>
                  <td className="num">{row.pointsPerRound === null ? "—" : row.pointsPerRound.toFixed(1)}</td>
                  <td className="num">{row.twenties}</td>
                  <td className="num">{row.twentiesPerGame.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
