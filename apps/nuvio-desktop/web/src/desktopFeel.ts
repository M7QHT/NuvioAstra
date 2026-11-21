// Makes the webview behave like a desktop app instead of a browser page:
// - horizontal lists (catalog rows, Continue watching, cast…) scroll by holding the left mouse
//   button and dragging; a drag never opens the title under the pointer;
// - no browser context menu (except in text fields, for copy/paste) and no "ghost" image when an
//   image or link is dragged.
// Text fields, sliders, selects and the player controls keep their normal behavior.

const DRAG_THRESHOLD = 6;

/** Text fields only (copy/paste menu); sliders, checkboxes and buttons are not. */
function isTextField(el: Element | null): boolean {
  return !!el?.closest(
    'textarea, [contenteditable="true"], input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="password"], input[type="url"], input[type="tel"], input[type="number"]',
  );
}

/** Controls whose own mouse handling must not start a drag of the row. */
function isEditable(el: Element | null): boolean {
  return !!el?.closest('input, textarea, select, [contenteditable="true"]');
}

/** Nearest ancestor that scrolls horizontally (has more content than width). */
function horizontalScroller(start: Element | null): HTMLElement | null {
  for (let el = start as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
    // Elements with their own drag handling (Live TV filters) and the player are left alone.
    if (el.classList.contains("drag-scroll") || el.classList.contains("controls") || el.classList.contains("full-player")) return null;
    if (el.scrollWidth > el.clientWidth + 1) {
      const overflow = getComputedStyle(el).overflowX;
      if (overflow === "auto" || overflow === "scroll") return el;
    }
  }
  return null;
}

export function installDesktopFeel() {
  let target: HTMLElement | null = null;
  let startX = 0;
  let startScroll = 0;
  let dragging = false;
  let pointerId = -1;
  let snap = "";

  document.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || isEditable(e.target as Element)) return;
    const el = horizontalScroller(e.target as Element);
    if (!el) return;
    target = el;
    startX = e.clientX;
    startScroll = el.scrollLeft;
    dragging = false;
    pointerId = e.pointerId;
  });

  document.addEventListener("pointermove", (e) => {
    if (!target || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    if (!dragging) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      dragging = true;
      snap = target.style.scrollSnapType;
      target.style.scrollSnapType = "none";
      target.style.scrollBehavior = "auto";
      target.classList.add("is-dragging");
      document.body.classList.add("drag-scrolling");
    }
    target.scrollLeft = startScroll - dx;
    e.preventDefault();
  });

  const end = (e: PointerEvent) => {
    if (!target || e.pointerId !== pointerId) return;
    const el = target;
    target = null;
    if (!dragging) return;
    el.classList.remove("is-dragging");
    document.body.classList.remove("drag-scrolling");
    el.style.scrollBehavior = "";
    // Restore snapping after the drag, so the row settles on a card.
    requestAnimationFrame(() => {
      el.style.scrollSnapType = snap;
    });
    // The click that follows a drag must not open the card under the pointer.
    const swallow = (c: MouseEvent) => {
      c.preventDefault();
      c.stopPropagation();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
  };
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);

  // No browser context menu outside text fields.
  document.addEventListener("contextmenu", (e) => {
    if (!isTextField(e.target as Element)) e.preventDefault();
  });
  // No dragging of images / links (the browser's drag ghost).
  document.addEventListener("dragstart", (e) => {
    if (!isTextField(e.target as Element)) e.preventDefault();
  });
}
