/**
 * The data seam.
 *
 * Every screen talks to this hook and nothing else. Today it is backed by
 * in-memory fixtures; swapping the body for `useQuery`/`useMutation` against
 * Convex is the whole of the wiring job once `convex dev` has produced
 * `_generated` (§6.2 — agent C works against fixtures so backend and frontend
 * never block each other).
 *
 * Deliberately mirrors the Convex function surface one-for-one:
 *   games.list / games.get / games.create / games.addRound /
 *   games.removeLastRound / games.softDelete / stats.leaderboard
 */

import {
  aggregateStats,
  configFor,
  gameStanding,
  groupByNight,
  settle,
  type Format,
  type GameWithRounds,
  type PlayerStats,
  type RingCounts,
  type Settlement,
} from "@crokinole/core";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { GAMES, PLAYERS, type Player } from "./fixtures";

export interface NewGameInput {
  format: Format;
  playedAt: number;
  teamA: string[];
  teamB: string[];
  /** Which side plays black. The other side is white. */
  blackTeam: "A" | "B";
  betCentsByPlayer: Record<string, number>;
}

interface StoreValue {
  players: Player[];
  games: GameWithRounds[];
  createGame: (input: NewGameInput) => string;
  addRound: (gameId: string, a: RingCounts, b: RingCounts) => void;
  removeLastRound: (gameId: string) => void;
  softDelete: (gameId: string) => void;
  getGame: (gameId: string) => GameWithRounds | undefined;
}

const StoreContext = createContext<StoreValue | null>(null);

let nextId = 1000;

export function StoreProvider({ children }: { children: ReactNode }): ReactNode {
  const [games, setGames] = useState<GameWithRounds[]>(() => [...GAMES]);

  const createGame = useCallback((input: NewGameInput): string => {
    const id = `g-${(nextId += 1)}`;
    const config = configFor(input.format);
    const playerIds = [...input.teamA, ...input.teamB];

    setGames((current) => [
      {
        id,
        playedAt: input.playedAt,
        status: "in_progress",
        config,
        teams: {
          A: {
            color: input.blackTeam === "A" ? "black" : "white",
            playerIds: input.teamA,
          },
          B: {
            color: input.blackTeam === "B" ? "black" : "white",
            playerIds: input.teamB,
          },
        },
        bets: playerIds.map((playerId) => ({
          playerId,
          amountCents: input.betCentsByPlayer[playerId] ?? 0,
        })),
        rounds: [],
      },
      ...current,
    ]);
    return id;
  }, []);

  const addRound = useCallback((gameId: string, a: RingCounts, b: RingCounts): void => {
    setGames((current) =>
      current.map((game) => {
        if (game.id !== gameId) return game;
        const rounds = [...game.rounds, { index: game.rounds.length, A: a, B: b }];
        // Completion is derived, never decided by the UI (§3.5).
        const status = gameStanding(rounds, game.config).isComplete ? "final" : "in_progress";
        return { ...game, rounds, status };
      }),
    );
  }, []);

  const removeLastRound = useCallback((gameId: string): void => {
    setGames((current) =>
      current.map((game) => {
        if (game.id !== gameId || game.rounds.length === 0) return game;
        const rounds = game.rounds.slice(0, -1);
        const status = gameStanding(rounds, game.config).isComplete ? "final" : "in_progress";
        return { ...game, rounds, status };
      }),
    );
  }, []);

  const softDelete = useCallback((gameId: string): void => {
    // Soft delete only (§3.2.4) — the row stays, history hides it.
    setGames((current) =>
      current.map((game) =>
        game.id === gameId ? { ...game, deletedAt: Date.now() } : game,
      ),
    );
  }, []);

  const getGame = useCallback(
    (gameId: string): GameWithRounds | undefined =>
      games.find((game) => game.id === gameId),
    [games],
  );

  const value = useMemo<StoreValue>(
    () => ({
      players: PLAYERS,
      games,
      createGame,
      addRound,
      removeLastRound,
      softDelete,
      getGame,
    }),
    [games, createGame, addRound, removeLastRound, softDelete, getGame],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useStore must be used inside <StoreProvider>.");
  return value;
}

/** Games that haven't been deleted, newest first. */
export function useVisibleGames(): GameWithRounds[] {
  const { games } = useStore();
  return useMemo(
    () =>
      games
        .filter((game) => game.deletedAt === undefined)
        .sort((a, b) => b.playedAt - a.playedAt),
    [games],
  );
}

export function useLeaderboard(): (PlayerStats & { displayName: string })[] {
  const { players } = useStore();
  const games = useVisibleGames();
  return useMemo(() => {
    const rows = aggregateStats(games, {
      includePlayerIds: players.filter((p) => p.isActive).map((p) => p.id),
    });
    const names = new Map(players.map((p) => [p.id, p.displayName]));
    return rows.map((row) => ({
      ...row,
      displayName: names.get(row.playerId) ?? "Unknown",
    }));
  }, [games, players]);
}

export interface NightSummary {
  date: string;
  games: GameWithRounds[];
  settlement: Settlement[];
}

export function useNights(): NightSummary[] {
  const games = useVisibleGames();
  return useMemo(
    () =>
      groupByNight(games).map((night) => {
        const totals = new Map<string, number>();
        for (const game of night.games) {
          for (const entry of settle(game)) {
            totals.set(entry.playerId, (totals.get(entry.playerId) ?? 0) + entry.netCents);
          }
        }
        return {
          date: night.date,
          games: [...night.games].sort((a, b) => b.playedAt - a.playedAt),
          settlement: [...totals.entries()]
            .map(([playerId, netCents]) => ({ playerId, netCents }))
            .sort((a, b) => b.netCents - a.netCents),
        };
      }),
    [games],
  );
}

/** The game currently being entered, if any. Drives "resume where I was". */
export function useLiveGame(): GameWithRounds | undefined {
  const games = useVisibleGames();
  return useMemo(() => games.find((game) => game.status === "in_progress"), [games]);
}
