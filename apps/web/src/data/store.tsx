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
  MAX_NAME_LENGTH,
  currentNightKey,
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

import {
  GAMES,
  MEMBERS,
  PLAYERS,
  SUPER_ADMIN_EMAIL,
  type Member,
  type Player,
  type Role,
} from "./fixtures";

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
  /** Correct a round already committed. Completion is re-derived from scratch. */
  updateRound: (gameId: string, index: number, a: RingCounts, b: RingCounts) => void;
  softDelete: (gameId: string) => void;
  getGame: (gameId: string) => GameWithRounds | undefined;

  /**
   * Who is physically at the table tonight. Starts empty — everyone is greyed
   * out until you tap them in on the standings screen — and gates the player
   * dropdowns so you're never scrolling past people who aren't there.
   */
  presentIds: string[];
  togglePresent: (playerId: string) => void;
  /** Active players who are here tonight. Falls back to everyone if none set. */
  availablePlayers: Player[];

  // Admin — mirrors convex/admin.ts one-for-one.
  members: Member[];
  /** The signed-in user. Fixtures assume the first admin; Convex uses the JWT. */
  currentEmail: string;
  isAdmin: boolean;
  /** True for the one account other admins can't edit. */
  isSuperAdmin: (email: string) => boolean;
  invite: (input: { email: string; displayName: string; role: Role }) => void;
  setRole: (email: string, role: Role) => void;
  revoke: (email: string) => void;
  updateProfile: (email: string, changes: { displayName?: string; email?: string }) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

let nextId = 1000;

/**
 * ⚠️ TEMPORARY — survives a reload so the app is testable on a real phone.
 *
 * This is NOT the persistence design. Convex is the store (§6.2); this exists
 * only because the wiring isn't done and games vanishing on every refresh made
 * it impossible to play a night through. Delete this whole mechanism when
 * `store.tsx` moves onto Convex — do not build on it.
 */
const SAVE_KEY = "crokinole:games:v1";

function loadGames(): GameWithRounds[] {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return [...GAMES];
    const parsed = JSON.parse(raw) as GameWithRounds[];
    // Seed data is re-merged by id so a fixtures change still lands, and so a
    // corrupt save can't wipe the real recorded night.
    const saved = new Map(parsed.map((game) => [game.id, game]));
    for (const game of GAMES) if (!saved.has(game.id)) saved.set(game.id, game);
    return [...saved.values()];
  } catch {
    return [...GAMES];
  }
}

