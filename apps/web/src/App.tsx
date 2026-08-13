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
  const { isLoading, isCreatingGame } = useStore();
  const live = useLiveGame();
  /*
   * The two moments in which the database has not yet said whether there is a
   * game to resume. They arrive from opposite directions and both end with
   * `live === undefined`, which is why they share a branch:
   *
   *  - `isLoading` — the games subscription hasn't delivered anything yet, so a
   *    game may well be running and we simply can't see it. Cold load.
   *  - `isCreatingGame && !live` — `createGame` has been called and the setup
   *    screen has already navigated to /games/<placeholder>/play, but the
   *    Convex insert hasn't landed. `isLoading` is long since false here, so
   *    without this the bar rendered the *New* branch for that one round trip
   *    and the button flashed a green cross pointing at /games/new the instant
   *    the setup screen went away. Read `isCreatingGame`'s doc comment in the
   *    store: it is derived during render precisely so this flips back on the
   *    same commit the game lands on, with no trailing frame to paper over.
   *
   * `&& !live` because the previous game is still live while the next one is
   * being born — going straight from one game to another must keep offering
   * Resume rather than blanking the button for a round trip.
   */
  const waiting = isLoading || (isCreatingGame && !live);
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
      {waiting ? (
        /*
         * Whether this is "Resume" or "New" is a fact about the database, and
         * in the two moments listed above we don't have it: `live` is undefined
         * because the games haven't arrived (or the new one hasn't been
         * inserted yet), which looks exactly like there being no game in
         * progress. Left alone, the button says New and points at /games/new —
         * so a mid-game refresh followed by a tap on the biggest target on
         * screen starts a *second* game against the same four people, and the
         * real one is stranded in history.
         *
         * The other two options were worse. Guessing "Resume" needs an id we
         * don't have. Keeping the link live and correcting the label a moment
         * later means the tap that lands in that moment still navigates
         * wrongly, which is the case we're here to fix. So: hold the shape,
         * hold the space, take no tap, claim nothing. It costs a beat of
         * unavailability on a cold load and one round trip after Start game,
         * and nothing at all otherwise.
         *
         * A timeout, a fade or a transition delay would only move the flash
         * behind a curtain — the button would still be claiming "New" while it
         * was hidden, and a tap during the curtain would still go to the wrong
         * place. The cure is to not make the claim.
         */
        <button
          type="button"
          className="tabbar__link tabbar__link--board tabbar__link--waiting"
          disabled
          aria-busy="true"
        >
          <span className="boardbtn" aria-hidden="true">
            {/* No mark at all: either one is a claim we can't make yet. */}
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
        <span className="tabbar__glyph tabbar__glyph--icon" aria-hidden="true">
          <GearGlyph />
        </span>
        Settings
      </NavLink>
    </nav>
  );
}

/**
 * Settings, drawn to belong to the tray.
 *
 * Its four neighbours are literal text characters — ◎ ▤ ▦ — which every
 * platform resolves out of its symbol font: flat, monochrome, `currentColor`,
 * so they go faint with the rest of the bar and red on the current page. ⚙
 * (U+2699) does not: Windows and iOS both hand it to the *emoji* font, so the
 * one tab in five came back as a full-colour picture at its own weight, ignored
 * the tab's colour entirely, and read as something pasted in from another app.
 *
 * A variation selector to force text presentation is a request, not a
 * guarantee, and it fails differently on every platform. So the gear is drawn
 * here instead: a cog at 20 of the 24-unit box, matching the ink the symbol
 * characters put down, stroked in `currentColor` so it inherits every state the
 * others do.
 */
function GearGlyph(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" className="gearglyph" aria-hidden="true" focusable="false">
      {/*
       * Eight teeth on the diagonals and the axes, each a radial stub from r=6.6
       * to r=10. They start inside the body's stroke so the two read as one
       * solid cog rather than a ring with spokes leaning on it.
       */}
      <path
        className="gearglyph__teeth"
        d="M12 2 V5.4 M12 22 V18.6 M2 12 H5.4 M22 12 H18.6
           M19.07 4.93 L16.67 7.33 M4.93 19.07 L7.33 16.67
           M4.93 4.93 L7.33 7.33 M19.07 19.07 L16.67 16.67"
      />
      {/* The body is a stroked circle, so the hole in the middle costs nothing. */}
      <circle cx="12" cy="12" r="6.2" className="gearglyph__body" />
    </svg>
  );
}

/**
 * The board, drawn small. `mark` is the overlay that says what tapping it does
 * — a play triangle to resume, a cross to start — and is left off entirely while
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
       * shapes: both filled outlines, no stroke on either, matched span and
       * matched optical mass. What they are is the whole message — a tap here
       * either resumes a game or starts one — so each has to be unmistakable
       * from across a table at 3.6rem.
       *
       * Both used to be *stroked* at width 8 with round caps and joins, on the
       * theory that a shared stroke made them siblings. It made them blobs: the
       * cross's round caps swelled it into a soft clover, and the triangle,
       * filled *and* stroked, grew 4 units in every direction into an orange
       * lozenge with no point on it. Geometry does the matching now.
       *
       * The triangle is placed on its centroid, not its bounding box — a right-
       * pointing triangle centred by its box reads as sliding off to the left.
       */}
      {mark === "resume" ? (
        <path
          d="M16.5 10.5 L38.5 24 L16.5 37.5 Z"
          className="boardbtn__glyph boardbtn__glyph--play"
        />
      ) : null}
      {/*
       * A Greek cross: arms 26 long and 8 thick about the centre, drawn as a
       * filled outline so the ends are square by construction. Nothing here can
       * be softened by a cap or a join, which is the point.
       */}
      {mark === "new" ? (
        <path
          d="M20 11 H28 V20 H37 V28 H28 V37 H20 V28 H11 V20 H20 Z"
          className="boardbtn__glyph boardbtn__glyph--plus"
        />
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
