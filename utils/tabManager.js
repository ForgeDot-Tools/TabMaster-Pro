/**
 * TabMaster Pro — Tab Manager
 * Core logic for grouping, cleanup, and tab operations.
 */

import { getSettings, getTabActivity, markProgrammaticTabs, isTabManuallyGrouped, incrementStat, getHeuristicCache, setHeuristicCache } from './storage.js';

/** Chrome tab group colors */
export const GROUP_COLORS = [
  'grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'
];

/** Known second-level TLDs where we need to take 3 parts (e.g. co.uk, co.in, com.au) */
const MULTI_PART_TLDS = new Set([
  'co.uk','co.in','co.nz','co.za','co.jp','co.kr','co.il','co.id',
  'com.au','com.br','com.ar','com.mx','com.sg','com.hk','com.tr',
  'org.uk','org.au','net.au','gov.uk','gov.au','gov.in',
  'ac.uk','ac.in','edu.au',
]);

/**
 * Extract the registrable domain from a URL.
 * Examples:
 *   now.hdfc.bank.in   → bank.in
 *   retail.sbi.bank.in → bank.in
 *   mail.google.com    → google.com
 *   bbc.co.uk          → bbc.co.uk
 */
export function getDomain(url) {
  try {
    const parts = new URL(url).hostname.toLowerCase().split('.');
    if (parts.length < 2) return parts[0] || null;
    // Check if last two parts form a known multi-part TLD (e.g. co.uk)
    const twoPartTld = parts.slice(-2).join('.');
    if (MULTI_PART_TLDS.has(twoPartTld) && parts.length >= 3) {
      // Take last 3 parts: e.g. bbc.co.uk
      return parts.slice(-3).join('.');
    }
    // Default: take last 2 parts (registrable domain)
    return parts.slice(-2).join('.');
  } catch {
    return null;
  }
}

/** Get a human-readable group name from a registrable domain */
export function getGroupName(domain) {
  if (!domain) return 'Other';
  const parts = domain.split('.');
  const name = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Get a human-readable group key+name for SUBDOMAIN mode.
 * Groups by the full hostname but produces a readable label.
 *
 * Examples:
 *   mail.google.com    → key: "mail.google.com",  label: "Mail · Google"
 *   drive.google.com   → key: "drive.google.com", label: "Drive · Google"
 *   retail.sbi.bank.in → key: "retail.sbi.bank.in", label: "Retail · Bank"
 *   www.github.com     → key: "github.com",        label: "Github"   (www stripped)
 */
export function getSubdomainGroupKey(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const registrable = getDomain(url); // e.g. google.com
    if (!registrable) return { key: hostname, label: hostname };

    if (hostname === registrable) {
      // No meaningful subdomain — use plain name
      return { key: registrable, label: getGroupName(registrable) };
    }

    // Build a readable "Subdomain · Site" label
    const subPart = hostname.slice(0, hostname.length - registrable.length - 1); // e.g. "mail"
    const siteName = getGroupName(registrable); // e.g. "Google"
    const subName  = subPart.charAt(0).toUpperCase() + subPart.slice(1);         // e.g. "Mail"
    return { key: hostname, label: `${subName} · ${siteName}` };
  } catch {
    return { key: url, label: url };
  }
}

