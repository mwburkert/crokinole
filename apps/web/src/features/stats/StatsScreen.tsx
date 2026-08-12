import { useMemo, useState, type ReactNode } from "react";

import { useLeaderboard } from "../../data/store";
import { Card, Empty, Money } from "../../ui/components";

type SortKey =
  | "displayName"
  | "gamesPlayed"
  | "gamesWon"
  | "winPct"
  | "matchPointsFor"
  | "roundPointsFor"
  | "netCents";

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "displayName", label: "Player", numeric: false },
  { key: "gamesPlayed", label: "GP", numeric: true },
  { key: "gamesWon", label: "W", numeric: true },
  { key: "winPct", label: "Win %", numeric: true },
  { key: "matchPointsFor", label: "MP for", numeric: true },
  { key: "roundPointsFor", label: "Pts for", numeric: true },
  { key: "netCents", label: "Net", numeric: true },
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

  const sorted = useMemo(() => {
    const played = rows.filter((row) => row.gamesPlayed > 0);
    return [...played].sort((a, b) =>
      sort === "displayName"
        ? a.displayName.localeCompare(b.displayName)
        : Number(b[sort]) - Number(a[sort]),
    );
  }, [rows, sort]);

  if (sorted.length === 0) {
    return (
      <Card title="Stats">
        <Empty>Play a game and the numbers start here.</Empty>
      </Card>
    );
  }

  return (
    <div className="stack">
      <Card title="Lifetime">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
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
                  <td>{row.displayName}</td>
                  <td className="num">{row.gamesPlayed}</td>
                  <td className="num">{row.gamesWon}</td>
                  <td className="num">{Math.round(row.winPct * 100)}%</td>
                  <td className="num">{row.matchPointsFor}</td>
                  <td className="num">{row.roundPointsFor}</td>
                  <td>
                    <Money cents={row.netCents} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="faint" style={{ marginBottom: 0 }}>
          Tap a column to sort. Every figure is derived from the stored rounds — nothing here is
          a saved total.
        </p>
      </Card>
    </div>
  );
}
