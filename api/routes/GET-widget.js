import { RouteHandler } from "gadget-server";

/**
 * GET /widget — serves the self-contained storefront chat widget as JavaScript.
 * The BigCommerce Scripts API injects <script src="<APP_URL>/widget?store=HASH">
 * onto the storefront; this script mounts a floating chat bubble that POSTs to
 * /chat. Written as a serialized function to avoid template-literal escaping.
 *
 * @type { RouteHandler }
 */
const route = async ({ request, reply, api }) => {
  reply.header("Content-Type", "application/javascript; charset=utf-8");
  reply.header("Cache-Control", "public, max-age=300");
  reply.header("Access-Control-Allow-Origin", "*");

  // Look up per-store config to feature-gate the widget (e.g. image uploads).
  let vision = false;
  const storeHash = request.query?.store;
  if (storeHash) {
    try {
      const rows = await api.internal.bigcommerce.store.findMany({
        filter: { storeHash: { equals: storeHash } },
        first: 1,
      });
      vision = !!rows[0]?.visionEnabled;
    } catch (e) {
      /* default to no vision on lookup failure */
    }
  }

  const config = JSON.stringify({ vision });
  return reply.send("var RC_CONFIG=" + config + ";(" + widgetSource.toString() + ")();");
};

export default route;

