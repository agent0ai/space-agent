import { initializeRuntime } from "/runtime.js";
import { initializeProxyLab } from "/ui/tests/proxy-lab.js";

function initializeTestsPage() {
  const runtime = initializeRuntime({
    proxyPath: "/api/proxy"
  });

  initializeProxyLab(runtime);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeTestsPage, { once: true });
} else {
  initializeTestsPage();
}
