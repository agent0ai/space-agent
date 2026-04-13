import {
  listPages as listIndexedPages,
  normalizePageRoutePath
} from "/mod/_core/pages/page-index.js";

function normalizeLookupText(value) {
  return String(value ?? "")
    .trim()
    .replace(/^#\/?/u, "")
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function getRouter() {
  const router = globalThis.space?.router;

  if (!router || typeof router !== "object") {
    return null;
  }

  return router;
}

function toRoutePath(target) {
  if (target && typeof target === "object" && !Array.isArray(target)) {
    return normalizePageRoutePath(
      target.routePath ?? target.path ?? target.href ?? target.hash
    );
  }

  return normalizePageRoutePath(target);
}

export async function listPages() {
  return listIndexedPages();
}

export async function findPage(target) {
  const pages = await listIndexedPages();
  const routePath = toRoutePath(target);

  if (routePath) {
    const exactRouteMatch = pages.find((page) => page.routePath === routePath);

    if (exactRouteMatch) {
      return exactRouteMatch;
    }
  }

  const normalizedTarget = normalizeLookupText(
    target && typeof target === "object" && !Array.isArray(target)
      ? target.name ?? target.title ?? target.routePath ?? target.path
      : target
  );

  if (!normalizedTarget) {
    return null;
  }

  return pages.find((page) => {
    const normalizedName = normalizeLookupText(page.name);
    const normalizedRoutePath = normalizeLookupText(page.routePath);

    return normalizedName === normalizedTarget || normalizedRoutePath === normalizedTarget;
  }) || null;
}

export async function createPageHref(target) {
  const page = await findPage(target);
  const routePath = page?.routePath || toRoutePath(target);

  if (!routePath) {
    throw new Error(`Unable to resolve page target: ${String(target ?? "")}`);
  }

  const router = getRouter();

  if (router?.createHref) {
    return router.createHref(routePath);
  }

  return `#/${routePath}`;
}

export async function goToPage(target, options = {}) {
  const page = await findPage(target);
  const routePath = page?.routePath || toRoutePath(target);

  if (!routePath) {
    throw new Error(`Unable to resolve page target: ${String(target ?? "")}`);
  }

  const router = getRouter();

  if (router?.goTo) {
    await router.goTo(routePath, {
      scrollMode: "top",
      ...options
    });
    return page || { routePath };
  }

  globalThis.location.hash = `#/${routePath}`;
  return page || { routePath };
}

export const navigateToPage = goToPage;
