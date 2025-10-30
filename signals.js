const YahooFinance = require('yahoo-finance2').default;
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
  if (duration.endsWith('d')) now.setDate(now.getDate() - value);
  else if (duration.endsWith('mo')) now.setMonth(now.getMonth() - value);
  else throw new Error("Unsupported duration format; use 'Xd' or 'Xmo'");
  return formatDate(now);
}

async function getHistory(symbol, duration = '7d') {
  try {
    const period1Str = calculatePeriod1(duration);
    const period2Str = formatDate(new Date());
    const prices = await yf.historical(symbol, {
      period1: period1Str,
      period2: period2Str,
      interval: '1d'
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
    { label: 'trend', interval: '60m' },
    { label: 'setup', interval: '15m' },
    { label: 'entry', interval: '5m' }
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
          interval
        });

        const data = chart.quotes.map(q => ({
          high: q.high,
          low: q.low,
          close: q.close
        }));

        if (data.length < 2) throw new Error("Not enough data points");

        const { direction } = calculateSupertrend(data, 10, 3);
        const lastDir = direction[direction.length - 1];
        results[label] = lastDir === 1 ? 'up' : 'down';
      } catch (err) {
        console.error(`[getIntradaySupertrend] ${symbol} ${label} error:`, err.message);
        results[label] = 'neutral';
      }
    })
  );

  return results;
}

async function getSwingSupertrend(symbol) {
  const intervals = [
    { label: 'trend', interval: '1d' },
    { label: 'setup', interval: '60m' },
    { label: 'entry', interval: '15m' }
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
          interval
        });

        const data = chart.quotes.map(q => ({
          high: q.high,
          low: q.low,
          close: q.close
        }));

        if (data.length < 2) throw new Error("Not enough data points");

        const { direction } = calculateSupertrend(data, 10, 3);
        const lastDir = direction[direction.length - 1];
        results[label] = lastDir === 1 ? 'up' : 'down';
      } catch (err) {
        console.error(`[getSwingSupertrend] ${symbol} ${label} error:`, err.message);
        results[label] = 'neutral';
      }
    })
  );

  return results;
}

/* ------------------------------ Signal Generators ------------------------------ */
exports.momentum = async (symbol) => {
  try {
    const prices = await getHistory(symbol, '10d');
    if (prices.length < 2) return 'Hold';
    const change = ((prices[0].close - prices[prices.length - 1].close) / prices[prices.length - 1].close) * 100;
    if (change > 3) return 'Buy';
    if (change < -3) return 'Sell';
    return 'Hold';
  } catch {
    return 'Hold';
  }
};

exports.breakout = async (symbol) => {
  try {
    const prices = await getHistory(symbol, '1mo');
    if (prices.length < 2) return 'Hold';
    const lastClose = prices[0].close;
    const prevHigh = Math.max(...prices.slice(1).map(p => p.high));
    const prevLow = Math.min(...prices.slice(1).map(p => p.low));
    if (lastClose > prevHigh) return 'Buy';
    if (lastClose < prevLow) return 'Sell';
    return 'Hold';
  } catch {
    return 'Hold';
  }
};

exports.volume = async (symbol) => {
  try {
    const prices = await getHistory(symbol, '10d');
    if (prices.length < 2) return 'Hold';
    const avgVolume = prices.slice(1).reduce((a, b) => a + b.volume, 0) / (prices.length - 1);
    const today = prices[0];
    const yesterday = prices[1];
    if (today.volume > avgVolume * 2) {
      if (today.close > yesterday.close) return 'Buy';
      if (today.close < yesterday.close) return 'Sell';
    }
    return 'Hold';
  } catch {
    return 'Hold';
  }
};

/* ------------------------------ Combined Clubbed Signal ------------------------------ */
exports.combined = async (symbol) => {
  try {
    const [momentum, breakout, volume] = await Promise.all([
      exports.momentum(symbol),
      exports.breakout(symbol),
      exports.volume(symbol)
    ]);

    console.log(`[combined] ${symbol}:`, { momentum, breakout, volume });

    let final = 'Hold';

    if (
      (momentum === 'Buy' && breakout === 'Buy' && volume === 'Buy') ||
      (momentum === 'Buy' && volume === 'Buy')
    ) {
      final = 'Strong Buy';
    } else if (
      (momentum === 'Sell' && breakout === 'Sell' && volume === 'Sell') ||
      (momentum === 'Sell' && volume === 'Sell')
    ) {
      final = 'Strong Sell';
    } else if (momentum === 'Buy' || breakout === 'Buy' || volume === 'Buy') {
      final = 'Buy';
    } else if (momentum === 'Sell' || breakout === 'Sell' || volume === 'Sell') {
      final = 'Sell';
    }

    return { momentum, breakout, volume, final };
  } catch (err) {
    console.error(`[combined] Error: ${err.message}`);
    return { momentum: 'Hold', breakout: 'Hold', volume: 'Hold', final: 'Hold' };
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
    return { trend: 'neutral', setup: 'neutral', entry: 'neutral' };
  }
};

