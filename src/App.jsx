import { useState, useEffect, useCallback } from "react";
const BACKEND_URL = "https://kripto-monitor.onrender.com";

function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round(100 - 100 / (1 + rs));
}

function calcEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

function calcMACD(prices) {
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  if (!ema12 || !ema26) return null;
  const macdLine = ema12 - ema26;
  return { macdLine: macdLine.toFixed(4), signal: macdLine > 0 ? "Bullish" : "Bearish" };}function calcBollinger(prices, period = 20) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
  const std = Math.sqrt(variance);
  return { upper: mean + 2 * std, lower: mean - 2 * std, mid: mean };
}

function calcFibonacci(high, low) {
  const diff = high - low;
  return {
    r236: high - diff * 0.236,
    r382: high - diff * 0.382,
    r500: high - diff * 0.5,
    r618: high - diff * 0.618,
    r786: high - diff * 0.786,
  };
}

function calcSupportResistance(prices) {
  if (prices.length < 2) return { support: prices[0], resistance: prices[0] };
  const sorted = [...prices].sort((a, b) => a - b);
  return {
    support: sorted[Math.floor(sorted.length * 0.1)],
    resistance: sorted[Math.floor(sorted.length * 0.9)],
  };
}

function detectGoldenDeath(prices) {
  const ma50 = prices.length >= 50 ? prices.slice(-50).reduce((a, b) => a + b, 0) / 50 : null;
  const ma200 = prices.length >= 200 ? prices.slice(-200).reduce((a, b) => a + b, 0) / 200 : null;
  if (!ma50 || !ma200) return { cross: "N/A", ma50, ma200 };
  if (ma50 > ma200) return { cross: "Golden Cross 🟡", ma50, ma200 };
  return { cross: "Death Cross 💀", ma50, ma200 };
}

function scoreSignal(analysis) {
  let score = 0;
  if (analysis.rsi !== null) {
    if (analysis.rsi < 30) score += 3;
    else if (analysis.rsi < 40) score += 1;
    else if (analysis.rsi > 70) score -= 2;
  }
  if (analysis.macd?.signal === "Bullish") score += 2;
  if (analysis.volumeSpike) score += 2;
  if (analysis.cross?.cross?.includes("Golden")) score += 2;
  if (analysis.bollinger && analysis.currentPrice < analysis.bollinger.lower) score += 2;
  return score;
}

function isPumpDump(coin) {
  const priceChange = Math.abs(coin.price_change_percentage_24h || 0);
  const volumeRatio = coin.total_volume / (coin.market_cap || 1);
  return priceChange > 15 && volumeRatio > 0.3;
  }
async function sendTelegram(botToken, chatId, text) {
  try {
    const res = await fetch(`https://kripto-monitor.onrender.com/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

async function getAIAnalysis(coin, technicals) {
  const prompt = `Ti si kripto analitičar. Analiziraj i daj preporuku u JSON formatu.

Valuta: ${coin.name} (${coin.symbol.toUpperCase()})
Cijena: $${coin.current_price}
24h: ${coin.price_change_percentage_24h?.toFixed(2)}%
RSI: ${technicals.rsi}
MACD: ${technicals.macd?.signal}
Support: $${technicals.sr?.support?.toFixed(2)}
Resistance: $${technicals.sr?.resistance?.toFixed(2)}
Fib 0.618: $${technicals.fib?.r618?.toFixed(2)}
Volume spike: ${technicals.volumeSpike ? "DA" : "NE"}
Pump&Dump: ${technicals.pumpDump ? "DA" : "NE"}

Odgovori SAMO JSON, bez ikakvog teksta prije ili poslije:
{"sentiment":"Bullish/Bearish/Neutral","vijesti":"kratki opis situacije","ulaz":"$cijena","tp":"$cijena","sl":"$cijena","rr":"1:X","preporuka":"1-2 rečenice","pouzdanost":"Visoka/Srednja/Niska"}`;

  try {
    const response = await fetch(`${BACKEND_URL}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        coin: `${coin.name} (${coin.symbol.toUpperCase()})`,
        rsi: technicals.rsi,
        macd: technicals.macd?.signal,
        volume: technicals.volumeSpike ? 200 : 50,
        price: coin.current_price,
        support: technicals.sr?.support,
        resistance: technicals.sr?.resistance
      }),
    });
    const data = await response.json();
    console.log('ANALYSIS:', JSON.stringify(data.analysis));
    return data.analysis;
  } catch (e) {
  return { sentiment: "N/A", explanation: "Analiza nedostupna", ulaz: "N/A", tp: "N/A", sl: "N/A", rr: "N/A", pouzdanost: "Niska" };
  }
} async function fetchTopCoins(apiKey) {
  const headers = { "Accept": "application/json" };
  if (apiKey && apiKey.startsWith("CG-")) {
    headers["x-cg-demo-api-key"] = apiKey;
  }
  const res = await fetch(
    "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false",
    { headers }
  );
  if (!res.ok) throw new Error(`CoinGecko greška: ${res.status}`);
  return res.json();
}