/** Assign a deterministic color to a domain */
export function getDomainColor(domain) {
  if (!domain) return 'grey';
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = domain.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Built-in categories for smart tab grouping.
 * Each category defines hostname/URL patterns that identify tabs of that type.
 * Exported so settings.js can render category cards from the same source of truth.
 */
export const BUILTIN_CATEGORIES = [
  // ── 1. Banking & Finance ──────────────────────────────────────────────────
  {
    id: 'banking',
    name: 'Banking & Finance',
    emoji: '🏦',
    color: 'green',
    desc: 'Banks, payments, investing & trading platforms',
    patterns: [
      // ── Generic signals (catch-all for any locale) ───────────────────────
      'bank', 'netbanking', 'online-banking', 'creditcard', 'mutualfund',
      '/account/transfer', '/account/payment', '/trading/', '/invest/',
      // ── Global fintech & payments ────────────────────────────────────────
      'paypal.com', 'stripe.com', 'wise.com', 'revolut.com',
      'square.com', 'klarna.com', 'afterpay.com', 'venmo.com', 'cashapp.com',
      // ── Global investing ─────────────────────────────────────────────────
      'robinhood.com', 'etrade.com', 'schwab.com', 'fidelity.com',
      'vanguard.com', 'tdameritrade.com', 'interactivebrokers.com',
      'trading212.com', 'degiro.com', 'etoro.com', 'binance.com', 'coinbase.com',
      // ── US banks ────────────────────────────────────────────────────────
      'chase.com', 'wellsfargo.com', 'bankofamerica.com', 'citibank.com',
      'usbank.com', 'capitalone.com', 'pnc.com',
      // ── UK banks ────────────────────────────────────────────────────────
      'hsbc.com', 'barclays.co.uk', 'natwest.com', 'lloydsbank.com',
      'monzo.com', 'starlingbank.com',
      // ── EU banks ────────────────────────────────────────────────────────
      'n26.com', 'ing.com', 'bnpparibas.com', 'deutschebank.com',
      // ── India banks & fintech ────────────────────────────────────────────
      'hdfcbank.com', 'icicibank.com', 'onlinesbi.sbi', 'axisbank.com',
      'kotakbank.com', 'phonepe.com', 'paytm.com', 'razorpay.com',
      'zerodha.com', 'groww.in', 'nseindia.com', 'bseindia.com',
      'tickertape.in', 'smallcase.com', 'paytmmoney.com',
      // ── APAC ────────────────────────────────────────────────────────────
      'dbs.com.sg', 'uob.com.sg', 'ocbc.com', 'commbank.com.au',
      'nab.com.au', 'westpac.com.au', 'bca.co.id', 'maybank2u.com.my',
    ],
  },

  // ── 2. Work & Productivity ───────────────────────────────────────────────
  {
    id: 'work',
    name: 'Work & Productivity',
    emoji: '💼',
    color: 'blue',
    desc: 'Email, docs, project management & collaboration',
    patterns: [
      // ── Google Workspace ─────────────────────────────────────────────────
      'mail.google.com', 'drive.google.com', 'docs.google.com',
      'sheets.google.com', 'slides.google.com', 'calendar.google.com',
      'meet.google.com', 'chat.google.com',
      // ── Microsoft 365 ────────────────────────────────────────────────────
      'office.com', 'outlook.com', 'outlook.live.com',
      'teams.microsoft.com', 'sharepoint.com', 'onedrive.live.com',
      // ── Project & task management ────────────────────────────────────────
      'notion.so', 'jira.', 'confluence.', 'asana.com', 'trello.com',
      'linear.app', 'monday.com', 'clickup.com', 'basecamp.com',
      'todoist.com', 'height.app', 'taskade.com',
      // ── Design & visual collaboration ────────────────────────────────────
      'figma.com', 'miro.com', 'canva.com', 'airtable.com',
      'lucid.app', 'whimsical.com',
      // ── Communication & meetings ─────────────────────────────────────────
      'slack.com', 'zoom.us', 'webex.com', 'whereby.com',
      'gotomeeting.com', 'meet.jit.si',
      // ── Cloud storage ────────────────────────────────────────────────────
      'dropbox.com', 'box.com',
      // ── CRM / support / helpdesk ─────────────────────────────────────────
      'salesforce.com', 'hubspot.com', 'zendesk.com', 'intercom.com',
      'freshdesk.com', 'freshworks.com',
      // ── Regional productivity suites ──────────────────────────────────────
      'zoho.com', 'zohomail.com',                    // Global (India-origin)
      'worksuite.com', 'kakaopay.com',               // APAC
      // ── Bookmarks & Curation ─────────────────────────────────────────────
      'raindrop.io', 'getpocket.com', 'instapaper.com', 'pinboard.in',
    ],
  },

  // ── 3. Shopping ──────────────────────────────────────────────────────────
  {
    id: 'shopping',
    name: 'Shopping',
    emoji: '🛒',
    color: 'yellow',
    desc: 'E-commerce, online stores & marketplaces',
    patterns: [
      // ── Generic signals ──────────────────────────────────────────────────
      '/cart', '/checkout', '/wishlist', '/product/', '/buy-now',
      // ── Global ───────────────────────────────────────────────────────────
      'amazon.', 'ebay.com', 'etsy.com', 'aliexpress.com',
      'shopify.com', 'shein.com', 'temu.com', 'wish.com',
      // ── US ────────────────────────────────────────────────────────────────
      'walmart.com', 'target.com', 'bestbuy.com', 'costco.com',
      'newegg.com', 'wayfair.com', 'chewy.com',
      // ── UK / EU ───────────────────────────────────────────────────────────
      'asos.com', 'zalando.com', 'argos.co.uk', 'johnlewis.com',
      'otto.de', 'bol.com', 'cdiscount.com',
      // ── India ────────────────────────────────────────────────────────────
      'flipkart.com', 'myntra.com', 'nykaa.com', 'meesho.com',
      'ajio.com', 'snapdeal.com', 'indiamart.com',
      // ── APAC ────────────────────────────────────────────────────────────
      'lazada.com', 'tokopedia.com', 'shopee.com', 'rakuten.com',
      'jd.com', 'taobao.com', 'tmall.com', 'coupang.com',
      // ── LATAM ────────────────────────────────────────────────────────────
      'mercadolibre.com', 'americanas.com.br',
    ],
  },

  // ── 4. Social Media ──────────────────────────────────────────────────────
  {
    id: 'social',
    name: 'Social Media',
    emoji: '💬',
    color: 'pink',
    desc: 'Social networks, messaging & communities',
    patterns: [
      // ── Global mainstream ────────────────────────────────────────────────
      'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
      'linkedin.com', 'reddit.com', 'pinterest.com', 'snapchat.com',
      'tiktok.com', 'tumblr.com', 'threads.net',
      // ── Messaging ────────────────────────────────────────────────────────
      'whatsapp.com', 'web.whatsapp.com', 'telegram.org', 'web.telegram.org',
      'signal.org', 'discord.com', 'messenger.com',
      // ── Communities & interest ────────────────────────────────────────────
      'quora.com', 'mastodon.social', 'bsky.app', 'lemmy.',
      // ── APAC ────────────────────────────────────────────────────────────
      'weibo.com', 'wechat.com', 'line.me', 'kakaotalk.com',
      'vk.com', 'ok.ru',
      // ── India-origin platforms ────────────────────────────────────────────
      'sharechat.com', 'koo.com',
    ],
  },

  // ── 5. News & Media ──────────────────────────────────────────────────────
  {
    id: 'news',
    name: 'News & Media',
    emoji: '📰',
    color: 'orange',
    desc: 'News, articles, publications & blogs',
    patterns: [
      // ── Global wire services ─────────────────────────────────────────────
      'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk',
      'aljazeera.com', 'dw.com', 'france24.com',
      // ── US news ──────────────────────────────────────────────────────────
      'cnn.com', 'nytimes.com', 'washingtonpost.com', 'bloomberg.com',
      'wsj.com', 'usatoday.com', 'nbcnews.com', 'foxnews.com', 'politico.com',
      // ── UK / EU ───────────────────────────────────────────────────────────
      'theguardian.com', 'telegraph.co.uk', 'independent.co.uk',
      'spiegel.de', 'lemonde.fr', 'elpais.com',
      // ── Tech news (global) ────────────────────────────────────────────────
      'techcrunch.com', 'theverge.com', 'wired.com', 'arstechnica.com',
      'news.ycombinator.com', 'medium.com', 'substack.com',
      // ── India ────────────────────────────────────────────────────────────
      'ndtv.com', 'timesofindia.com', 'thehindu.com', 'indianexpress.com',
      'hindustantimes.com', 'livemint.com', 'economictimes.com',
      // ── APAC ────────────────────────────────────────────────────────────
      'straitstimes.com', 'scmp.com', 'theage.com.au', 'smh.com.au',
      // ── LATAM ────────────────────────────────────────────────────────────
      'globo.com', 'infobae.com',
    ],
  },

  // ── 6. Entertainment ─────────────────────────────────────────────────────
  {
    id: 'entertainment',
    name: 'Entertainment',
    emoji: '🎬',
    color: 'purple',
    desc: 'Streaming video, music, gaming & podcasts',
    patterns: [
      // ── Global video streaming ────────────────────────────────────────────
      'youtube.com', 'netflix.com', 'primevideo.com',
      'disneyplus.com', 'hbomax.com', 'max.com',
      'hulu.com', 'peacocktv.com', 'paramountplus.com',
      'appletv.apple.com', 'crunchyroll.com', 'funimation.com',
      'twitch.tv', 'dailymotion.com', 'vimeo.com',
      // ── Regional video streaming ──────────────────────────────────────────
      'hotstar.com', 'jiocinema.com', 'zee5.com', 'sonyliv.com', // India
      'voot.com', 'mxplayer.in', 'erosnow.com', 'altbalaji.com',  // India
      'iqiyi.com', 'youku.com', 'bilibili.com', 'wetv.vip',       // China / APAC
      'wavve.com', 'laftel.net',                                    // Korea
      'starzplay.com', 'shahid.net', 'weyyak.com',                 // MENA
      // ── Global music ─────────────────────────────────────────────────────
      'spotify.com', 'music.apple.com', 'music.youtube.com',
      'soundcloud.com', 'tidal.com', 'deezer.com', 'bandcamp.com',
      'pandora.com', 'amazon.com/music',
      // ── Regional music ────────────────────────────────────────────────────
      'jiosaavn.com', 'gaana.com', 'wynk.in',                      // India
      'netease.com', 'qqmusic.qq.com',                              // China
      // ── Gaming ────────────────────────────────────────────────────────────
      'store.steampowered.com', 'epicgames.com', 'gog.com', 'itch.io',
      'xbox.com', 'playstation.com', 'nintendo.com', 'ea.com',
      'battle.net', 'ubisoft.com', 'roblox.com',
      // ── Podcasts ─────────────────────────────────────────────────────────
      'podcasts.apple.com', 'open.spotify.com/episode', 'anchor.fm',
      'buzzsprout.com', 'podchaser.com',
    ],
  },

  // ── 7. Development ───────────────────────────────────────────────────────
  {
    id: 'dev',
    name: 'Development',
    emoji: '💻',
    color: 'cyan',
    desc: 'Code, docs, APIs & developer tools',
    patterns: [
      // ── Source control & community ────────────────────────────────────────
      'github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com',
      'stackexchange.com',
      // ── Package registries ────────────────────────────────────────────────
      'npmjs.com', 'pypi.org', 'crates.io', 'pkg.go.dev',
      'packagist.org', 'rubygems.org', 'nuget.org', 'maven.',
      // ── Deployment & hosting ─────────────────────────────────────────────
      'vercel.app', 'netlify.app', 'railway.app', 'render.com',
      'fly.io', 'heroku.com',
      // ── Domains & infrastructure ─────────────────────────────────────────
      'godaddy.com', 'namecheap.com', 'cloudflare.com', 'hostinger.com',
      // ── Cloud consoles ────────────────────────────────────────────────────
      'console.aws.amazon.com', 'cloud.google.com', 'portal.azure.com',
      'console.firebase.google.com', 'console.cloud.google.com', 'catalyst.zoho.com',
      // ── Online IDEs & sandboxes ───────────────────────────────────────────
      'codepen.io', 'codesandbox.io', 'replit.com', 'jsfiddle.net',
      'stackblitz.com', 'gitpod.io', 'codespaces.github.com',
      // ── Documentation & reference ─────────────────────────────────────────
      'developer.mozilla.org', 'devdocs.io', 'caniuse.com', 'regex101.com',
      'w3schools.com', 'developer.apple.com', 'developer.android.com',
      // ── Developer blogs & portfolios ─────────────────────────────────────
      'una.im', 'dev.to', 'hashnode.com', 'gitconnected.com',
      // ── API tools ────────────────────────────────────────────────────────
      'postman.com', 'insomnia.rest', 'hoppscotch.io', 'permit.io',
      // ── Local dev ────────────────────────────────────────────────────────
      'localhost', '127.0.0.1', '0.0.0.0', '192.168.',
    ],
  },

  // ── 8. AI & Tech Assistants ──────────────────────────────────────────────
  {
    id: 'ai',
    name: 'AI & Tech Assistants',
    emoji: '🤖',
    color: 'purple',
    desc: 'AI assistants, chatbots, LLMs & machine learning tools',
    patterns: [
      // ── AI Assistants & Chatbots ─────────────────────────────────────────
      'chatgpt.com', 'chat.openai.com', 'openai.com', 'claude.ai',
      'gemini.google.com', 'aistudio.google.com', 'perplexity.ai',
      'copilot.microsoft.com', 'poe.com', 'character.ai', 'pi.ai',
      // ── AI Code & Generation ──────────────────────────────────────────────
      'v0.dev', 'lovable.dev', 'githubcopilot.com', 'phind.com', 'cursor.sh', 'cursor.com',
      'midjourney.com', 'runwayml.com', 'elevenlabs.io', 'synthesia.io',
      // ── AI Hubs & Dev tools ───────────────────────────────────────────────
      'huggingface.co', 'replicate.com', 'civitai.com', 'ollama.com',
    ],
  },

  // ── 9. Learning & Education ──────────────────────────────────────────────
  {
    id: 'learning',
    name: 'Learning & Education',
    emoji: '🎓',
    color: 'red',
    desc: 'Online courses, tutorials, research & reference',
    patterns: [
      // ── Global MOOC platforms ─────────────────────────────────────────────
      'coursera.org', 'udemy.com', 'edx.org', 'khanacademy.org',
      'pluralsight.com', 'skillshare.com', 'udacity.com',
      'codecademy.com', 'freecodecamp.org', 'brilliant.org',
      'linkedin.com/learning', 'duolingo.com', 'babbel.com',
      // ── Research & reference ─────────────────────────────────────────────
      'wikipedia.org', 'scholar.google.com', 'researchgate.net',
      'academia.edu', 'arxiv.org', 'semanticscholar.org',
      'jstor.org', 'pubmed.ncbi.nlm.nih.gov',
      '.edu', '/learn/', '/course/', '/tutorial/', '/docs/',
      // ── Regional ed-tech ─────────────────────────────────────────────────
      'byjus.com', 'unacademy.com', 'vedantu.com', 'upgrad.com', // India
      'simplilearn.com', 'doubtnut.com',                           // India
      'xuetangx.com', 'zhihu.com',                                 // China
      'collab49.com', 'almentor.net',                              // MENA
      'domestika.org',                                             // LATAM / ES
    ],
  },

  // ── 10. Food & Delivery ───────────────────────────────────────────────────
  {
    id: 'food',
    name: 'Food & Delivery',
    emoji: '🍔',
    color: 'orange',
    desc: 'Food ordering, delivery & restaurant discovery',
    patterns: [
      // ── Global ────────────────────────────────────────────────────────────
      'doordash.com', 'ubereats.com', 'grubhub.com', 'deliveroo.com',
      'instacart.com', 'gopuff.com', 'postmates.com',
      'yelp.com', 'tripadvisor.com/restaurants', 'opentable.com',
      // ── Europe ────────────────────────────────────────────────────────────
      'justeat.com', 'takeaway.com', 'lieferando.de', 'thuisbezorgd.nl',
      'wolt.com', 'foodpanda.com',
      // ── India ────────────────────────────────────────────────────────────
      'zomato.com', 'swiggy.com', 'dunzo.com', 'blinkit.com', 'zepto.com',
      'eazydiner.com', 'dineout.co.in',
      // ── APAC ────────────────────────────────────────────────────────────
      'grab.com', 'gojek.com', 'meituan.com', 'ele.me',
      'demaecan.jp', 'foodpanda.com.hk',
      // ── LATAM ────────────────────────────────────────────────────────────
      'rappi.com', 'ifood.com.br',
    ],
  },

  // ── 11. Travel & Booking ──────────────────────────────────────────────────
  {
    id: 'travel',
    name: 'Travel & Booking',
    emoji: '✈️',
    color: 'blue',
    desc: 'Flights, hotels, trains & travel planning',
    patterns: [
      // ── Global OTAs & aggregators ─────────────────────────────────────────
      'booking.com', 'airbnb.com', 'expedia.com', 'tripadvisor.com',
      'skyscanner.com', 'kayak.com', 'hotels.com', 'agoda.com',
      'hostelworld.com', 'vrbo.com',
      // Airlines
      'airindia.com', 'indiigo.com', 'goair.in', 'spicejet.com',
      'vistara.com', 'akasaair.com', 'flydubai.com', 'emirates.com',
    ],
  },

  // ── 12. Government & Utilities ────────────────────────────────────────────
  {
    id: 'government',
    name: 'Government & Utilities',
    emoji: '🏛️',
    color: 'grey',
    desc: 'Government portals, tax filing & public services',
    patterns: [
      // Indian government
      'india.gov.in', 'nic.in', 'gov.in', 'uidai.gov.in',
      'incometax.gov.in', 'gst.gov.in', 'mca.gov.in',
      'digilocker.gov.in', 'epfindia.gov.in', 'umang.gov.in',
      'cowin.gov.in', 'passport.gov.in', 'mhrd.gov.in',
      'rto.gov.in', 'parivahan.gov.in', 'vahan.gov.in',
      // Generic TLDs
      '.gov', '.gov.in',
    ],
  },

  // ── 13. Search Engines ────────────────────────────────────────────────────
  {
    id: 'search',
    name: 'Search Engines',
    emoji: '🔍',
    color: 'grey',
    desc: 'Web search engines & portals',
    patterns: [
      'google.', 'bing.com', 'duckduckgo.com', 'yahoo.com', 'baidu.com',
      'yandex.', 'ecosia.org', 'startpage.com',
    ],
  },
];


/**
 * Returns the first matching BUILTIN_CATEGORY for a tab, or null.
 * Checks tab URL (full) and hostname against category patterns.
 */
export function tabMatchesCategory(tab, category) {
  const rawUrl   = tab.url || '';
  const url      = rawUrl.toLowerCase();
  const hostname = (() => { try { return new URL(rawUrl).hostname.toLowerCase(); } catch { return ''; } })();
  const baseDomain = hostname.split('.').slice(-2).join('.');

  return category.patterns.some((p) => {
    // Plain string (built-in patterns)
    if (typeof p === 'string') {
      const pat = p.toLowerCase();
      // If it looks like a standard domain pattern:
      // - contains a dot (e.g., google.com)
      // - does not contain a slash (not a URL path)
      // - does not start/end with a dot (not a TLD like .gov or keyword like jira.)
      if (pat.includes('.') && !pat.includes('/') && !pat.startsWith('.') && !pat.endsWith('.')) {
        return hostname === pat || hostname.endsWith('.' + pat);
      }
      return hostname.includes(pat) || url.includes(pat);
    }
    // Typed pattern object { type, value }
    const { type, value } = p;
    if (!value) return false;
    const v = value.toLowerCase();
    switch (type) {
      case 'url-contains':      return url.includes(v);
      case 'hostname-contains': return hostname.includes(v);
      case 'hostname-exact':    return hostname === v;
      case 'base-domain':       return baseDomain === v || hostname === v;
      case 'regex': {
        try { return new RegExp(value, 'i').test(rawUrl); } catch { return false; }
      }
      default:                  return hostname.includes(v) || url.includes(v);
    }
  });
}


/**
 * Heuristic Keyword Dictionary
 * Maps category IDs to a list of keywords to look for in the page title/description.
 */
const HEURISTIC_DICTIONARY = {
  shopping: ['shop', 'store', 'cart', 'buy', 'clothing', 'fashion', 'marketplace', 'checkout'],
  finance: ['bank', 'finance', 'invest', 'portfolio', 'crypto', 'wallet', 'tax', 'trading', 'loan', 'credit'],
  work: ['docs', 'spreadsheet', 'presentation', 'jira', 'confluence', 'workspace', 'slack', 'notion', 'trello', 'asana', 'invoice'],
  social: ['social', 'connect', 'community', 'forum', 'chat', 'message', 'network', 'friends', 'meet'],
  news: ['news', 'breaking', 'article', 'journal', 'post', 'blog', 'daily', 'times', 'report', 'headlines'],
  entertainment: ['video', 'watch', 'movie', 'stream', 'music', 'listen', 'podcast', 'game', 'play', 'show', 'entertainment'],
  dev: ['code', 'developer', 'api', 'hosting', 'domain', 'server', 'database', 'cloud', 'deployment', 'git', 'repository', 'docs'],
  ai: ['ai', 'artificial intelligence', 'chat', 'llm', 'generate', 'prompt', 'model'],
  learning: ['course', 'learn', 'tutorial', 'class', 'education', 'study', 'university', 'academy', 'degree'],
  food: ['food', 'delivery', 'restaurant', 'menu', 'order', 'eat', 'recipe', 'dining'],
  travel: ['travel', 'flight', 'hotel', 'book', 'trip', 'vacation', 'airline', 'booking', 'accommodation'],
  government: ['government', 'official', 'portal', 'tax', 'citizen', 'public services', 'department']
};

/**
 * Scrapes metadata from the actual tab DOM.
 * Must be executed in the context of the page.
 */
function scrapeTabMetadata() {
  const metaDesc = document.querySelector('meta[name="description"]')?.content || '';
  const metaKeywords = document.querySelector('meta[name="keywords"]')?.content || '';
  return { title: document.title, description: metaDesc, keywords: metaKeywords };
}

/**
 * Auto-group all tabs in the current window by domain.
 */
export async function autoGroupByDomain(windowId, forceReGroupAll = false) {
  const settings = await getSettings();
  const excluded = new Set(settings.excludedDomains || []);

  // Safety: if windowId is missing, resolve it from the focused window
  if (!windowId) {
    try {
      const win = await chrome.windows.getLastFocused();
      windowId = win?.id;
    } catch { /* ignore */ }
  }

  // Restricted URL prefixes that Chrome/Edge won't allow tab grouping on
  const RESTRICTED = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'data:', 'javascript:'];
  const isGroupable = (url) => url && !RESTRICTED.some((p) => url.startsWith(p));

  const allTabs = await chrome.tabs.query({ windowId });
  // If forceReGroupAll is false, only consider ungrouped tabs (t.groupId === -1)
  let tabs = allTabs.filter((t) => !t.pinned && isGroupable(t.url) && (forceReGroupAll || t.groupId === -1));

  if (!forceReGroupAll) {
    const filterResults = await Promise.all(tabs.map(async (t) => {
      const isManual = await isTabManuallyGrouped(t.id);
      return !isManual;
    }));
    tabs = tabs.filter((_, idx) => filterResults[idx]);
  }

  const existingGroups = await chrome.tabGroups.query({ windowId });
  const results = [];

  // ── Step 1: Category-based grouping (always runs) ───────────────
  // Each tab is matched against unified category list based on categoryOrder (first match wins).
  const categoryMatchedTabIds = new Set();

  {
    const overrides = settings.categoryOverrides || {};
    const catTabMap = {}; // catId → { label, emoji, color, tabIds[] }

    const builtInMap = Object.fromEntries(BUILTIN_CATEGORIES.map(c => [c.id, c]));
    const customMap = Object.fromEntries((settings.customCategories || []).map(c => [c.id, c]));
    const order = settings.categoryOrder || [];

    // Ensure any newly added categories are evaluated even if not in order array
    const allCatIds = new Set([...Object.keys(builtInMap), ...Object.keys(customMap)]);
    const evaluateOrder = [...order];
    for (const id of allCatIds) {
      if (!evaluateOrder.includes(id)) evaluateOrder.push(id);
    }

    for (const catId of evaluateOrder) {
      const isCustom = customMap.hasOwnProperty(catId);
      const isBuiltIn = builtInMap.hasOwnProperty(catId);
      if (!isCustom && !isBuiltIn) continue;

      let label, color, effectiveCat;

      if (isCustom) {
        const cat = customMap[catId];
        if (cat.enabled === false) continue;
        if (!cat.patterns?.length) continue;
        color = cat.color || 'blue';
        label = `${cat.emoji || '📁'} ${cat.name || 'Custom'}`;
        effectiveCat = cat;
      } else {
        const cat = builtInMap[catId];
        const ov = overrides[cat.id] || {};
        if (ov.enabled === false) continue;

        color = ov.color || cat.color;
        const name  = ov.name  || cat.name;
        label = `${cat.emoji} ${name}`;
        effectiveCat = {
          ...cat,
          patterns: [...cat.patterns, ...(ov.extraPatterns || [])],
        };
      }

      for (const tab of tabs) {
        if (categoryMatchedTabIds.has(tab.id)) continue;
        if (categoryMatchedTabIds.has(tab.id)) continue;
        if (tabMatchesCategory(tab, effectiveCat)) {
          if (!catTabMap[catId]) catTabMap[catId] = { label, color, tabIds: [] };
          catTabMap[catId].tabIds.push(tab.id);
          categoryMatchedTabIds.add(tab.id);
        }
      }
    }

    // ── Heuristic Fallback for Unmatched Tabs ──
    const unmatchedTabs = tabs.filter(t => !categoryMatchedTabIds.has(t.id));
    if (unmatchedTabs.length > 0) {
      const hCache = await getHeuristicCache();
      let cacheUpdated = false;

      const getCatDetails = (id) => {
        const c = customMap[id] || builtInMap[id];
        if (!c) return null;
        let color = c.color || 'blue';
        let name = c.name || 'Custom';
        if (builtInMap[id]) {
          const ov = overrides[id] || {};
          color = ov.color || color;
          name = ov.name || name;
        }
        return { label: `${c.emoji || '📁'} ${name}`, color };
      };

      await Promise.all(unmatchedTabs.map(async (tab) => {
        const domain = getDomain(tab.url);
        if (!domain || excluded.has(domain)) return;

        let matchedCatId = hCache[domain];

        if (!matchedCatId && tab.url && tab.url.startsWith('http')) {
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: scrapeTabMetadata
            });
            
            if (results && results[0] && results[0].result) {
              const { title, description, keywords } = results[0].result;
              const text = `${title} ${description} ${keywords}`.toLowerCase();
              
              for (const [catId, kws] of Object.entries(HEURISTIC_DICTIONARY)) {
                if (kws.some(kw => text.includes(kw))) {
                  if (customMap[catId] || builtInMap[catId]) {
                    matchedCatId = catId;
                    break;
                  }
                }
              }
              hCache[domain] = matchedCatId || 'unmatched';
              cacheUpdated = true;
            }
          } catch (e) {
            // Cannot execute script on discarded or restricted pages, fallback to just tab title
            if (tab.title) {
              const text = tab.title.toLowerCase();
              for (const [catId, kws] of Object.entries(HEURISTIC_DICTIONARY)) {
                if (kws.some(kw => text.includes(kw))) {
                  if (customMap[catId] || builtInMap[catId]) {
                    matchedCatId = catId;
                    break;
                  }
                }
              }
              hCache[domain] = matchedCatId || 'unmatched';
              cacheUpdated = true;
            }
          }
        }

        if (matchedCatId && matchedCatId !== 'unmatched') {
          const details = getCatDetails(matchedCatId);
          if (details) {
            if (!catTabMap[matchedCatId]) catTabMap[matchedCatId] = { label: details.label, color: details.color, tabIds: [] };
            catTabMap[matchedCatId].tabIds.push(tab.id);
            categoryMatchedTabIds.add(tab.id);
          }
        }
      }));

      if (cacheUpdated) {
        await chrome.storage.local.set({ heuristicCache: hCache });
      }
    }

    for (const { label, color, tabIds } of Object.values(catTabMap)) {
      if (tabIds.length === 0) continue;
      try {
        const existing = existingGroups.find((g) => g.title === label);
        if (existing) {
          const newCount = tabIds.filter(id => allTabs.find(t => t.id === id)?.groupId !== existing.id).length;
          await markProgrammaticTabs(tabIds);
          await chrome.tabs.group({ tabIds, groupId: existing.id });
          results.push({ groupId: existing.id, title: label, color, count: tabIds.length, newlyGroupedCount: newCount, source: 'category' });
        } else {
          await markProgrammaticTabs(tabIds);
          const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
          await chrome.tabGroups.update(groupId, { color, title: label });
          existingGroups.push({ id: groupId, title: label, color });
          results.push({ groupId, title: label, color, count: tabIds.length, newlyGroupedCount: tabIds.length, source: 'category' });
        }
      } catch (e) {
        console.warn('[TabMaster] Could not group category tabs for', label, e);
      }
    }
  }

  // ── Step 2: Domain-based grouping ─────────────────────────────────────
  // Only runs when settings.groupByDomain is true (default).
  // Subdomain behaviour:
  //   Global toggle: settings.subdomainGrouping
  //   Per-host patterns: settings.subdomainDomains [{ type, value }] — typed matches
  const useSubdomainGlobal = !!settings.subdomainGrouping;
  const subdomainPatterns = settings.subdomainDomains || [];

  /**
   * Returns true if the given hostname should use subdomain grouping.
   * If the list is empty, applies to all domains. Otherwise, only matches explicitly.
   */
  function hostMatchesSubdomainPattern(hostname) {
    if (subdomainPatterns.length === 0) return true;
    const baseDomain = hostname.split('.').slice(-2).join('.');
    return subdomainPatterns.some((p) => {
      const v = typeof p === 'string' ? p.trim().toLowerCase() : (p.value || '').trim().toLowerCase();
      return baseDomain === v || hostname === v || hostname.includes(v);
    });
  }

  const groupNameMap = {}; // key → { label, tabIds[], color }
  const alreadyMatched = (id) => categoryMatchedTabIds.has(id);

  if (settings.groupByDomain !== false) {
    for (const tab of tabs) {
      if (alreadyMatched(tab.id)) continue;
      const domain = getDomain(tab.url);
      if (!domain || excluded.has(domain)) continue;

      // Decide subdomain mode: only applies if global switch is ON and pattern matches
      const hostname = (() => { try { return new URL(tab.url).hostname.toLowerCase(); } catch { return ''; } })();
      const useSubdomain = useSubdomainGlobal && hostMatchesSubdomainPattern(hostname);

      let key, label, colorSeed;

      if (useSubdomain) {
        const sg = getSubdomainGroupKey(tab.url);
        key       = sg.key;
        label     = sg.label;
        colorSeed = key;
      } else {
        label     = getGroupName(domain);
        key       = label;
        colorSeed = domain;
      }

      if (!groupNameMap[key]) {
        groupNameMap[key] = { label, tabIds: [], color: getDomainColor(colorSeed) };
      }
      groupNameMap[key].tabIds.push(tab.id);
    }
  }

  for (const { label, tabIds, color } of Object.values(groupNameMap)) {
    if (tabIds.length < 2 && settings.groupSingleTabs === false) continue;
    try {
      const existing = existingGroups.find((g) => g.title === label);
      if (existing) {
        const newCount = tabIds.filter(id => allTabs.find(t => t.id === id)?.groupId !== existing.id).length;
        await markProgrammaticTabs(tabIds);
        await chrome.tabs.group({ tabIds, groupId: existing.id });
        results.push({ groupId: existing.id, title: label, color, count: tabIds.length, newlyGroupedCount: newCount, source: 'domain' });
      } else {
        await markProgrammaticTabs(tabIds);
        const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
        await chrome.tabGroups.update(groupId, { color, title: label });
        existingGroups.push({ id: groupId, title: label, color });
        results.push({ groupId, title: label, color, count: tabIds.length, newlyGroupedCount: tabIds.length, source: 'domain' });
      }
    } catch (e) {
      console.warn('[TabMaster] Could not group domain tabs for', label, e);
    }
  }

  const totalGrouped = results.reduce((sum, r) => sum + (r.newlyGroupedCount || 0), 0);
  if (totalGrouped > 0) {
    incrementStat('tabsAutoGrouped', totalGrouped);
  }

  // ── Step 3: Enforce Physical Ordering (Optional) ──────────────
  if (settings.sortTabsAndGroups !== false) {
    await sortTabsAndGroupsInWindow(windowId, settings);
  }

  // ── Step 4: Ensure active tab's group is expanded ───────────
  try {
    const [activeTab] = await chrome.tabs.query({ windowId, active: true });
    if (activeTab && activeTab.groupId !== -1) {
      await chrome.tabGroups.update(activeTab.groupId, { collapsed: false });
    }
  } catch (e) {
    console.warn('[TabMaster] Could not expand active group', e);
  }

  return results;
}

