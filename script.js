
(function(){
  "use strict";
  var PW_KEY = "dm-portfolio-key";
  // --- lite YouTube
  function wireYouTube(root){
    (root || document).querySelectorAll(".yt[data-id]").forEach(function(box){
      var btn = box.querySelector("button"); if (!btn) return;
      btn.addEventListener("click", function(){
        var f = document.createElement("iframe");
        f.src = "https://www.youtube-nocookie.com/embed/" + box.dataset.id + "?autoplay=1&rel=0";
        f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
        f.allowFullscreen = true; f.title = btn.getAttribute("aria-label") || "Video";
        box.innerHTML = ""; box.appendChild(f);
      });
    });
  }
  wireYouTube();
  // --- password gate (AES-GCM, key from PBKDF2 of the password)
  function b64(s){ var bin = atob(s), a = new Uint8Array(bin.length); for (var i=0;i<bin.length;i++) a[i]=bin.charCodeAt(i); return a; }
  async function deriveKey(pw, salt){
    var km = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({name:"PBKDF2", salt: salt, iterations: 150000, hash:"SHA-256"}, km, {name:"AES-GCM", length:256}, false, ["decrypt"]);
  }
  async function decrypt(blob, pw){
    var key = await deriveKey(pw, b64(blob.salt));
    var pt = await crypto.subtle.decrypt({name:"AES-GCM", iv: b64(blob.iv)}, key, b64(blob.ct));
    return new TextDecoder().decode(pt);
  }

  // --- encrypted assets of locked pages (GitHub copy): decrypted on unlock
  var ASSET_SALT = "VI+9tQRWhx6BBJuhE+t0CQ==", _akey = null, _amemo = {};
  var MIME = {jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png", gif:"image/gif", webp:"image/webp", mp4:"video/mp4", webm:"video/webm", svg:"image/svg+xml"};
  function assetKey(pw){ if (!_akey) _akey = deriveKey(pw, b64(ASSET_SALT)); return _akey; }
  function decAsset(url, pw){
    if (_amemo[url]) return _amemo[url];
    _amemo[url] = (async function(){
      var key = await assetKey(pw);
      var buf = await (await fetch(url)).arrayBuffer();
      var pt = await crypto.subtle.decrypt({name:"AES-GCM", iv: new Uint8Array(buf, 0, 12)}, key, new Uint8Array(buf, 12));
      var m = url.match(/\.(\w+)\.enc$/);
      return URL.createObjectURL(new Blob([pt], {type: (m && MIME[m[1].toLowerCase()]) || "application/octet-stream"}));
    })();
    return _amemo[url];
  }
  function decAssets(root, pw){
    var media = [];
    root.querySelectorAll("[data-eposter]").forEach(function(el){ media.push(decAsset(el.dataset.eposter, pw).then(function(u){ el.poster = u; }).catch(function(){})); });
    root.querySelectorAll("source[data-esrc], video[data-esrc]").forEach(function(el){ media.push(decAsset(el.dataset.esrc, pw).then(function(u){ el.src = u; var v = el.closest("video"); if (v && el !== v) v.load(); }).catch(function(){})); });
    root.querySelectorAll("img[data-esrc]").forEach(function(el){ decAsset(el.dataset.esrc, pw).then(function(u){ el.src = u; }).catch(function(){}); });
    root.querySelectorAll("a[data-ehref]").forEach(function(a){
      a.addEventListener("click", function(ev){
        ev.preventDefault(); var w = window.open("", "_blank");
        decAsset(a.dataset.ehref, pw).then(function(u){ if (w) w.location.href = u; else location.href = u; });
      });
    });
    return Promise.all(media);
  }
  var dataEl = document.getElementById("locked-data");
  var blob = dataEl ? JSON.parse(dataEl.textContent) : null;
  async function unlockWith(pw){
    if (!blob) return false;
    try {
      var html = await decrypt(blob, pw);
      sessionStorage.setItem(PW_KEY, pw);
      if (blob.kind === "page") {
        var gate = document.getElementById("gate"); var target = document.getElementById("locked-content");
        if (gate) gate.classList.add("hidden");
        if (target) { target.innerHTML = html; target.classList.remove("hidden"); await decAssets(target, pw); wireYouTube(target); if (window.dmWirePhones) window.dmWirePhones(target); }
      } else if (blob.kind === "tiles" || blob.kind === "tiles+bits") {
        var parsed = JSON.parse(html);
        var map = blob.kind === "tiles" ? parsed : parsed.tiles;
        if (parsed.bits) {
          Object.keys(parsed.bits).forEach(function(title){
            var el = document.querySelector('[data-locked="' + title.replace(/"/g, '\\"') + '"]'); if (!el) return;
            el.innerHTML = parsed.bits[title]; decAssets(el, pw); var hint = el.previousElementSibling; if (hint) hint.remove();
          });
          var g = document.getElementById("gate"); if (g) g.classList.add("hidden");
        }
        Object.keys(map).forEach(function(slug){
          var t = document.querySelector('[data-tile="' + slug + '"] .img'); if (!t) return;
          var img = document.createElement("img"); if (/\.enc$/.test(map[slug])) { (function(im, u){ decAsset(u, pw).then(function(b){ im.src = b; }); })(img, map[slug]); } else img.src = map[slug]; img.alt = ""; img.loading = "lazy";
          t.classList.remove("type"); t.innerHTML = ""; t.appendChild(img);
          var lk = document.createElement("span"); lk.className = "lock"; lk.textContent = "Unlocked"; t.appendChild(lk);
        });
      }
      return true;
    } catch (e) { return false; }
  }
  var form = document.getElementById("gate-form");
  if (form) {
    form.addEventListener("submit", async function(ev){
      ev.preventDefault();
      var pw = form.querySelector("input").value.trim(); var err = form.parentNode.querySelector(".err");
      var ok = await unlockWith(pw);
      if (!ok && err) err.textContent = "That’s not it — try again.";
    });
  }
  var saved = sessionStorage.getItem(PW_KEY);
  if (blob && saved) unlockWith(saved);
  // --- writing randomizer
  var qEl = document.getElementById("quote"), sEl = document.getElementById("quote-src"), qBtn = document.getElementById("new-sample"), qData = document.getElementById("samples");
  if (qEl && qData) {
    var samples = JSON.parse(qData.textContent), last = -1;
    var show = function(){ var i; do { i = Math.floor(Math.random()*samples.length); } while (i === last && samples.length > 1); last = i; qEl.textContent = "“" + samples[i].text + "”"; sEl.textContent = "— " + samples[i].source; };
    show(); if (qBtn) qBtn.addEventListener("click", show);
  }
})();


// ---- v2: header shadow once scrolled (reveals are CSS scroll-driven animations; no JS needed) ----
(function () {
  var onScroll = function () { document.body.classList.toggle('scrolled', scrollY > 8); };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
})();


// ---- DI: a prompt box that starts an email ----
(function () {
  var form = document.getElementById('di-form'); if (!form) return;
  var ta = document.getElementById('di-prompt'), reveal = document.getElementById('di-reveal'), mailto = document.getElementById('di-mailto');
  var EMAIL = 'momanaee@gmail.com', picked = null;
  ta.addEventListener('input', function () { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 320) + 'px'; });
  form.querySelectorAll('.chip').forEach(function (c) {
    c.addEventListener('click', function () {
      var on = c.getAttribute('aria-pressed') === 'true';
      form.querySelectorAll('.chip').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
      picked = on ? null : c.dataset.chip; if (!on) c.setAttribute('aria-pressed', 'true');
      if (!ta.value.trim() && picked) ta.placeholder = picked + ' for…'; ta.focus();
    });
  });
  function build() {
    var body = (picked ? 'Request type: ' + picked + '\n\n' : '') + 'Brief:\n' + ta.value.trim() + '\n\n— sent from DI, dmomanaee.com';
    return 'mailto:' + EMAIL + '?subject=' + encodeURIComponent('DI request') + '&body=' + encodeURIComponent(body);
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault(); if (!ta.value.trim()) { ta.focus(); return; }
    var href = build(); mailto.href = href;
    reveal.hidden = false; reveal.classList.add('show'); document.body.classList.add('di-sent');
    reveal.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(function () { window.location.href = href; }, 350);
  });
  ta.addEventListener('keydown', function (e) { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') form.requestSubmit(); });
  var copy = document.getElementById('di-copy'), copied = document.getElementById('di-copied');
  copy.addEventListener('click', function () {
    var done = function () { copied.hidden = false; };
    if (navigator.clipboard) navigator.clipboard.writeText(EMAIL).then(done, done); else done();
  });
})();


// ---- phone-frame ads: muted autoplay while in view, tap for sound + controls ----
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var io = ('IntersectionObserver' in window && !reduce) ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { var v = e.target; if (e.intersectionRatio >= 0.5) { if (v.paused && !v.ended) v.play().catch(function () {}); } else if (!v.paused) v.pause(); });
  }, { threshold: [0, 0.5, 1] }) : null;
  function wire(root) {
    (root || document).querySelectorAll('video[data-autoplay]').forEach(function (v) {
      if (v.dataset.wired) return; v.dataset.wired = '1';
      if (io) io.observe(v);
      var fig = v.closest('.phone'), btn = fig && fig.querySelector('.snd'); if (!btn) return;
      var unmute = function () { v.muted = false; v.controls = true; fig.classList.add('sound'); if (v.ended) v.currentTime = 0; v.play().catch(function () {}); };
      btn.addEventListener('click', unmute);
      v.addEventListener('click', function () { if (!v.controls) unmute(); });
      v.addEventListener('ended', function () { v.load(); });  // back to the poster when it ends
    });
  }
  window.dmWirePhones = wire; wire(document);
})();

// ---- process loops on About: honour reduced motion ----
(function () {
  if (!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  document.querySelectorAll('video.process').forEach(function (v) { v.removeAttribute('autoplay'); v.pause(); v.controls = true; });
})();
