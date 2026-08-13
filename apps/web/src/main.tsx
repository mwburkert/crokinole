import { ConvexProvider, ConvexReactClient } from "convex/react";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router-dom";

import { App } from "./App";
import { consumeCodeFromUrl, PasscodeProvider } from "./data/passcode";
import { PasscodeGate } from "./features/gate/PasscodeGate";
import { JoinScreen } from "./features/join/JoinScreen";
import "./ui/tokens.css";
import "./ui/app.css";

const container = document.getElementById("root");
if (!container) throw new Error("No #root element.");

/*
 * ⚠️ TEMPORARY (§7.1). Before anything renders, because the router reads the
 * URL at mount and this rewrites it: an onboarding link is `…/?code=XXXX`, and
 * the param is stored and stripped so it never ends up in a screenshot, a
 * bookmark, or the back stack.
 */
consumeCodeFromUrl();

/*
 * Baked in by `vite.config.ts`, not read from `import.meta.env`.
 *
 * ⚠️ It used to be `import.meta.env.VITE_CONVEX_URL`, and that is how this app
 * went to production dead: `VITE_CONVEX_URL` is the one variable `.env.example`
 * asks a human to add by hand, `.env.local` is gitignored, and on the machine
 * that ran the deploy it simply wasn't there. Vite inlined nothing, this line
 * got `undefined`, and `games.burkert.app` served the screen below to everyone
 * while the build stayed green. The config now derives the URL from the
 * Convex CLI's own variables and refuses to build without one, so reaching
 * `MissingConfig` again takes a `vite dev` in a fresh clone — which is exactly
 * who it was written for.
 */
const convexUrl = __CONVEX_URL__.trim();

/**
 * Shown instead of the app when the deployment URL is missing. This used to be
 * a white screen with a console error, which on a phone is indistinguishable
 * from the app being broken.
 */
function MissingConfig(): ReactNode {
  return (
    <div className="gate">
      <div className="gate__inner">
        <h1 className="gate__title">Not configured.</h1>
        <p className="muted gate__hint">
          There is no Convex deployment to talk to, so nothing can be read or written.
        </p>
        <p className="gate__detail">
          Run <code>npx convex dev</code> once — it writes <code>CONVEX_DEPLOYMENT</code> and{" "}
          <code>CONVEX_URL</code> into <code>.env.local</code> at the repo root, and the build
          derives the browser&apos;s URL from either. Then restart the dev server.
          {"\n\n"}
          Only <code>vite dev</code> can reach this screen: a production build refuses to
          finish without a deployment URL, because a bundle with no backend that looks like a
          successful deploy is how this app once went live dead.
        </p>
        <p className="faint" style={{ margin: 0 }}>
          Build {__BUILD_ID__}
        </p>
      </div>
    </div>
  );
}

/** The one path that renders without a passcode. */
const JOIN_PATH = "/join";

/**
 * Which half of the app this URL belongs to.
 *
 * ⚠️ Deliberately a pathname test and **not** a second `<Routes>`. `App.tsx`
 * owns the only route table in this app and every path in it is absolute, so
 * nesting another `<Routes>` around it would either swallow those paths or need
 * them all rewritten as relative — in a file this change does not own. One
 * branch on the pathname is the whole of what is needed, and it keeps the route
 * table in exactly one place.
 *
 * Trailing slash and case are both tolerated: this URL is typed off a printed
 * card and scanned off a QR, and `/Join/` failing to find the join screen would
 * be indistinguishable from the link being wrong.
 */
function Root(): ReactNode {
  const path = useLocation().pathname.toLowerCase().replace(/\/+$/, "");
  if (path === JOIN_PATH) return <JoinScreen />;
  return (
    <PasscodeGate>
      <App />
    </PasscodeGate>
  );
}

const root = createRoot(container);

if (!convexUrl) {
  root.render(
    <StrictMode>
      <MissingConfig />
    </StrictMode>,
  );
} else {
  const convex = new ConvexReactClient(convexUrl);
  root.render(
    <StrictMode>
      <ConvexProvider client={convex}>
        {/*
          The router sits ABOVE the gate, which is the opposite of how this
          started — it used to be "the gate sits above the router, not inside
          it", because every route reads from Convex and a rejected query throws
          during render wherever you happen to have landed.

          It had to move for `/join`: the whole point of that screen is
          that someone with no passcode at all can reach it — a QR joiner, or a
          person typing the URL off a card — and under the gate there is no such
          thing as a route you can see without one.

          Everything else is still gated, and `Root` is what keeps that true:
          exactly one path renders outside `<PasscodeGate>`, and `<App />` — with
          its `StoreProvider` and its five routes, all of which read from Convex
          — is still wrapped whole. The gate's error boundary lost its reach over
          `/join` in the move, so `JoinScreen` brings its own; without one a
          refused query on that route throws during render with nothing above it
          and the joiner gets a white screen.
        */}
        <PasscodeProvider>
          <BrowserRouter>
            <Root />
          </BrowserRouter>
        </PasscodeProvider>
      </ConvexProvider>
    </StrictMode>,
  );
}
