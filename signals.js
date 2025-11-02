const YahooFinance = require("yahoo-finance2").default;
const yf = new YahooFinance();

/* ------------------------------ ATR Calculation ------------------------------ */
function calculateATR(data, period = 10) {
  const tr = [];
  for (let i = 1; i < data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i - 1].close;
    const trueRange = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    tr.push(trueRange);
  }

  let atr = [];
  atr[0] = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < tr.length; i++) {
    atr.push((atr[atr.length - 1] * (period - 1) + tr[i]) / period);
  }

  return [Array(data.length - atr.length).fill(null), ...atr].flat();
}

/* --------------------------- Supertrend Calculation -------------------------- */
function calculateSupertrend(data, atrPeriod = 10, factor = 3) {
  const atr = calculateATR(data, atrPeriod);
  const supertrend = [];
  const direction = [];

  for (let i = 0; i < data.length; i++) {
    if (i < atrPeriod) {
      supertrend.push(null);
      direction.push(0);
      continue;
    }

    const hl2 = (data[i].high + data[i].low) / 2;
    const upperBand = hl2 + factor * atr[i];
    const lowerBand = hl2 - factor * atr[i];

    if (i === atrPeriod) {
      supertrend.push(hl2);
      direction.push(1);
      continue;
    }

    const prevSupertrend = supertrend[i - 1];
    const prevDirection = direction[i - 1];

    let newSupertrend = prevSupertrend;
    let newDirection = prevDirection;

    if (data[i].close > prevSupertrend) {
      newDirection = 1;
      newSupertrend = Math.max(lowerBand, prevSupertrend);
    } else if (data[i].close < prevSupertrend) {
      newDirection = -1;
      newSupertrend = Math.min(upperBand, prevSupertrend);
    }

    supertrend.push(newSupertrend);
    direction.push(newDirection);
  }

  return { supertrend, direction };
}

/* ---------------------------- Helper Functions ---------------------------- */
function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function calculatePeriod1(duration) {
  const now = new Date();
  const value = parseInt(duration);
  if (duration.endsWith("d")) now.setDate(now.getDate() - value);
  else if (duration.endsWith("mo")) now.setMonth(now.getMonth() - value);
  else throw new Error("Unsupported duration format; use 'Xd' or 'Xmo'");
  return formatDate(now);
}

async function getHistory(symbol, duration = "7d") {
  try {
    const period1Str = calculatePeriod1(duration);
    const period2Str = formatDate(new Date());
    const prices = await yf.historical(symbol, {
      period1: period1Str,
      period2: period2Str,
      interval: "1d",
    });
    if (!prices || prices.length === 0)
      throw new Error(`No historical data for ${symbol}`);
    return prices.reverse();
  } catch (err) {
    console.error(`[getHistory] Error fetching ${symbol}:`, err.message);
    throw err;
  }
}

/* ---------------------- Supertrend Multi-timeframe ---------------------- */
async function getIntradaySupertrend(symbol) {
  const intervals = [
    { label: "trend", interval: "60m" },
    { label: "setup", interval: "15m" },
    { label: "entry", interval: "5m" },
  ];

  const now = new Date();
  const period1 = new Date(now);
  period1.setDate(period1.getDate() - 1);

  const results = {};

  await Promise.all(
    intervals.map(async ({ label, interval }) => {
      try {
        const chart = await yf.chart(symbol, {
          period1: period1.toISOString(),
          period2: now.toISOString(),
          interval,
        });

        const data = chart.quotes.map((q) => ({
          high: q.high,
          low: q.low,
          close: q.close,
        }));

        if (data.length < 2) throw new Error("Not enough data points");

        const { direction } = calculateSupertrend(data, 10, 3);
        const lastDir = direction[direction.length - 1];
        results[label] = lastDir === 1 ? "up" : "down";
      } catch (err) {
        console.error(
          `[getIntradaySupertrend] ${symbol} ${label} error:`,
          err.message
        );
        results[label] = "neutral";
      }
    })
  );

  return results;
}