async function sortTabsAndGroupsInWindow(windowId, settings) {
  const tabs = await chrome.tabs.query({ windowId });
  const groups = await chrome.tabGroups.query({ windowId });
  
  if (groups.length === 0 && tabs.length === 0) return;

  // Re-build category order mapping
  const categoryOrderMap = {};
  let orderIndex = 0;
  
  // We need BUILTIN_CATEGORIES. It's imported at the top.
  const builtInMap = Object.fromEntries(BUILTIN_CATEGORIES.map(c => [c.id, c]));
  const customMap = Object.fromEntries((settings.customCategories || []).map(c => [c.id, c]));
  const order = settings.categoryOrder || [];
  const overrides = settings.categoryOverrides || {};

  const evaluateOrder = [...order];
  const allCatIds = new Set([...Object.keys(builtInMap), ...Object.keys(customMap)]);
  for (const id of allCatIds) {
    if (!evaluateOrder.includes(id)) evaluateOrder.push(id);
  }

  for (const catId of evaluateOrder) {
    let label;
    if (customMap[catId]) {
      const cat = customMap[catId];
      label = `${cat.emoji || '📁'} ${cat.name || 'Custom'}`;
    } else if (builtInMap[catId]) {
      const cat = builtInMap[catId];
      const ov = overrides[catId] || {};
      label = `${cat.emoji} ${ov.name || cat.name}`;
    }
    if (label) {
      categoryOrderMap[label] = orderIndex++;
    }
  }

  // Sort groups: Categories first (by defined order), then alphabetical for the rest
  const sortedGroups = [...groups].sort((a, b) => {
    const aOrder = categoryOrderMap[a.title] !== undefined ? categoryOrderMap[a.title] : 99999;
    const bOrder = categoryOrderMap[b.title] !== undefined ? categoryOrderMap[b.title] : 99999;
    
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    return (a.title || '').localeCompare(b.title || '');
  });

  // Move each group physically to the end of the window in sorted order
  for (const g of sortedGroups) {
    await chrome.tabGroups.move(g.id, { index: -1 });
  }

  // Gather all unpinned, ungrouped tabs and push them to the very end
  const ungroupedTabs = tabs.filter(t => !t.pinned && t.groupId === -1);
  if (ungroupedTabs.length > 0) {
    await chrome.tabs.move(ungroupedTabs.map(t => t.id), { index: -1 });
  }
}

