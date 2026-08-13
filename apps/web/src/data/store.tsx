/**
 * The data seam.
 *
 * Every screen talks to this hook and nothing else, which is what let the move
 * off fixtures be a one-file change (§6.2). It mirrors the Convex function
 * surface one-for-one:
 *   games.list / games.create / games.addRound / games.updateRound /
 *   games.removeLastRound / games.softDelete / players.list / players.create /
 *   players.me / admin.*
 *
 * Derivation stays on this side of the seam. `stats.leaderboard` and
 * `stats.nights` exist on the backend and are deliberately unused: they call
 * the same `@crokinole/core` functions this file does, over games the screens
 * are already subscribed to, so a second round trip would buy nothing but a
 * chance for the two answers to disagree (§3.2.1, §3.2.2).
 *
 * 🕐 Every call carries `passcode`. See `data/passcode.tsx` and
 * `convex/lib/auth.ts` — the whole interim goes when Cloudflare Access lands.
 */

import {
  aggregateStats,
  currentNightKey,
  groupByNight,
  MAX_NAME_LENGTH,
  settle,
  type Format,
  type GameWithRounds,
  type PlacedDisc,
  type PlayerStats,
  type RingCounts,
  type RoundPlayerStat,
  type Settlement,
} from "@crokinole/core";
import { useMutation, useQuery } from "convex/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { api } from "../../../../convex/_generated/api";
import { useRequiredPasscode } from "./passcode";
import type { Member, Player, Role } from "./types";

export interface NewGameInput {
  format: Format;
  playedAt: number;
  teamA: string[];
  teamB: string[];
  /** Which side plays black. The other side is white. */
  blackTeam: "A" | "B";
  betCentsByPlayer: Record<string, number>;
}

/** Optional detail a round can carry beyond the two teams' ring counts. */
export interface RoundDetail {
  /**
   * The board, when one was placed. **The server recomputes the ring counts
   * from this** — positions are the source of truth when present (§3.5), so the
   * two can never disagree.
   */
  discs?: PlacedDisc[];
  /** Per-player twenties, when someone bothered to break them down. */
  playerStats?: RoundPlayerStat[];
  /**
   * A total someone typed, when the round was logged without any detail.
   *
   * Replaces the derived total for that side (§3.3). Deliberately distinct from
   * ring counts of zero, which claim nobody scored — this claims only that the
   * sections weren't recorded. Without it "Black 60 / White 45" commits as 0–0,
   * a tie, silently, with the night's money riding on it.
   */
  pointsOverride?: { A?: number; B?: number };
}

interface StoreValue {
  /**
   * True until games, players and identity have all answered once.
   *
   * Convex hands back `undefined` before the first response, and the seam
   * turns that into an empty array — so without this flag "still loading" and
   * "genuinely nothing there" are the same value, and a cold load of a live
   * game flashes *"That game is gone."* On a phone refresh mid-game that reads
   * as data loss. Every screen with an empty state checks this first.
   */
  isLoading: boolean;
  /**
   * True while the member list itself is still in flight.
   *
   * Separate from `isLoading` because `admin.listMembers` can only be
   * subscribed to *after* `players.me` says you're an admin — so it starts one
   * render after `isLoading` goes false, and the settings screen spent that
   * round trip announcing "Players — 0 / Nobody yet." over a full roster.
   */
  membersLoading: boolean;

  /**
   * True from the moment `createGame` is called until the new game has actually
   * arrived on the games subscription.
   *
   * ⚠️ Load-bearing for the tab bar. `createGame` returns a `pending:` id
   * synchronously and the entry screen navigates on it, but the game itself only
   * exists once the Convex insert lands — so for that round trip
   * `useLiveGame()` finds nothing in progress, which is indistinguishable from
   * "no game is running" and made the board button flash *New* (a green plus,
   * pointing at /games/new) immediately after the setup screen. This is the
   * missing third state: not loading, not live, but a game being born.
   */
  isCreatingGame: boolean;

