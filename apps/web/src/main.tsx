import { ConvexProvider, ConvexReactClient } from "convex/react";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App";
import { consumeCodeFromUrl, PasscodeProvider } from "./data/passcode";
import { PasscodeGate } from "./features/gate/PasscodeGate";
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

const convexUrl = (import.meta.env.VITE_CONVEX_URL as string | undefined)?.trim();

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
          <code>VITE_CONVEX_URL</code> is not set, so there is no backend to talk to.
        </p>
        <p className="gate__detail">
          Set it in <code>.env.local</code> at the repo root — the same file the Convex CLI
          writes <code>CONVEX_DEPLOYMENT</code> to — then restart the dev server:
          {"\n\n"}
          VITE_CONVEX_URL=https://your-deployment.convex.cloud
          {"\n\n"}
          See <code>.env.example</code>. Vite reads the root file because{" "}
          <code>apps/web/vite.config.ts</code> points <code>envDir</code> there.
        </p>
      </div>
    </div>
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
          The gate sits above the router, not inside it: every route reads from
          Convex, so there is no screen worth showing without a passcode, and a
          rejected query throws during render wherever you happen to have landed.
        */}
        <PasscodeProvider>
          <PasscodeGate>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </PasscodeGate>
        </PasscodeProvider>
      </ConvexProvider>
    </StrictMode>,
  );
}