/**
 * Group selected tab IDs with a custom name and color.
 */
export async function groupTabs(tabIds, title, color, windowId) {
  if (!tabIds || tabIds.length === 0) return null;
  await markProgrammaticTabs(tabIds);
  const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
  await chrome.tabGroups.update(groupId, { color: color || 'blue', title: title || 'Group' });
  return groupId;
}

/**
 * Ungroup all tabs in the current window.
 */
export async function ungroupAllTabs(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  const groupedIds = tabs.filter((t) => t.groupId !== -1).map((t) => t.id);
  if (groupedIds.length > 0) {
    await markProgrammaticTabs(groupedIds);
    await chrome.tabs.ungroup(groupedIds);
  }
  return groupedIds.length;
}

/**
 * Find and close duplicate tabs (same URL, keep the most recently accessed).
 */
export async function closeDuplicateTabs(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  const urlMap = {};
  const toClose = [];

  for (const tab of tabs) {
    const key = tab.url;
    if (!urlMap[key]) {
      urlMap[key] = tab;
    } else {
      // Keep the more recently accessed tab
      if ((tab.lastAccessed || 0) > (urlMap[key].lastAccessed || 0)) {
        toClose.push(urlMap[key].id);
        urlMap[key] = tab;
      } else {
        toClose.push(tab.id);
      }
    }
  }

  if (toClose.length > 0) {
    await chrome.tabs.remove(toClose);
    await incrementStat('tabsCleanedUp', toClose.length);
  }
  return toClose.length;
}

