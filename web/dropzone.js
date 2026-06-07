import { app } from "/scripts/app.js";

app.registerExtension({
  name: "ComfyUI.WorkflowDropZone",

  async setup() {
    // --- constants ---
    const SIZE = 72;
    const MARGIN = 18;
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
      bottom: `${MARGIN}px`,
      left: `${MARGIN}px`,
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
    tip.textContent = "Drop image / workflow here";
    zone.appendChild(tip);

    document.body.appendChild(zone);

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
    async function processFile(file) {
      try {
        // JSON workflow file
        if (file.name?.endsWith(".json") || file.type === "application/json") {
          const text = await file.text();
          const json = JSON.parse(text);
          if (json?.nodes || json?.workflow?.nodes) {
            // Could be a raw workflow or an API format with embedded workflow
            const workflow = json.workflow || json;
            app.loadGraphData(workflow);
            flashFeedback(true);
            return;
          }
          // Maybe it's an API-format prompt — try loading anyway
          app.loadGraphData(json);
          flashFeedback(true);
          return;
        }

        // Image file — delegate to ComfyUI's built-in handleFile
        // which extracts workflow from PNG metadata, WebP, etc.
        if (file.type?.startsWith("image/") ||
            /\.(png|jpg|jpeg|webp|svg|bmp|gif)$/i.test(file.name || "")) {
          if (typeof app.handleFile === "function") {
            await app.handleFile(file);
            flashFeedback(true);
            return;
          }
        }

        // Unknown — still try handleFile as a fallback
        if (typeof app.handleFile === "function") {
          await app.handleFile(file);
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

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        await processFile(files[0]);
      } else {
        // Maybe a URL or text was dropped — try to fetch it
        const url = e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain");
        if (url && url.startsWith("http")) {
          try {
            const resp = await fetch(url);
            const blob = await resp.blob();
            const name = url.split("/").pop() || "dropped";
            const file = new File([blob], name, { type: blob.type });
            await processFile(file);
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

    console.log("[WorkflowDropZone] Initialized - drop zone in lower-left corner");
  },
});
