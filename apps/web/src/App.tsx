import type { ReactNode } from "react";
import { NavLink, Route, Routes, useParams } from "react-router-dom";

import { StoreProvider, useLiveGame, useStore } from "./data/store";
import { AdminScreen } from "./features/admin/AdminScreen";
import { EntryScreen } from "./features/entry/EntryScreen";
import { NewGameScreen } from "./features/entry/NewGameScreen";
import { GameDetailScreen } from "./features/history/GameDetailScreen";
import { HistoryScreen } from "./features/history/HistoryScreen";
import { LeaderboardScreen } from "./features/leaderboard/LeaderboardScreen";
import { StatsScreen } from "./features/stats/StatsScreen";

/**
 * Five routes (§3.5). **All of them are behind auth** — the public leaderboard
 * was removed on 2026-08-12, so there is no anonymous surface to reason about.
 * Cloudflare Access gates the whole hostname; Convex validates the JWT and its
 * AUD on every call.
 */
function TabBar(): ReactNode {
  const { isLoading } = useStore();
  const live = useLiveGame();
  return (
    <nav className="tabbar" aria-label="Main">
      <NavLink to="/" className="tabbar__link" end>
        <span className="tabbar__glyph" aria-hidden="true">
          ◎
        </span>
        Standings
      </NavLink>
      {/*
        `end` matters here: without it, NavLink matches by prefix and "History"
        would light up on /games/new and /games/:id/play too, so the tab bar
        would lie about where you are during the entire entry flow.
      */}
      <NavLink to="/games" className="tabbar__link" end>
        <span className="tabbar__glyph" aria-hidden="true">
          ▤
        </span>
        History
      </NavLink>
      {/* The primary action, shaped like the thing it starts. Rides above the
          bar with a collar of the bar's own colour, which is what cuts the top
          line and reads as a bulge. */}
      {isLoading ? (
        /*
         * Whether this is "Resume" or "New" is a fact about the database, and
         * for the first frames we don't have it: `live` is undefined because
         * the games haven't arrived, which looks exactly like there being no
         * game in progress. Left alone, the button says New and points at
         * /games/new — so a mid-game refresh followed by a tap on the biggest
         * target on screen starts a *second* game against the same four people,
         * and the real one is stranded in history.
         *
         * The other two options were worse. Guessing "Resume" needs an id we
         * don't have. Keeping the link live and correcting the label a moment
         * later means the tap that lands in that moment still navigates
         * wrongly, which is the case we're here to fix. So: hold the shape,
         * hold the space, take no tap, claim nothing. It costs a beat of
         * unavailability on a cold load and nothing at all afterwards —
         * `isLoading` never goes true again for reactive updates.
         */
        <button
          type="button"
          className="tabbar__link tabbar__link--board tabbar__link--waiting"
          disabled
          aria-busy="true"
        >
          <span className="boardbtn" aria-hidden="true">
            {/* No mark and no plus: both are the claim we can't make yet. */}
            <BoardGlyph />
          </span>
          Board
        </button>
      ) : (
        <NavLink
          to={live ? `/games/${live.id}/play` : "/games/new"}
          className="tabbar__link tabbar__link--board"
          aria-label={live ? "Resume game" : "New game"}
        >
          <span className="boardbtn" aria-hidden="true">
            <BoardGlyph mark={live ? "resume" : "new"} />
          </span>
          {live ? "Resume" : "New"}
        </NavLink>
      )}
      <NavLink to="/stats" className="tabbar__link">
        <span className="tabbar__glyph" aria-hidden="true">
          ▦
        </span>
        Stats
      </NavLink>
      {/* The gear used to live in a title bar that existed only to hold it. */}
      <NavLink to="/admin" className="tabbar__link">
        <span className="tabbar__glyph" aria-hidden="true">
          ⚙
        </span>
        Settings
      </NavLink>
    </nav>
  );
}

/**
 * The board, drawn small. `mark` is the overlay that says what tapping it does
 * — a play triangle to resume, a plus to start — and is left off entirely while
 * the store hasn't said which it is.
 */
function BoardGlyph({ mark }: { mark?: "resume" | "new" }): ReactNode {
  return (
    <svg viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="23" className="boardbtn__frame" />
      <circle cx="24" cy="24" r="20" className="boardbtn__surface" />
      <circle cx="24" cy="24" r="13.5" className="boardbtn__ring" />
      <circle cx="24" cy="24" r="7" className="boardbtn__ring" />
      {/* Quadrant dividers, as on the real board's outer ring. */}
      <path
        d="M33.5 14.5 L38.6 9.4 M14.5 14.5 L9.4 9.4 M33.5 33.5 L38.6 38.6 M14.5 33.5 L9.4 38.6"
        className="boardbtn__ring"
      />
      <circle cx="24" cy="24" r="2.6" className="boardbtn__hole" />
      {/*
       * Two states of one control, so they are drawn as one glyph in two
       * shapes: same stroke weight, same rounded joins, matched optical mass.
       * Both are stroked — the triangle is filled *and* stroked — which is what
       * gives the play mark the same corner radius as the plus's caps, and what
       * makes the pair read as siblings rather than two borrowed icons. Sizes
       * are the inner paths; the stroke grows each by half its width.
       */}
      {mark === "resume" ? (
        <path
          d="M17.5 13.8 L35 24 L17.5 34.2 Z"
          className="boardbtn__glyph boardbtn__glyph--play"
        />
      ) : null}
      {mark === "new" ? (
        <path d="M24 11.5 V36.5 M11.5 24 H36.5" className="boardbtn__glyph boardbtn__glyph--plus" />
      ) : null}
    </svg>
  );
}

/**
 * The entry screen, remounted whenever the game changes.
 *
 * React Router keeps the same element mounted when only a path *param* changes,
 * so going from one game's play screen straight to another's carried the whole
 * of `EntryScreen`'s state across: the discs placed on the previous board, the
 * undo stack, which round the correction sheet was paged to, and whether the
 * end-of-game scorecard was showing. Every one of those belongs to a specific
 * game and none of them mean anything on the next one.
 *
 * Keying on the id makes "which game" part of the component's identity, so the
 * state cannot outlive the game it describes. Cheaper and far more reliable
 * than resetting a dozen `useState`s in an effect and remembering to add the
 * thirteenth.
 */
function KeyedEntryScreen(): ReactNode {
  const { gameId } = useParams();
  return <EntryScreen key={gameId} />;
}

export function App(): ReactNode {
  return (
    <StoreProvider>
      <div className="app">
        <main className="app__main">
          <Routes>
            <Route path="/" element={<LeaderboardScreen />} />
            <Route path="/games" element={<HistoryScreen />} />
            <Route path="/games/new" element={<NewGameScreen />} />
            <Route path="/games/:gameId" element={<GameDetailScreen />} />
            <Route path="/games/:gameId/play" element={<KeyedEntryScreen />} />
            <Route path="/stats" element={<StatsScreen />} />
            <Route path="/admin" element={<AdminScreen />} />
            <Route path="*" element={<p className="empty">Nothing here.</p>} />
          </Routes>
        </main>
        <TabBar />
      </div>
    </StoreProvider>
  );
}