export function StoreProvider({ children }: { children: ReactNode }): ReactNode {
  const [games, setGamesRaw] = useState<GameWithRounds[]>(loadGames);

  const setGames = useCallback(
    (update: (current: GameWithRounds[]) => GameWithRounds[]): void => {
      setGamesRaw((current) => {
        const next = update(current);
        try {
          window.localStorage.setItem(SAVE_KEY, JSON.stringify(next));
        } catch {
          // Quota or private mode — the session still works, it just won't survive.
        }
        return next;
      });
    },
    [],
  );
  const [members, setMembers] = useState<Member[]>(() => [...MEMBERS]);
  const [players, setPlayers] = useState<Player[]>(() => [...PLAYERS]);

  /**
   * Presence is stored against the night it belongs to, so it survives a reload
   * mid-evening but is simply absent once the night rolls over at 3am. No
   * expiry job needed — a new night reads a key that was never written.
   */
  const [presentIds, setPresentIds] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem(`present:${currentNightKey()}`);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  const togglePresent = useCallback((playerId: string): void => {
    setPresentIds((current) => {
      const next = current.includes(playerId)
        ? current.filter((id) => id !== playerId)
        : [...current, playerId];
      try {
        window.localStorage.setItem(`present:${currentNightKey()}`, JSON.stringify(next));
      } catch {
        // Private browsing or a full quota — presence just won't survive a reload.
      }
      return next;
    });
  }, []);

  // With Convex this comes from the Access JWT via players.me. In fixtures we
  // assume you're the first admin so the screen is reachable.
  const currentEmail = MEMBERS.find((member) => member.role === "admin")?.email ?? "";
  const isAdmin = members.some(
    (member) => member.email === currentEmail && member.role === "admin",
  );

  const invite = useCallback(
    ({ email, displayName, role }: { email: string; displayName: string; role: Role }): void => {
      const normalised = email.trim().toLowerCase();
      const name = displayName.trim();
      if (!normalised.includes("@") || !name) return;

      setMembers((current) => {
        if (current.some((member) => member.email === normalised)) return current;
        const playerId = `p-${name.toLowerCase().replace(/\W+/g, "-")}`;
        setPlayers((existing) =>
          existing.some((player) => player.id === playerId)
            ? existing
            : [...existing, { id: playerId, displayName: name, shortName: name, isActive: true }],
        );
        return [
          ...current,
          {
            email: normalised,
            role,
            invitedAt: Date.now(),
            playerId,
            displayName: name,
            hasSignedIn: false,
          },
        ];
      });
    },
    [],
  );

  const setRole = useCallback(
    (email: string, role: Role): void => {
      // Never let the last admin demote themselves — unrecoverable without the
      // Convex dashboard.
      if (email === currentEmail && role !== "admin") return;
      setMembers((current) =>
        current.map((member) => (member.email === email ? { ...member, role } : member)),
      );
    },
    [currentEmail],
  );

  const isSuperAdmin = useCallback(
    (email: string): boolean => email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase(),
    [],
  );

  const revoke = useCallback(
    (email: string): void => {
      if (email === currentEmail || isSuperAdmin(email)) return;
      // Removes permission, never the person — their history still scores.
      setMembers((current) => current.filter((member) => member.email !== email));
    },
    [currentEmail, isSuperAdmin],
  );

  const updateProfile = useCallback(
    (email: string, changes: { displayName?: string; email?: string }): void => {
      if (isSuperAdmin(email) && !isSuperAdmin(currentEmail)) return;
      const nextEmail = changes.email?.trim().toLowerCase();
      const nextName = changes.displayName?.trim().slice(0, MAX_NAME_LENGTH);

      setMembers((current) =>
        current.map((member) =>
          member.email === email
            ? {
                ...member,
                ...(nextEmail ? { email: nextEmail } : {}),
                ...(nextName ? { displayName: nextName } : {}),
              }
            : member,
        ),
      );
      setPlayers((current) =>
        current.map((player) => {
          const member = members.find((m) => m.email === email);
          if (!member || player.id !== member.playerId) return player;
          return nextName ? { ...player, displayName: nextName, shortName: nextName } : player;
        }),
      );
    },
    [currentEmail, isSuperAdmin, members],
  );

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

  const updateRound = useCallback(
    (gameId: string, index: number, a: RingCounts, b: RingCounts): void => {
      setGames((current) =>
        current.map((game) => {
          if (game.id !== gameId) return game;
          const rounds = game.rounds.map((round) =>
            round.index === index ? { ...round, A: a, B: b } : round,
          );
          // A correction can un-finish a game as easily as finish one, so status
          // is recomputed rather than left alone.
          const status = gameStanding(rounds, game.config).isComplete ? "final" : "in_progress";
          return { ...game, rounds, status };
        }),
      );
    },
    [],
  );

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

  /**
   * Only people marked in tonight. No fallback to "everyone" — the new-game
   * screen disables itself instead, which is honest about the fact that you
   * haven't said who's here yet rather than quietly offering the wrong list.
   */
  const availablePlayers = useMemo(
    () => players.filter((player) => player.isActive && presentIds.includes(player.id)),
    [players, presentIds],
  );

  const value = useMemo<StoreValue>(
    () => ({
      players,
      games,
      createGame,
      addRound,
      removeLastRound,
      updateRound,
      softDelete,
      getGame,
      presentIds,
      togglePresent,
      availablePlayers,
      members,
      currentEmail,
      isAdmin,
      isSuperAdmin,
      invite,
      setRole,
      revoke,
      updateProfile,
    }),
    [
      players,
      games,
      createGame,
      addRound,
      removeLastRound,
      updateRound,
      softDelete,
      getGame,
      presentIds,
      togglePresent,
      availablePlayers,
      members,
      currentEmail,
      isAdmin,
      isSuperAdmin,
      invite,
      setRole,
      revoke,
      updateProfile,
    ],
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
