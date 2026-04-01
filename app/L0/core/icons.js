function normalizeIconElement(icon) {
  if (!(icon instanceof HTMLElement)) {
    return;
  }

  const rawName = icon.getAttribute("name") || icon.textContent || "";
  const iconName = rawName.trim();

  if (!iconName) {
    return;
  }

  icon.classList.add("material-symbols-outlined");
  icon.setAttribute("translate", "no");
  icon.textContent = iconName;
}

export function loadIcons(roots = [document.documentElement]) {
  const rootElements = Array.isArray(roots) ? roots : [roots];

  rootElements.forEach((root) => {
    if (!root) {
      return;
    }

    if (root instanceof Element && root.matches("x-icon")) {
      normalizeIconElement(root);
    }

    if (typeof root.querySelectorAll === "function") {
      root.querySelectorAll("x-icon").forEach((icon) => normalizeIconElement(icon));
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => loadIcons());
} else {
  loadIcons();
}

const iconObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      loadIcons([node]);
    }
  }
});

iconObserver.observe(document.body, { childList: true, subtree: true });
