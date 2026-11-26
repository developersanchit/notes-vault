(function () {
  var prefix = window.NV_ROOT_PREFIX || "";
  var data = window.NOTESVAULT_DATA || { subjects: [], resources: [], pyqs: [], events: [] };

  var resById = {};
  var resByAsset = {};
  (data.resources || []).forEach(function (r) {
    resById[r.id] = r;
    if (r.assetPath) resByAsset[r.assetPath] = r;
  });
  (data.pyqs || []).forEach(function (p) {
    if (!resById[p.id]) {
      resById[p.id] = {
        id: p.id,
        title: p.title,
        assetPath: p.assetPath,
        fileType: p.fileType || "PDF",
        fileSizeLabel: p.fileSizeLabel || "",
        subjectName: p.subjectName || "",
        typeLabel: "PYQ"
      };
    }
    if (p.assetPath && !resByAsset[p.assetPath]) resByAsset[p.assetPath] = resById[p.id];
  });

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // 1. Theme toggle
  var themeBtn = document.getElementById("nv-theme-toggle");
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var isDark = document.documentElement.dataset.theme === "dark";
      if (isDark) {
        delete document.documentElement.dataset.theme;
        localStorage.setItem("notes-hub:theme", "light");
      } else {
        document.documentElement.dataset.theme = "dark";
        localStorage.setItem("notes-hub:theme", "dark");
      }
    });
  }

  // 2. Sidebar & mobile drawer toggles
  var sidebarBtn = document.getElementById("nv-sidebar-toggle");
  var mobileMore = document.getElementById("nv-mobile-more");
  var drawer = document.getElementById("nv-mobile-drawer");
  var drawerClose = document.getElementById("nv-drawer-close");

  if (sidebarBtn) {
    sidebarBtn.addEventListener("click", function () {
      if (window.innerWidth < 768 && drawer) {
        drawer.classList.add("nv-drawer-open");
      } else {
        document.body.classList.toggle("nv-collapsed");
      }
    });
  }
  if (mobileMore && drawer) {
    mobileMore.addEventListener("click", function () {
      drawer.classList.add("nv-drawer-open");
    });
  }
  if (drawerClose && drawer) {
    drawerClose.addEventListener("click", function () {
      drawer.classList.remove("nv-drawer-open");
    });
  }
  if (drawer && drawer.firstElementChild) {
    drawer.firstElementChild.addEventListener("click", function () {
      drawer.classList.remove("nv-drawer-open");
    });
  }

  // 3. Bookmarks (localStorage)
  var BM_KEY = "notes-hub:bookmarks";
  function getBookmarks() {
    try {
      var arr = JSON.parse(localStorage.getItem(BM_KEY) || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveBookmarks(arr) {
    try { localStorage.setItem(BM_KEY, JSON.stringify(arr)); } catch (e) {}
  }
  function syncBookmarkButtons() {
    var set = new Set(getBookmarks());
    document.querySelectorAll(".nv-bookmark-btn[data-resource-id]").forEach(function (btn) {
      var id = btn.getAttribute("data-resource-id");
      var saved = set.has(id);
      btn.setAttribute("aria-pressed", saved ? "true" : "false");
      var svg = btn.querySelector("svg");
      if (svg) {
        btn.classList.toggle("text-primary-strong", saved);
        btn.classList.toggle("text-faint", !saved);
        svg.setAttribute("fill", saved ? "currentColor" : "none");
      } else {
        var isFull = btn.textContent.trim().length > 2;
        btn.textContent = isFull ? (saved ? "★ Saved" : "☆ Save") : (saved ? "★" : "☆");
      }
    });
  }
  function toggleBookmark(id) {
    var list = getBookmarks();
    var idx = list.indexOf(id);
    if (idx === -1) list.push(id); else list.splice(idx, 1);
    saveBookmarks(list);
    syncBookmarkButtons();
    if (document.getElementById("nv-bookmarks-container")) renderBookmarksPage();
  }
  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest(".nv-bookmark-btn[data-resource-id]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    toggleBookmark(btn.getAttribute("data-resource-id"));
  });
  syncBookmarkButtons();

  // 4. Lightweight In-Page Full-Screen Reader Modal + Hover Pre-warm Cache
  var prewarmPool = document.createElement("div");
  prewarmPool.setAttribute("aria-hidden", "true");
  prewarmPool.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:10px;height:10px;opacity:0;pointer-events:none;overflow:hidden;";
  document.body.appendChild(prewarmPool);

  var frameCache = new Map(); // previewUrl -> { iframe, loaded, lastUsed }
  var MAX_CACHED_FRAMES = 4;

  function pruneCache(activeUrl) {
    if (frameCache.size <= MAX_CACHED_FRAMES) return;
    var oldestKey = null;
    var oldestTime = Infinity;
    frameCache.forEach(function (entry, key) {
      if (key !== activeUrl && entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    });
    if (oldestKey) {
      var old = frameCache.get(oldestKey);
      if (old && old.iframe && old.iframe.parentNode) old.iframe.parentNode.removeChild(old.iframe);
      frameCache.delete(oldestKey);
    }
  }

  function getOrCreateFrame(previewUrl, title, onReady) {
    var entry = frameCache.get(previewUrl);
    if (entry) {
      entry.lastUsed = Date.now();
      if (entry.loaded && onReady) onReady();
      else if (onReady) entry.onReady = onReady;
      return entry;
    }
    var iframe = document.createElement("iframe");
    iframe.src = previewUrl;
    iframe.title = title || "Document Viewer";
    iframe.className = "w-full h-full border-0 bg-white";
    iframe.setAttribute("allow", "autoplay; fullscreen");
    entry = { iframe: iframe, loaded: false, lastUsed: Date.now(), onReady: onReady || null };
    iframe.addEventListener("load", function () {
      entry.loaded = true;
      if (entry.onReady) {
        var cb = entry.onReady;
        entry.onReady = null;
        cb();
      }
    });
    frameCache.set(previewUrl, entry);
    prewarmPool.appendChild(iframe);
    pruneCache(previewUrl);
    return entry;
  }

  // Create singleton reader modal DOM
  var readerEl = document.createElement("div");
  readerEl.id = "nv-reader-modal";
  readerEl.className = "fixed inset-0 z-[120] hidden flex-col bg-black/75 backdrop-blur-sm";
  readerEl.setAttribute("role", "dialog");
  readerEl.setAttribute("aria-modal", "true");
  readerEl.innerHTML =
    '<div id="nv-reader-chrome" class="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2.5 shadow-sm shrink-0">' +
      '<div class="min-w-0 flex items-center gap-3">' +
        '<button id="nv-reader-close-left" type="button" class="flex h-8 w-8 shrink-0 items-center justify-center rounded-button border border-border bg-surface-soft text-ink hover:border-sage-300" aria-label="Close reader" title="Close (Esc)">✕</button>' +
        '<div class="min-w-0">' +
          '<p id="nv-reader-title" class="truncate text-body-lg font-semibold text-ink"></p>' +
          '<p id="nv-reader-subtitle" class="truncate text-micro text-muted"></p>' +
        '</div>' +
      '</div>' +
      '<div class="flex items-center gap-2 shrink-0">' +
        '<span id="nv-reader-badge" class="hidden sm:inline-flex items-center rounded-full bg-primary-soft px-2.5 py-0.5 text-micro font-semibold text-primary-strong"></span>' +
        '<button id="nv-reader-bookmark" type="button" class="nv-bookmark-btn rounded-button border border-border bg-surface px-3 py-1.5 text-micro font-semibold text-ink hover:border-sage-300" data-resource-id="">☆ Save</button>' +
        '<a id="nv-reader-download" href="#" download class="rounded-button bg-primary px-3 py-1.5 text-micro font-semibold text-white hover:opacity-90">Download</a>' +
        '<button id="nv-reader-fullscreen" type="button" class="hidden sm:inline-flex h-8 w-8 items-center justify-center rounded-button border border-border bg-surface text-ink hover:border-sage-300" aria-label="Toggle fullscreen" title="Fullscreen">⛶</button>' +
      '</div>' +
    '</div>' +
    '<div id="nv-reader-stage" class="relative flex-1 w-full overflow-hidden bg-[var(--background)]">' +
      '<div id="nv-reader-loader" class="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none bg-[var(--background)] z-10 transition-opacity duration-200">' +
        '<div class="h-8 w-8 rounded-full border-2 border-sage-300 border-t-primary animate-spin"></div>' +
        '<p class="text-body text-secondary">Loading document in viewer…</p>' +
      '</div>' +
    '</div>';
  document.body.appendChild(readerEl);

  var rTitle = document.getElementById("nv-reader-title");
  var rSubtitle = document.getElementById("nv-reader-subtitle");
  var rBadge = document.getElementById("nv-reader-badge");
  var rBookmark = document.getElementById("nv-reader-bookmark");
  var rDownload = document.getElementById("nv-reader-download");
  var rFullscreen = document.getElementById("nv-reader-fullscreen");
  var rCloseLeft = document.getElementById("nv-reader-close-left");
  var rStage = document.getElementById("nv-reader-stage");
  var rLoader = document.getElementById("nv-reader-loader");

  var activeEntry = null;
  var activeNonFrame = null;
  var prevOverflow = "";

  function hideLoader() {
    if (rLoader) rLoader.style.display = "none";
  }
  function showLoader() {
    if (rLoader) rLoader.style.display = "flex";
  }

  function closeReader() {
    if (readerEl.classList.contains("hidden")) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(function () {});
    }
    readerEl.classList.add("hidden");
    readerEl.classList.remove("flex");
    document.body.style.overflow = prevOverflow;
    if (activeEntry && activeEntry.iframe) {
      prewarmPool.appendChild(activeEntry.iframe);
      activeEntry = null;
    }
    if (activeNonFrame && activeNonFrame.parentNode) {
      activeNonFrame.parentNode.removeChild(activeNonFrame);
      activeNonFrame = null;
    }
  }

  function openReader(meta) {
    if (!meta || !meta.assetPath || typeof window.resolveStudyAsset !== "function") return;
    var resolved = window.resolveStudyAsset(meta.assetPath, prefix);
    var fileType = (meta.fileType || "PDF").toUpperCase();

    // Clean any previous stage item
    if (activeEntry && activeEntry.iframe) {
      prewarmPool.appendChild(activeEntry.iframe);
      activeEntry = null;
    }
    if (activeNonFrame && activeNonFrame.parentNode) {
      activeNonFrame.parentNode.removeChild(activeNonFrame);
      activeNonFrame = null;
    }

    rTitle.textContent = meta.title || meta.assetPath;
    rSubtitle.textContent = [meta.subjectName, meta.typeLabel, meta.fileSizeLabel].filter(Boolean).join(" · ");
    rBadge.textContent = resolved.source === "gdrive" ? "Google Drive" : fileType;
    rDownload.href = resolved.downloadUrl;

    if (meta.id && !String(meta.id).startsWith("schedule")) {
      rBookmark.style.display = "";
      rBookmark.setAttribute("data-resource-id", meta.id);
      syncBookmarkButtons();
    } else {
      rBookmark.style.display = "none";
    }

    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    readerEl.classList.remove("hidden");
    readerEl.classList.add("flex");

    if (resolved.source === "gdrive" || fileType === "PDF") {
      showLoader();
      var entry = getOrCreateFrame(resolved.previewUrl, meta.title, hideLoader);
      activeEntry = entry;
      rStage.appendChild(entry.iframe);
      if (entry.loaded) hideLoader();
    } else if (fileType === "JPG" || fileType === "JPEG" || fileType === "PNG" || fileType === "WEBP") {
      hideLoader();
      var wrap = document.createElement("div");
      wrap.className = "flex h-full w-full items-center justify-center p-4";
      wrap.innerHTML = '<img src="' + escapeHtml(resolved.viewUrl) + '" alt="' + escapeHtml(meta.title) + '" class="max-h-full max-w-full rounded shadow-lg object-contain"/>';
      activeNonFrame = wrap;
      rStage.appendChild(wrap);
    } else {
      hideLoader();
      var card = document.createElement("div");
      card.className = "flex h-full w-full items-center justify-center p-6";
      card.innerHTML = '<div class="max-w-sm rounded-card border border-border bg-surface p-6 text-center shadow-sm space-y-3">' +
        '<p class="text-card font-semibold text-ink">Inline preview unavailable for ' + escapeHtml(fileType) + '</p>' +
        '<p class="text-body text-secondary">Download this file directly using the button below.</p>' +
        '<a href="' + escapeHtml(resolved.downloadUrl) + '" download class="inline-flex rounded-button bg-primary px-4 py-2 text-body font-semibold text-white">Download</a></div>';
      activeNonFrame = card;
      rStage.appendChild(card);
    }
  }

  rCloseLeft.addEventListener("click", closeReader);
  rFullscreen.addEventListener("click", function () {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(function () {});
    } else if (readerEl.requestFullscreen) {
      readerEl.requestFullscreen().catch(function () {});
    }
  });

  // Resolve what resource a clicked/hovered link targets
  function resolveLinkTarget(anchor) {
    if (!anchor) return null;
    var assetAttr = anchor.getAttribute("data-asset-href");
    if (assetAttr) {
      if (resByAsset[assetAttr]) return resByAsset[assetAttr];
      return {
        id: "schedule-calendar",
        title: "Academic Calendar 2026–27",
        subjectName: "SGSITS Schedule",
        typeLabel: "PDF",
        fileType: "PDF",
        assetPath: assetAttr
      };
    }
    var href = anchor.getAttribute("href") || "";
    var m = href.match(/notes\/([a-z0-9]{10,})\/index\.html/i);
    if (m && resById[m[1]]) return resById[m[1]];
    return null;
  }

  // Intercept note / PDF clicks to open in the same-tab modal viewer!
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    var anchor = e.target.closest && e.target.closest("a");
    if (!anchor) return;
    if (anchor.hasAttribute("download") || anchor.hasAttribute("data-asset-download") || anchor.id === "nv-download-file" || anchor.id === "nv-reader-download") return;
    var meta = resolveLinkTarget(anchor);
    if (!meta) return;
    e.preventDefault();
    if (searchModal && searchModal.classList.contains("open")) closeSearch();
    openReader(meta);
  });

  // Pre-warm Google Drive iframe on hover / focus (80ms dwell)
  var hoverTimer = null;
  document.addEventListener("pointerover", function (e) {
    var anchor = e.target.closest && e.target.closest("a");
    if (!anchor || anchor.hasAttribute("download") || anchor.hasAttribute("data-asset-download")) return;
    var meta = resolveLinkTarget(anchor);
    if (!meta || !meta.assetPath || typeof window.resolveStudyAsset !== "function") return;
    var resolved = window.resolveStudyAsset(meta.assetPath, prefix);
    if (resolved.source !== "gdrive" && (meta.fileType || "").toUpperCase() !== "PDF") return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(function () {
      getOrCreateFrame(resolved.previewUrl, meta.title, null);
    }, 80);
  });
  document.addEventListener("pointerout", function (e) {
    if (e.target && e.target.closest && e.target.closest("a")) {
      clearTimeout(hoverTimer);
    }
  });

  // 5. Global Ctrl+K Search Modal with keyboard navigation
  var searchModal = document.getElementById("nv-search-modal");
  var searchTrigger = document.getElementById("nv-search-trigger");
  var searchInput = document.getElementById("nv-search-input");
  var searchResults = document.getElementById("nv-search-results");
  var searchClose = document.getElementById("nv-search-close");
  var activeIndex = -1;

  function updateActiveResult() {
    if (!searchResults) return;
    var items = searchResults.querySelectorAll("a");
    items.forEach(function (el, idx) {
      el.classList.toggle("bg-surface-soft", idx === activeIndex);
    });
    if (activeIndex >= 0 && items[activeIndex]) {
      items[activeIndex].scrollIntoView({ block: "nearest" });
    }
  }

  function renderSearch(q) {
    if (!searchResults) return;
    activeIndex = -1;
    var query = (q || "").trim().toLowerCase();
    var matchedSubj = (data.subjects || []).filter(function (s) {
      return !query || (s.name + " " + s.code).toLowerCase().includes(query);
    }).slice(0, 4);
    var matchedRes = (data.resources || []).filter(function (r) {
      return !query || (r.title + " " + r.subjectName + " " + r.subjectCode + " " + r.originalFilename + " " + r.typeLabel).toLowerCase().includes(query);
    }).slice(0, 14);

    var html = "";
    matchedSubj.forEach(function (s) {
      html += '<a href="' + prefix + 'subjects/' + s.id + '/index.html" class="flex items-center justify-between gap-3 rounded-button px-3 py-2.5 hover:bg-surface-soft">' +
        '<span class="min-w-0"><span class="block truncate text-body font-semibold text-ink">' + escapeHtml(s.name) + '</span>' +
        '<span class="block text-micro text-muted">' + escapeHtml(s.code) + ' · Subject</span></span>' +
        '<span class="rounded-full bg-primary-soft px-2 py-0.5 text-micro font-semibold text-primary-strong">Subject</span></a>';
    });
    matchedRes.forEach(function (r) {
      html += '<a href="' + prefix + 'notes/' + r.id + '/index.html" class="flex items-center justify-between gap-3 rounded-button px-3 py-2.5 hover:bg-surface-soft">' +
        '<span class="min-w-0"><span class="block truncate text-body font-semibold text-ink">' + escapeHtml(r.title) + '</span>' +
        '<span class="block truncate text-micro text-muted">' + escapeHtml(r.subjectName) + ' · ' + escapeHtml(r.typeLabel) + '</span></span>' +
        '<span class="rounded-full bg-surface-soft px-2 py-0.5 text-micro font-semibold text-secondary">' + escapeHtml(r.fileType) + '</span></a>';
    });
    if (!html) {
      html = '<p class="p-6 text-center text-body text-muted">No matching subjects or notes.</p>';
    }
    searchResults.innerHTML = html;
  }

  function openSearch() {
    if (!searchModal) return;
    searchModal.classList.add("open");
    renderSearch(searchInput ? searchInput.value : "");
    setTimeout(function () { searchInput && searchInput.focus(); }, 20);
  }
  function closeSearch() {
    if (!searchModal) return;
    searchModal.classList.remove("open");
  }
  if (searchTrigger) searchTrigger.addEventListener("click", openSearch);
  if (searchClose) searchClose.addEventListener("click", closeSearch);
  if (searchModal) {
    searchModal.addEventListener("click", function (e) {
      if (e.target === searchModal) closeSearch();
    });
  }
  if (searchInput) {
    searchInput.addEventListener("input", function () {
      renderSearch(searchInput.value);
    });
    searchInput.addEventListener("keydown", function (e) {
      if (!searchResults) return;
      var items = searchResults.querySelectorAll("a");
      if (!items.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        activeIndex = (activeIndex + 1) % items.length;
        updateActiveResult();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeIndex = (activeIndex - 1 + items.length) % items.length;
        updateActiveResult();
      } else if (e.key === "Enter" && activeIndex >= 0 && items[activeIndex]) {
        e.preventDefault();
        items[activeIndex].click();
      }
    });
  }
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openSearch();
    } else if (e.key === "Escape") {
      if (!readerEl.classList.contains("hidden")) closeReader();
      else closeSearch();
    }
  });

  // 6. Bookmarks page rendering
  function renderBookmarksPage() {
    var container = document.getElementById("nv-bookmarks-container");
    if (!container) return;
    var ids = getBookmarks();
    var items = ids.map(function (id) { return resById[id]; }).filter(Boolean);
    if (!items.length) {
      container.innerHTML = '<div class="p-10 text-center space-y-2"><p class="text-body-lg font-semibold text-ink">No saved notes yet</p><p class="text-body text-muted">Click ☆ on any note to save it here for quick revision.</p></div>';
      return;
    }
    var rows = items.map(function (r) {
      var resolved = window.resolveStudyAsset(r.assetPath, prefix);
      return '<li class="flex min-h-[64px] items-center gap-3.5 px-4 py-3 hover:bg-row-hover">' +
        '<a href="' + prefix + 'notes/' + r.id + '/index.html" class="flex min-w-0 flex-1 items-center gap-3.5">' +
        '<span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-input bg-primary-soft text-primary-strong text-micro font-bold">' + escapeHtml(r.fileType) + '</span>' +
        '<span class="min-w-0 flex-1"><span class="block truncate text-body-lg font-semibold text-ink">' + escapeHtml(r.title) + '</span>' +
        '<span class="mt-0.5 block truncate text-micro text-muted">' + escapeHtml(r.subjectName) + ' · ' + escapeHtml(r.typeLabel) + '</span></span></a>' +
        '<a data-asset-href="' + escapeHtml(r.assetPath) + '" href="' + resolved.viewUrl + '" class="rounded-button border border-border bg-surface px-2.5 py-1.5 text-micro font-semibold text-ink">Open</a>' +
        '<button type="button" class="nv-bookmark-btn flex h-8 w-8 items-center justify-center rounded-button border border-border bg-surface text-primary-strong" data-resource-id="' + r.id + '">★</button></li>';
    }).join("");
    container.innerHTML = '<ul class="divide-y divide-border-soft">' + rows + '</ul>';
  }
  renderBookmarksPage();

  // 7. Resolve all asset links across the page
  if (typeof window.resolveStudyAsset === "function") {
    document.querySelectorAll("[data-asset-href]").forEach(function (el) {
      var res = window.resolveStudyAsset(el.getAttribute("data-asset-href"), prefix);
      el.setAttribute("href", res.viewUrl);
    });
    document.querySelectorAll("[data-asset-download]").forEach(function (el) {
      var res = window.resolveStudyAsset(el.getAttribute("data-asset-download"), prefix);
      el.setAttribute("href", res.downloadUrl);
    });
  }

  // 8. Standalone Note Viewer Page (notes/<id>/index.html)
  var viewer = document.querySelector("[data-note-viewer]");
  if (viewer && typeof window.resolveStudyAsset === "function") {
    var assetPath = viewer.getAttribute("data-asset-path");
    var fileType = (viewer.getAttribute("data-file-type") || "PDF").toUpperCase();
    var res = window.resolveStudyAsset(assetPath, prefix);
    var openBtn = document.getElementById("nv-open-file");
    var dlBtn = document.getElementById("nv-download-file");
    var badge = document.getElementById("nv-asset-source-badge");
    var preview = document.getElementById("nv-preview-container");
    if (openBtn) {
      openBtn.href = res.viewUrl;
      openBtn.setAttribute("data-asset-href", assetPath);
      openBtn.textContent = "Full-screen Reader";
    }
    if (dlBtn) dlBtn.href = res.downloadUrl;
    if (badge) {
      if (res.source === "gdrive") {
        badge.textContent = "Google Drive";
        badge.classList.add("nv-badge-drive");
      } else {
        badge.textContent = "Local asset";
      }
    }
    if (preview) {
      if (res.source === "gdrive" || fileType === "PDF") {
        preview.innerHTML = '<iframe src="' + escapeHtml(res.previewUrl) + '" class="w-full h-[78vh] border-0" title="Document preview" allow="autoplay; fullscreen"></iframe>';
      } else if (fileType === "JPG" || fileType === "JPEG" || fileType === "PNG" || fileType === "WEBP") {
        preview.innerHTML = '<img src="' + escapeHtml(res.viewUrl) + '" alt="Document preview" class="max-h-[78vh] w-auto object-contain p-4"/>';
      } else {
        preview.innerHTML = '<div class="p-10 text-center space-y-3"><p class="text-body-lg font-semibold text-ink">Preview not available inline for ' + escapeHtml(fileType) + ' files</p><p class="text-body text-muted">Use Download above to view this file.</p></div>';
      }
    }
  }

  // 9. Schedule PDF preview
  var schedPreview = document.getElementById("nv-schedule-preview");
  if (schedPreview && typeof window.resolveStudyAsset === "function") {
    var spath = schedPreview.getAttribute("data-asset-path");
    var sres = window.resolveStudyAsset(spath, prefix);
    schedPreview.innerHTML = '<iframe src="' + escapeHtml(sres.previewUrl) + '" class="w-full h-[70vh] border-0" title="Academic Calendar PDF" allow="autoplay; fullscreen"></iframe>';
  }

  // 10. Subjects filter
  var subjSem = document.getElementById("nv-subj-sem");
  var subjSearch = document.getElementById("nv-subj-search");
  function filterSubjects() {
    var sem = subjSem ? subjSem.value : "all";
    var q = subjSearch ? subjSearch.value.trim().toLowerCase() : "";
    document.querySelectorAll(".nv-subject-card").forEach(function (card) {
      var okSem = sem === "all" || card.getAttribute("data-sem") === sem;
      var okQ = !q || (card.getAttribute("data-search") || "").includes(q);
      card.style.display = okSem && okQ ? "" : "none";
    });
  }
  if (subjSem) subjSem.addEventListener("change", filterSubjects);
  if (subjSearch) subjSearch.addEventListener("input", filterSubjects);

  // 11. Subject detail filter
  var subjDetailSearch = document.getElementById("nv-subj-detail-search");
  var typePills = document.getElementById("nv-type-pills");
  var activeSubjType = "all";
  function filterSubjDetail() {
    var q = subjDetailSearch ? subjDetailSearch.value.trim().toLowerCase() : "";
    document.querySelectorAll(".nv-resource-row").forEach(function (row) {
      var okT = activeSubjType === "all" || row.getAttribute("data-type") === activeSubjType;
      var okQ = !q || (row.getAttribute("data-search") || "").includes(q);
      row.style.display = okT && okQ ? "" : "none";
    });
  }
  if (subjDetailSearch) subjDetailSearch.addEventListener("input", filterSubjDetail);
  if (typePills) {
    typePills.addEventListener("click", function (e) {
      var pill = e.target.closest(".nv-filter-pill");
      if (!pill) return;
      activeSubjType = pill.getAttribute("data-type") || "all";
      typePills.querySelectorAll(".nv-filter-pill").forEach(function (p) {
        var on = p === pill;
        p.classList.toggle("bg-primary-soft", on);
        p.classList.toggle("text-primary-strong", on);
        p.classList.toggle("border-sage-300", on);
        p.classList.toggle("bg-surface", !on);
        p.classList.toggle("text-secondary", !on);
        p.classList.toggle("border-border", !on);
      });
      filterSubjDetail();
    });
  }

  // 12. All Notes filter & sort
  var notesSearch = document.getElementById("nv-notes-search");
  var notesSubj = document.getElementById("nv-notes-subject");
  var notesType = document.getElementById("nv-notes-type");
  var notesSort = document.getElementById("nv-notes-sort");
  var notesList = document.getElementById("nv-notes-list");
  var notesCount = document.getElementById("nv-notes-count");
  function filterNotes() {
    if (!notesList) return;
    var q = notesSearch ? notesSearch.value.trim().toLowerCase() : "";
    var s = notesSubj ? notesSubj.value : "all";
    var t = notesType ? notesType.value : "all";
    var rows = Array.prototype.slice.call(notesList.querySelectorAll(".nv-note-row"));
    var visible = 0;
    rows.forEach(function (row) {
      var ok = (!q || (row.getAttribute("data-search") || "").includes(q)) &&
               (s === "all" || row.getAttribute("data-subject") === s) &&
               (t === "all" || row.getAttribute("data-type") === t);
      row.style.display = ok ? "" : "none";
      if (ok) visible++;
    });
    if (notesCount) notesCount.textContent = visible + " resources shown";
  }
  function sortNotes() {
    if (!notesList || !notesSort) return;
    var mode = notesSort.value;
    var rows = Array.prototype.slice.call(notesList.querySelectorAll(".nv-note-row"));
    rows.sort(function (a, b) {
      if (mode === "title") {
        return (a.getAttribute("data-title") || "").localeCompare(b.getAttribute("data-title") || "");
      }
      return Number(b.getAttribute("data-views") || 0) - Number(a.getAttribute("data-views") || 0);
    });
    rows.forEach(function (r) { notesList.appendChild(r); });
  }
  if (notesSearch) notesSearch.addEventListener("input", filterNotes);
  if (notesSubj) notesSubj.addEventListener("change", filterNotes);
  if (notesType) notesType.addEventListener("change", filterNotes);
  if (notesSort) notesSort.addEventListener("change", sortNotes);

  // 13. PYQ filter
  var pyqSearch = document.getElementById("nv-pyq-search");
  var pyqSubj = document.getElementById("nv-pyq-subject");
  function filterPyq() {
    var q = pyqSearch ? pyqSearch.value.trim().toLowerCase() : "";
    var s = pyqSubj ? pyqSubj.value : "all";
    document.querySelectorAll(".nv-pyq-row").forEach(function (row) {
      var ok = (!q || (row.getAttribute("data-search") || "").includes(q)) &&
               (s === "all" || row.getAttribute("data-subject") === s);
      row.style.display = ok ? "" : "none";
    });
  }
  if (pyqSearch) pyqSearch.addEventListener("input", filterPyq);
  if (pyqSubj) pyqSubj.addEventListener("change", filterPyq);
})();
