export const fallback = { name: "2018-style Global Dust Storm", sunlightDropPct: 80, durationSols: 5 };
export async function getStorm() {
  try { return await (await fetch('YOUR_WORKER_URL/storm')).json(); }
  catch { return fallback; }
}