async function fetchCoinHistory(coinId, apiKey) {
  const headers = { "Accept": "application/json" };
  if (apiKey && apiKey.startsWith("CG-")) {
    headers["x-cg-demo-api-key"] = apiKey;
  }
  const res = await fetch(
    `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=30&interval=daily`,
    { headers }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.prices?.map(p => p[1]) || [];
}
export default function KriptoMonitor() {
  const [step, setStep] = useState("setup");
  const [cgKey, setCgKey] = useState("");
  const [tgToken, setTgToken] = useState("");
  const [tgChat, setTgChat] = useState("44452505");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [signals, setSignals] = useState([]);
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [error, setError] = useState("");
  const [setupError, setSetupError] = useState("");

  const handleStart = () => {
    if (!cgKey.trim()) { setSetupError("Upiši CoinGecko API ključ!"); return; }
    if (!tgToken.trim()) { setSetupError("Upiši Telegram Bot Token!"); return; }
    if (!tgChat.trim()) { setSetupError("Upiši Telegram Chat ID!"); return; }
    setSetupError("");
    runScan(cgKey.trim(), tgToken.trim(), tgChat.trim());
  };

  const runScan = async (apiKey, botToken, chatId) => {
    setStep("scanning");
    setError("");
    setSignals([]);
    setProgress(0);

    try {
      setProgressLabel("Dohvaćam TOP 50 valuta s CoinGecko...");
      setProgress(5);

      const coins = await fetchTopCoins(apiKey);
      if (!Array.isArray(coins) || coins.length === 0) {
        throw new Error("Nije moguće dohvatiti podatke. Provjeri API ključ.");
      }

      const results = [];

      for (let i = 0; i < Math.min(20, coins.length); i++) {
        const coin = coins[i];
        setProgressLabel(`Analiziram ${coin.symbol.toUpperCase()} (${i + 1}/20)...`);
        setProgress(5 + Math.round((i / 20) * 55));

        let prices = [];
        try {
          prices = await fetchCoinHistory(coin.id, apiKey);
          await new Promise(r => setTimeout(r, 1200));
        } catch (e) { prices = []; }

        const rsi = calcRSI(prices);
        const macd = calcMACD(prices);
        const bollinger = calcBollinger(prices);
        const sr = calcSupportResistance(prices.length > 2 ? prices : [coin.current_price * 0.95, coin.current_price, coin.current_price * 1.05]);
        const crossData = detectGoldenDeath(prices);
        const high = prices.length ? Math.max(...prices) : coin.current_price * 1.1;
        const low = prices.length ? Math.min(...prices) : coin.current_price * 0.9;
        const fib = calcFibonacci(high, low);
        const volumeSpike = (coin.total_volume / (coin.market_cap || 1)) > 0.15;
        const pumpDump = isPumpDump(coin);

        const technicals = { rsi, macd, bollinger, sr, cross: crossData, fib, volumeSpike, pumpDump, currentPrice: coin.current_price };
        const score = scoreSignal(technicals);

      const stablecoins = ["usdt", "usdc", "dai", "busd", "tusd", "usdd", "fdusd"];
const isStablecoin = stablecoins.includes(coin.symbol.toLowerCase());

if (score >= 1 && !isStablecoin) {
  results.push({ coin, technicals, score, ai: null });
}
      }

      results.sort((a, b) => b.score - a.score);
      const top5 = results.slice(0, 5);

      if (top5.length === 0) {
        setProgressLabel("Nema jakih signala trenutno.");
        setProgress(100);
        setStep("results");
        return;
      }

      for (let i = 0; i < top5.length; i++) {
        setProgressLabel(`AI analizira ${top5[i].coin.symbol.toUpperCase()}...`);
        setProgress(60 + i * 7);
        top5[i].ai = await getAIAnalysis(top5[i].coin, top5[i].technicals);
        await new Promise(r => setTimeout(r, 300));
      }

      setProgressLabel("Šaljem Telegram notifikacije...");
      setProgress(95);

      for (const sig of top5) {
        if (botToken && chatId) {
          const msg = buildTelegramMsg(sig);
          await sendTelegram(botToken, chatId, msg);
        }
      }

      setSignals(top5);
      setProgress(100);
      setProgressLabel(`Pronađeno ${top5.length} signala!`);
      setStep("results");

    } catch (e) {
      setError(e.message || "Nepoznata greška");
      setStep("results");
    }
  };function buildTelegramMsg({ coin, technicals: t, ai }) {
    return `🚨 <b>SIGNAL - ${coin.symbol.toUpperCase()}</b> (${coin.name})
━━━━━━━━━━━━━━━
💰 Cijena: $${coin.current_price?.toLocaleString()}
📈 24h: ${coin.price_change_percentage_24h?.toFixed(2)}%

📊 <b>TEHNIČKA ANALIZA:</b>
RSI: ${t.rsi ?? "N/A"}${t.rsi < 30 ? " ⬇️ Preprodano" : t.rsi > 70 ? " ⬆️ Prekupljeno" : ""}
MACD: ${t.macd?.signal ?? "N/A"}
Volume spike: ${t.volumeSpike ? "✅ DA" : "➖ NE"}
MA Cross: ${t.cross?.cross ?? "N/A"}
Support: $${t.sr?.support?.toFixed(2) ?? "N/A"}
Resistance: $${t.sr?.resistance?.toFixed(2) ?? "N/A"}
Fib 0.618: $${t.fib?.r618?.toFixed(2) ?? "N/A"}

📰 <b>FUNDAMENTALI:</b>
Sentiment: ${ai?.sentiment ?? "N/A"}
${ai?.explanation ?? ai?.vijesti ?? ""}

🎯 <b>PREPORUKA:</b>
Ulaz: ${ai?.entry ?? ai?.ulaz ?? "N/A"}
TP: ${ai?.tp ?? "N/A"}
Stop Loss: ${ai?.sl ?? "N/A"}
R/R: ${ai?.rr ?? "N/A"}
${ai?.explanation ?? ai?.preporuka ?? "NEMA EXPLANATION"}

⚠️ Pump&Dump: ${t.pumpDump ? "⚠️ SUMNJA!" : "✅ Organski"}
Pouzdanost: ${ai?.pouzdanost ?? "N/A"}
━━━━━━━━━━━━━━━
⚠️ <i>Nije financijski savjet!</i>`;
  }

  const inputStyle = {
    width: "100%", background: "#0d1420",
    border: "1px solid #1a3a5a", color: "#e0e8f0",
    padding: "14px 16px", borderRadius: 8,
    fontFamily: "inherit", fontSize: 14,
    outline: "none", boxSizing: "border-box",
    marginTop: 6
  };

  const labelStyle = {
    color: "#00ff88", fontSize: 12,
    letterSpacing: 2, display: "block"
  };if (step === "setup") {
    return (
      <div style={{
        minHeight: "100vh", background: "#080b12",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Courier New', monospace", padding: "24px"
      }}>
        <div style={{ width: "100%", maxWidth: 420 }}>
          <div style={{ textAlign: "center", marginBottom: 36 }}>
            <div style={{ fontSize: 52 }}>📡</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: "#00ff88", letterSpacing: 4, marginTop: 8 }}>
              KRIPTO MONITOR
            </div>
            <div style={{ color: "#334", fontSize: 11, marginTop: 4, letterSpacing: 2 }}>
              BOTTOM-UP SIGNAL SCANNER
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle}>COINGECKO API KLJUČ</label>
            <input
              value={cgKey}
              onChange={e => setCgKey(e.target.value)}
              placeholder="CG-xxxxxxxxxxxxxxxx"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle}>TELEGRAM BOT TOKEN</label>
            <input
              value={tgToken}
              onChange={e => setTgToken(e.target.value)}
              placeholder="123456789:AABBcc..."
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={labelStyle}>TELEGRAM CHAT ID</label>
            <input
              value={tgChat}
              onChange={e => setTgChat(e.target.value)}
              placeholder="44452505"
              style={inputStyle}
            />
          </div>

          {setupError && (
            <div style={{
              background: "#1a0810", border: "1px solid #ff4466",
              borderRadius: 8, padding: "12px 16px", marginBottom: 16,
              color: "#ff4466", fontSize: 13, textAlign: "center"
            }}>
              ⚠️ {setupError}
            </div>
          )}

          <button
            onClick={handleStart}
            style={{
              width: "100%", padding: "16px",
              background: "#00ff88", color: "#080b12",
              border: "none", borderRadius: 8,
              fontFamily: "inherit", fontWeight: 900,
              fontSize: 15, letterSpacing: 2, cursor: "pointer"
            }}
          >
            POKRENI MONITOR →
          </button>

          <div style={{ color: "#223", fontSize: 11, textAlign: "center", marginTop: 14 }}>
            Ključevi se ne pohranjuju nigdje
          </div>
        </div>
      </div>
    );
  }if (step === "scanning") {
    return (
      <div style={{
        minHeight: "100vh", background: "#080b12",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Courier New', monospace", padding: "24px"
      }}>
        <div style={{ width: "100%", maxWidth: 420, textAlign: "center" }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>🔍</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#00ff88", letterSpacing: 3, marginBottom: 8 }}>
            SKENIRANJE...
          </div>
          <div style={{ color: "#00ccff", fontSize: 13, marginBottom: 24, minHeight: 20 }}>
            {progressLabel}
          </div>

          <div style={{ background: "#0d1420", borderRadius: 6, height: 8, overflow: "hidden", marginBottom: 12 }}>
            <div style={{
              width: `${progress}%`, height: "100%",
              background: "linear-gradient(90deg, #00ff88, #00ccff)",
              transition: "width 0.6s ease", borderRadius: 6
            }} />
          </div>
          <div style={{ color: "#445", fontSize: 12 }}>{progress}%</div>

          <div style={{ marginTop: 30, color: "#223", fontSize: 11, lineHeight: 1.8 }}>
            ⬇️ Analiziram pokazatelje<br />
            → RSI → MACD → Volume<br />
            → Fibonacci → Support/Resistance<br />
            → Dolazim do valute s prilikama
          </div>
        </div>
      </div>
    );
  }return (
    <div style={{
      minHeight: "100vh", background: "#080b12",
      fontFamily: "'Courier New', monospace",
      color: "#c8d8e8", padding: "20px",
      maxWidth: 760, margin: "0 auto"
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#00ff88", letterSpacing: 3 }}>📡 KRIPTO MONITOR</div>
          <div style={{ fontSize: 11, color: "#334", marginTop: 2 }}>
            {signals.length > 0 ? `${signals.length} signala pronađena` : "Nema signala"}
          </div>
        </div>
        <button
          onClick={() => { setStep("setup"); setSignals([]); setError(""); }}
          style={{
            padding: "8px 16px", background: "#0d1420",
            border: "1px solid #1a3a5a", color: "#00ff88",
            borderRadius: 6, fontFamily: "inherit",
            fontSize: 11, cursor: "pointer", letterSpacing: 1
          }}
        >
          ↩ NOVI SCAN
        </button>
      </div>

      {error && (
        <div style={{
          background: "#1a0810", border: "1px solid #ff4466",
          borderRadius: 8, padding: "14px 18px", marginBottom: 20,
          color: "#ff4466", fontSize: 13
        }}>
          ⚠️ {error}
          <div style={{ marginTop: 8, fontSize: 11, color: "#884" }}>
            Provjeri jesu li API ključevi ispravni i pokušaj ponovo.
          </div>
        </div>
      )}

      {signals.length === 0 && !error && (
        <div style={{
          textAlign: "center", padding: "50px 20px",
          border: "1px dashed #1a2a3a", borderRadius: 12
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>😐</div>
          <div style={{ color: "#445", fontSize: 14 }}>Nema jakih signala trenutno</div>
          <div style={{ color: "#223", fontSize: 11, marginTop: 8 }}>Tržište je mirno — pokušaj za koji sat</div>
        </div>
      )}{signals.map((sig, idx) => {
        const { coin, technicals: t, ai, score } = sig;
        const expanded = expandedIdx === idx;
        const scoreColor = score >= 7 ? "#00ff88" : score >= 5 ? "#f0c040" : "#888";

        return (
          <div key={coin.id} style={{
            background: "#0d1420",
            border: `1px solid ${t.pumpDump ? "#ff4422" : "#1a2a3a"}`,
            borderRadius: 12, marginBottom: 14, overflow: "hidden",
            boxShadow: score >= 7 ? "0 0 20px rgba(0,255,136,0.06)" : "none"
          }}>
            <div
              onClick={() => setExpandedIdx(expanded ? null : idx)}
              style={{ padding: "16px 18px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <img src={coin.image} alt={coin.symbol} style={{ width: 36, height: 36, borderRadius: "50%" }} onError={e => e.target.style.display = "none"} />
                <div>
                  <div style={{ fontWeight: 900, color: "#e0e8f0", fontSize: 17 }}>
                    {coin.symbol.toUpperCase()}
                    <span style={{ color: "#445", fontSize: 12, fontWeight: 400, marginLeft: 8 }}>{coin.name}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#445", marginTop: 2 }}>
                    ${coin.current_price?.toLocaleString()} &nbsp;
                    <span style={{ color: (coin.price_change_percentage_24h || 0) >= 0 ? "#00ff88" : "#ff4466" }}>
                      {coin.price_change_percentage_24h?.toFixed(2)}%
                    </span>
                  </div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: "#334", letterSpacing: 1 }}>SCORE</div>
                <div style={{ fontSize: 26, fontWeight: 900, color: scoreColor }}>{score}</div>
                {t.pumpDump && <div style={{ fontSize: 10, color: "#ff4422" }}>⚠️ PUMP?</div>}
              </div>
            </div>

            <div style={{ display: "flex", borderTop: "1px solid #0f1820", fontSize: 11 }}>
              {[
                { l: "RSI", v: t.rsi ?? "N/A", c: t.rsi < 30 ? "#00ff88" : t.rsi > 70 ? "#ff4466" : "#f0c040" },
                { l: "MACD", v: t.macd?.signal ?? "N/A", c: t.macd?.signal === "Bullish" ? "#00ff88" : "#ff4466" },
                { l: "VOLUME", v: t.volumeSpike ? "SPIKE!" : "Normal", c: t.volumeSpike ? "#f0c040" : "#445" },
                { l: "MA CROSS", v: t.cross?.cross?.includes("Golden") ? "Golden 🟡" : t.cross?.cross?.includes("Death") ? "Death 💀" : "N/A", c: t.cross?.cross?.includes("Golden") ? "#f0c040" : "#888" },
              ].map(ind => (
                <div key={ind.l} style={{ flex: 1, padding: "8px 4px", textAlign: "center", borderRight: "1px solid #0f1820" }}>
                  <div style={{ color: "#334", marginBottom: 3 }}>{ind.l}</div>
                  <div style={{ color: ind.c, fontWeight: 700, fontSize: 10 }}>{ind.v}</div>
                </div>
              ))}
            </div>

            {expanded && (
              <div style={{ padding: "18px", borderTop: "1px solid #0f1820" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                  <div>
                    <div style={{ color: "#00ff88", fontSize: 10, letterSpacing: 2, marginBottom: 10 }}>📊 TEHNIČKA</div>
                    {[
                      ["RSI (14)", t.rsi ?? "N/A"],
                      ["MACD", t.macd?.signal ?? "N/A"],
                      ["BB Gornja", `$${t.bollinger?.upper?.toFixed(2) ?? "N/A"}`],
                      ["BB Donja", `$${t.bollinger?.lower?.toFixed(2) ?? "N/A"}`],
                      ["Support", `$${t.sr?.support?.toFixed(2) ?? "N/A"}`],
                      ["Resistance", `$${t.sr?.resistance?.toFixed(2) ?? "N/A"}`],
                      ["MA Cross", t.cross?.cross ?? "N/A"],
                    ].map(([k, v]) => (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #0f1820", fontSize: 11 }}>
                        <span style={{ color: "#445" }}>{k}</span>
                        <span style={{ color: "#c8d8e8" }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{ color: "#f0c040", fontSize: 10, letterSpacing: 2, marginBottom: 10 }}>📐 FIBONACCI</div>
                    {[["0.236", t.fib?.r236], ["0.382", t.fib?.r382], ["0.500", t.fib?.r500], ["0.618", t.fib?.r618], ["0.786", t.fib?.r786]].map(([k, v]) => (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #0f1820", fontSize: 11 }}>
                        <span style={{ color: "#445" }}>Fib {k}</span>
                        <span style={{ color: "#f0c040" }}>${v?.toFixed(2) ?? "N/A"}</span>
                      </div>
                    ))}
                    {ai && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ color: "#00ccff", fontSize: 10, letterSpacing: 2, marginBottom: 6 }}>📰 SENTIMENT</div>
                        <div style={{ background: "#080b12", borderRadius: 6, padding: "8px", fontSize: 11, color: "#8a9ab0", lineHeight: 1.6 }}>
                          <span style={{ color: ai.sentiment === "Bullish" ? "#00ff88" : ai.sentiment === "Bearish" ? "#ff4466" : "#f0c040", fontWeight: 700 }}>{ai.sentiment} — </span>
                          {ai.vijesti}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {ai && (
                  <div style={{ background: "#080b12", border: "1px solid #1a3a2a", borderRadius: 8, padding: "14px" }}>
                    <div style={{ color: "#00ff88", fontSize: 10, letterSpacing: 2, marginBottom: 12 }}>🎯 AI PREPORUKA</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                      {[
                        { l: "ULAZ", v: ai.ulaz, c: "#00ccff" },
                        { l: "TAKE PROFIT", v: ai.tp, c: "#00ff88" },
                        { l: "STOP LOSS", v: ai.sl, c: "#ff4466" },
                        { l: "R/R", v: ai.rr, c: "#f0c040" },
                      ].map(item => (
                        <div key={item.l} style={{ textAlign: "center", padding: "8px 4px", background: "#0d1420", borderRadius: 6 }}>
                          <div style={{ fontSize: 9, color: "#334", marginBottom: 4, letterSpacing: 1 }}>{item.l}</div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: item.c }}>{item.v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 12, color: "#8a9ab0", lineHeight: 1.6, marginBottom: 10 }}>{ai.preporuka}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                      <div style={{
                        padding: "4px 10px",
                        background: t.pumpDump ? "#1a0810" : "#001a10",
                        border: `1px solid ${t.pumpDump ? "#ff4422" : "#00ff44"}`,
                        borderRadius: 4, fontSize: 10,
                        color: t.pumpDump ? "#ff4422" : "#00ff88"
                      }}>
                        {t.pumpDump ? "⚠️ SUMNJA NA PUMP & DUMP" : "✅ Organski rast"}
                      </div>
                      <div style={{ fontSize: 11, color: "#334" }}>
                        Pouzdanost: <span style={{ color: ai.pouzdanost === "Visoka" ? "#00ff88" : ai.pouzdanost === "Srednja" ? "#f0c040" : "#445" }}>{ai.pouzdanost}</span>
                      </div>
                    </div>
                  </div>
                )}
                <div style={{ fontSize: 10, color: "#223", textAlign: "center", marginTop: 10 }}>
                  ⚠️ Nije financijski savjet. Uvijek istraži sam prije ulaganja.
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div style={{ textAlign: "center", marginTop: 24, fontSize: 10, color: "#223", letterSpacing: 1 }}>
        KRIPTO MONITOR MVP • @JoMonitorBot • Demo CoinGecko
      </div>
    </div>
  );
}