/**
 * Close tabs that haven't been visited in N days.
 */
export async function closeInactiveTabs(windowId, days) {
  const settings = await getSettings();
  const inactiveDays = days ?? settings.inactiveDays ?? 7;
  const cutoff = Date.now() - inactiveDays * 24 * 60 * 60 * 1000;

  const activity = await getTabActivity();
  const tabs = await chrome.tabs.query({ windowId, active: false, pinned: false });
  const toClose = [];

  for (const tab of tabs) {
    const lastActive = activity[tab.id] || tab.lastAccessed || 0;
    if (lastActive < cutoff) {
      toClose.push(tab.id);
    }
  }

  if (toClose.length > 0) {
    await chrome.tabs.remove(toClose);
    await incrementStat('tabsCleanedUp', toClose.length);
  }
  return toClose.length;
}

/**
 * Hibernate (discard) all background tabs to free memory.
 */
export async function hibernateTabs(windowId) {
  const tabs = await chrome.tabs.query({ windowId, active: false, pinned: false, discarded: false });
  let count = 0;
  for (const tab of tabs) {
    try {
      await chrome.tabs.discard(tab.id);
      count++;
    } catch {
      // Some tabs cannot be discarded
    }
  }
  return count;
}

/**
 * Close all non-pinned, non-active tabs.
 */
