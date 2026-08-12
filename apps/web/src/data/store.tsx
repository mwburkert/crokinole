/**
 * The data seam.
 *
 * Every screen talks to this hook and nothing else, which is what let the move
 * off fixtures be a one-file change (§6.2). It mirrors the Convex function
 * surface one-for-one:
 *   games.list / games.create / games.addRound / games.removeLastRound /
 *   games.softDelete / players.list / players.me / admin.*
 *
 * Derivation stays on this side of the seam. `stats.leaderboard` and
 * `stats.nights` exist on the backend and are deliberately unused: they call
 * the same `@crokinole/core` functions this file does, over games the screens
 * are already subscribed to, so a second round trip would buy nothing but a
 * chance for the two answers to disagree (§3.2.1, §3.2.2).
 */

import {
  aggregateStats,
  currentNightKey,
  groupByNight,
  MAX_NAME_LENGTH,
  settle,
  type Format,
  type GameWithRounds,
  type PlayerStats,
  type RingCounts,
  type Settlement,
} from "@crokinole/core";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { api } from "../../../../convex/_generated/api";
import type { Member, Player, Role } from "./fixtures";

export interface NewGameInput {
  format: Format;
  playedAt: number;
  teamA: string[];
  teamB: string[];
  /** Which side plays black. The other side is white. */
  blackTeam: "A" | "B";
  betCentsByPlayer: Record<string, number>;
}

/*
 * ---------------------------------------------------------------------------
 * The backend surface, named once.
 *
 * `convex/_generated/api` is the `anyApi` fallback until someone runs
 * `convex dev` against a real deployment: every path off it is `any`, and
 * `noUncheckedIndexedAccess` widens that to `any | undefined`, which won't even
 * index. Spelling out the handful of functions this file calls buys back the
 * argument and result checking that would otherwise be silently absent — and
 * documents exactly what the seam depends on. Delete the cast once codegen
 * produces a typed `api`; the shapes below should then be redundant.
 * ---------------------------------------------------------------------------
 */

type Q<Args extends Record<string, unknown>, Result> = FunctionReference<
  "query",
  "public",
  Args,
  Result
>;
type M<Args extends Record<string, unknown>, Result> = FunctionReference<
  "mutation",
  "public",
  Args,
  Result
>;
type NoArgs = Record<string, never>;

/** `games.list` also returns standing and settlement; the seam derives those itself. */
type GameRow = { game: GameWithRounds };

type PlayerDoc = {
  _id: string;
  displayName: string;
  shortName?: string;
  isActive: boolean;
  createdAt: number;
};

type MemberRow = {
  email: string;
  role: Role;
  invitedAt: number;
  playerId: string | null;
  displayName: string | null;
  hasSignedIn: boolean;
  /** The owner's address is a Convex env var (§2.0), so only the server can say. */
  isSuperAdmin: boolean;
};

type TeamArg = { color: "black" | "white"; playerIds: string[] };

const fns = api as unknown as {
  games: {
    list: Q<{ limit?: number }, GameRow[]>;
    create: M<
      {
        playedAt: number;
        format: Format;
        teams: { A: TeamArg; B: TeamArg };
        bets: { playerId: string; amountCents: number }[];
      },
      string
    >;
    addRound: M<{ gameId: string; A: RingCounts; B: RingCounts }, unknown>;
    removeLastRound: M<{ gameId: string }, null>;
    softDelete: M<{ gameId: string }, null>;
  };
  players: {
    list: Q<{ includeInactive?: boolean }, PlayerDoc[]>;
    me: Q<NoArgs, { player: PlayerDoc; role: Role; email: string }>;
  };
  admin: {
    listMembers: Q<NoArgs, MemberRow[]>;
    invite: M<{ email: string; displayName: string; role: Role }, string>;
    setRole: M<{ email: string; role: Role }, null>;
    revoke: M<{ email: string }, null>;
    updateProfile: M<{ playerId: string; displayName?: string; email?: string }, null>;
  };
};

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
  /** The signed-in user, from the Access JWT via players.me. */
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

/**
 * Fire a write and forget it.
 *
 * The seam's mutations are `void` because the screens are — nobody awaits a
 * round, they just watch the subscription catch up. A rejection still has to
 * land somewhere, though: without this it surfaces as an unhandled rejection
 * and a refused write (not allowlisted, game deleted under you) leaves no trace
 * at all.
 */
function fire(promise: Promise<unknown>): void {
  void promise.catch((error: unknown) => {
    console.error("Convex write failed", error);
  });
}

