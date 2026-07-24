export const INDICES = [
  { region: "US", name: "S&P 500", symbol: "^GSPC" },
  { region: "US", name: "Nasdaq", symbol: "^IXIC" },
  { region: "Europe", name: "Euro Stoxx 50", symbol: "^STOXX50E" },
  { region: "Europe", name: "FTSE 100", symbol: "^FTSE" },
  { region: "Asia", name: "SSE Composite", symbol: "000001.SS" },
  { region: "Asia", name: "CSI 300", symbol: "000300.SS" },
  { region: "Asia", name: "Hang Seng", symbol: "^HSI" },
];

export async function fetchIndex(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
  const res = await fetch(url, { headers: { "user-agent": "morning-board/1.0" } });
  if (!res.ok) throw new Error(`Yahoo Finance ${symbol}: HTTP ${res.status}`);
  const data = await res.json();
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta) throw new Error(`Yahoo Finance ${symbol}: malformed response`);
  const price = meta.regularMarketPrice;
  const prev = meta.chartPreviousClose ?? meta.previousClose;
  return {
    price,
    changePct: prev ? ((price - prev) / prev) * 100 : 0,
  };
}

export async function fetchMarkets() {
  const results = await Promise.allSettled(
    INDICES.map(async (idx) => {
      const { price, changePct } = await fetchIndex(idx.symbol);
      return { ...idx, price, changePct };
    }),
  );
  return {
    indices: results
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value),
  };
}
