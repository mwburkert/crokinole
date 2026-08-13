/**
 * Auth providers for this deployment.
 *
 * ⚠️ **Empty, deliberately, and only until Cloudflare Access exists.**
 *
 * The design (§3.6, §7.1) is for Convex to validate the Cloudflare Access JWT
 * directly, which gives one login across all three apps and one allowlist. That
 * needs a domain, a Zero Trust team, and an Access application — none of which
 * exist yet (§7 is still "in flight"). With no provider registered,
 * `ctx.auth.getUserIdentity()` can only ever return null, so the interim
 * security boundary is the shared passphrase threaded through every function
 * as an argument — see `assertAllowlisted` in `convex/lib/auth.ts`, which is
 * where the whole interim is marked for deletion.
 *
 * Convex statically scans this file for `process.env` reads and refuses to
 * deploy when one is unset, so the config below is a comment rather than a
 * conditional: an unset variable must not be able to block every push.
 *
 * ---------------------------------------------------------------------------
 * TO RESTORE WHEN §7.1 LANDS — this is the whole change, plus deleting the
 * passcode argument:
 *
 *   npx convex env set CF_ACCESS_TEAM_DOMAIN https://<team>.cloudflareaccess.com
 *   npx convex env set CF_ACCESS_AUD         <crokinole's AUD tag>
 *
 * then replace the export with:
 *
 *   const teamDomain = process.env.CF_ACCESS_TEAM_DOMAIN!;
 *   const applicationID = process.env.CF_ACCESS_AUD!;
 *
 *   export default {
 *     providers: [
 *       {
 *         type: "customJwt" as const,
 *         issuer: teamDomain,
 *         jwks: `${teamDomain}/cdn-cgi/access/certs`,
 *         applicationID,
 *         algorithm: "RS256" as const,
 *       },
 *     ],
 *   };
 *
 * `applicationID` must be **crokinole's own AUD tag**. There are three separate
 * Access applications — one per app — precisely so this check tells them apart.
 * A single multi-domain application would issue one AUD across all three, and a
 * token minted for meal-planner would then be cryptographically valid here.
 * ---------------------------------------------------------------------------
 */

export default {
  providers: [],
};