  players: Player[];
  games: GameWithRounds[];
  createGame: (input: NewGameInput) => string;
  addRound: (gameId: string, a: RingCounts, b: RingCounts, detail?: RoundDetail) => void;
  removeLastRound: (gameId: string) => void;
  /** Correct a round already committed. Completion is re-derived from scratch. */
  updateRound: (
    gameId: string,
    index: number,
    a: RingCounts,
    b: RingCounts,
    detail?: RoundDetail,
  ) => void;
  softDelete: (gameId: string) => void;
  getGame: (gameId: string) => GameWithRounds | undefined;

  /**
   * Who is physically at the table tonight. Starts empty — everyone is greyed
   * out until you tap them in on the standings screen — and gates the player
   * dropdowns so you're never scrolling past people who aren't there.
   */
  presentIds: string[];
  togglePresent: (playerId: string) => void;
  /** Active players who are here tonight. */
  availablePlayers: Player[];

  // Admin — mirrors convex/admin.ts one-for-one.
  members: Member[];
  /** The signed-in user's address, or "" while the passphrase is the auth model. */
  currentEmail: string;
  isAdmin: boolean;
  /** True for the one account other admins can't edit. */
  isSuperAdmin: (email: string) => boolean;
  /**
   * Add a person, as an admin.
   *
   * **Email is required**, which supersedes the earlier "a name alone is
   * enough" shape — every person now arrives with the one field that can tell a
   * returning player from a second copy of them. Because there is always an
   * address there is always an allowlist entry to make, so this goes through
   * `admin.invite` rather than `players.create`.
   *
   * ⚠️ Awaited and allowed to reject, unlike most of this seam. `admin.invite`
   * throws when the address is already on the list, and fired-and-forgotten that
   * refusal was a console line plus a row that silently never appeared — the
   * admin's only signal being a `+` sheet that closed as if it had worked.
   */
  addPlayer: (input: {
    email: string;
    firstName: string;
    lastName?: string;
    /** Omitted means "pick one for me" — first name, or first + last initial. */
    nickname?: string;
    role?: Role;
  }) => Promise<void>;
  /**
   * Add yourself. Email is **required** here and is what stops a returning
   * player becoming a second row — deliberately unlike `addPlayer`.
   */
  selfJoin: (input: {
    email: string;
    firstName: string;
    lastName?: string;
    nickname?: string;
  }) => Promise<{ created: boolean }>;
  setRole: (email: string, role: Role) => void;
  revoke: (email: string) => void;
  /**
   * Edit a person: real name, nickname, email. One write, not one per field —
   * see `admin.updateProfile`, which is the only handler that can move the
   * allowlist entry alongside a changed address.
   *
   * Awaited for the same reason `addPlayer` is: the refusals here are ones a
   * human has to read ("That account is managed by its owner"), and a silent
   * one leaves an editor closing over an edit that never landed.
   */
  updateProfile: (
    playerId: string,
    changes: {
      firstName?: string;
      /** Empty clears it. */
      lastName?: string;
      nickname?: string;
      email?: string;
    },
  ) => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

/**
 * Fire a write and forget it.
 *
 * The seam's mutations are `void` because the screens are — nobody awaits a
 * round, they just watch the subscription catch up. A rejection still has to
 * land somewhere, though: without this it surfaces as an unhandled rejection
 * and a refused write (wrong code, game deleted under you) leaves no trace at
 * all.
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

/** True while a screen is still holding a placeholder rather than a real id. */
export function isPendingGameId(gameId: string): boolean {
  return gameId.startsWith(PENDING_PREFIX);
}

/**
 * The placeholder map, kept in `sessionStorage` as well as in React state.
 *
 * Per tab and cleared when it closes, which is exactly the lifetime of a
 * placeholder. This is what lets a reload resolve the real game instead of
 * guessing at one — see `resolveId`.
 */
function pendingKey(placeholder: string): string {
  return `crokinole:${placeholder}`;
}

function readPendingId(placeholder: string): string | undefined {
  try {
    return window.sessionStorage.getItem(pendingKey(placeholder)) ?? undefined;
  } catch {
    return undefined;
  }
}

function writePendingId(placeholder: string, gameId: string): void {
  try {
    window.sessionStorage.setItem(pendingKey(placeholder), gameId);
  } catch {
    // Private browsing. The in-memory map still covers everything but a reload.
  }
}

export function StoreProvider({ children }: { children: ReactNode }): ReactNode {
  // 🕐 Guaranteed non-null: `StoreProvider` only ever renders inside the gate.
  const passcode = useRequiredPasscode();

  const gameRows = useQuery(api.games.list, { passcode });
  // Inactive players are included so a retired regular's name still resolves in
  // history; `isActive` gates the pickers, not the lookups.
  const playerDocs = useQuery(api.players.list, { passcode, includeInactive: true });
  const me = useQuery(api.players.me, { passcode });
  const isAdmin = me?.role === "admin";
  // listMembers throws for anyone but an admin, and a throwing query takes the
  // whole app down from here — StoreProvider wraps every screen. "skip" holds
  // the hook slot without opening the subscription.
  const memberRows = useQuery(api.admin.listMembers, isAdmin ? { passcode } : "skip");

  const createMutation = useMutation(api.games.create);
  const addRoundMutation = useMutation(api.games.addRound);
  const updateRoundMutation = useMutation(api.games.updateRound);
  const removeLastRoundMutation = useMutation(api.games.removeLastRound);
  const softDeleteMutation = useMutation(api.games.softDelete);
  const inviteMutation = useMutation(api.admin.invite);
  const selfJoinMutation = useMutation(api.players.selfJoin);
  const setRoleMutation = useMutation(api.admin.setRole);
  const revokeMutation = useMutation(api.admin.revoke);
  const updateProfileMutation = useMutation(api.admin.updateProfile);

  /** Placeholder id → the real one, once `games.create` has answered. */
  const [pendingIds, setPendingIds] = useState<ReadonlyMap<string, string>>(() => new Map());

  /**
   * Placeholders handed out this session. A placeholder leaves this list only
   * when the game behind it is visible in `games` — resolving the id is not
   * enough, because the mutation can answer a beat before the subscription
   * delivers the row, and that beat is exactly the window this exists to cover.
   */
  const [creating, setCreating] = useState<readonly string[]>([]);

  /**
   * The three queries every screen is built on. `memberRows` is excluded on
   * purpose: it is skipped for non-admins, so waiting on it would leave them
   * loading forever.
   */
  const isLoading = gameRows === undefined || playerDocs === undefined || me === undefined;

  /** See `membersLoading` on `StoreValue`. Never true for a non-admin, who never subscribes. */
  const membersLoading = isAdmin && memberRows === undefined;

  // A loading query is `undefined`; the seam is arrays, so every screen sees an
  // empty one for the first frame rather than a crash. `isLoading` is what tells
  // that frame apart from an empty database.
  const games = useMemo(
    () => (gameRows ?? []).map((row) => row.game as GameWithRounds),
    [gameRows],
  );

  const players = useMemo<Player[]>(
    () =>
      (playerDocs ?? []).map((doc) => ({
        id: doc._id,
        // The nickname is the display name — see `Player` in ./types.
        displayName: doc.nickname,
        firstName: doc.firstName,
        lastName: doc.lastName ?? null,
        isActive: doc.isActive,
      })),
    [playerDocs],
  );

  const currentEmail = me?.email ?? "";

  /**
   * Everyone the settings screen can act on.
   *
   * `admin.listMembers` is admin-only. A non-admin gets the one row they could
   * have seen in the full list — themselves — built from `players.me`. 🕐 Under
   * the shared passphrase everyone is an admin, so this fallback is currently
   * unreachable; it exists for when roles mean something again.
   */
  const members = useMemo<Member[]>(() => {
    if (memberRows) {
      return memberRows.map((row) => ({
        playerId: row.playerId,
        displayName: row.displayName,
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email,
        role: row.role,
        invitedAt: row.invitedAt,
        isActive: row.isActive,
        hasSignedIn: row.hasSignedIn,
      }));
    }
    if (!me?.player) return [];
    return [
      {
        playerId: me.player._id,
        displayName: me.player.nickname,
        firstName: me.player.firstName,
        lastName: me.player.lastName ?? null,
        email: me.email,
        role: me.role,
        invitedAt: me.player.createdAt,
        isActive: me.player.isActive,
        hasSignedIn: true,
      },
    ];
  }, [memberRows, me]);

  /**
   * Presence is stored against the night it belongs to, so it survives a reload
   * mid-evening but is simply absent once the night rolls over at 3am. No
   * expiry job needed — a new night reads a key that was never written. Kept on
   * the device on purpose: who is at *this* table is not shared state, and it's
   * the only thing this app still keeps in localStorage.
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
    () =>
      new Set(
        (memberRows ?? [])
          .filter((row) => row.isSuperAdmin && row.email)
          .map((row) => row.email as string),
      ),
    [memberRows],
  );

  const isSuperAdmin = useCallback(
    (email: string): boolean => superAdmins.has(email.trim().toLowerCase()),
    [superAdmins],
  );

  const addPlayer = useCallback(
    async ({
      email,
      firstName,
      lastName,
      nickname,
      role,
    }: {
      email: string;
      firstName: string;
      lastName?: string;
      nickname?: string;
      role?: Role;
    }): Promise<void> => {
      const first = firstName.trim();
      const normalised = email.trim().toLowerCase();
      // Both are refused server-side; throwing the same refusal from here keeps
      // the sheet's error line the one place a failure shows up, rather than
      // half the failures ending as a silent no-op.
      if (!first) throw new Error("Give them a name so they can be picked for a game.");
      if (!normalised.includes("@")) throw new Error("That doesn't look like an email address.");

      // An address means an allowlist entry as well as a player row, which is
      // what makes the row mean something once a login exists. `admin.invite`
      // writes both in one transaction, so there is no half-added person.
      await inviteMutation({
        passcode,
        email: normalised,
        firstName: first,
        ...(lastName?.trim() ? { lastName: lastName.trim() } : {}),
        ...(nickname?.trim() ? { nickname: nickname.trim() } : {}),
        ...(role ? { role } : {}),
      });
    },
    [inviteMutation, passcode],
  );

  /**
   * Add yourself.
   *
   * Awaited rather than fire-and-forget, unlike every other write here: the
   * join screen has to tell you whether it worked before it can move you on,
   * and a silent failure would leave someone standing at a table believing they
   * are in the game.
   */
  const selfJoin = useCallback(
    async (input: {
      email: string;
      firstName: string;
      lastName?: string;
      nickname?: string;
    }): Promise<{ created: boolean }> => {
      const result = await selfJoinMutation({
        passcode,
        email: input.email.trim().toLowerCase(),
        firstName: input.firstName.trim(),
        ...(input.lastName?.trim() ? { lastName: input.lastName.trim() } : {}),
        ...(input.nickname?.trim() ? { nickname: input.nickname.trim() } : {}),
      });
      return { created: result.created };
    },
    [passcode, selfJoinMutation],
  );

  const setRole = useCallback(
    (email: string, role: Role): void => {
      // Never let the last admin demote themselves — unrecoverable without the
      // Convex dashboard. The server enforces this too.
      if (email === currentEmail && role !== "admin") return;
      fire(setRoleMutation({ passcode, email, role }));
    },
    [currentEmail, passcode, setRoleMutation],
  );

  const revoke = useCallback(
    (email: string): void => {
      if (email === currentEmail || isSuperAdmin(email)) return;
      // Removes permission, never the person — their history still scores.
      fire(revokeMutation({ passcode, email }));
    },
    [currentEmail, isSuperAdmin, passcode, revokeMutation],
  );

  const updateProfile = useCallback(
    async (
      playerId: string,
      changes: {
        firstName?: string;
        lastName?: string;
        nickname?: string;
        email?: string;
      },
    ): Promise<void> => {
      /*
       * 🕐 The super-admin guard needs two identities to compare, and under the
       * shared passphrase there are none — `currentEmail` is "" for everyone.
       * Applying it anyway would lock the owner out of their own row the moment
       * anybody's player record gained the `SUPER_ADMIN_EMAIL` address, which is
       * the opposite of what it's for. `convex/admin.ts:assertMayEdit` skips it
       * on a null caller for the same reason; the two must agree, or this
       * refuses a write the server would have accepted.
       *
       * ⚠️ It throws rather than returning quietly now that the callers await
       * it. A silent return under an awaited call reads as success, so the
       * editor would close on "Saved ✓" over a write it had itself refused —
       * the same class of lie this whole change is removing from the `+` sheet.
       * The message is the server's, word for word, so the two paths are
       * indistinguishable to the person reading them.
       */
      if (currentEmail !== "") {
        const member = members.find((row) => row.playerId === playerId);
        if (member?.email && isSuperAdmin(member.email) && !isSuperAdmin(currentEmail)) {
          throw new Error("That account is managed by its owner and can't be changed here.");
        }
      }

      const nextEmail = changes.email?.trim().toLowerCase();
      // Truncate rather than let the server throw: these are text inputs and
      // over-typing one shouldn't lose the whole edit.
      const cap = (value: string): string => value.trim().slice(0, MAX_NAME_LENGTH);

      await updateProfileMutation({
        passcode,
        playerId: playerId as Parameters<typeof updateProfileMutation>[0]["playerId"],
        ...(changes.firstName !== undefined ? { firstName: cap(changes.firstName) } : {}),
        // Sent even when empty — that is how a surname gets cleared. Every other
        // field here treats blank as "leave it alone", so this one is the odd
        // one out on purpose.
        ...(changes.lastName !== undefined ? { lastName: cap(changes.lastName) } : {}),
        ...(changes.nickname !== undefined ? { nickname: cap(changes.nickname) } : {}),
        ...(nextEmail ? { email: nextEmail } : {}),
      });
    },
    [currentEmail, isSuperAdmin, members, passcode, updateProfileMutation],
  );

  /**
   * Turn whatever id a screen is holding into one Convex will accept.
   *
   * A pass-through for a real id. For a placeholder it is the mapping and
   * nothing else — **it must never guess at an existing game.**
   *
   * ⚠️ It did guess, briefly, and the bug is worth recording. The fallback was
   * "the open game, or failing that the most recent one", to survive a reload
   * that wiped the in-memory map. But between `createGame` returning a
   * placeholder and the new game arriving on the subscription there *is* no
   * open game — so the most recent one is the last game you finished, and the
   * screen that should have been an empty board was that game's final
   * scorecard. `EntryScreen` then rewrote the URL to it, so it never recovered:
   * starting a new game dropped you into an old one, permanently. The window is
   * one network round trip, which is why it never showed up on localhost and
   * always showed up on a phone.
   *
   * The map is persisted instead, so a reload recovers the real answer rather
   * than needing a guess. When there is genuinely no mapping the honest answer
   * is `undefined`, and the entry screen shows a loading state — a placeholder
   * means "a game is being created", which *is* a loading state.
   */
  const resolveId = useCallback(
    (gameId: string): string | undefined => {
      if (!gameId.startsWith(PENDING_PREFIX)) return gameId;
      return pendingIds.get(gameId) ?? readPendingId(gameId);
    },
    [pendingIds],
  );

  /** Every mutation is keyed by a game id; Convex wants its branded form. */
  type GameIdArg = Parameters<typeof softDeleteMutation>[0]["gameId"];
  const asGameId = (id: string): GameIdArg => id as GameIdArg;

  const createGame = useCallback(
    (input: NewGameInput): string => {
      const placeholder = `${PENDING_PREFIX}${(pendingCount += 1)}`;
      const playerIds = [...input.teamA, ...input.teamB];
      type PlayerIdArg = Parameters<typeof createMutation>[0]["bets"][number]["playerId"];

      setCreating((current) => [...current, placeholder]);

      // The scoring config is snapshotted server-side from the format (§3.2.3);
      // sending one from here would be a second place for the rules to live.
      fire(
        createMutation({
          passcode,
          playedAt: input.playedAt,
          format: input.format,
          teams: {
            A: {
              color: input.blackTeam === "A" ? "black" : "white",
              playerIds: input.teamA as PlayerIdArg[],
            },
            B: {
              color: input.blackTeam === "B" ? "black" : "white",
              playerIds: input.teamB as PlayerIdArg[],
            },
          },
          bets: playerIds.map((playerId) => ({
            playerId: playerId as PlayerIdArg,
            amountCents: input.betCentsByPlayer[playerId] ?? 0,
          })),
        })
          .then((gameId) => {
            // Persisted as well as held in state: a reload mid-creation would
            // otherwise leave the URL holding a placeholder nothing can resolve.
            writePendingId(placeholder, gameId);
            setPendingIds((current) => new Map(current).set(placeholder, gameId));
          })
          .catch((error: unknown) => {
            // A create that never lands must not leave the tab bar waiting
            // forever for a game that isn't coming. Re-thrown so `fire` still
            // logs it — this only takes the placeholder back out of the queue.
            setCreating((current) => current.filter((id) => id !== placeholder));
            throw error;
          }),
      );

      return placeholder;
    },
    [createMutation, passcode],
  );

  /**
   * Retire placeholders whose games have arrived.
   *
   * Derived during render rather than in an effect: the tab bar reads
   * `isCreatingGame` on the same commit the game lands on, and an effect would
   * leave it true for one extra frame — which is one extra frame of the wrong
   * button, the exact fault this is here to remove.
   */
  const isCreatingGame = useMemo(
    () =>
      creating.some((placeholder) => {
        const real = pendingIds.get(placeholder) ?? readPendingId(placeholder);
        return real === undefined || !games.some((game) => game.id === real);
      }),
    [creating, pendingIds, games],
  );

  /** The optional half of a round, shaped the same for add and update. */
  type DetailArgs = Pick<
    Parameters<typeof addRoundMutation>[0],
    "discs" | "playerStats" | "pointsOverride"
  >;
  const detailArgs = (detail?: RoundDetail): DetailArgs => ({
    ...(detail?.discs ? { discs: detail.discs } : {}),
    ...(detail?.playerStats
      ? { playerStats: detail.playerStats as DetailArgs["playerStats"] }
      : {}),
    ...(detail?.pointsOverride ? { pointsOverride: detail.pointsOverride } : {}),
  });

  const addRound = useCallback(
    (gameId: string, a: RingCounts, b: RingCounts, detail?: RoundDetail): void => {
      const id = resolveId(gameId);
      if (!id) return;
      // Completion is derived, never decided by the UI (§3.5) — the mutation
      // flips the game to `final` itself and the subscription reports it back.
      fire(
        addRoundMutation({
          passcode,
          gameId: asGameId(id),
          A: a,
          B: b,
          ...detailArgs(detail),
        }),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- asGameId/detailArgs are pure.
    [addRoundMutation, passcode, resolveId],
  );

  /**
   * Correct a round already committed.
   *
   * Keyed by `(gameId, index)`. It used to be unreachable: `games.updateRound`
   * took a `roundId`, and nothing hands one out — `games.list` and `games.get`
   * return core's `Round`, which has an index and no id. Re-keying the mutation
   * was the right end to fix, because core knows nothing about Convex (§3.2.2)
   * and leaking document ids through it to make one mutation callable would
   * have put database identity into the rules engine.
   */
  const updateRound = useCallback(
    (
      gameId: string,
      index: number,
      a: RingCounts,
      b: RingCounts,
      detail?: RoundDetail,
    ): void => {
      const id = resolveId(gameId);
      if (!id) return;
      fire(
        updateRoundMutation({
          passcode,
          gameId: asGameId(id),
          index,
          A: a,
          B: b,
          ...detailArgs(detail),
        }),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- asGameId/detailArgs are pure.
    [passcode, resolveId, updateRoundMutation],
  );

  const removeLastRound = useCallback(
    (gameId: string): void => {
      const id = resolveId(gameId);
      if (!id) return;
      fire(removeLastRoundMutation({ passcode, gameId: asGameId(id) }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- asGameId is pure.
    [passcode, removeLastRoundMutation, resolveId],
  );

  const softDelete = useCallback(
    (gameId: string): void => {
      const id = resolveId(gameId);
      if (!id) return;
      // Soft delete only (§3.2.4) — the row stays, `games.list` stops returning it.
      fire(softDeleteMutation({ passcode, gameId: asGameId(id) }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- asGameId is pure.
    [passcode, resolveId, softDeleteMutation],
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
      isLoading,
      membersLoading,
      isCreatingGame,
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
      addPlayer,
      selfJoin,
      setRole,
      revoke,
      updateProfile,
    }),
    [
      isLoading,
      membersLoading,
      isCreatingGame,
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
      addPlayer,
      selfJoin,
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
