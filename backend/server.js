const express = require('express');
const cors = require('cors');
const axios = require('axios');
const Parser = require('rss-parser');
const rssParser = new Parser();

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
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'CryptoPanic', url: 'https://cryptopanic.com/news/rss/' }
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend pokrenut na portu ${PORT}`);
});