export async function closeOtherTabs(windowId) {
  const tabs = await chrome.tabs.query({ windowId, active: false, pinned: false });
  const ids = tabs.map((t) => t.id);
  if (ids.length > 0) {
    await chrome.tabs.remove(ids);
    await incrementStat('tabsCleanedUp', ids.length);
  }
  return ids.length;
}

/**
 * Sort tabs within each group alphabetically by title.
 */
export async function sortTabsInGroups(windowId) {
  const groups = await chrome.tabGroups.query({ windowId });
  for (const group of groups) {
    const tabs = await chrome.tabs.query({ groupId: group.id });
    const sorted = [...tabs].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    for (let i = 0; i < sorted.length; i++) {
      await chrome.tabs.move(sorted[i].id, { index: -1 });
    }
  }
}

/**
 * Get tab statistics for the current window.
 */
export async function getTabStats(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  const groups = await chrome.tabGroups.query({ windowId });

  const domainCounts = {};
  let pinnedCount = 0;
  let discardedCount = 0;

  for (const tab of tabs) {
    if (tab.pinned) pinnedCount++;
    if (tab.discarded) discardedCount++;
    const domain = getDomain(tab.url);
    if (domain) {
      domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    }
  }

  const topDomains = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return {
    totalTabs: tabs.length,
    groupCount: groups.length,
    pinnedCount,
    discardedCount,
    topDomains,
    groups: groups.map((g) => ({
      id: g.id,
      title: g.title,
      color: g.color,
      collapsed: g.collapsed,
    })),
  };
}

