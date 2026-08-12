/**
 * Convex validates the Cloudflare Access JWT directly (§7.1).
 *
 * ⚠️ `applicationID` must be **crokinole's own AUD tag**. There are three
 * separate Access applications — one per app — precisely so this check tells
 * them apart. A single multi-domain application would issue one AUD across all
 * three, and a token minted for meal-planner would then be cryptographically
 * valid here.
 *
 * Set in the Convex dashboard (or `.env.local` for dev):
 *   CF_ACCESS_TEAM_DOMAIN   e.g. https://burkert.cloudflareaccess.com
 *   CF_ACCESS_AUD           the AUD tag of the CROKINOLE application
 */

const teamDomain = process.env.CF_ACCESS_TEAM_DOMAIN;
const applicationID = process.env.CF_ACCESS_AUD;

export default {
  providers:
    teamDomain && applicationID
      ? [
          {
            type: "customJwt" as const,
            issuer: teamDomain,
            jwks: `${teamDomain}/cdn-cgi/access/certs`,
            applicationID,
            algorithm: "RS256" as const,
          },
        ]
      : [],
};
