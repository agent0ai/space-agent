import { DEFAULT_ROUTE_PATH, parseRouteTarget } from "../router/route-path.js";
import { SPACES_ROUTE_PATH } from "./constants.js";
import { installExampleSpace, listSpaces } from "./storage.js";

export const FIRST_LOGIN_SPACE_SOURCE_PATH = "L0/_all/mod/_core/spaces/onboarding_space/";

function normalizePathname(pathname) {
  const normalizedPathname = String(pathname || "").trim();

  if (!normalizedPathname) {
    return "/";
  }

  const trimmedPathname = normalizedPathname.replace(/\/+$/u, "");
  return trimmedPathname || "/";
}

export function shouldRedirectFirstLoginToSpace({ locationLike = globalThis.location } = {}) {
  if (normalizePathname(locationLike?.pathname) !== "/") {
    return false;
  }

  const currentRoute = parseRouteTarget(String(locationLike?.hash || ""), {
    defaultPath: DEFAULT_ROUTE_PATH
  });

  return currentRoute.path === DEFAULT_ROUTE_PATH;
}

export function buildFirstLoginSpaceRoute(spaceId) {
  return parseRouteTarget({
    params: { id: String(spaceId || "").trim() },
    path: SPACES_ROUTE_PATH
  });
}

export function replaceFirstLoginRouteHash(nextHash, { historyLike = globalThis.history, locationLike = globalThis.location } = {}) {
  const normalizedHash = String(nextHash || "").trim();

  if (!normalizedHash || String(locationLike?.hash || "").trim() === normalizedHash) {
    return false;
  }

  if (historyLike && typeof historyLike.replaceState === "function") {
    // Login hooks run before the router store mounts, so replacing the hash here
    // lets router bootstrap pick up the onboarding route instead of defaulting home.
    historyLike.replaceState(historyLike.state, "", normalizedHash);
    return true;
  }

  if (locationLike && typeof locationLike === "object") {
    locationLike.hash = normalizedHash;
    return true;
  }

  return false;
}

export async function ensureFirstLoginSpace({
  installExampleSpaceImpl = installExampleSpace,
  listSpacesImpl = listSpaces
} = {}) {
  const existingSpaces = await listSpacesImpl();

  if (Array.isArray(existingSpaces) && existingSpaces.length > 0) {
    return {
      created: false,
      space: existingSpaces[0]
    };
  }

  const createdSpace = await installExampleSpaceImpl({
    sourcePath: FIRST_LOGIN_SPACE_SOURCE_PATH
  });

  return {
    created: true,
    space: createdSpace
  };
}

export async function runFirstLoginSpaceOnboarding(
  context = {},
  {
    historyLike = globalThis.history,
    installExampleSpaceImpl = installExampleSpace,
    listSpacesImpl = listSpaces,
    locationLike = globalThis.location
  } = {}
) {
  if (context?.isFirstLogin === false) {
    return {
      created: false,
      redirected: false,
      route: null,
      space: null
    };
  }

  const { created, space } = await ensureFirstLoginSpace({
    installExampleSpaceImpl,
    listSpacesImpl
  });
  const normalizedSpaceId = String(space?.id || "").trim();

  if (!normalizedSpaceId) {
    return {
      created,
      redirected: false,
      route: null,
      space: null
    };
  }

  const route = buildFirstLoginSpaceRoute(normalizedSpaceId);
  const redirected = shouldRedirectFirstLoginToSpace({ locationLike })
    ? replaceFirstLoginRouteHash(route.hash, {
        historyLike,
        locationLike
      })
    : false;

  return {
    created,
    redirected,
    route,
    space
  };
}