/**
 * Get all tab groups in the current window with their tabs.
 */
export async function getGroupsWithTabs(windowId) {
  const groups = await chrome.tabGroups.query({ windowId });
  const tabs = await chrome.tabs.query({ windowId });

  const result = groups.map((group) => ({
    ...group,
    tabs: tabs.filter((t) => t.groupId === group.id),
  }));

  // Also include ungrouped tabs
  const ungrouped = tabs.filter((t) => t.groupId === -1 && !t.pinned);
  if (ungrouped.length > 0) {
    result.push({ id: -1, title: 'Ungrouped', color: 'grey', tabs: ungrouped });
  }

  return result;
}

/**
 * Collapse all tab groups in windowId except the one containing the active tab.
 * Used after auto-grouping on new tab load so the user's current context stays visible.
 */
export async function collapseAllExceptActive(windowId) {
  try {
    // Find the currently active tab
    const [activeTab] = await chrome.tabs.query({ windowId, active: true });
    const activeGroupId = activeTab?.groupId ?? -1; // -1 means ungrouped

    // Build a set of group IDs that contain at least one audible (media-playing) tab.
    // Those groups must NEVER be collapsed even if they are not active.
    const allTabs = await chrome.tabs.query({ windowId });
    const audibleGroupIds = new Set(
      allTabs
        .filter((t) => t.audible && t.groupId !== chrome.tabGroups?.TAB_GROUP_ID_NONE && t.groupId > 0)
        .map((t) => t.groupId)
    );

    const groups = await chrome.tabGroups.query({ windowId });

    for (const group of groups) {
      const isActive  = group.id === activeGroupId;
      const hasMedia  = audibleGroupIds.has(group.id);
      // Collapse only if: not the active group AND no audible tabs playing
      const shouldCollapse = !isActive && !hasMedia;

      // Only call update if the collapsed state actually needs to change
      if (group.collapsed !== shouldCollapse) {
        await chrome.tabGroups.update(group.id, { collapsed: shouldCollapse });
      }
    }
  } catch (e) {
    // Non-fatal — grouping already succeeded, collapsing is best-effort
    console.warn('[TabMaster] collapseAllExceptActive failed:', e);
  }
}

