async function fetchFuturesKlines(symbol, { limit = 96 } = {}) {
  const market = symbol.includes("-") ? symbol : symbol.replace(/USDT$/i, "USDT");
  const url = `https://api.coinex.com/v2/futures/kline?market=${encodeURIComponent(market)}&period=1hour&limit=${limit}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`CoinEx kline HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload.code !== 0 || !Array.isArray(payload.data)) {
    throw new Error(`CoinEx kline error: ${payload.message || "unknown"}`);
  }

  return payload.data.map((item) => ({
    time: Number(item.created_at || item[0] || 0),
    open: Number(item.open || item[1]),
    close: Number(item.close || item[2]),
    high: Number(item.high || item[3]),
    low: Number(item.low || item[4]),
  }));
}

module.exports = {
  fetchFuturesKlines,
};
