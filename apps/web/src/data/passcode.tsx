/**
 * ⚠️ TEMPORARY — the shared-passphrase interim, deleted when Cloudflare Access
 * lands (§7.1).
 *
 * Access doesn't exist yet, so `ctx.auth.getUserIdentity()` is always null and
 * `assertAllowlisted` has no JWT to check. Until it does, every Convex query
 * and mutation takes a `passcode` argument compared server-side against
 * `APP_PASSCODE`. This module is the browser's half of that: one string, kept
 * in localStorage, entered once — or handed over by a `?code=XXXX` link, which
 * is the only realistic way to onboard four people standing at a board.
 *
 * When Access lands, delete this file, the gate, and the `passcode` argument in
 * one commit. A bypass that outlives its reason is how "`assertAllowlisted` is
 * the only thing between the internet and this data" (§3.2.5) stops being true.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** Namespaced like the presence key in `store.tsx`, for the same reason. */
const STORAGE_KEY = "crokinole:passcode";

/** The query/hash parameter an onboarding link carries. */
const CODE_PARAM = "code";

/**
 * Every read and write is wrapped: Safari in private browsing throws on
 * `localStorage` access rather than returning null, and an app that white-
 * screens because someone opened it in a private tab is worse than one that
 * simply asks for the code every time.
 */
export function readStoredPasscode(): string | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const code = raw === null ? "" : raw.trim();
    return code === "" ? null : code;
  } catch {
    return null;
  }
}

export function storePasscode(code: string): void {
  // Trimmed, never re-cased — the server compares the string exactly.
  const trimmed = code.trim();
  if (trimmed === "") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, trimmed);
  } catch {
    // Private browsing or a full quota. The code still works for this session;
    // it just won't survive a reload.
  }
}

export function clearStoredPasscode(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing was stored in the first place.
  }
}

/**
 * Reads `?code=…` from the URL, stores it, and strips the param via
 * `history.replaceState`. Call once before render.
 *
 * `replaceState` rather than a location assignment: the router reads the URL at
 * mount, and anything that reloads or pushes here would either loop or leave a
 * dead entry behind the back button. Only `code` is removed — the path, any
 * other params, and the rest of the hash survive, so a link can deep-link and
 * carry the code at once.
 */
export function consumeCodeFromUrl(): void {
  if (typeof window === "undefined") return;

  let url: URL;
  try {
    url = new URL(window.location.href);
  } catch {
    return;
  }

  let found: string | null = null;
  let changed = false;

  const fromSearch = url.searchParams.get(CODE_PARAM);
  if (fromSearch !== null) {
    found = fromSearch.trim();
    url.searchParams.delete(CODE_PARAM);
    changed = true;
  }

  /*
   * The hash form, in two shapes: `#code=XXXX` on its own, and `#/path?code=…`
   * as a hash router would write it. A hash carrying no `code` is left exactly
   * as it was — parsing it must never be able to rewrite it.
   */
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  if (hash !== "") {
    const split = hash.indexOf("?");
    const hashPath = split === -1 ? "" : hash.slice(0, split);
    const params = new URLSearchParams(split === -1 ? hash : hash.slice(split + 1));
    const fromHash = params.get(CODE_PARAM);
    if (fromHash !== null) {
      // A `?code=` in the search wins; both carrying one is a malformed link.
      if (found === null || found === "") found = fromHash.trim();
      params.delete(CODE_PARAM);
      const rest = params.toString();
      const nextHash = rest === "" ? hashPath : `${hashPath}?${rest}`;
      url.hash = nextHash === "" ? "" : `#${nextHash}`;
      changed = true;
    }
  }

  if (found !== null && found !== "") storePasscode(found);

  if (changed) {
    // `url.search` is already "" once the last param goes, and `url.hash` the
    // same, so this is the original URL minus exactly one parameter.
    const next = `${url.pathname}${url.search}${url.hash}`;
    try {
      window.history.replaceState(window.history.state, "", next);
    } catch {
      // Sandboxed iframes throw here. The code is stored either way; the link
      // just keeps showing it. This runs before render, so it must never throw.
    }
  }
}

export interface PasscodeValue {
  code: string | null;
  setCode: (code: string) => void;
  clear: () => void;
}

const PasscodeContext = createContext<PasscodeValue | null>(null);

export function PasscodeProvider({ children }: { children: ReactNode }): ReactNode {
  // Read once, at mount. `consumeCodeFromUrl` has already run by then, so a
  // link's code is in storage before this initialiser looks for it.
  const [code, setCodeState] = useState<string | null>(() => readStoredPasscode());

  const setCode = useCallback((next: string): void => {
    const trimmed = next.trim();
    if (trimmed === "") return;
    storePasscode(trimmed);
    setCodeState(trimmed);
  }, []);

  const clear = useCallback((): void => {
    clearStoredPasscode();
    setCodeState(null);
  }, []);

  const value = useMemo<PasscodeValue>(() => ({ code, setCode, clear }), [code, setCode, clear]);

  return <PasscodeContext.Provider value={value}>{children}</PasscodeContext.Provider>;
}

export function usePasscode(): PasscodeValue {
  const value = useContext(PasscodeContext);
  if (!value) throw new Error("usePasscode must be used inside <PasscodeProvider>.");
  return value;
}

/**
 * Throws if there is no passcode. Used inside the gate, where one is
 * guaranteed — every caller below `<PasscodeGate>` can treat this as a string
 * rather than threading a null through every Convex argument object.
 */
export function useRequiredPasscode(): string {
  const { code } = usePasscode();
  if (code === null) {
    throw new Error("No passcode. useRequiredPasscode must be used inside <PasscodeGate>.");
  }
  return code;
}
