import { app } from "/scripts/app.js";

app.registerExtension({
  name: "ComfyUI.WorkflowDropZone",

  async setup() {
    // --- constants ---
    const SIZE = 72;
    const MARGIN = 18;
    // nudge the zone right from the left margin by ~160% of its width
    const LEFT_OFFSET = Math.round(SIZE * 1.6);
    // lower the zone by dropping it 15px below the bottom margin
    const BOTTOM_OFFSET = -15;
    const IDLE_OPACITY = 0.25;
    const HOVER_OPACITY = 0.85;
    const DROP_OPACITY = 1.0;
    const FADE_MS = 180;
    const FEEDBACK_MS = 1200;

    // --- build DOM ---
    const zone = document.createElement("div");
    zone.id = "workflow-dropzone";
    Object.assign(zone.style, {
      position: "fixed",
      bottom: `${MARGIN + BOTTOM_OFFSET}px`,
      left: `${MARGIN + LEFT_OFFSET}px`,
      width: `${SIZE}px`,
      height: `${SIZE}px`,
      borderRadius: "14px",
      border: "2.5px dashed rgba(180,180,255,0.6)",
      background: "rgba(30,30,50,0.55)",
      backdropFilter: "blur(6px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "99999",
      opacity: String(IDLE_OPACITY),
      transition: `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease, border-color ${FADE_MS}ms ease, background ${FADE_MS}ms ease`,
      cursor: "pointer",
      pointerEvents: "auto",
      userSelect: "none",
      transform: "scale(1)",
      boxSizing: "border-box",
    });

    // icon (upload arrow)
    const icon = document.createElement("div");
    icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"
      fill="none" stroke="rgba(200,200,255,0.85)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>`;
    icon.style.pointerEvents = "none";
    zone.appendChild(icon);

    // tooltip
    const tip = document.createElement("div");
    Object.assign(tip.style, {
      position: "absolute",
      left: `${SIZE + 10}px`,
      bottom: "50%",
      transform: "translateY(50%)",
      background: "rgba(20,20,35,0.92)",
      color: "#ccc",
      padding: "5px 10px",
      borderRadius: "6px",
      fontSize: "12px",
      whiteSpace: "nowrap",
      pointerEvents: "none",
      opacity: "0",
      transition: `opacity ${FADE_MS}ms ease`,
    });
    tip.textContent = "Drop / click to load  •  Shift = append  •  right-click = menu  •  drag to move";
    zone.appendChild(tip);

    document.body.appendChild(zone);

    // --- draggable + persisted position ---
    const POS_KEY = "workflow-dropzone-pos";
    const FULL_TRANSITION = `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease, border-color ${FADE_MS}ms ease, background ${FADE_MS}ms ease`;

    function clampToViewport(left, top) {
      const maxLeft = window.innerWidth - SIZE;
      const maxTop = window.innerHeight - SIZE;
      return {
        left: Math.max(0, Math.min(left, maxLeft)),
        top: Math.max(0, Math.min(top, maxTop)),
      };
    }

    // switch to top/left positioning (drop the default bottom anchor)
    function applyPosition(left, top) {
      const c = clampToViewport(left, top);
      zone.style.left = `${c.left}px`;
      zone.style.top = `${c.top}px`;
      zone.style.bottom = "auto";
    }

    // restore saved position, if any
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) || "null");
      if (saved && typeof saved.left === "number" && typeof saved.top === "number") {
        applyPosition(saved.left, saved.top);
      }
    } catch (e) { /* ignore corrupt value */ }

    // click-hold to drag; a plain click (below threshold) still opens the picker
    let suppressClick = false;
    let dragState = null;

    zone.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const rect = zone.getBoundingClientRect();
      dragState = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        left: rect.left,
        top: rect.top,
        moved: false,
      };
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!dragState) return;
      const dx = e.clientX - dragState.mouseX;
      const dy = e.clientY - dragState.mouseY;
      if (!dragState.moved && Math.hypot(dx, dy) < 4) return; // threshold
      dragState.moved = true;
      zone.style.cursor = "grabbing";
      zone.style.transition = "none"; // no easing while dragging
      applyPosition(dragState.left + dx, dragState.top + dy);
    });

    window.addEventListener("mouseup", () => {
      if (!dragState) return;
      const moved = dragState.moved;
      dragState = null;
      zone.style.cursor = "pointer";
      zone.style.transition = FULL_TRANSITION;
      if (moved) {
        suppressClick = true; // swallow the click that fires after a drag
        const rect = zone.getBoundingClientRect();
        try {
          localStorage.setItem(POS_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
        } catch (e) { /* storage may be unavailable */ }
      }
    });

    // keep it on-screen if the window is resized
    window.addEventListener("resize", () => {
      const rect = zone.getBoundingClientRect();
      applyPosition(rect.left, rect.top);
      if (panelOpen) positionPanel();
    });

    // --- auto-snapshot + restore (crash recovery) ---
    // Snapshots are stored per ComfyUI workflow (one localStorage key each), so
    // switching workflow tabs keeps separate histories and two browser tabs editing
    // different workflows never clobber each other's snapshots.
    const SNAP_PREFIX = "workflow-dropzone-snap:";
    const SNAP_INTERVAL_MS = 20000;  // how often we check for changes
    const SNAP_SPACING_MS = 120000;  // min age before a new history entry is started
    const SNAP_MAX = 8;              // rolling history depth (~14 min with the spacing above)
    const lastSnapHash = {};         // per-workflow "unchanged since last capture" guard

    // Identify the active ComfyUI workflow tab. Falls back to a single shared
    // bucket on older frontends that don't expose the workflow store.
    function activeWorkflowId() {
      try {
        const wf = app.extensionManager?.workflow?.activeWorkflow;
        if (wf) return String(wf.key || wf.path || wf.filename || "__active__");
      } catch (e) { /* store not present */ }
      try {
        const wf = app.workflowManager?.activeWorkflow; // legacy frontends
        if (wf) return String(wf.path || wf.name || "__active__");
      } catch (e) { /* noop */ }
      return "__active__";
    }
    function activeWorkflowName() {
      try {
        const wf = app.extensionManager?.workflow?.activeWorkflow;
        if (wf) return String(wf.filename || wf.key || wf.path || "workflow");
      } catch (e) { /* noop */ }
      return "workflow";
    }
    function snapKey(id) { return SNAP_PREFIX + (id || activeWorkflowId()); }

    function loadSnapshots(id) {
      try { return JSON.parse(localStorage.getItem(snapKey(id)) || "[]"); }
      catch (e) { return []; }
    }

    // free the least-recently-touched snapshot bucket other than keepKey
    function evictOtherSnapshotBucket(keepKey) {
      let victim = null, victimTime = Infinity;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k === keepKey || !k.startsWith(SNAP_PREFIX)) continue;
        let newest = 0;
        try { newest = JSON.parse(localStorage.getItem(k) || "[]")[0]?.time || 0; } catch (e) { newest = 0; }
        if (newest < victimTime) { victimTime = newest; victim = k; }
      }
      if (victim) { try { localStorage.removeItem(victim); return true; } catch (e) { /* noop */ } }
      return false;
    }

    // persist newest-first; on quota errors drop our own oldest, then sacrifice
    // other workflows' buckets (oldest first) until it fits
    function saveSnapshots(list, id) {
      const key = snapKey(id);
      let arr = list.slice();
      for (;;) {
        try { localStorage.setItem(key, JSON.stringify(arr)); return arr; }
        catch (e) {
          if (arr.length > 1) { arr.pop(); continue; }
          if (evictOtherSnapshotBucket(key)) continue;
          try { localStorage.removeItem(key); } catch (e2) { /* noop */ }
          return [];
        }
      }
    }

    function takeSnapshot() {
      let data;
      try { data = app.graph?.serialize(); } catch (e) { return; }
      if (!data || !Array.isArray(data.nodes) || data.nodes.length === 0) return; // never overwrite history with an empty canvas
      const id = activeWorkflowId();
      const json = JSON.stringify(data);
      if (json === lastSnapHash[id]) return; // unchanged since last capture for this workflow
      lastSnapHash[id] = json;
      let arr = loadSnapshots(id);
      const entry = { time: Date.now(), nodes: data.nodes.length, data };
      const newest = arr[0];
      if (newest && (Date.now() - newest.time) < SNAP_SPACING_MS) {
        arr[0] = entry; // coalesce: keep the newest slot tracking current work
      } else {
        arr.unshift(entry); // enough time passed — start a fresh history point
      }
      if (arr.length > SNAP_MAX) arr = arr.slice(0, SNAP_MAX);
      saveSnapshots(arr, id);
      if (panelOpen) renderPanel();
    }

    function restoreSnapshot(snap) {
      try {
        takeSnapshot();          // capture current canvas first, so a restore is itself undoable
        app.loadGraphData(snap.data);
        closePanel();
        flashFeedback(true);
      } catch (e) {
        console.error("[WorkflowDropZone] Restore failed:", e);
        flashFeedback(false);
      }
    }

    setInterval(takeSnapshot, SNAP_INTERVAL_MS);
    window.addEventListener("beforeunload", takeSnapshot);
    setTimeout(takeSnapshot, 3000); // seed one shortly after load

    // --- recent + favorites ---
    const RECENT_KEY = "workflow-dropzone-recent";
    const FAV_KEY = "workflow-dropzone-favorites";
    const RECENT_MAX = 10;

    // generic quota-safe store (newest-first); drops oldest until it fits
    function loadList(key) {
      try { return JSON.parse(localStorage.getItem(key) || "[]"); }
      catch (e) { return []; }
    }
    function saveList(key, list) {
      let arr = list.slice();
      while (arr.length) {
        try { localStorage.setItem(key, JSON.stringify(arr)); return arr; }
        catch (e) { arr.pop(); }
      }
      try { localStorage.removeItem(key); } catch (e) { /* noop */ }
      return [];
    }

    // record a successfully-loaded workflow into Recent (dedupe by name)
    function recordRecent(name) {
      let data;
      try { data = app.graph?.serialize(); } catch (e) { return; }
      if (!data || !Array.isArray(data.nodes) || data.nodes.length === 0) return;
      const label = name || "workflow";
      let arr = loadList(RECENT_KEY).filter((r) => r.name !== label);
      arr.unshift({ name: label, time: Date.now(), nodes: data.nodes.length, data });
      if (arr.length > RECENT_MAX) arr = arr.slice(0, RECENT_MAX);
      saveList(RECENT_KEY, arr);
      if (panelOpen) renderPanel();
    }

    function isFavorite(name) {
      return loadList(FAV_KEY).some((f) => f.name === name);
    }
    function toggleFavorite(entry) {
      let favs = loadList(FAV_KEY);
      if (favs.some((f) => f.name === entry.name)) {
        favs = favs.filter((f) => f.name !== entry.name);
      } else {
        favs.unshift({ name: entry.name, time: Date.now(), nodes: entry.nodes, data: entry.data });
      }
      saveList(FAV_KEY, favs);
      closePanel(); // dismiss after the action, like loading a row does
    }

    // load a stored entry (recent/favorite), snapshotting current work first
    function loadStored(entry) {
      try {
        takeSnapshot();
        app.loadGraphData(entry.data);
        closePanel();
        flashFeedback(true);
      } catch (e) {
        console.error("[WorkflowDropZone] Load failed:", e);
        flashFeedback(false);
      }
    }

    // merge an incoming workflow into the current canvas without clearing it.
    // Remaps node/link ids to avoid collisions and nudges positions so the
    // appended nodes don't land exactly on top of existing ones.
    function mergeIntoCurrent(incoming) {
      const base = app.graph.serialize();
      const baseNodes = base.nodes || [];
      const baseLinks = base.links || [];
      let maxNodeId = 0;
      for (const n of baseNodes) maxNodeId = Math.max(maxNodeId, n.id || 0);
      let maxLinkId = 0;
      for (const l of baseLinks) maxLinkId = Math.max(maxLinkId, l[0] || 0);
      const nodeOff = maxNodeId + 1;
      const linkOff = maxLinkId + 1;
      const dx = 48, dy = 48;

      const inc = JSON.parse(JSON.stringify(incoming.workflow || incoming));
      const incNodes = inc.nodes || [];
      const incLinks = inc.links || [];

      for (const n of incNodes) {
        n.id = (n.id || 0) + nodeOff;
        if (Array.isArray(n.pos)) { n.pos[0] += dx; n.pos[1] += dy; }
        if (Array.isArray(n.inputs)) {
          for (const inp of n.inputs) if (inp.link != null) inp.link += linkOff;
        }
        if (Array.isArray(n.outputs)) {
          for (const out of n.outputs) if (Array.isArray(out.links)) out.links = out.links.map((id) => id + linkOff);
        }
      }
      const remappedLinks = incLinks.map((l) => {
        const c = l.slice();
        c[0] += linkOff; // link id
        c[1] += nodeOff; // origin node id
        c[3] += nodeOff; // target node id
        return c;
      });

      base.nodes = baseNodes.concat(incNodes);
      base.links = baseLinks.concat(remappedLinks);
      if (inc.groups) base.groups = (base.groups || []).concat(inc.groups);
      base.last_node_id = Math.max(base.last_node_id || 0, ...incNodes.map((n) => n.id), maxNodeId);
      base.last_link_id = Math.max(base.last_link_id || 0, ...remappedLinks.map((l) => l[0]), maxLinkId);
      app.loadGraphData(base);
    }

    // --- popover panel (right-click) ---
    const panel = document.createElement("div");
    Object.assign(panel.style, {
      position: "fixed",
      minWidth: "230px",
      maxWidth: "300px",
      maxHeight: "60vh",
      overflowY: "auto",
      background: "rgba(22,22,34,0.97)",
      border: "1px solid rgba(120,140,200,0.35)",
      borderRadius: "12px",
      boxShadow: "0 8px 28px rgba(0,0,0,0.5)",
      backdropFilter: "blur(8px)",
      padding: "8px",
      zIndex: "100000",
      display: "none",
      font: "13px system-ui, sans-serif",
      color: "#dfe3f0",
      userSelect: "none",
    });
    document.body.appendChild(panel);
    let panelOpen = false;

    function relTime(ts) {
      const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
      if (s < 60) return `${s}s ago`;
      const m = Math.round(s / 60);
      if (m < 60) return `${m}m ago`;
      const h = Math.round(m / 60);
      return `${h}h ago`;
    }

    function sectionHeader(title) {
      const head = document.createElement("div");
      Object.assign(head.style, {
        padding: "6px 8px 4px",
        fontSize: "11px",
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        color: "rgba(180,190,220,0.7)",
      });
      head.textContent = title;
      return head;
    }

    // a clickable row: { primary, secondary, onClick, starred, onStar }
    // onStar omitted => no star toggle (used for snapshots)
    function makeRow(opts) {
      const row = document.createElement("div");
      Object.assign(row.style, {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "10px",
        padding: "7px 8px",
        borderRadius: "7px",
        cursor: "pointer",
        transition: "background 120ms ease",
      });

      const left = document.createElement("div");
      Object.assign(left.style, { minWidth: "0", flex: "1 1 auto" });
      const primary = document.createElement("div");
      Object.assign(primary.style, { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
      primary.textContent = opts.primary;
      const secondary = document.createElement("div");
      Object.assign(secondary.style, { fontSize: "11px", color: "rgba(180,190,220,0.6)" });
      secondary.textContent = opts.secondary;
      left.appendChild(primary);
      left.appendChild(secondary);
      row.appendChild(left);

      if (opts.onStar) {
        const star = document.createElement("span");
        Object.assign(star.style, {
          flex: "0 0 auto",
          fontSize: "15px",
          lineHeight: "1",
          color: opts.starred ? "rgba(255,205,90,0.95)" : "rgba(180,190,220,0.4)",
          cursor: "pointer",
        });
        star.textContent = opts.starred ? "★" : "☆";
        star.title = opts.starred ? "Unpin from favorites" : "Pin to favorites";
        star.addEventListener("click", (e) => { e.stopPropagation(); opts.onStar(); });
        row.appendChild(star);
      }

      row.addEventListener("mouseenter", () => { row.style.background = "rgba(120,160,255,0.18)"; });
      row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });
      row.addEventListener("click", opts.onClick);
      return row;
    }

    function renderPanel() {
      panel.innerHTML = "";

      const favs = loadList(FAV_KEY);
      const recents = loadList(RECENT_KEY);
      const snaps = loadSnapshots();

      if (favs.length) {
        panel.appendChild(sectionHeader("Favorites"));
        favs.forEach((entry) => {
          panel.appendChild(makeRow({
            primary: entry.name,
            secondary: `${entry.nodes} node${entry.nodes === 1 ? "" : "s"}`,
            onClick: () => loadStored(entry),
            starred: true,
            onStar: () => toggleFavorite(entry),
          }));
        });
      }

      if (recents.length) {
        panel.appendChild(sectionHeader("Recent"));
        recents.forEach((entry) => {
          panel.appendChild(makeRow({
            primary: entry.name,
            secondary: `${relTime(entry.time)} · ${entry.nodes} node${entry.nodes === 1 ? "" : "s"}`,
            onClick: () => loadStored(entry),
            starred: isFavorite(entry.name),
            onStar: () => toggleFavorite(entry),
          }));
        });
      }

      panel.appendChild(sectionHeader(`Restore · ${activeWorkflowName()}`));
      if (!snaps.length) {
        const empty = document.createElement("div");
        Object.assign(empty.style, { padding: "8px", color: "rgba(180,190,220,0.55)" });
        empty.textContent = "No snapshots yet — they appear as you work.";
        panel.appendChild(empty);
      } else {
        snaps.forEach((snap, i) => {
          panel.appendChild(makeRow({
            primary: relTime(snap.time),
            secondary: `${snap.nodes} node${snap.nodes === 1 ? "" : "s"}${i === 0 ? " · latest" : ""}`,
            onClick: () => restoreSnapshot(snap),
          }));
        });
      }
    }

    function positionPanel() {
      const r = zone.getBoundingClientRect();
      panel.style.visibility = "hidden";
      panel.style.display = "block";
      const pw = panel.offsetWidth;
      const ph = panel.offsetHeight;
      let left = r.left;
      let top = r.top - ph - 8;        // prefer above the zone
      if (top < 8) top = r.bottom + 8; // fall back to below
      left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
      top = Math.max(8, Math.min(top, window.innerHeight - ph - 8));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.visibility = "visible";
    }

    function openPanel() {
      renderPanel();
      positionPanel();
      panelOpen = true;
    }
    function closePanel() {
      panel.style.display = "none";
      panelOpen = false;
    }

    zone.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (panelOpen) closePanel(); else openPanel();
    });

    document.addEventListener("mousedown", (e) => {
      if (panelOpen && !panel.contains(e.target) && !zone.contains(e.target)) closePanel();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && panelOpen) closePanel();
    });

    // --- helpers ---
    function setVisual(state) {
      if (state === "hover") {
        zone.style.opacity = String(HOVER_OPACITY);
        zone.style.transform = "scale(1.12)";
        zone.style.borderColor = "rgba(120,160,255,0.9)";
        zone.style.background = "rgba(40,50,90,0.7)";
        tip.style.opacity = "1";
      } else if (state === "drop") {
        zone.style.opacity = String(DROP_OPACITY);
        zone.style.transform = "scale(1.18)";
        zone.style.borderColor = "rgba(80,220,120,0.95)";
        zone.style.background = "rgba(30,70,50,0.75)";
        tip.style.opacity = "0";
      } else {
        zone.style.opacity = String(IDLE_OPACITY);
        zone.style.transform = "scale(1)";
        zone.style.borderColor = "rgba(180,180,255,0.6)";
        zone.style.background = "rgba(30,30,50,0.55)";
        tip.style.opacity = "0";
      }
    }

    function flashFeedback(success) {
      if (success) {
        zone.style.borderColor = "rgba(80,220,120,0.95)";
        zone.style.background = "rgba(30,100,50,0.8)";
        icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"
          fill="none" stroke="rgba(80,220,120,0.95)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>`;
      } else {
        zone.style.borderColor = "rgba(255,80,80,0.9)";
        zone.style.background = "rgba(100,30,30,0.8)";
        icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"
          fill="none" stroke="rgba(255,100,100,0.95)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>`;
      }
      setTimeout(() => {
        // restore upload icon
        icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"
          fill="none" stroke="rgba(200,200,255,0.85)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>`;
        setVisual("idle");
      }, FEEDBACK_MS);
    }

    // --- process a dropped file ---
    // opts.append => merge into the current canvas instead of replacing it
    async function processFile(file, opts = {}) {
      const append = !!opts.append;
      try {
        // JSON workflow file
        if (file.name?.endsWith(".json") || file.type === "application/json") {
          const text = await file.text();
          const json = JSON.parse(text);
          // Could be a raw workflow or an API format with embedded workflow
          const workflow = json.workflow || json;
          if (append) {
            takeSnapshot();
            mergeIntoCurrent(workflow);
            flashFeedback(true);
            return;
          }
          takeSnapshot();
          app.loadGraphData(workflow);
          recordRecent(file.name);
          flashFeedback(true);
          return;
        }

        // Image file — delegate to ComfyUI's built-in handleFile
        // which extracts workflow from PNG metadata, WebP, etc.
        // (append isn't supported for images — handleFile always replaces)
        if (file.type?.startsWith("image/") ||
            /\.(png|jpg|jpeg|webp|svg|bmp|gif)$/i.test(file.name || "")) {
          if (typeof app.handleFile === "function") {
            if (append) console.warn("[WorkflowDropZone] Append isn't supported for images — loading normally.");
            takeSnapshot();
            await app.handleFile(file);
            recordRecent(file.name);
            flashFeedback(true);
            return;
          }
        }

        // Unknown — still try handleFile as a fallback
        if (typeof app.handleFile === "function") {
          takeSnapshot();
          await app.handleFile(file);
          recordRecent(file.name);
          flashFeedback(true);
          return;
        }

        console.warn("[WorkflowDropZone] Unsupported file:", file.name);
        flashFeedback(false);
      } catch (err) {
        console.error("[WorkflowDropZone] Error processing file:", err);
        flashFeedback(false);
      }
    }

    // --- drag & drop on the zone ---
    let dragCounter = 0;

    zone.addEventListener("dragenter", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter++;
      setVisual("hover");
    });

    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
    });

    zone.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        setVisual("idle");
      }
    });

    zone.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      setVisual("drop");

      const append = e.shiftKey || e.altKey; // hold Shift/Alt to merge instead of replace

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        await processFile(files[0], { append });
      } else {
        // Maybe a URL or text was dropped — try to fetch it
        const url = e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain");
        if (url && url.startsWith("http")) {
          try {
            const resp = await fetch(url);
            const blob = await resp.blob();
            const name = url.split("/").pop() || "dropped";
            const file = new File([blob], name, { type: blob.type });
            await processFile(file, { append });
          } catch (err) {
            console.error("[WorkflowDropZone] Failed to fetch dropped URL:", err);
            flashFeedback(false);
          }
        } else {
          flashFeedback(false);
        }
      }
    });

    // --- click to open file picker ---
    zone.addEventListener("click", () => {
      if (suppressClick) { suppressClick = false; return; } // ignore click after a drag
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,.png,.jpg,.jpeg,.webp,.svg,.bmp,.gif";
      input.onchange = async () => {
        if (input.files && input.files.length > 0) {
          setVisual("drop");
          await processFile(input.files[0]);
        }
      };
      input.click();
    });

    // --- mouse hover (not drag) ---
    zone.addEventListener("mouseenter", () => {
      if (dragCounter === 0) {
        zone.style.opacity = String(HOVER_OPACITY);
        tip.style.opacity = "1";
      }
    });
    zone.addEventListener("mouseleave", () => {
      if (dragCounter === 0) {
        zone.style.opacity = String(IDLE_OPACITY);
        tip.style.opacity = "0";
      }
    });

    // --- global drag highlight: make the zone more visible when
    //     a file is being dragged anywhere over the window ---
    let globalDragCounter = 0;

    window.addEventListener("dragenter", () => {
      globalDragCounter++;
      if (globalDragCounter === 1) {
        zone.style.opacity = String(0.6);
        zone.style.transform = "scale(1.05)";
      }
    });

    window.addEventListener("dragleave", () => {
      globalDragCounter--;
      if (globalDragCounter <= 0) {
        globalDragCounter = 0;
        if (dragCounter === 0) setVisual("idle");
      }
    });

    window.addEventListener("drop", () => {
      globalDragCounter = 0;
      // zone's own drop handler takes care of its own state
    });

    // --- paste to load (Ctrl/Cmd+V): image with embedded workflow, or JSON text ---
    window.addEventListener("paste", async (e) => {
      // don't hijack paste while the user is typing in a field
      const t = e.target;
      const tag = (t?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || t?.isContentEditable) return;

      const items = e.clipboardData?.items || [];
      for (const it of items) {
        if (it.type?.startsWith("image/")) {
          const file = it.getAsFile();
          if (file) {
            e.preventDefault();
            setVisual("drop");
            await processFile(file);
            return;
          }
        }
      }

      const text = e.clipboardData?.getData("text/plain");
      if (text && text.trim().startsWith("{")) {
        try {
          const json = JSON.parse(text);
          if (json?.nodes || json?.workflow?.nodes) {
            e.preventDefault();
            setVisual("drop");
            takeSnapshot();
            app.loadGraphData(json.workflow || json);
            recordRecent("pasted workflow");
            flashFeedback(true);
          }
        } catch (err) {
          /* not workflow JSON — let the paste fall through */
        }
      }
    });

    // --- cross-tab sync: another browser tab changed shared state ---
    window.addEventListener("storage", (e) => {
      if (!e.key) return;
      if (panelOpen && (e.key === RECENT_KEY || e.key === FAV_KEY || e.key.startsWith(SNAP_PREFIX))) {
        renderPanel(); // reflect the other tab's recents/favorites/snapshots live
      }
    });

    console.log("[WorkflowDropZone] Initialized - drop zone in lower-left corner");
  },
});
