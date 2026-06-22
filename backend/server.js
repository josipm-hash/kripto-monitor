const express = require('express');
const cors = require('cors');
const axios = require('axios');
const Parser = require('rss-parser');
const rssParser = new Parser();
// Pamćenje poslanih signala (zaštita od duplikata)
const sentNewsCache = new Set();
const app = express();
app.use(cors());
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const COINGECKO_API = process.env.COINGECKO_API;
const ANTHROPIC_API = process.env.ANTHROPIC_API;

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Kripto Monitor Backend radi!' });
});

// AI analiza endpoint
app.post('/analyze', async (req, res) => {
  const { coin, rsi, macd, volume, price, support, resistance } = req.body;

  try {
    // Claude AI analiza
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
7. Objašnjenje za POČETNIKE - piši jednostavnim jezikom kao da objašnjavaš prijatelju koji ne zna ništa o tradingu. Kratko objasni termine u zagradama (npr. "RSI je nizak (što znači da se puno prodavalo)"). Max 200 znakova, 1-2 rečenice.

Odgovori u JSON formatu:
{"signal":"DA/NE/CEKAJ","ulaz":0,"tp":0,"sl":0,"rr":"1:2","pump":"NE/SUMNJA","sentiment":"Bullish/Bearish/Neutral","pouzdanost":"Visoka/Srednja/Niska","explanation":"tekst"}
        `}]
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
console.log('AI ODGOVOR:', text); // DEBUG

const jsonMatch = text.match(/\{[\s\S]*\}/);
if (!jsonMatch) {
  console.error('Nema JSON-a u odgovoru:', text);
  throw new Error('AI nije vratio JSON');
}
const analysis = JSON.parse(jsonMatch[0]);

    // Pošalji Telegram ako je jak signal
    if (analysis.signal === 'DA') {
      const msg = `🚨 SIGNAL - ${coin}
━━━━━━━━━━━━━━━
💰 Cijena: $${price}
📊 RSI: ${rsi} | MACD: ${macd}
📈 Volume: +${volume}%

🎯 PREPORUKA:
Ulaz: $${analysis.entry}
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
      { chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// RSS izvori za vijesti
const RSS_FEEDS = [
  { name: 'CoinTelegraph', url: 'https://cointelegraph.com/rss' },
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' }
];

// Dohvati vijesti sa svih RSS izvora
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

// Endpoint za testiranje dohvata vijesti
app.get('/news-fetch', async (req, res) => {
  try {
    const news = await fetchAllNews();
    res.json({ success: true, count: news.length, news });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Dohvati postove s Reddit r/CryptoCurrency
async function fetchRedditPosts() {
  try {
    const response = await axios.get(
      'https://www.reddit.com/r/CryptoCurrency/hot.json?limit=25',
      {
        headers: {
          'User-Agent': 'kripto-monitor-app/1.0'
        }
      }
    );
    const posts = response.data.data.children.map(post => ({
      title: post.data.title,
      upvotes: post.data.ups,
      numComments: post.data.num_comments,
      link: `https://reddit.com${post.data.permalink}`,
      created: new Date(post.data.created_utc * 1000).toISOString(),
      selftext: post.data.selftext ? post.data.selftext.slice(0, 300) : ''
    }));
    return posts;
  } catch (err) {
    console.error('Greška kod dohvaćanja Reddita:', err.message);
    return [];
  }
}

// Endpoint za testiranje dohvata Reddit postova
app.get('/reddit-fetch', async (req, res) => {
  try {
    const posts = await fetchRedditPosts();
    res.json({ success: true, count: posts.length, posts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// LunarCrush sentiment za valutu
async function fetchLunarCrushSentiment(coinSymbol) {
  try {
    const LUNARCRUSH_API = process.env.LUNARCRUSH_API;
    const response = await axios.get(
      `https://lunarcrush.com/api4/public/coins/${coinSymbol.toLowerCase()}/v1`,
      {
        headers: {
          'Authorization': `Bearer ${LUNARCRUSH_API}`
        }
      }
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

// Glavni endpoint: skeniraj vijesti + sentiment + AI analiza
app.get('/news-scan', async (req, res) => {
  try {
    // 1. Dohvati vijesti
    const news = await fetchAllNews();
    const newsText = news.slice(0, 20).map(n => {
  const date = n.pubDate ? new Date(n.pubDate).toLocaleString('hr-HR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }) : 'datum nepoznat';
  return `[${n.source} | ${date}] ${n.title} — ${n.summary?.slice(0, 100) || ''}`;
}).join('\n');

    // 2. Fear & Greed Index + LunarCrush (ako dostupan)
let fearGreedText = '';
try {
  const fgResponse = await axios.get('https://api.alternative.me/fng/');
  const fgData = fgResponse.data.data[0];
  const fgValue = fgData.value;
  const fgLabel = fgData.value_classification;
  fearGreedText = `Fear & Greed Index: ${fgValue}/100 — ${fgLabel}`;
} catch (err) {
  fearGreedText = 'Fear & Greed Index: nedostupan';
}

const coins = ['BTC', 'ETH', 'SOL', 'BNB', 'ADA', 'AVAX', 'DOT', 'LINK'];
const sentimentResults = [];
for (const coin of coins) {
  const s = await fetchLunarCrushSentiment(coin);
  if (s) sentimentResults.push(s);
}
const lunarText = sentimentResults.length > 0
  ? sentimentResults.map(s =>
      `${s.symbol}: Galaxy Score=${s.galaxyScore}, Sentiment=${s.sentiment}, Social Volume=${s.socialVolume}`
    ).join('\n')
  : 'LunarCrush: nije dostupno (potreban plaćeni plan)';

const sentimentText = `${fearGreedText}\n${lunarText}`;

    // 3. AI analiza vijesti + sentimenta
    const aiResponse = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `Ti si kripto analitičar. Analiziraj vijesti i sentiment podatke i pronađi TOP 3 prilike za eksplozivni rast cijene.

VIJESTI (zadnjih sat vremena):
${newsText}

SENTIMENT PODATCI:
${sentimentText}

Za svaku valutu procijeni:
1. Slažu li se vijesti i sentiment? (poklapanje = jak signal)
2. Ima li znakova pump & dump manipulacije?
3. Je li rast organski ili umjetan?
4. Kolika je pouzdanost signala?

VAŽNO: 
- Masovna organska reakcija zajednice (visok social volume) jednako je važna kao pojedinačna utjecajna vijest
- Ako cijena već jako porasla a vijesti su tek stigle = SUMNJA NA PUMP
- Objasni jednostavnim jezikom kao za početnike

Odgovori u JSON formatu:
{
  "signals": [
    {
      "coin": "BTC",
      "signal": "DA/NE/CEKAJ",
      "pouzdanost": "Visoka/Srednja/Niska",
      "poklapanje": "Vijesti i sentiment se SLAŽU/NE SLAŽU/DJELOMIČNO",
      "pump_sumnja": true/false,
      "razlog_poklapanja": "kratko objašnjenje zašto se slažu ili ne",
      "vijesti_summary": "kratki sažetak relevantnih vijesti",
      "sentiment_opis": "opis sentiment signala",
      "preporuka": "što napraviti i zašto, jednostavnim jezikom"
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
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI nije vratio JSON');
    const result = JSON.parse(jsonMatch[0]);

    // 4. Pošalji Telegram za svaki jak signal
    for (const s of result.signals) {
     const cacheKey = `${s.coin}-${s.vijesti_summary?.slice(0, 50)}`;
if ((s.signal === 'DA' || s.pouzdanost === 'Visoka') && !sentNewsCache.has(cacheKey)) {
  sentNewsCache.add(cacheKey);
        const pumpIcon = s.pump_sumnja ? '⚠️ SUMNJA NA PUMP!' : '✅ Organski rast';
        const poklapanjeIcon = s.poklapanje?.includes('SLAŽU') ? '✅' : '⚠️';

        const msg = `🚨 NEWS SIGNAL - ${s.coin}
━━━━━━━━━━━━━━━
📰 VIJESTI:
${s.vijesti_summary}

🌐 SENTIMENT (Twitter+Reddit):
${s.sentiment_opis}

😨 FEAR & GREED INDEX:
${fearGreedText}
${(() => {
  if (fearGreedText.includes('Extreme Greed')) return '🔴 EKSTREMNA POHLEPA — svi žele kupiti, cijena može pasti. Ulazi oprezno!';
  if (fearGreedText.includes('Greed')) return '🟠 POHLEPA — tržište je optimistično, ali pazi na preveliko oduševljenje.';
  if (fearGreedText.includes('Extreme Fear')) return '🟢 EKSTREMNI STRAH — svi prodaju. Historijski, dobre prilike za kupnju!';
  if (fearGreedText.includes('Fear')) return '🟡 STRAH — tržište je nervozno. Kvalitetne valute mogu biti podcijenjene.';
  return '⚪ NEUTRALNO — nema ekstremnih emocija, tehnika je pouzdanija.';
})()}

${poklapanjeIcon} POKLAPANJE SIGNALA:
${s.razlog_poklapanja}

🔍 PUMP & DUMP provjera:
${pumpIcon}

🎯 PREPORUKA:
${s.preporuka}

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
