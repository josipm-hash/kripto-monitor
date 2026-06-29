const express = require('express');
const cors = require('cors');
const axios = require('axios');
const Parser = require('rss-parser');
const rssParser = new Parser();

const sentNewsCache = new Set();
const app = express();
app.use(cors());
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const COINGECKO_API = process.env.COINGECKO_API;
const ANTHROPIC_API = process.env.ANTHROPIC_API;

// Mapa: simbol → CoinGecko ID
const COIN_ID_MAP = {
  'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana',
  'BNB': 'binancecoin', 'XRP': 'ripple', 'ADA': 'cardano',
  'AVAX': 'avalanche-2', 'DOT': 'polkadot', 'LINK': 'chainlink',
  'DOGE': 'dogecoin', 'SHIB': 'shiba-inu', 'MATIC': 'matic-network',
  'UNI': 'uniswap', 'ATOM': 'cosmos', 'LTC': 'litecoin',
  'BCH': 'bitcoin-cash', 'XLM': 'stellar', 'TON': 'the-open-network',
  'ICP': 'internet-computer', 'APT': 'aptos'
};

app.get('/', (req, res) => {
  res.json({ status: 'Kripto Monitor Backend radi!' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Dohvati trenutnu cijenu i tehničke podatke za valutu
async function fetchCoinData(coinSymbol) {
  try {
    const coinId = COIN_ID_MAP[coinSymbol.toUpperCase()];
    if (!coinId) return null;

    const headers = { 'Accept': 'application/json' };
    if (COINGECKO_API) headers['x-cg-demo-api-key'] = COINGECKO_API;

    // Trenutna cijena
    const marketRes = await axios.get(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coinId}`,
      { headers }
    );
    const coin = marketRes.data[0];
    if (!coin) return null;

    // Povijest cijena (30 dana za tehničku analizu)
    const histRes = await axios.get(
      `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=30&interval=daily`,
      { headers }
    );
    const prices = histRes.data.prices?.map(p => p[1]) || [];

    // RSI
    let rsi = null;
    if (prices.length >= 15) {
      let gains = 0, losses = 0;
      for (let i = prices.length - 14; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff > 0) gains += diff; else losses += Math.abs(diff);
      }
      const avgGain = gains / 14, avgLoss = losses / 14;
      if (avgLoss > 0) rsi = Math.round(100 - 100 / (1 + avgGain / avgLoss));
      else rsi = 100;
    }

    // Support / Resistance
    const sorted = [...prices].sort((a, b) => a - b);
    const support = sorted[Math.floor(sorted.length * 0.1)];
    const resistance = sorted[Math.floor(sorted.length * 0.9)];

    // Volume spike
    const volumeSpike = coin.total_volume > (coin.market_cap * 0.1);

    return {
      price: coin.current_price,
      change24h: coin.price_change_percentage_24h,
      rsi,
      support: support?.toFixed(2),
      resistance: resistance?.toFixed(2),
      volumeSpike,
      macd: prices.length >= 26 ? 'dostupan' : 'N/A'
    };
  } catch (err) {
    console.error(`Greška kod dohvaćanja podataka za ${coinSymbol}:`, err.message);
    return null;
  }
}

// AI analiza endpoint (price scan)
app.post('/analyze', async (req, res) => {
  const { coin, rsi, macd, volume, price, support, resistance } = req.body;
  try {
    const aiResponse = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `Analiziraj kriptovalutu za kratkoročno trgovanje na hrvatskom jeziku.

Valuta: ${coin}
Cijena: $${price}
RSI: ${rsi}
MACD: ${macd}
Volume promjena: ${volume}%
Support: $${support}
Resistance: $${resistance}

Daj:
1. Je li ovo dobar signal za ulaz? (DA/NE/ČEKAJ)
2. Preporučena cijena ulaza
3. Take Profit (TP) cijena
4. Stop Loss (SL) cijena
5. Omjer rizik/nagrada
6. Je li ovo pump & dump? (DA/NE/SUMNJA)
7. Objašnjenje za POČETNIKE - jednostavnim jezikom, max 200 znakova.

Odgovori u JSON formatu:
{"signal":"DA/NE/CEKAJ","ulaz":0,"tp":0,"sl":0,"rr":"1:2","pump":"NE/SUMNJA","sentiment":"Bullish/Bearish/Neutral","pouzdanost":"Visoka/Srednja/Niska","explanation":"tekst"}`
        }]
      },
      {
        headers: {
          'x-api-key': ANTHROPIC_API,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      }
    );

    const text = aiResponse.data.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI nije vratio JSON');
    const analysis = JSON.parse(jsonMatch[0]);

    // BUG FIX: koristimo analysis.ulaz (ne analysis.entry)
    if (analysis.signal === 'DA') {
      const msg = `🚨 SIGNAL - ${coin}
━━━━━━━━━━━━━━━
💰 Cijena: $${price}
📊 RSI: ${rsi} | MACD: ${macd}
📈 Volume: +${volume}%

🎯 PREPORUKA:
Ulaz: $${analysis.ulaz}
TP: $${analysis.tp}
SL: $${analysis.sl}
R/R: ${analysis.rr}

⚠️ Pump & Dump: ${analysis.pump}

💬 ${analysis.explanation}
━━━━━━━━━━━━━━━
⚠️ Nije financijski savjet!`;

      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
        { chat_id: TELEGRAM_CHAT_ID, text: msg }
      );
    }

    res.json({ success: true, analysis });
  } catch (error) {
    console.error('Greška:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/telegram', async (req, res) => {
  try {
    const { text } = req.body;
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
{ chat_id: TELEGRAM_CHAT_ID, text }
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const RSS_FEEDS = [
  { name: 'CoinTelegraph', url: 'https://cointelegraph.com/rss' },
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' }
];

async function fetchAllNews() {
  const allNews = [];
  for (const feed of RSS_FEEDS) {
    try {
      const parsed = await rssParser.parseURL(feed.url);
      const items = parsed.items.slice(0, 15).map(item => ({
        source: feed.name,
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        summary: item.contentSnippet || ''
      }));
      allNews.push(...items);
    } catch (err) {
      console.error(`Greška kod dohvaćanja ${feed.name}:`, err.message);
    }
  }
  return allNews;
}

app.get('/news-fetch', async (req, res) => {
  try {
    const news = await fetchAllNews();
    res.json({ success: true, count: news.length, news });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function fetchLunarCrushSentiment(coinSymbol) {
  try {
    const LUNARCRUSH_API = process.env.LUNARCRUSH_API;
    const response = await axios.get(
      `https://lunarcrush.com/api4/public/coins/${coinSymbol.toLowerCase()}/v1`,
      { headers: { 'Authorization': `Bearer ${LUNARCRUSH_API}` } }
    );
    const data = response.data.data;
    return {
      symbol: coinSymbol,
      galaxyScore: data.galaxy_score || null,
      altRank: data.alt_rank || null,
      sentiment: data.sentiment || null,
      socialVolume: data.social_volume_24h || null,
      socialScore: data.social_score || null
    };
  } catch (err) {
    console.error(`LunarCrush greška za ${coinSymbol}:`, err.message);
    return null;
  }
}

// Glavni news scan endpoint
app.get('/news-scan', async (req, res) => {
  try {
    // 1. Vijesti
    const news = await fetchAllNews();
    const newsText = news.slice(0, 20).map(n => {
      const date = n.pubDate ? new Date(n.pubDate).toLocaleString('hr-HR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      }) : 'datum nepoznat';
      return `[${n.source} | ${date}] ${n.title} — ${n.summary?.slice(0, 100) || ''}`;
    }).join('\n');

    // 2. Fear & Greed
    let fearGreedText = '';
    let fgValue = 50;
    try {
      const fgResponse = await axios.get('https://api.alternative.me/fng/');
      const fgData = fgResponse.data.data[0];
      fgValue = parseInt(fgData.value);
      fearGreedText = `Fear & Greed Index: ${fgValue}/100 — ${fgData.value_classification}`;
    } catch (err) {
      fearGreedText = 'Fear & Greed Index: nedostupan';
    }

    // 3. LunarCrush
    const coins = ['BTC', 'ETH', 'SOL', 'BNB', 'ADA', 'AVAX', 'DOT', 'LINK'];
    const sentimentResults = [];
    for (const coin of coins) {
      const s = await fetchLunarCrushSentiment(coin);
      if (s) sentimentResults.push(s);
    }
    const lunarText = sentimentResults.length > 0
      ? sentimentResults.map(s => `${s.symbol}: Galaxy Score=${s.galaxyScore}, Sentiment=${s.sentiment}, Social Volume=${s.socialVolume}`).join('\n')
      : 'LunarCrush: nije dostupno (potreban plaćeni plan)';

    const sentimentText = `${fearGreedText}\n${lunarText}`;

    // 4. AI analiza vijesti
    const aiResponse = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `Ti si kripto analitičar. Analiziraj vijesti i sentiment podatke i pronađi TOP 3 prilike za eksplozivni rast cijene.

VIJESTI:
${newsText}

SENTIMENT:
${sentimentText}

VAŽNO:
- Masovna organska reakcija zajednice jednako je važna kao pojedinačna utjecajna vijest
- Ako cijena već jako porasla a vijesti su tek stigle = SUMNJA NA PUMP
- Objasni jednostavnim jezikom za početnike

Odgovori u JSON formatu:
{
  "signals": [
    {
      "coin": "BTC",
      "signal": "DA/NE/CEKAJ",
      "pouzdanost": "Visoka/Srednja/Niska",
      "poklapanje": "Vijesti i sentiment se SLAŽU/NE SLAŽU/DJELOMIČNO",
      "pump_sumnja": true/false,
      "razlog_poklapanja": "kratko objašnjenje",
      "vijesti_summary": "kratki sažetak relevantnih vijesti",
      "sentiment_opis": "opis sentiment signala",
      "preporuka": "što napraviti, jednostavnim jezikom"
    }
  ]
}`
        }]
      },
      {
        headers: {
          'x-api-key': ANTHROPIC_API,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      }
    );

    const text = aiResponse.data.content[0].text;
    const cleanText = text.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI nije vratio JSON');

    let result;
    try {
      const cleanJson = jsonMatch[0]
        .replace(/[\u2013\u2014\u2015]/g, '-')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\n\r\t]/g, ' ');
      result = JSON.parse(cleanJson);
    } catch (e) {
      console.error('JSON parse greška:', e.message);
      throw new Error('AI vratio neispravan JSON');
    }

    // 5. Za svaki jak signal — povuci cijene i dodaj Ulaz/TP/SL
    const fgExplanation = fgValue >= 80 ? '🔴 EKSTREMNA POHLEPA — svi žele kupiti, opasnost od pada!' :
      fgValue >= 60 ? '🟠 POHLEPA — tržište je optimistično, budi oprezan.' :
      fgValue >= 40 ? '⚪ NEUTRALNO — nema ekstremnih emocija, tehnika je pouzdanija.' :
      fgValue >= 20 ? '🟡 STRAH — tržište je nervozno, kvalitetne valute podcijenjene.' :
      '🟢 EKSTREMNI STRAH — svi prodaju! Historijski izvrsne prilike za kupnju!';

    for (const s of result.signals) {
      const cacheKey = `${s.coin}-${s.vijesti_summary?.slice(0, 50)}`;
      if ((s.signal === 'DA' || s.pouzdanost === 'Visoka') && !sentNewsCache.has(cacheKey)) {
        sentNewsCache.add(cacheKey);

        // Povuci tehničke podatke za ovu valutu
        const coinData = await fetchCoinData(s.coin);

        const pumpIcon = s.pump_sumnja ? '⚠️ SUMNJA NA PUMP!' : '✅ Organski rast';
        const poklapanjeIcon = s.poklapanje?.includes('SLAŽU') ? '✅' : '⚠️';

        // Tehnički blok (ako su dostupni podaci)
        let tehničkiBlok = '';
        let preporukaBlok = s.preporuka;

        if (coinData) {
          tehničkiBlok = `
📈 TEHNIČKI PODACI:
Cijena: $${coinData.price?.toLocaleString()}
24h promjena: ${coinData.change24h?.toFixed(2)}%
RSI: ${coinData.rsi ?? 'N/A'} ${coinData.rsi < 30 ? '(preprodano ✅)' : coinData.rsi > 70 ? '(prekupljeno ⚠️)' : ''}
Support: $${coinData.support}
Resistance: $${coinData.resistance}
Volume spike: ${coinData.volumeSpike ? 'DA ⚠️' : 'NE'}`;

          // Izračunaj Ulaz, TP, SL na temelju tehničkih podataka
          const price = coinData.price;
          const support = parseFloat(coinData.support);
          const resistance = parseFloat(coinData.resistance);
          const ulaz = price?.toFixed(2);
          const tp = (price + (resistance - price) * 0.7)?.toFixed(2);
          const sl = (price - (price - support) * 0.5)?.toFixed(2);
          const rizik = (price - sl).toFixed(2);
          const nagrada = (tp - price).toFixed(2);
          const rr = rizik > 0 ? `1:${(nagrada / rizik).toFixed(1)}` : 'N/A';

          preporukaBlok = `${s.preporuka}

🎯 PRIJEDLOG TRGOVANJA:
Ulaz: $${ulaz}
TP (cilj): $${tp}
SL (stop loss): $${sl}
R/R omjer: ${rr}`;
        }

        const msg = `🚨 NEWS SIGNAL - ${s.coin}
━━━━━━━━━━━━━━━
📰 VIJESTI:
${s.vijesti_summary}

🌐 SENTIMENT:
${s.sentiment_opis}
${tehničkiBlok}

😨 FEAR & GREED INDEX:
${fearGreedText}
${fgExplanation}

${poklapanjeIcon} POKLAPANJE SIGNALA:
${s.razlog_poklapanja}

🔍 PUMP & DUMP provjera:
${pumpIcon}

🎯 PREPORUKA:
${preporukaBlok}

📊 Pouzdanost: ${s.pouzdanost}
━━━━━━━━━━━━━━━
⚠️ Nije financijski savjet!`;

        await axios.post(
          `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
          { chat_id: TELEGRAM_CHAT_ID, text: msg }
        );
      }
    }

    res.json({ success: true, signals: result.signals });
  } catch (error) {
    console.error('News-scan greška:', error.message);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend pokrenut na portu ${PORT}`);
});
