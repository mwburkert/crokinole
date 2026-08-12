import type { ReactNode } from "react";
import { NavLink, Route, Routes } from "react-router-dom";

import { StoreProvider, useLiveGame } from "./data/store";
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
      <NavLink
        to={live ? `/games/${live.id}/play` : "/games/new"}
        className="tabbar__link tabbar__link--board"
        aria-label={live ? "Resume game" : "New game"}
      >
        <span className="boardbtn" aria-hidden="true">
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
            {live ? (
              <path d="M17 12 L37 24 L17 36 Z" className="boardbtn__mark" />
            ) : (
              <path d="M24 9 V39 M9 24 H39" className="boardbtn__plus" />
            )}
          </svg>
        </span>
        {live ? "Resume" : "New"}
      </NavLink>
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
            <Route path="/games/:gameId/play" element={<EntryScreen />} />
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