exports.swing = async (symbol) => {
  try {
    const signal = await getSwingSupertrend(symbol);
    console.log(`[swing] ${symbol}:`, signal);
    return signal;
  } catch (err) {
    console.error(`[swing] Error: ${err.message}`);
    return { trend: 'neutral', setup: 'neutral', entry: 'neutral' };
  }
};

/* ------------------------------ ScoreSignal Strategy (Phase 1) ------------------------------ */
exports.scoresignal = async (symbol) => {
  try {
    const chart = await yf.chart(symbol, { interval: '15m', range: '5d' });
    const data = chart.quotes
      .filter(q => q && q.high && q.low && q.close && q.volume)
      .map(q => ({
        high: q.high,
        low: q.low,
        close: q.close,
        open: q.open,
        volume: q.volume
      }));

    if (data.length < 30) throw new Error("Not enough data points");
    let score = 0;
    const closes = data.map(d => d.close);

    /* ---------- VWAP ---------- */
    const vwap = data.reduce((acc, d) => acc + d.close * d.volume, 0) /
                 data.reduce((acc, d) => acc + d.volume, 0);
    const lastClose = closes.at(-1);
    if (lastClose > vwap) score += 1; else score -= 1;

    /* ---------- EMA(9) & EMA(21) ---------- */
    const ema = (arr, period) => {
      const k = 2 / (period + 1);
      let emaArr = [arr[0]];
      for (let i = 1; i < arr.length; i++) {
        emaArr.push(arr[i] * k + emaArr[i - 1] * (1 - k));
      }
      return emaArr;
    };
    const ema9 = ema(closes, 9);
    const ema21 = ema(closes, 21);
    if (ema9.at(-1) > ema21.at(-1)) score += 1; else score -= 1;

    /* ---------- RSI(14) ---------- */
    const gains = [], losses = [];
    for (let i = 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      gains.push(diff > 0 ? diff : 0);
      losses.push(diff < 0 ? -diff : 0);
    }
    const avgGain = gains.slice(-14).reduce((a, b) => a + b, 0) / 14;
    const avgLoss = losses.slice(-14).reduce((a, b) => a + b, 0) / 14;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    if (rsi < 45) score += 1;
    else if (rsi > 65) score -= 1;

    /* ---------- MACD(12,26,9) ---------- */
    const ema12 = ema(closes, 12);
    const ema26 = ema(closes, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const signalLine = ema(macdLine, 9);
    const macdHist = macdLine.at(-1) - signalLine.at(-1);
    if (macdHist > 0) score += 2; else score -= 2;

    /* ---------- Bollinger Bands (20,2) ---------- */
    const period = 20;
    const recent = closes.slice(-period);
    const mean = recent.reduce((a, b) => a + b, 0) / period;
    const stdDev = Math.sqrt(
      recent.map(c => (c - mean) ** 2).reduce((a, b) => a + b, 0) / period
    );
    const upper = mean + 2 * stdDev;
    const lower = mean - 2 * stdDev;
    if (lastClose > upper) score -= 1;
    else if (lastClose < lower) score += 1;

    /* ---------- Debug Log ---------- */
    console.log(`
==============================
[scoresignal] ${symbol}
Close: ${lastClose}
VWAP: ${vwap.toFixed(2)}
EMA9: ${ema9.at(-1).toFixed(2)} | EMA21: ${ema21.at(-1).toFixed(2)}
RSI: ${rsi.toFixed(2)}
MACD Hist: ${macdHist.toFixed(2)}
BBands: ${lower.toFixed(2)} - ${upper.toFixed(2)}
Score: ${score}
==============================
`);

    /* ---------- Final Signal ---------- */
    let final = 'Hold';
    if (score >= 4) final = 'Strong Buy';
    else if (score >= 2) final = 'Buy';
    else if (score <= -4) final = 'Strong Sell';
    else if (score <= -2) final = 'Sell';

    return { symbol, score, final };

  } catch (err) {
    console.error(`[scoresignal] Error for ${symbol}: ${err.message}`);
    return { symbol, score: 0, final: 'Hold', error: err.message };
  }
};