async function getSwingSupertrend(symbol) {
  const intervals = [
    { label: "trend", interval: "1d" },
    { label: "setup", interval: "60m" },
    { label: "entry", interval: "15m" },
  ];

  const now = new Date();
  const period1 = new Date(now);
  period1.setMonth(period1.getMonth() - 1);

  const results = {};

  await Promise.all(
    intervals.map(async ({ label, interval }) => {
      try {
        const chart = await yf.chart(symbol, {
          period1: period1.toISOString(),
          period2: now.toISOString(),
          interval,
        });

        const data = chart.quotes.map((q) => ({
          high: q.high,
          low: q.low,
          close: q.close,
        }));

        if (data.length < 2) throw new Error("Not enough data points");

        const { direction } = calculateSupertrend(data, 10, 3);
        const lastDir = direction[direction.length - 1];
        results[label] = lastDir === 1 ? "up" : "down";
      } catch (err) {
        console.error(
          `[getSwingSupertrend] ${symbol} ${label} error:`,
          err.message
        );
        results[label] = "neutral";
      }
    })
  );

  return results;
}

/* -------------------------- ADX, D+, and D- Calculation -------------------------- */
function calculateADX(data, diLen = 14, adxLen = 14) {
  const plusDM = [];
  const minusDM = [];
  const tr = [];

  for (let i = 1; i < data.length; i++) {
    const upMove = data[i].high - data[i - 1].high;
    const downMove = data[i - 1].low - data[i].low;

    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);

    const trueRange = Math.max(
      data[i].high - data[i].low,
      Math.abs(data[i].high - data[i - 1].close),
      Math.abs(data[i].low - data[i - 1].close)
    );
    tr.push(trueRange);
  }

  // Wilder's smoothing (RMA)
  const rma = (arr, len) => {
    const result = [];
    let sum = arr.slice(0, len).reduce((a, b) => a + b, 0);
    result[len - 1] = sum / len;
    for (let i = len; i < arr.length; i++) {
      result[i] = (result[i - 1] * (len - 1) + arr[i]) / len;
    }
    return result;
  };

  const trRMA = rma(tr, diLen);
  const plusRMA = rma(plusDM, diLen);
  const minusRMA = rma(minusDM, diLen);

  const plusDI = plusRMA.map((v, i) => (v / trRMA[i]) * 100);
  const minusDI = minusRMA.map((v, i) => (v / trRMA[i]) * 100);

  const dx = plusDI.map((v, i) =>
    i < diLen - 1
      ? null
      : (Math.abs(v - minusDI[i]) / (v + minusDI[i])) * 100
  );

  const adx = rma(dx.filter((v) => v !== null), adxLen);

  // Align arrays to data length
  const pad = data.length - adx.length;
  return {
    plusDI: [Array(pad).fill(null), ...plusDI.slice(pad)].flat(),
    minusDI: [Array(pad).fill(null), ...minusDI.slice(pad)].flat(),
    adx: [Array(pad).fill(null), ...adx].flat(),
  };
}

/* ------------------------------ Signal Generators ------------------------------ */
exports.momentum = async (symbol) => {
  try {
    const prices = await getHistory(symbol, "10d");
    if (prices.length < 2) return "Hold";
    const change =
      ((prices[0].close - prices[prices.length - 1].close) /
        prices[prices.length - 1].close) *
      100;
    if (change > 3) return "Buy";
    if (change < -3) return "Sell";
    return "Hold";
  } catch {
    return "Hold";
  }
};

exports.breakout = async (symbol) => {
  try {
    const prices = await getHistory(symbol, "1mo");
    if (prices.length < 2) return "Hold";
    const lastClose = prices[0].close;
    const prevHigh = Math.max(...prices.slice(1).map((p) => p.high));
    const prevLow = Math.min(...prices.slice(1).map((p) => p.low));
    if (lastClose > prevHigh) return "Buy";
    if (lastClose < prevLow) return "Sell";
    return "Hold";
  } catch {
    return "Hold";
  }
};

