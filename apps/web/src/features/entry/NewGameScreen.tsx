import { configFor, playersPerTeam, type Format } from "@crokinole/core";
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useStore } from "../../data/store";
import { Card, SegmentedControl } from "../../ui/components";

/**
 * Game setup — §3.5 step 1. Done once per game, and the friction here is what
 * stops people logging the fourth and fifth game of a night, so: date defaults
 * to today, one bet input autofills everyone, and a single swap flips partners.
 */
export function NewGameScreen(): ReactNode {
  const { players, createGame } = useStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [format, setFormat] = useState<Format>("doubles");
  // "Same four, next game" (§3.5 step 5) arrives as a query param — the single
  // most important affordance in the app, since you play five in a night.
  const [selected, setSelected] = useState<string[]>(() => {
    const repeat = params.get("players");
    return repeat ? repeat.split(",").filter(Boolean) : [];
  });
  const [blackTeam, setBlackTeam] = useState<"A" | "B">("A");
  const [betDollars, setBetDollars] = useState("5");

  const perTeam = playersPerTeam(configFor(format));
  const needed = perTeam * 2;
  const ready = selected.length === needed;

  const teamA = useMemo(() => selected.slice(0, perTeam), [selected, perTeam]);
  const teamB = useMemo(() => selected.slice(perTeam, needed), [selected, perTeam, needed]);

  const toggle = (id: string): void => {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((existing) => existing !== id)
        : current.length >= needed
          ? current
          : [...current, id],
    );
  };

  const swapSides = (): void => setSelected((current) => [...current.slice(perTeam), ...current.slice(0, perTeam)]);

  const swapPartners = (): void =>
    setSelected((current) =>
      perTeam === 2 && current.length === 4
        ? [current[0] ?? "", current[2] ?? "", current[1] ?? "", current[3] ?? ""]
        : current,
    );

  const start = (): void => {
    const cents = Math.round(Number.parseFloat(betDollars || "0") * 100);
    const amount = Number.isFinite(cents) && cents >= 0 ? cents : 0;
    const id = createGame({
      format,
      playedAt: Date.now(),
      teamA,
      teamB,
      blackTeam,
      betCentsByPlayer: Object.fromEntries(selected.map((playerId) => [playerId, amount])),
    });
    navigate(`/games/${id}/play`);
  };

  const nameOf = (id: string): string =>
    players.find((player) => player.id === id)?.displayName ?? "?";

  return (
    <div className="stack">
      <Card title="Format">
        <SegmentedControl
          label="Format"
          value={format}
          onChange={(next) => {
            setFormat(next);
            setSelected([]);
          }}
          options={[
            { value: "doubles", label: "Doubles · 6 discs" },
            { value: "singles", label: "Singles · 8 discs" },
          ]}
        />
      </Card>

      <Card title={`Players — pick ${needed}`}>
        <div className="chips">
          {players
            .filter((player) => player.isActive)
            .map((player) => (
              <button
                key={player.id}
                type="button"
                className="chip"
                aria-pressed={selected.includes(player.id)}
                onClick={() => toggle(player.id)}
              >
                {player.displayName}
              </button>
            ))}
        </div>
        {selected.length > 0 ? (
          <p className="faint" style={{ marginBottom: 0 }}>
            Tapped in order — first {perTeam} make one side.
          </p>
        ) : null}
      </Card>

      {ready ? (
        <Card title="Sides">
          <div className="spread" style={{ marginBottom: "0.75rem" }}>
            <div>
              <span className={`disc disc--${blackTeam === "A" ? "black" : "white"}`} />{" "}
              <strong>{teamA.map(nameOf).join(" & ")}</strong>
            </div>
            <span className="faint">vs</span>
            <div style={{ textAlign: "right" }}>
              <strong>{teamB.map(nameOf).join(" & ")}</strong>{" "}
              <span className={`disc disc--${blackTeam === "B" ? "black" : "white"}`} />
            </div>
          </div>
          <div className="row">
            <button type="button" className="btn btn--ghost" onClick={swapSides}>
              Swap sides
            </button>
            {perTeam === 2 ? (
              <button type="button" className="btn btn--ghost" onClick={swapPartners}>
                Swap partners
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setBlackTeam((current) => (current === "A" ? "B" : "A"))}
            >
              Flip colours
            </button>
          </div>
        </Card>
      ) : null}

      <Card title="Bet — everyone">
        <div className="row">
          <span style={{ fontSize: "1.4rem", fontWeight: 700 }}>$</span>
          <input
            className="btn"
            style={{ flex: 1, textAlign: "center", fontSize: "1.3rem" }}
            inputMode="decimal"
            value={betDollars}
            onChange={(event) => setBetDollars(event.target.value)}
            aria-label="Bet per player in dollars"
          />
        </div>
        <p className="faint" style={{ marginBottom: 0 }}>
          Everyone pays in; the winning side splits the whole pot. Equal $5 bets means
          <strong> +$5 each</strong> for the winners.
        </p>
      </Card>

      <button
        type="button"
        className="btn btn--accent btn--block btn--lg"
        disabled={!ready}
        onClick={start}
      >
        {ready ? "Start game" : `Pick ${needed - selected.length} more`}
      </button>
    </div>
  );
}
