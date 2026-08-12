import {
  currentNightKey,
  gamesOnNight,
  shuffle,
  suggestSeating,
  type DiscColor,
  type Format,
} from "@crokinole/core";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { useStore, useVisibleGames } from "../../data/store";
import { Card, Loading, SegmentedControl } from "../../ui/components";
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
  const { availablePlayers, createGame, isLoading } = useStore();
  const allGames = useVisibleGames();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const tonightGames = useMemo(
    () => gamesOnNight(allGames, currentNightKey()),
    [allGames],
  );

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

  /** Re-seat the people already chosen, without changing who's playing. */
  const reshuffleSeats = (): void => {
    const seated = activeSeats.map((seat) => seats[seat]).filter(Boolean);
    if (seated.length < activeSeats.length) return;
    const mixed = shuffle(seated);
    setSeats((current) => {
      const next = { ...current };
      activeSeats.forEach((seat, i) => {
        next[seat] = mixed[i] ?? "";
      });
      return next;
    });
  };

  /** Pick a whole new four, favouring partnerships that haven't happened tonight. */
  const suggest = (): void => {
    const seating = suggestSeating(
      availablePlayers.map((player) => player.id),
      tonightGames,
      format,
    );
    if (!seating) return;
    setSeats(
      singles
        ? { top: seating.teamA[0] ?? "", bottom: seating.teamB[0] ?? "", left: "", right: "" }
        : {
            top: seating.teamA[0] ?? "",
            bottom: seating.teamA[1] ?? "",
            right: seating.teamB[0] ?? "",
            left: seating.teamB[1] ?? "",
          },
    );
  };

  const seatControl = (seat: SeatKey): ReactNode => {
    const isSideSeat = seat === "left" || seat === "right";
    return (
      <div className={`seat seat--${seat}`} key={seat}>
        {/* No seat label — the discs drawn on the board say which side is which,
            and the labels were the difference between fitting on an iPhone 15
            and not. */}
        <select
          className={`seat__select${seats[seat] ? "" : " seat__select--empty"}`}
          value={seats[seat]}
          onChange={(event) => pick(seat, event.target.value)}
          aria-label={`${seatName(seat, singles)} player`}
        >
          <option value="">{isSideSeat ? "Pick" : "Choose…"}</option>
          {availablePlayers.map((player) => (
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

  const here = availablePlayers.length;
  const enoughForDoubles = here >= 4;
  const enoughForSingles = here >= 2;

  /*
   * `availablePlayers` is `players` (Convex, async) ∩ `presentIds`
   * (localStorage, instant), so until the players land it is empty however many
   * people you marked in — and the screen below would tell you that you hadn't
   * marked anyone, then send you to a tab where they're all already ticked.
   */
  if (isLoading) {
    return (
      <Card>
        <Loading rows={3} />
      </Card>
    );
  }

  if (!enoughForSingles) {
    return (
      <Card title="Nobody's here yet">
        <p style={{ marginTop: 0 }}>
          Mark who's at the table on the <strong>Standings</strong> tab and the seats will fill
          from that list.
        </p>
        <Link className="btn btn--accent btn--block btn--lg" to="/">
          Mark who's here
        </Link>
      </Card>
    );
  }

  return (
    <div className="stack">
      <Card title="Format">
        <SegmentedControl
          label="Format"
          value={format}
          onChange={(next) => setFormat(next)}
          options={[
            { value: "doubles", label: "Doubles", disabled: !enoughForDoubles },
            { value: "singles", label: "Singles" },
          ]}
        />
        {enoughForDoubles ? null : (
          <p className="faint" style={{ margin: "0.5rem 0 0" }}>
            Doubles needs four people here — {here} marked in.
          </p>
        )}
      </Card>

      <Card>
        {/* The grid is identical in both formats — singles simply leaves the
            side seats empty, so the board never changes size when you toggle. */}
        <div className="table-layout">
          {seatControl("top")}
          {singles ? null : seatControl("left")}
          <div className="table-layout__board">
            <Board topColor={topColor} sideColor={sideColor} singles={singles} />
          </div>
          {singles ? null : seatControl("right")}
          {seatControl("bottom")}
        </div>

        <div className="tools">
          <button
            type="button"
            className="tools__btn"
            onClick={() => setTopIsBlack((current) => !current)}
            title="Flip colours"
            aria-label="Flip colours"
          >
            <span className="tools__glyph" aria-hidden="true">
              <span className="disc disc--black" />
              <span className="disc disc--white" />
            </span>
            Colours
          </button>
          <button
            type="button"
            className="tools__btn"
            onClick={reshuffleSeats}
            disabled={!ready}
            title="Same players, new seats"
            aria-label="Shuffle the seating of the current players"
          >
            <span className="tools__glyph" aria-hidden="true">
              ⇄
            </span>
            Re-seat
          </button>
          <button
            type="button"
            className="tools__btn"
            onClick={suggest}
            disabled={availablePlayers.length < (singles ? 2 : 4)}
            title="New pairing, favouring partners who haven't played together tonight"
            aria-label="Suggest a pairing that hasn't happened tonight"
          >
            <span className="tools__glyph" aria-hidden="true">
              ⤮
            </span>
            Mix up
          </button>
        </div>
      </Card>

      <Card>
        {/*
         * A form so Enter commits and dismisses the keyboard. The label, the $
         * and the field are one group centred on the page, and the field grows
         * with the number rather than the group shifting off centre.
         */}
        <form
          className="bet-row"
          onSubmit={(event) => {
            event.preventDefault();
            (event.currentTarget.querySelector("input") as HTMLInputElement | null)?.blur();
          }}
        >
          <span className="bet-row__label">Bet</span>
          <span style={{ fontSize: "1.35rem", fontWeight: 700 }}>$</span>
          <input
            className="bet-row__input"
            inputMode="decimal"
            enterKeyHint="done"
            value={betDollars}
            // Fits 999 at rest and widens as you type past it. The floor is 3
            // rather than the current length so the box doesn't visibly shrink
            // and grow around a single digit.
            style={{ width: `calc(${Math.max(3, betDollars.length)}ch + 1.1rem)` }}
            onChange={(event) => setBetDollars(event.target.value)}
            aria-label="Bet per player in dollars"
          />
        </form>
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