// Everything below runs in the shopper's browser (serialized via .toString()).
function widgetSource() {
  var script = document.currentScript;
  var src = (script && script.src) || "";
  var apiBase, store;
  try {
    var u = new URL(src, location.href);
    // API targets the environment that served this script (dev or production);
    // override with ?api= on the script src for testing.
    apiBase = u.searchParams.get("api") || u.origin;
    store = u.searchParams.get("store") || "";
  } catch (e) {
    return;
  }
  if (!store) return;

  // ---- config (script data-attributes override defaults) ----
  var color = script.getAttribute("data-color") || "#ef6526";
  var title = script.getAttribute("data-title") || "Recover AI";
  var greeting = script.getAttribute("data-greeting") || "Have questions? Get answers now.";
  var SUGGESTIONS = ["What are your best-sellers?", "Help me find the right product", "What's your return & shipping policy?"];
  try { var sa = script.getAttribute("data-suggestions"); if (sa) SUGGESTIONS = JSON.parse(sa); } catch (e) {}
  var DISCLAIMER = script.getAttribute("data-disclaimer") ||
    "This is an AI assistant trained to answer questions about our products. If you need a human, just ask and we'll connect you with support.";

  // ---- capabilities ----
  var VISION = (typeof RC_CONFIG !== "undefined" && RC_CONFIG && RC_CONFIG.vision) || false;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var synth = window.speechSynthesis || null;

  // ---- state ----
  var messages = [];
  var open = false, streaming = false, voiceMode = false, dictating = false, recog = null;
  var pending = []; // downscaled image data URLs to attach to the next message
  var listEl, inputEl, previewsEl, voiceBtn, micBtn, suggestsEl = null;

  function sessionId() {
    try {
      var id = localStorage.getItem("recover_chat_session");
      if (!id) { id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()); localStorage.setItem("recover_chat_session", id); }
      return id;
    } catch (e) { return String(Date.now()); }
  }

  function renderText(text) {
    var s = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    var links = [];
    // Placeholders use \u0000 so plain numbers in the reply (e.g. "9mm & 357") aren't mistaken for link indexes.
    function stash(label, url) { return "\u0000" + (links.push('<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + "</a>") - 1) + "\u0000"; }
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, label, url) { return /^(https?:\/\/|\/)/.test(url) ? stash(label, url) : m; });
    s = s.replace(/(https?:\/\/[^\s<]+)/g, function (url) { return stash(url, url); });
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/^\s*[*-]\s+/gm, "• ");
    s = s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return links[Number(i)]; });
    return s.replace(/\n/g, "<br>");
  }
  function plain(text) {
    return String(text).replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/https?:\/\/\S+/g, "").replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
  }
  function hexToRgb(h) { var m = /^#?([0-9a-fA-F]{6})$/.exec(h || ""); if (!m) return "239,101,38"; var n = parseInt(m[1], 16); return ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255); }
  var glowRgb = hexToRgb(color);

  // ---- icons ----
  var ICON_BUBBLE = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  var ICON_DOTS = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var ICON_CLIP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';
  var ICON_MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
  var ICON_WAVE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="9" width="2.4" height="6" rx="1.2"/><rect x="9" y="5" width="2.4" height="14" rx="1.2"/><rect x="14" y="8" width="2.4" height="8" rx="1.2"/><rect x="18.6" y="10.5" width="2.4" height="3" rx="1.2"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';

  var host = document.createElement("div");
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: "open" });

  var style = document.createElement("style");
  style.textContent =
    "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');" +
    ":host{all:initial}*{box-sizing:border-box;font-family:Inter,sans-serif}" +
    ".launcher{position:fixed;bottom:20px;right:20px;width:60px;height:60px;border-radius:50%;background:" + color + ";color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2147483646;animation:rc-glow 2.4s ease-out infinite;transition:transform .15s ease}" +
    ".launcher:hover{transform:scale(1.06)}.launcher svg{width:28px;height:28px}" +
    ".panel{position:fixed;bottom:92px;right:20px;width:390px;max-width:calc(100vw - 32px);height:620px;max-height:calc(100vh - 110px);background:#fff;border-radius:16px;box-shadow:0 12px 44px rgba(0,0,0,.30);display:none;flex-direction:column;overflow:hidden;z-index:2147483647}" +
    ".panel.open{display:flex}" +
    ".header{background:" + color + ";padding:14px 16px;display:flex;align-items:center;justify-content:space-between}" +
    ".brand{display:flex;align-items:center;gap:11px}" +
    ".avatar{width:36px;height:36px;border-radius:50%;background:#111;display:flex;align-items:center;justify-content:center;flex:0 0 auto}.avatar svg{width:20px;height:20px}" +
    ".htitle{font-weight:700;font-size:16px;color:#141414}" +
    ".hactions{display:flex;align-items:center;gap:2px}" +
    ".iconbtn{background:transparent;border:none;cursor:pointer;color:#141414;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:50%}" +
    ".iconbtn:hover{background:rgba(0,0,0,.09)}.iconbtn svg{width:20px;height:20px}" +
    ".messages{flex:1;overflow-y:auto;padding:18px 16px;background:#fff}" +
    ".msg{max-width:82%;padding:11px 15px;border-radius:16px;margin-bottom:12px;font-size:14px;line-height:1.5;word-wrap:break-word}" +
    ".msg.assistant{background:#f1f2f4;color:#1a1a1a;border-bottom-left-radius:5px}" +
    ".msg.user{background:" + color + ";color:#fff;margin-left:auto;border-bottom-right-radius:5px}" +
    ".msg a{color:inherit;text-decoration:underline}" +
    ".msg .imgs{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.msg .imgs img{max-width:130px;max-height:130px;border-radius:8px;display:block}" +
    ".suggests{display:flex;flex-direction:column;align-items:flex-end;gap:11px;margin-top:2px}" +
    ".chip{border:1px solid #dcdfe3;background:#fff;border-radius:22px;padding:12px 18px;font-size:14px;font-weight:500;color:#1a1a1a;cursor:pointer;max-width:92%;text-align:left;line-height:1.35;transition:all .12s ease}" +
    ".chip:hover{border-color:" + color + ";background:#fff7f3}" +
    ".status{font-size:12px;color:#8a8f98;margin:0 0 10px 2px;font-style:italic}" +
    ".footer{padding:0 12px 12px;background:#fff}" +
    ".disclaimer{position:relative;background:#f1f2f4;border-radius:12px;padding:12px 34px 12px 14px;margin-bottom:9px;font-size:12.5px;color:#5b616b;line-height:1.5}" +
    ".disclaimer .x{position:absolute;top:9px;right:11px;cursor:pointer;color:#9aa0a8;font-size:16px;line-height:1}" +
    ".previews{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}" +
    ".thumb{position:relative;width:52px;height:52px;border-radius:8px;overflow:hidden;border:1px solid #e2e5e9}.thumb img{width:100%;height:100%;object-fit:cover}" +
    ".thumb .rm{position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:#111;color:#fff;font-size:12px;line-height:15px;text-align:center;cursor:pointer;border:2px solid #fff}" +
    ".composer{display:flex;align-items:center;gap:4px;border:1px solid #d3d7dd;border-radius:26px;padding:5px 7px 5px 10px;background:#fff}" +
    ".composer textarea{flex:1;resize:none;border:none;outline:none;font-size:14px;max-height:88px;padding:8px 4px;background:transparent;line-height:1.4;color:#1a1a1a}" +
    ".pill{background:transparent;border:none;cursor:pointer;width:34px;height:34px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;color:#6b7280;border-radius:50%}" +
    ".pill:hover{background:#f1f2f4}.pill svg{width:20px;height:20px}.pill.active{color:" + color + "}" +
    ".voicebtn{background:#111;border:none;cursor:pointer;width:38px;height:38px;flex:0 0 auto;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff}" +
    ".voicebtn svg{width:19px;height:19px}.voicebtn:disabled{opacity:.4;cursor:default}" +
    ".voicebtn.listening{animation:rc-listen 1.3s ease-out infinite}" +
    "@keyframes rc-listen{0%{box-shadow:0 0 0 0 rgba(17,17,17,.45)}70%{box-shadow:0 0 0 10px rgba(17,17,17,0)}100%{box-shadow:0 0 0 0 rgba(17,17,17,0)}}" +
    "@keyframes rc-glow{0%{box-shadow:0 4px 16px rgba(0,0,0,.25),0 0 0 0 rgba(" + glowRgb + ",.5)}70%{box-shadow:0 4px 16px rgba(0,0,0,.25),0 0 0 14px rgba(" + glowRgb + ",0)}100%{box-shadow:0 4px 16px rgba(0,0,0,.25),0 0 0 0 rgba(" + glowRgb + ",0)}}" +
    "@keyframes rc-pop{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}" +
    ".callout{position:fixed;bottom:92px;right:16px;max-width:230px;background:#fff;color:#1a1a1a;padding:11px 14px;border-radius:14px;box-shadow:0 6px 22px rgba(0,0,0,.16);font-size:14px;font-weight:500;line-height:1.35;z-index:2147483646;cursor:pointer;animation:rc-pop .35s ease}" +
    ".callout:after{content:'';position:absolute;bottom:-5px;right:26px;width:11px;height:11px;background:#fff;transform:rotate(45deg)}" +
    ".callout .x{position:absolute;top:-8px;right:-8px;width:20px;height:20px;border-radius:50%;background:#fff;color:#6b7280;border:1px solid #eee;font-size:14px;line-height:18px;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.15)}";
  root.appendChild(style);

  // ---- floating launcher + rotating callout ----
  var launcher = document.createElement("button");
  launcher.className = "launcher";
  launcher.setAttribute("aria-label", "Open chat");
  launcher.innerHTML = ICON_BUBBLE;
  launcher.onclick = toggle;
  root.appendChild(launcher);

  var CALLOUTS = ["👋 Need help finding something?", "Ask me about any product", "Questions about your order?", "I'm here to help — chat now!"];
  var callout = document.createElement("div");
  callout.className = "callout";
  var calloutText = document.createElement("span");
  calloutText.textContent = CALLOUTS[0];
  var calloutClose = document.createElement("span");
  calloutClose.className = "x";
  calloutClose.textContent = "×";
  callout.appendChild(calloutText);
  callout.appendChild(calloutClose);
  callout.addEventListener("click", function (e) { if (e.target === calloutClose) { dismissCallout(); return; } toggle(); });
  root.appendChild(callout);
  var calloutIdx = 0;
  var calloutTimer = setInterval(function () {
    calloutIdx = (calloutIdx + 1) % CALLOUTS.length;
    calloutText.textContent = CALLOUTS[calloutIdx];
    callout.style.animation = "none"; void callout.offsetWidth; callout.style.animation = "rc-pop .35s ease";
  }, 4500);
  function dismissCallout() { if (calloutTimer) { clearInterval(calloutTimer); calloutTimer = null; } if (callout && callout.parentNode) callout.parentNode.removeChild(callout); }

  // ---- panel ----
  var showDisc = true;
  try { showDisc = localStorage.getItem("recover_chat_disc") !== "1"; } catch (e) {}
  var attachHtml = VISION ? '<button class="pill attach" type="button" aria-label="Attach image">' + ICON_CLIP + "</button>" +
    '<input class="file" type="file" accept="image/*" multiple style="display:none" />' : "";
  var micHtml = SR ? '<button class="pill mic" type="button" aria-label="Voice input">' + ICON_MIC + "</button>" : "";
  var discHtml = showDisc ? '<div class="disclaimer"><span class="x" role="button" aria-label="Dismiss">×</span></div>' : "";

  var panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML =
    '<div class="header"><div class="brand"><div class="avatar">' + ICON_BUBBLE + '</div><span class="htitle"></span></div>' +
    '<div class="hactions"><button class="iconbtn menu" aria-label="Reset conversation">' + ICON_DOTS + "</button>" +
    '<button class="iconbtn close" aria-label="Close chat">' + ICON_CLOSE + "</button></div></div>" +
    '<div class="messages"></div>' +
    '<div class="footer">' + discHtml + '<div class="previews"></div>' +
    '<div class="composer">' + attachHtml + '<textarea rows="1"></textarea>' + micHtml +
    '<button class="voicebtn" type="button" aria-label="Send or talk"></button></div></div>';
  root.appendChild(panel);
  panel.querySelector(".htitle").textContent = title;

  listEl = panel.querySelector(".messages");
  inputEl = panel.querySelector("textarea");
  previewsEl = panel.querySelector(".previews");
  voiceBtn = panel.querySelector(".voicebtn");
  micBtn = panel.querySelector(".mic");

  var ph = "Type your message…";
  if (SR && VISION) ph = "Type, talk, or upload an image";
  else if (SR) ph = "Type or talk…";
  else if (VISION) ph = "Type or upload an image";
  inputEl.placeholder = ph;

  panel.querySelector(".close").addEventListener("click", toggle);
  panel.querySelector(".menu").addEventListener("click", resetChat);
  inputEl.addEventListener("input", updateVoiceBtn);
  inputEl.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  voiceBtn.addEventListener("click", onVoiceBtn);
  if (micBtn) micBtn.addEventListener("click", toggleDictation);
  if (showDisc) {
    panel.querySelector(".disclaimer").insertBefore(document.createTextNode(DISCLAIMER), panel.querySelector(".disclaimer .x"));
    panel.querySelector(".disclaimer .x").addEventListener("click", function () {
      var d = panel.querySelector(".disclaimer"); if (d) d.parentNode.removeChild(d);
      try { localStorage.setItem("recover_chat_disc", "1"); } catch (e) {}
    });
  }
  if (VISION) {
    var attachBtn = panel.querySelector(".attach");
    var fileInput = panel.querySelector(".file");
    attachBtn.addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", function () {
      var files = Array.prototype.slice.call(fileInput.files || []); fileInput.value = "";
      files.forEach(function (f) {
        if (pending.length >= 3 || !/^image\//.test(f.type)) return;
        downscale(f, function (d) { if (d && pending.length < 3) { pending.push(d); renderPreviews(); updateVoiceBtn(); } });
      });
    });
  }
  updateVoiceBtn();

  // ---- UI helpers ----
  function toggle() {
    open = !open;
    panel.classList.toggle("open", open);
    if (open) { dismissCallout(); if (listEl.childElementCount === 0) renderIntro(); inputEl.focus(); }
    else if (voiceMode) stopVoiceMode();
  }
  function resetChat() {
    messages = []; suggestsEl = null; listEl.innerHTML = "";
    try { synth && synth.cancel(); } catch (e) {}
    renderIntro();
  }
  function renderIntro() {
    bubble("assistant", greeting);
    if (!SUGGESTIONS.length) return;
    suggestsEl = document.createElement("div");
    suggestsEl.className = "suggests";
    SUGGESTIONS.forEach(function (q) {
      var c = document.createElement("button");
      c.className = "chip"; c.type = "button"; c.textContent = q;
      c.addEventListener("click", function () { inputEl.value = q; updateVoiceBtn(); send(); });
      suggestsEl.appendChild(c);
    });
    listEl.appendChild(suggestsEl);
    listEl.scrollTop = listEl.scrollHeight;
  }
  function clearSuggestions() { if (suggestsEl && suggestsEl.parentNode) { suggestsEl.parentNode.removeChild(suggestsEl); suggestsEl = null; } }
  function bubble(role, text, images) {
    var el = document.createElement("div");
    el.className = "msg " + role;
    el.innerHTML = renderText(text);
    if (images && images.length) {
      var wrap = document.createElement("div"); wrap.className = "imgs";
      images.forEach(function (uu) { var im = document.createElement("img"); im.src = uu; wrap.appendChild(im); });
      el.appendChild(wrap);
    }
    listEl.appendChild(el); listEl.scrollTop = listEl.scrollHeight; return el;
  }
  var statusEl = null;
  function setStatus(label) {
    if (!label) { if (statusEl) { statusEl.remove(); statusEl = null; } return; }
    if (!statusEl) { statusEl = document.createElement("div"); statusEl.className = "status"; listEl.appendChild(statusEl); }
    statusEl.textContent = label; listEl.scrollTop = listEl.scrollHeight;
  }
  function renderPreviews() {
    previewsEl.innerHTML = "";
    pending.forEach(function (url, idx) {
      var t = document.createElement("div"); t.className = "thumb";
      var img = document.createElement("img"); img.src = url;
      var rm = document.createElement("span"); rm.className = "rm"; rm.textContent = "×";
      rm.addEventListener("click", function () { pending.splice(idx, 1); renderPreviews(); updateVoiceBtn(); });
      t.appendChild(img); t.appendChild(rm); previewsEl.appendChild(t);
    });
  }
  function downscale(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1024, w = img.width, h = img.height;
        if (w > max || h > max) { if (w >= h) { h = Math.round((h * max) / w); w = max; } else { w = Math.round((w * max) / h); h = max; } }
        var c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        try { cb(c.toDataURL("image/jpeg", 0.8)); } catch (e) { cb(null); }
      };
      img.onerror = function () { cb(null); }; img.src = reader.result;
    };
    reader.onerror = function () { cb(null); }; reader.readAsDataURL(file);
  }

  // ---- voice ----
  function updateVoiceBtn() {
    if (voiceMode) { voiceBtn.innerHTML = ICON_WAVE; voiceBtn.classList.add("listening"); voiceBtn.disabled = false; return; }
    voiceBtn.classList.remove("listening");
    var hasContent = !!(inputEl.value.trim() || pending.length);
    voiceBtn.innerHTML = hasContent ? ICON_SEND : ICON_WAVE;
    voiceBtn.disabled = !hasContent && !SR;
  }
  function onVoiceBtn() {
    if (voiceMode) { stopVoiceMode(); return; }
    if (inputEl.value.trim() || pending.length) { send(); return; }
    if (SR) startVoiceMode();
  }
  function makeRecog(onFinal) {
    if (!SR) return null;
    var r = new SR();
    r.lang = navigator.language || "en-US";
    r.interimResults = true; r.continuous = false;
    r.onresult = function (e) {
      var t = ""; for (var i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      inputEl.value = t; updateVoiceBtn();
      if (e.results[e.results.length - 1].isFinal && onFinal) onFinal(t.trim());
    };
    return r;
  }
  function toggleDictation() {
    if (!SR) return;
    if (dictating) { try { recog && recog.stop(); } catch (e) {} return; }
    if (voiceMode) stopVoiceMode();
    recog = makeRecog(null); if (!recog) return;
    dictating = true; micBtn.classList.add("active");
    recog.onend = recog.onerror = function () { dictating = false; micBtn.classList.remove("active"); inputEl.focus(); updateVoiceBtn(); };
    try { recog.start(); } catch (e) { dictating = false; micBtn.classList.remove("active"); }
  }
  function startVoiceMode() { voiceMode = true; updateVoiceBtn(); listenVoice(); }
  function listenVoice() {
    recog = makeRecog(function (finalText) { if (finalText) { inputEl.value = finalText; send(); } });
    if (!recog) { voiceMode = false; updateVoiceBtn(); return; }
    recog.onerror = function () {};
    recog.onend = function () {}; // next listen is triggered after the reply is spoken
    try { recog.start(); } catch (e) {}
  }
  function stopVoiceMode() {
    voiceMode = false; updateVoiceBtn();
    try { recog && recog.stop(); } catch (e) {}
    try { synth && synth.cancel(); } catch (e) {}
  }
  function speakThenListen(text) {
    if (!voiceMode) return;
    if (!synth) { listenVoice(); return; }
    try {
      synth.cancel();
      var utt = new SpeechSynthesisUtterance(plain(text));
      utt.onend = function () { if (voiceMode) listenVoice(); };
      utt.onerror = function () { if (voiceMode) listenVoice(); };
      synth.speak(utt);
    } catch (e) { if (voiceMode) listenVoice(); }
  }

  // ---- send ----
  function send() {
    if (streaming) return;
    var text = (inputEl.value || "").trim().slice(0, 4000);
    var imgs = pending.slice();
    if (!text && imgs.length === 0) return;
    clearSuggestions();
    inputEl.value = ""; pending = []; renderPreviews(); updateVoiceBtn();
    var userMsg = { role: "user", content: text };
    if (imgs.length) userMsg.images = imgs;
    messages.push(userMsg);
    bubble("user", text, imgs);
    streaming = true; voiceBtn.disabled = true; setStatus("Thinking…");

    // Send only the latest turn's images to bound payload size.
    var payload = messages.slice(-40).map(function (m, i, arr) {
      return m.images && i !== arr.length - 1 ? { role: m.role, content: m.content } : m;
    });

    var acc = "", replyEl = null, finished = false;
    function esc(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    function finish() {
      if (finished) return; finished = true;
      setStatus(null);
      var reply = acc.trim();
      if (!reply) { if (!replyEl) bubble("assistant", "Sorry, I couldn't respond."); }
      else if (replyEl) { replyEl.innerHTML = renderText(reply); }
      messages.push({ role: "assistant", content: reply || "Sorry, I couldn't respond." });
      streaming = false; voiceBtn.disabled = false; updateVoiceBtn();
      if (voiceMode) speakThenListen(reply); else inputEl.focus();
    }
    function fail() {
      if (finished) return; finished = true;
      setStatus(null);
      if (!acc) bubble("assistant", "Sorry, something went wrong. Please try again.");
      else if (replyEl) replyEl.innerHTML = renderText(acc);
      streaming = false; voiceBtn.disabled = false; updateVoiceBtn();
      if (voiceMode) listenVoice(); else inputEl.focus();
    }

    fetch(apiBase + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessionId(), store: store, storeHash: store, messages: payload })
    }).then(function (res) {
      if (!res.ok) return Promise.reject(res);
      if (!res.body || !res.body.getReader) {
        // Older browser without stream reading — fall back to full-body JSON.
        return res.json().then(function (data) { acc = (data && data.text) || ""; if (acc) { replyEl = bubble("assistant", ""); } finish(); });
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buf = "";
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) { finish(); return; }
          buf += decoder.decode(r.value, { stream: true });
          var idx;
          while ((idx = buf.indexOf("\n")) >= 0) {
            var line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
            if (!line) continue;
            var evt; try { evt = JSON.parse(line); } catch (e) { continue; }
            if (evt.type === "delta" && evt.text) {
              setStatus(null);
              acc += evt.text;
              if (!replyEl) replyEl = bubble("assistant", "");
              replyEl.innerHTML = esc(acc).replace(/\n/g, "<br>");
              listEl.scrollTop = listEl.scrollHeight;
            } else if (evt.type === "done") { finish(); return; }
            else if (evt.type === "error") { fail(); return; }
          }
          return pump();
        });
      }
      return pump();
    }).catch(function () { fail(); });
  }
}