exports.volume = async (symbol) => {
  try {
    const prices = await getHistory(symbol, "10d");
    if (prices.length < 2) return "Hold";
    const avgVolume =
      prices.slice(1).reduce((a, b) => a + b.volume, 0) / (prices.length - 1);
    const today = prices[0];
    const yesterday = prices[1];
    if (today.volume > avgVolume * 2) {
      if (today.close > yesterday.close) return "Buy";
      if (today.close < yesterday.close) return "Sell";
    }
    return "Hold";
  } catch {
    return "Hold";
  }
};

/* ------------------------------ Combined Clubbed Signal ------------------------------ */
exports.combined = async (symbol) => {
  try {
    const [momentum, breakout, volume] = await Promise.all([
      exports.momentum(symbol),
      exports.breakout(symbol),
      exports.volume(symbol),
    ]);

    console.log(`[combined] ${symbol}:`, { momentum, breakout, volume });

    let final = "Hold";

    if (
      (momentum === "Buy" && breakout === "Buy" && volume === "Buy") ||
      (momentum === "Buy" && volume === "Buy")
    ) {
      final = "Strong Buy";
    } else if (
      (momentum === "Sell" && breakout === "Sell" && volume === "Sell") ||
      (momentum === "Sell" && volume === "Sell")
    ) {
      final = "Strong Sell";
    } else if (momentum === "Buy" || breakout === "Buy" || volume === "Buy") {
      final = "Buy";
    } else if (
      momentum === "Sell" ||
      breakout === "Sell" ||
      volume === "Sell"
    ) {
      final = "Sell";
    }

    return { momentum, breakout, volume, final };
  } catch (err) {
    console.error(`[combined] Error: ${err.message}`);
    return {
      momentum: "Hold",
      breakout: "Hold",
      volume: "Hold",
      final: "Hold",
    };
  }
};

/* ------------------------------ Export Supertrends ------------------------------ */
exports.intraday = async (symbol) => {
  try {
    const signal = await getIntradaySupertrend(symbol);
    console.log(`[intraday] ${symbol}:`, signal);
    return signal;
  } catch (err) {
    console.error(`[intraday] Error: ${err.message}`);
    return { trend: "neutral", setup: "neutral", entry: "neutral" };
  }
};

exports.swing = async (symbol) => {
  try {
    const signal = await getSwingSupertrend(symbol);
    console.log(`[swing] ${symbol}:`, signal);
    return signal;
  } catch (err) {
    console.error(`[swing] Error: ${err.message}`);
    return { trend: "neutral", setup: "neutral", entry: "neutral" };
  }
};

exports.adx = async (symbol) => {
  try {
    // Fetch 60-minute historical data for the last few days
    const now = new Date();
    const period1 = new Date(now);
    period1.setDate(period1.getDate() - 10); // last 10 days of intraday data

    const chart = await yf.chart(symbol, {
      period1: period1.toISOString(),
      period2: now.toISOString(),
      interval: "60m", // 👈 60-minute candles
    });

    const data = chart.quotes.map((q) => ({
      high: q.high,
      low: q.low,
      close: q.close,
    }));

    if (data.length < 15)
      return { adx: null, plusDI: null, minusDI: null, signal: "Hold" };

    const { adx, plusDI, minusDI } = calculateADX(data, 14, 14);
    const lastADX = adx[adx.length - 1];
    const lastPlus = plusDI[plusDI.length - 1];
    const lastMinus = minusDI[minusDI.length - 1];

    let signal = "Hold";

    // ✅ Interpretation based on 60m ADX
    if (lastPlus > lastMinus && lastADX > 25) signal = "Buy";
    else if (lastMinus > lastPlus && lastADX > 25) signal = "Sell";

    return {
      adx: lastADX ? lastADX.toFixed(2) : null,
      plusDI: lastPlus ? lastPlus.toFixed(2) : null,
      minusDI: lastMinus ? lastMinus.toFixed(2) : null,
      signal,
    };
  } catch (err) {
    console.error(`[adx] Error: ${err.message}`);
    return { adx: null, plusDI: null, minusDI: null, signal: "Hold" };
  }
};