/**
 * `createGame` has to hand back an id synchronously — the new-game screen
 * navigates with it — but Convex can only give one once the insert lands. So it
 * returns a placeholder, and `resolveId` maps it to the real id when the
 * mutation resolves. The colon guarantees no collision with a Convex id.
 */
const PENDING_PREFIX = "pending:";
let pendingCount = 0;

export function StoreProvider({ children }: { children: ReactNode }): ReactNode {
  const gameRows = useQuery(fns.games.list, {});
  // Inactive players are included so a retired regular's name still resolves in
  // history; `isActive` gates the pickers, not the lookups.
  const playerDocs = useQuery(fns.players.list, { includeInactive: true });
  const me = useQuery(fns.players.me, {});
  const isAdmin = me?.role === "admin";
  // listMembers throws for anyone but an admin, and a throwing query takes the
  // whole app down from here — StoreProvider wraps every screen. "skip" holds
  // the hook slot without opening the subscription.
  const memberRows = useQuery(fns.admin.listMembers, isAdmin ? {} : "skip");

  const createMutation = useMutation(fns.games.create);
  const addRoundMutation = useMutation(fns.games.addRound);
  const removeLastRoundMutation = useMutation(fns.games.removeLastRound);
  const softDeleteMutation = useMutation(fns.games.softDelete);
  const inviteMutation = useMutation(fns.admin.invite);
  const setRoleMutation = useMutation(fns.admin.setRole);
  const revokeMutation = useMutation(fns.admin.revoke);
  const updateProfileMutation = useMutation(fns.admin.updateProfile);

  /** Placeholder id → the real one, once `games.create` has answered. */
  const [pendingIds, setPendingIds] = useState<ReadonlyMap<string, string>>(() => new Map());

  // A loading query is `undefined`; the seam is arrays, so every screen sees an
  // empty one for the first frame rather than a crash.
  const games = useMemo(() => (gameRows ?? []).map((row) => row.game), [gameRows]);

  const players = useMemo<Player[]>(
    () =>
      (playerDocs ?? []).map((doc) => ({
        id: doc._id,
        displayName: doc.displayName,
        // Stored short names are optional; the tables that use them are not.
        shortName: doc.shortName ?? doc.displayName,
        isActive: doc.isActive,
      })),
    [playerDocs],
  );

  const currentEmail = me?.email ?? "";

  /**
   * The member list, or just you.
   *
   * `admin.listMembers` is admin-only, but two screens read `members` to answer
   * "which player am I?" — the settings screen and history's can-I-delete-this
   * check. A non-admin therefore gets a single row built from `players.me`,
   * which is exactly the row they'd have seen in the full list.
   */
  const members = useMemo<Member[]>(() => {
    if (memberRows) {
      return memberRows.map((row) => ({
        email: row.email,
        role: row.role,
        invitedAt: row.invitedAt,
        playerId: row.playerId,
        displayName: row.displayName,
        hasSignedIn: row.hasSignedIn,
      }));
    }
    if (!me) return [];
    return [
      {
        email: me.email,
        role: me.role,
        invitedAt: me.player.createdAt,
        playerId: me.player._id,
        displayName: me.player.displayName,
        hasSignedIn: true,
      },
    ];
  }, [memberRows, me]);

  /**
   * Presence is stored against the night it belongs to, so it survives a reload
   * mid-evening but is simply absent once the night rolls over at 3am. No
   * expiry job needed — a new night reads a key that was never written. Kept on
   * the device on purpose: who is at *this* table is not shared state.
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

  /**
   * The super admin is identified by the server, never by a constant here — the
   * address lives in a Convex env var because this repo is public (§2.0). A
   * non-admin can't read the list, and gets `false`: they have no controls to
   * hide either way.
   */
  const superAdmins = useMemo(
    () => new Set((memberRows ?? []).filter((row) => row.isSuperAdmin).map((row) => row.email)),
    [memberRows],
  );

  const isSuperAdmin = useCallback(
    (email: string): boolean => superAdmins.has(email.trim().toLowerCase()),
    [superAdmins],
  );

  const invite = useCallback(
    ({ email, displayName, role }: { email: string; displayName: string; role: Role }): void => {
      const normalised = email.trim().toLowerCase();
      const name = displayName.trim();
      // The server rejects these too; catching them here keeps a half-filled
      // form from turning into a console full of failed writes.
      if (!normalised.includes("@") || !name) return;
      fire(inviteMutation({ email: normalised, displayName: name, role }));
    },
    [inviteMutation],
  );

  const setRole = useCallback(
    (email: string, role: Role): void => {
      // Never let the last admin demote themselves — unrecoverable without the
      // Convex dashboard.
      if (email === currentEmail && role !== "admin") return;
      fire(setRoleMutation({ email, role }));
    },
    [currentEmail, setRoleMutation],
  );

  const revoke = useCallback(
    (email: string): void => {
      if (email === currentEmail || isSuperAdmin(email)) return;
      // Removes permission, never the person — their history still scores.
      fire(revokeMutation({ email }));
    },
    [currentEmail, isSuperAdmin, revokeMutation],
  );

  const updateProfile = useCallback(
    (email: string, changes: { displayName?: string; email?: string }): void => {
      if (isSuperAdmin(email) && !isSuperAdmin(currentEmail)) return;
      // admin.updateProfile patches a player row, so the address the admin
      // screen works in has to be turned back into the person behind it.
      const playerId =
        members.find((member) => member.email === email)?.playerId ??
        (email === currentEmail ? me?.player._id : undefined);
      if (!playerId) return;

      const nextEmail = changes.email?.trim().toLowerCase();
      // Truncate rather than let the server throw: the name field is a text
      // input and over-typing it shouldn't lose the edit.
      const nextName = changes.displayName?.trim().slice(0, MAX_NAME_LENGTH);

      fire(
        updateProfileMutation({
          playerId,
          ...(nextName ? { displayName: nextName } : {}),
          ...(nextEmail ? { email: nextEmail } : {}),
        }),
      );
    },
    [currentEmail, isSuperAdmin, me, members, updateProfileMutation],
  );

  /**
   * Turn whatever id a screen is holding into one Convex will accept.
   *
   * Usually that's a pass-through. It matters only for the window after
   * `createGame` — and after a reload on a URL that still carries a
   * placeholder, where the mapping is gone: the open game is the one that
   * placeholder was always pointing at, so falling back to it is what the URL
   * meant.
   */
  const resolveId = useCallback(
    (gameId: string): string | undefined => {
      if (!gameId.startsWith(PENDING_PREFIX)) return gameId;
      return (
        pendingIds.get(gameId) ??
        games.find((game) => game.status === "in_progress")?.id
      );
    },
    [pendingIds, games],
  );

  const createGame = useCallback(
    (input: NewGameInput): string => {
      const placeholder = `${PENDING_PREFIX}${(pendingCount += 1)}`;
      const playerIds = [...input.teamA, ...input.teamB];

      // The scoring config is snapshotted server-side from the format (§3.2.3);
      // sending one from here would be a second place for the rules to live.
      fire(
        createMutation({
          playedAt: input.playedAt,
          format: input.format,
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
        }).then((gameId) => {
          setPendingIds((current) => new Map(current).set(placeholder, gameId));
        }),
      );

      return placeholder;
    },
    [createMutation],
  );

  const addRound = useCallback(
    (gameId: string, a: RingCounts, b: RingCounts): void => {
      const id = resolveId(gameId);
      if (!id) return;
      // Completion is derived, never decided by the UI (§3.5) — the mutation
      // flips the game to `final` itself and the subscription reports it back.
      fire(addRoundMutation({ gameId: id, A: a, B: b }));
    },
    [addRoundMutation, resolveId],
  );

  /**
   * ⚠️ Not wired, and it can't be from here.
   *
   * `games.updateRound` is keyed by `roundId`, and nothing exposes one:
   * `games.list` and `games.get` both hand back core's `Round`, which carries
   * an index and no id. The seam only ever has (gameId, index). This needs
   * either `games.updateRound` to accept those, or the read side to surface
   * round ids — a `convex/` change, which is not this agent's to make.
   *
   * It throws rather than no-ops on purpose: a correction that silently
   * evaporates leaves a wrong score standing, and the night settles off these
   * numbers.
   */
  const updateRound = useCallback(
    (gameId: string, index: number, _a: RingCounts, _b: RingCounts): void => {
      throw new Error(
        `Can't correct round ${index + 1} of ${gameId}: games.updateRound takes a roundId, ` +
          `which no query returns. Backend change needed.`,
      );
    },
    [],
  );

  const removeLastRound = useCallback(
    (gameId: string): void => {
      const id = resolveId(gameId);
      if (!id) return;
      fire(removeLastRoundMutation({ gameId: id }));
    },
    [removeLastRoundMutation, resolveId],
  );

  const softDelete = useCallback(
    (gameId: string): void => {
      const id = resolveId(gameId);
      if (!id) return;
      // Soft delete only (§3.2.4) — the row stays, `games.list` stops returning it.
      fire(softDeleteMutation({ gameId: id }));
    },
    [resolveId, softDeleteMutation],
  );

  const getGame = useCallback(
    (gameId: string): GameWithRounds | undefined => {
      const id = resolveId(gameId);
      return id === undefined ? undefined : games.find((game) => game.id === id);
    },
    [games, resolveId],
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
