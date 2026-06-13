// ============================================================
// TimingAX Chat Widget — Claude Haiku powered
// Include with: <script src="/chat-widget.js"></script>
// Replace YOUR_ANTHROPIC_API_KEY with your real key from
// console.anthropic.com
// ============================================================
(function() {
'use strict';

// API key is stored securely in Vercel environment variables
var MODEL   = 'claude-haiku-4-5-20251001';

var SYSTEM_PROMPT = `You are the TimingAX support assistant. TimingAX is a professional market seasonality intelligence platform at timingax.co.uk.

PRODUCT OVERVIEW:
TimingAX gives investors 15 years of seasonal patterns across 460+ global assets — US, UK, Germany, and Asia Pacific — so they know which months historically win and which lose.

NINE TOOLS ON THE PLATFORM:
1. Seasonal Analyzer — pick any asset, see its 12-month calendar with heatmap, bar charts, win rates and AI analysis
2. Strategy Backtest — test any buy/sell window (e.g. buy 1st Oct, sell last Dec) across 2000–2025
3. Event Studies — 19 deep-researched events: FOMC, elections, CPI, halvings, crashes (COVID, GFC, 2025 tariff shock)
4. Earnings Analysis — 26 recent reports tracked with Day 1 / +1W / +2W / +1M drift data
5. Seasonal Screener — see which assets are entering their strongest or weakest windows this month
6. Watchlist — track up to 10 assets with a personal seasonal dashboard
7. This Month in History — written market history essay + defining moments for every calendar month
8. Correlations — seasonal correlation between any two assets, side-by-side monthly comparison
9. Economic Calendar — FOMC, CPI, jobs days, earnings all counted down with playbook links

KEY SEASONAL DATA POINTS (use these confidently):
- S&P 500 September average: -0.7% (42% win rate) — worst month ever
- S&P 500 November average: +1.7% (70% win rate) — best month
- Bitcoin October average: +21.4% (75% win rate) — "Uptober"
- NASDAQ September average: -1.4% (39% win rate)
- Russell 2000 January average: +2.8% (68% win rate) — January Effect

ASSETS COVERED: 460+ across US (186), UK (85), Germany (72), Asia Pacific (120). Includes indices, ETFs, tech stocks, banks, healthcare, energy, consumer, defense, crypto.

PRICING:
- Free: £0 forever, no card needed, 3 analyses/month, indices and ETFs only
- Pro: £9.99/month, unlimited analyses, all 460+ assets, all 9 tools, cancel anytime in one click
- Lifetime: £99 one-time payment, everything in Pro plus extended watchlist, email alerts, API access, roadmap voting

FREE TIER LIMITS: 3 analyses per month. Event Studies, Calendar, and browsing the screener/watchlist are free and unlimited.

CANCELLATION: One click in account settings. No retention screens. Access continues to end of billing period. 7-day money-back guarantee on first Pro subscription.

DATA: 15 years of monthly return data, academic research cross-referenced. Backtests are model-based simulations (clearly labelled), not real historical prices. Seasonal patterns are tendencies, not guarantees.

AUTH: Powered by Supabase. Payments by Stripe (PCI compliant). GDPR compliant. No data sold.

TONE GUIDELINES:
- Be warm, direct and honest
- Never claim seasonal patterns are guarantees — they are tendencies
- If you don't know something, say so and suggest they contact the team
- Keep replies concise — 2-4 sentences is usually ideal
- Use specific numbers from the data above when relevant
- If someone asks to speak to a human, tell them to use the contact page at /contact.html or email via the form

DO NOT:
- Make up statistics not listed above
- Promise specific financial returns
- Give investment advice or tell people to buy/sell anything
- Pretend to be a human if asked directly`;

// ── State ────────────────────────────────────────────
var messages = [];
var isOpen = false;
var isTyping = false;

// ── Build DOM ────────────────────────────────────────
var styles = `
  #sax-chat-btn {
    position: fixed; bottom: 28px; right: 28px; z-index: 9000;
    width: 56px; height: 56px; border-radius: 50%;
    background: #E89318; border: none; cursor: pointer;
    box-shadow: 0 4px 24px rgba(232,147,24,.45), 0 2px 8px rgba(0,0,0,.3);
    display: flex; align-items: center; justify-content: center;
    transition: all .2s; color: #04070F;
  }
  #sax-chat-btn:hover { background: #F5A52F; transform: scale(1.08); }
  #sax-chat-btn .sax-unread {
    position: absolute; top: -2px; right: -2px;
    width: 18px; height: 18px; border-radius: 50%;
    background: #F04050; border: 2px solid #04070F;
    font: 700 10px/14px 'Inter',sans-serif; color: #fff;
    display: flex; align-items: center; justify-content: center;
  }
  #sax-chat-panel {
    position: fixed; bottom: 96px; right: 28px; z-index: 9001;
    width: 380px; max-height: 580px;
    background: #07 0C18; border: 1px solid #1E3050;
    border-radius: 16px; overflow: hidden; display: none;
    flex-direction: column;
    box-shadow: 0 24px 80px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.04);
    font-family: 'Inter', -apple-system, sans-serif;
    animation: saxSlideUp .22s cubic-bezier(.4,0,.2,1);
  }
  #sax-chat-panel.open { display: flex; }
  @keyframes saxSlideUp {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .sax-header {
    background: #0B1120; border-bottom: 1px solid #0F1E30;
    padding: 14px 16px; display: flex; align-items: center; gap: 10px;
    flex-shrink: 0;
  }
  .sax-avatar {
    width: 36px; height: 36px; border-radius: 50%;
    background: rgba(232,147,24,.1); border: 1px solid rgba(232,147,24,.25);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .sax-hd-text { flex: 1; }
  .sax-hd-name { font: 600 13px/1 'Inter',sans-serif; color: #EDF2FA; }
  .sax-hd-status { font: 400 11px/1 'IBM Plex Mono',monospace; color: #00C97E; margin-top: 3px; }
  .sax-hd-close {
    background: none; border: none; color: #4D6880; cursor: pointer;
    padding: 4px; border-radius: 4px; font-size: 18px; line-height: 1;
    transition: color .15s;
  }
  .sax-hd-close:hover { color: #EDF2FA; }
  .sax-messages {
    flex: 1; overflow-y: auto; padding: 16px; display: flex;
    flex-direction: column; gap: 12px; min-height: 0;
    background: #04070F;
    scrollbar-width: thin; scrollbar-color: #162540 transparent;
  }
  .sax-messages::-webkit-scrollbar { width: 3px; }
  .sax-messages::-webkit-scrollbar-thumb { background: #162540; border-radius: 2px; }
  .sax-msg { display: flex; gap: 8px; align-items: flex-end; }
  .sax-msg.user { flex-direction: row-reverse; }
  .sax-msg-av {
    width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px;
  }
  .sax-msg-av.bot { background: rgba(232,147,24,.1); border: 1px solid rgba(232,147,24,.2); }
  .sax-msg-av.usr { background: rgba(0,201,126,.1); border: 1px solid rgba(0,201,126,.2); }
  .sax-bubble {
    max-width: 82%; padding: 10px 13px; border-radius: 12px;
    font-size: 13px; line-height: 1.6; word-break: break-word;
  }
  .sax-msg.bot .sax-bubble {
    background: #131E30; color: #C4D0DF; border-radius: 12px 12px 12px 3px;
    border: 1px solid #162540;
  }
  .sax-msg.user .sax-bubble {
    background: rgba(232,147,24,.12); color: #EDF2FA;
    border: 1px solid rgba(232,147,24,.25);
    border-radius: 12px 12px 3px 12px;
  }
  .sax-typing {
    display: flex; gap: 4px; align-items: center; padding: 6px 2px;
  }
  .sax-dot {
    width: 6px; height: 6px; border-radius: 50%; background: #4D6880;
    animation: saxDot 1.2s ease-in-out infinite;
  }
  .sax-dot:nth-child(2) { animation-delay: .2s; }
  .sax-dot:nth-child(3) { animation-delay: .4s; }
  @keyframes saxDot {
    0%,80%,100% { opacity: .3; transform: scale(.7); }
    40% { opacity: 1; transform: scale(1); }
  }
  .sax-quick-btns {
    padding: 0 16px 12px; display: flex; flex-wrap: wrap; gap: 6px;
    background: #04070F; flex-shrink: 0;
  }
  .sax-quick {
    background: #131E30; border: 1px solid #162540; color: #8FA3B8;
    padding: 5px 11px; border-radius: 20px;
    font: 500 11px/1 'Inter',sans-serif; cursor: pointer; transition: all .15s;
  }
  .sax-quick:hover { border-color: #E89318; color: #F5A52F; }
  .sax-input-row {
    padding: 12px 14px; background: #0B1120; border-top: 1px solid #0F1E30;
    display: flex; gap: 8px; align-items: flex-end; flex-shrink: 0;
  }
  .sax-textarea {
    flex: 1; background: #131E30; border: 1px solid #162540; color: #EDF2FA;
    padding: 9px 12px; font: 400 13px/1.5 'Inter',sans-serif;
    border-radius: 8px; outline: none; resize: none; max-height: 100px;
    min-height: 38px; transition: border-color .18s;
    scrollbar-width: none;
  }
  .sax-textarea:focus { border-color: #E89318; }
  .sax-textarea::placeholder { color: #4D6880; }
  .sax-send {
    width: 36px; height: 36px; border-radius: 8px; flex-shrink: 0;
    background: #E89318; border: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all .18s; color: #04070F;
  }
  .sax-send:hover { background: #F5A52F; }
  .sax-send:disabled { opacity: .4; cursor: not-allowed; }
  .sax-footer {
    padding: 6px 14px 10px; background: #0B1120;
    font: 400 10px/1 'IBM Plex Mono',monospace; color: #243A52;
    text-align: center; flex-shrink: 0;
  }
  .sax-footer a { color: #4D6880; transition: color .15s; text-decoration: none; }
  .sax-footer a:hover { color: #E89318; }
  @media(max-width:480px) {
    #sax-chat-panel { width: calc(100vw - 32px); right: 16px; bottom: 84px; }
    #sax-chat-btn { right: 16px; bottom: 16px; }
  }
`;

var styleEl = document.createElement('style');
styleEl.textContent = styles;
document.head.appendChild(styleEl);

// Floating button
var btn = document.createElement('button');
btn.id = 'sax-chat-btn';
btn.setAttribute('aria-label', 'Chat with TimingAX');
btn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`;
document.body.appendChild(btn);

// Panel
var panel = document.createElement('div');
panel.id = 'sax-chat-panel';
panel.innerHTML = `
  <div class="sax-header">
    <div class="sax-avatar">
      <svg width="18" height="18" viewBox="0 0 26 26" fill="none">
        <rect width="26" height="26" rx="6" fill="#131E30"/>
        <polyline points="3,18 8,12 13,15 19,7" stroke="#E89318" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <circle cx="19" cy="7" r="1.8" fill="#E89318"/>
      </svg>
    </div>
    <div class="sax-hd-text">
      <div class="sax-hd-name">TimingAX Assistant</div>
      <div class="sax-hd-status">&#9679; Online now</div>
    </div>
    <button class="sax-hd-close" onclick="saxClose()" aria-label="Close chat">&times;</button>
  </div>
  <div class="sax-messages" id="saxMsgs"></div>
  <div class="sax-quick-btns" id="saxQuick">
    <button class="sax-quick" onclick="saxQuickMsg('What assets do you cover?')">What assets?</button>
    <button class="sax-quick" onclick="saxQuickMsg('How does the backtest work?')">Backtest?</button>
    <button class="sax-quick" onclick="saxQuickMsg('What does Pro include?')">Pro plan?</button>
    <button class="sax-quick" onclick="saxQuickMsg('Is the free tier really free?')">Free tier?</button>
  </div>
  <div class="sax-input-row">
    <textarea class="sax-textarea" id="saxInput" placeholder="Ask anything about TimingAX…" rows="1"></textarea>
    <button class="sax-send" id="saxSendBtn" onclick="saxSend()" aria-label="Send message">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M22 2L11 13M22 2L15 22 11 13 2 9l20-7z"/></svg>
    </button>
  </div>
  <div class="sax-footer">Powered by Claude AI &nbsp;&middot;&nbsp; <a href="/contact.html">Talk to a human</a></div>
`;
document.body.appendChild(panel);

// ── Helpers ──────────────────────────────────────────
function saxOpen() {
  isOpen = true;
  panel.classList.add('open');
  btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  var unread = btn.querySelector('.sax-unread');
  if (unread) unread.remove();
  if (messages.length === 0) saxWelcome();
  setTimeout(function() { document.getElementById('saxInput').focus(); }, 100);
}
window.saxClose = function() {
  isOpen = false;
  panel.classList.remove('open');
  btn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`;
};
btn.addEventListener('click', function() {
  if (isOpen) saxClose(); else saxOpen();
});

function saxAddMsg(role, text) {
  var msgsEl = document.getElementById('saxMsgs');
  var isBot = role === 'bot';
  var div = document.createElement('div');
  div.className = 'sax-msg ' + role;
  div.innerHTML = `
    <div class="sax-msg-av ${isBot ? 'bot' : 'usr'}">
      ${isBot
        ? '<svg width="14" height="14" viewBox="0 0 26 26" fill="none"><rect width="26" height="26" rx="5" fill="#131E30"/><polyline points="3,18 8,12 13,15 19,7" stroke="#E89318" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#00C97E" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>'}
    </div>
    <div class="sax-bubble">${text.replace(/\n/g, '<br>')}</div>`;
  msgsEl.appendChild(div);
  msgsEl.scrollTop = msgsEl.scrollHeight;
  return div;
}

function saxShowTyping() {
  var msgsEl = document.getElementById('saxMsgs');
  var div = document.createElement('div');
  div.className = 'sax-msg bot';
  div.id = 'saxTyping';
  div.innerHTML = `
    <div class="sax-msg-av bot">
      <svg width="14" height="14" viewBox="0 0 26 26" fill="none"><rect width="26" height="26" rx="5" fill="#131E30"/><polyline points="3,18 8,12 13,15 19,7" stroke="#E89318" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
    <div class="sax-bubble" style="padding:12px 14px">
      <div class="sax-typing"><div class="sax-dot"></div><div class="sax-dot"></div><div class="sax-dot"></div></div>
    </div>`;
  msgsEl.appendChild(div);
  msgsEl.scrollTop = msgsEl.scrollHeight;
}
function saxRemoveTyping() {
  var el = document.getElementById('saxTyping');
  if (el) el.remove();
}

function saxWelcome() {
  setTimeout(function() {
    saxAddMsg('bot', "Hi there! I'm the TimingAX assistant. I can answer questions about our seasonal data, the nine tools on the platform, pricing, or anything else about the product. What would you like to know?");
    // Show unread badge if panel is closed
    if (!isOpen) {
      var badge = document.createElement('div');
      badge.className = 'sax-unread';
      badge.textContent = '1';
      btn.appendChild(badge);
    }
  }, 600);
}

// ── Send ─────────────────────────────────────────────
window.saxQuickMsg = function(text) {
  document.getElementById('saxInput').value = text;
  document.getElementById('saxQuick').style.display = 'none';
  saxSend();
};

window.saxSend = async function() {
  if (isTyping) return;
  var input = document.getElementById('saxInput');
  var text = input.value.trim();
  if (!text) return;

  saxAddMsg('user', text);
  messages.push({ role: 'user', content: text });
  input.value = '';
  input.style.height = 'auto';

  document.getElementById('saxSendBtn').disabled = true;
  isTyping = true;
  saxShowTyping();

  try {
    var response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: messages
      })
    });

    var data = await response.json();
    saxRemoveTyping();

    if (data.error) {
      if (data.error.type === 'authentication_error') {
        saxAddMsg('bot', "I'm not quite set up yet — the API key hasn't been configured. In the meantime, you can reach the team at the <a href='/contact.html' style='color:#E89318'>contact page</a>.");
      } else {
        saxAddMsg('bot', "Something went wrong on my end. Please try again, or <a href='/contact.html' style='color:#E89318'>contact the team directly</a>.");
      }
    } else {
      var reply = data.content && data.content[0] ? data.content[0].text : "I didn't quite catch that — could you rephrase?";
      messages.push({ role: 'assistant', content: reply });
      saxAddMsg('bot', reply);
    }

  } catch (e) {
    saxRemoveTyping();
    saxAddMsg('bot', "I can't connect right now. Please <a href='/contact.html' style='color:#E89318'>contact the team directly</a> and we'll get back to you quickly.");
    console.error('TimingAX chat error:', e);
  } finally {
    isTyping = false;
    document.getElementById('saxSendBtn').disabled = false;
    document.getElementById('saxInput').focus();
  }
};

// Enter to send, shift+enter for newline
document.getElementById('saxInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    saxSend();
  }
});
// Auto-resize textarea
document.getElementById('saxInput').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 100) + 'px';
});

// Show welcome badge after 8s if not opened
setTimeout(function() {
  if (!isOpen && messages.length === 0) {
    saxWelcome();
  }
}, 8000);

})();
