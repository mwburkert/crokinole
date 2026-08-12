import type { DiscColor, Format } from "@crokinole/core";
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useStore } from "../../data/store";
import { Card, SegmentedControl } from "../../ui/components";
import { Board } from "./Board";

/**
 * Game setup — §3.5 step 1.
 *
 * Laid out as the table you're actually sitting at: a board with a seat on each
 * side. **Partners sit across from each other**, so top+bottom are one team and
 * left+right the other — which means the seating picture carries the whole team
 * structure and there is nothing to "swap". Choosing a different partner is
 * just picking a different name in a seat.
 *
 * Friction here is what stops people logging the fourth and fifth game of a
 * night, so: date is today, colours flip with one tap, and the bet autofills
 * everyone.
 */

type SeatKey = "top" | "right" | "bottom" | "left";

const DOUBLES_SEATS: SeatKey[] = ["top", "right", "bottom", "left"];
const SINGLES_SEATS: SeatKey[] = ["top", "bottom"];

export function NewGameScreen(): ReactNode {
  const { players, createGame } = useStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [format, setFormat] = useState<Format>(() =>
    params.get("format") === "singles" ? "singles" : "doubles",
  );
  const [topIsBlack, setTopIsBlack] = useState(true);
  const [betDollars, setBetDollars] = useState("1");

  // "Same four, next game" (§3.5 step 5) arrives as ?players=a1,a2,b1,b2 — the
  // single most important affordance in the app, since you play five in a night.
  // Partners are across, so team A takes top+bottom and team B the sides.
  const [seats, setSeats] = useState<Record<SeatKey, string>>(() => {
    const repeat = (params.get("players") ?? "").split(",").filter(Boolean);
    return {
      top: repeat[0] ?? "",
      bottom: repeat[1] ?? "",
      right: repeat[2] ?? "",
      left: repeat[3] ?? "",
    };
  });

  const singles = format === "singles";
  const activeSeats = singles ? SINGLES_SEATS : DOUBLES_SEATS;
  const ready = activeSeats.every((seat) => seats[seat] !== "");

  const topColor: DiscColor = topIsBlack ? "black" : "white";
  const sideColor: DiscColor = topIsBlack ? "white" : "black";

  const taken = useMemo(
    () => new Set(activeSeats.map((seat) => seats[seat]).filter(Boolean)),
    [activeSeats, seats],
  );

  const pick = (seat: SeatKey, playerId: string): void =>
    setSeats((current) => {
      // Picking someone who's already seated moves them, rather than silently
      // putting the same person in two chairs.
      const next = { ...current };
      for (const key of DOUBLES_SEATS) {
        if (next[key] === playerId) next[key] = "";
      }
      next[seat] = playerId;
      return next;
    });

  const start = (): void => {
    const parsed = Number.parseFloat(betDollars || "0");
    const cents = Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : 0;

    const teamA = singles ? [seats.top] : [seats.top, seats.bottom];
    const teamB = singles ? [seats.bottom] : [seats.right, seats.left];

    const id = createGame({
      format,
      playedAt: Date.now(),
      teamA,
      teamB,
      blackTeam: topIsBlack ? "A" : "B",
      betCentsByPlayer: Object.fromEntries(
        [...teamA, ...teamB].map((playerId) => [playerId, cents]),
      ),
    });
    navigate(`/games/${id}/play`);
  };

  const seatControl = (seat: SeatKey): ReactNode => {
    const isSideSeat = seat === "left" || seat === "right";
    const color = singles ? (seat === "top" ? topColor : sideColor) : isSideSeat ? sideColor : topColor;
    return (
      <div className={`seat seat--${seat}`} key={seat}>
        <span className="seat__label">
          <span className={`disc disc--${color}`} aria-hidden="true" />
          {seatName(seat, singles)}
        </span>
        <select
          className={`seat__select${seats[seat] ? "" : " seat__select--empty"}`}
          value={seats[seat]}
          onChange={(event) => pick(seat, event.target.value)}
          aria-label={`${seatName(seat, singles)} player`}
        >
          <option value="">{isSideSeat ? "Pick" : "Choose…"}</option>
          {players
            .filter((player) => player.isActive)
            .map((player) => (
              <option
                key={player.id}
                value={player.id}
                disabled={taken.has(player.id) && seats[seat] !== player.id}
              >
                {player.displayName}
              </option>
            ))}
        </select>
      </div>
    );
  };

  return (
    <div className="stack">
      <Card title="Format">
        <SegmentedControl
          label="Format"
          value={format}
          onChange={(next) => setFormat(next)}
          options={[
            { value: "doubles", label: "Doubles" },
            { value: "singles", label: "Singles" },
          ]}
        />
      </Card>

      <Card title={singles ? "Who's playing" : "Round the board — partners sit opposite"}>
        <div className={`table-layout${singles ? " table-layout--singles" : ""}`}>
          {seatControl("top")}
          {singles ? null : seatControl("left")}
          <div className="table-layout__board">
            <Board topColor={topColor} sideColor={sideColor} singles={singles} />
          </div>
          {singles ? null : seatControl("right")}
          {seatControl("bottom")}
        </div>

        <button
          type="button"
          className="btn btn--ghost btn--block"
          style={{ marginTop: "var(--gap)" }}
          onClick={() => setTopIsBlack((current) => !current)}
        >
          Flip colours
        </button>
      </Card>

      <Card title="Bet">
        <div className="bet-row">
          <span style={{ fontSize: "1.5rem", fontWeight: 700 }}>$</span>
          <input
            className="bet-row__input"
            inputMode="decimal"
            value={betDollars}
            onChange={(event) => setBetDollars(event.target.value)}
            aria-label="Bet per player in dollars"
          />
        </div>
      </Card>

      <button
        type="button"
        className="btn btn--accent btn--block btn--lg"
        disabled={!ready}
        onClick={start}
      >
        {ready ? "Start game" : "Fill every seat"}
      </button>
    </div>
  );
}

function seatName(seat: SeatKey, singles: boolean): string {
  if (singles) return seat === "top" ? "Player 1" : "Player 2";
  switch (seat) {
    case "top":
      return "Top";
    case "bottom":
      return "Bottom";
    case "left":
      return "Left";
    case "right":
      return "Right";
  }
}
