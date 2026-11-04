// Paper page. Public like ranks. Paints identity plus the live
// compiler status, then stays out of the reader's way.

async function main() {
  await window.AWSession.refreshIdentity();
  const badge = document.getElementById("paper-model");
  if (!badge) return;
  try {
    const res = await fetch("/v1/ai/provider");
    const data = await res.json();
    const c = data && data.compile ? data.compile : null;
    if (c && c.provider === "meta") {
      badge.textContent = `COMPILER · META ${c.model}`;
      badge.classList.add("live");
    } else {
      badge.textContent = "COMPILER · MOCK";
    }
  } catch {
    badge.textContent = "COMPILER · UNREACHABLE";
  }
}

main();
