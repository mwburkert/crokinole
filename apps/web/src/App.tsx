import type { ReactNode } from "react";
import { NavLink, Route, Routes } from "react-router-dom";

import { StoreProvider, useLiveGame } from "./data/store";
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
      <NavLink to={live ? `/games/${live.id}/play` : "/games/new"} className="tabbar__link">
        <span className="tabbar__glyph" aria-hidden="true">
          ⊕
        </span>
        {live ? "Resume" : "New"}
      </NavLink>
      <NavLink to="/stats" className="tabbar__link">
        <span className="tabbar__glyph" aria-hidden="true">
          ▦
        </span>
        Stats
      </NavLink>
    </nav>
  );
}

function TopBar(): ReactNode {
  return (
    <header className="topbar">
      <div className="topbar__inner">
        <h1 className="topbar__title">
          <span className="disc disc--black" aria-hidden="true" />
          <span className="disc disc--white" aria-hidden="true" />
          Crokinole
        </h1>
        <span className="topbar__meta">burkert.app</span>
      </div>
    </header>
  );
}

export function App(): ReactNode {
  return (
    <StoreProvider>
      <div className="app">
        <TopBar />
        <main className="app__main">
          <Routes>
            <Route path="/" element={<LeaderboardScreen />} />
            <Route path="/games" element={<HistoryScreen />} />
            <Route path="/games/new" element={<NewGameScreen />} />
            <Route path="/games/:gameId" element={<GameDetailScreen />} />
            <Route path="/games/:gameId/play" element={<EntryScreen />} />
            <Route path="/stats" element={<StatsScreen />} />
            <Route path="*" element={<p className="empty">Nothing here.</p>} />
          </Routes>
        </main>
        <TabBar />
      </div>
    </StoreProvider>
  );
}
