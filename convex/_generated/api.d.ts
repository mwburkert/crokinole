/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as games from "../games.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_firstNight from "../lib/firstNight.js";
import type * as lib_model from "../lib/model.js";
import type * as lib_players from "../lib/players.js";
import type * as players from "../players.js";
import type * as seed from "../seed.js";
import type * as stats from "../stats.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  games: typeof games;
  "lib/auth": typeof lib_auth;
  "lib/firstNight": typeof lib_firstNight;
  "lib/model": typeof lib_model;
  "lib/players": typeof lib_players;
  players: typeof players;
  seed: typeof seed;
  stats: typeof stats;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};
