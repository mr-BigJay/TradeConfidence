/**
 * Optional Binance futures websocket collector scaffold.
 * Enable later with BINANCE_WS_ENABLED=true.
 *
 * Stores rolling in-memory CVD / liquidations / orderbook deltas for the scoring layer.
 * Full persistence can be wired to SQLite tables when needed.
 */

const logger = require("../../logger");

const state = {
  enabled: false,
  cvd: 0,
  buyVolume: 0,
  sellVolume: 0,
  liquidations: [],
  orderbook: null,
  lastEventAt: null,
};

function getWsState() {
  return { ...state, liquidations: state.liquidations.slice(-50) };
}

async function startBinanceWsCollector(symbol = "BTCUSDT") {
  if (!["1", "true", "yes", "on"].includes(String(process.env.BINANCE_WS_ENABLED || "").toLowerCase())) {
    logger.info("Binance WS collector disabled (set BINANCE_WS_ENABLED=true to enable)");
    return null;
  }

  // Lazy require so environments without ws dependency still boot.
  let WebSocket;
  try {
    WebSocket = require("ws");
  } catch (error) {
    logger.warn("ws package not installed; Binance WS collector skipped");
    return null;
  }

  const streamSymbol = String(symbol).toLowerCase();
  const url = `wss://fstream.binance.com/stream?streams=${streamSymbol}@aggTrade/${streamSymbol}@forceOrder/${streamSymbol}@depth10@100ms`;
  state.enabled = true;

  const socket = new WebSocket(url);
  socket.on("open", () => logger.info("Binance WS connected", { symbol }));
  socket.on("message", (buffer) => {
    try {
      const payload = JSON.parse(String(buffer));
      const data = payload.data || payload;
      state.lastEventAt = new Date().toISOString();

      if (payload.stream?.includes("aggTrade") || data.e === "aggTrade") {
        const qty = Number(data.q || 0);
        if (data.m) {
          state.sellVolume += qty;
          state.cvd -= qty;
        } else {
          state.buyVolume += qty;
          state.cvd += qty;
        }
      }

      if (payload.stream?.includes("forceOrder") || data.e === "forceOrder") {
        state.liquidations.push({
          at: state.lastEventAt,
          side: data.o?.S,
          price: data.o?.p,
          qty: data.o?.q,
        });
        if (state.liquidations.length > 200) {
          state.liquidations = state.liquidations.slice(-100);
        }
      }

      if (payload.stream?.includes("depth") || data.e === "depthUpdate" || data.bids) {
        state.orderbook = {
          bids: data.bids || data.b || [],
          asks: data.asks || data.a || [],
          at: state.lastEventAt,
        };
      }
    } catch (error) {
      logger.debug("Binance WS parse failed", { error: error.message });
    }
  });
  socket.on("close", () => {
    logger.warn("Binance WS closed");
    state.enabled = false;
  });
  socket.on("error", (error) => {
    logger.warn("Binance WS error", { error: error.message });
  });

  return socket;
}

module.exports = {
  startBinanceWsCollector,
  getWsState,
};
