(() => {
  "use strict";

  const dialog = document.getElementById("capstone-dialog");
  const mount = document.querySelector("[data-capstone-frame]");
  const exit = document.querySelector("[data-capstone-exit]");
  const status = document.querySelector(".portal-status");
  const triggers = document.querySelectorAll("[data-capstone-open]");
  if (!dialog || !mount || !exit || !status) throw new Error("Capstone portal markup is incomplete.");
  if (typeof dialog.showModal !== "function") return;
  if (window.location.origin !== "https://djaykurtz.github.io") return;

  const origin = window.location.origin;
  const viewer = new URL("/AZLOCAL-POC/viewer/?embed=1", origin);
  let frame = null;
  let loaded = false;
  let returnTo = null;
  let loadTimeout = null;
  let boundDocuments = new WeakSet();
  let boundFrames = new WeakSet();
  const cleanups = [];

  function focusable(scope) {
    const result = [];
    for (const element of scope.querySelectorAll("a[href],button,input,select,textarea,[tabindex],iframe")) {
      if (element.tabIndex < 0 || element.matches(":disabled") || element.closest("[hidden],[inert],[aria-hidden='true']") || !element.getClientRects().length) continue;
      if (element.ownerDocument.defaultView.getComputedStyle(element).visibility === "hidden") continue;
      if (element.tagName === "IFRAME" && element.contentDocument) {
        const children = focusable(element.contentDocument);
        if (children.length) result.push(...children);
        else result.push(element);
      } else result.push(element);
    }
    return result;
  }

  function trapTab(event) {
    if (!dialog.open || event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return;
    if (frame) bindFrameKeys(frame.contentDocument);
    const items = focusable(dialog);
    if (!items.length) return;
    let active = document.activeElement;
    while (active && active.tagName === "IFRAME" && active.contentDocument) active = active.contentDocument.activeElement;
    const index = items.indexOf(active);
    const next = index < 0 ? (event.shiftKey ? items.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + items.length) % items.length;
    event.preventDefault();
    items[next].focus({ preventScroll: true });
  }

  function bindFrameKeys(doc) {
    if (!doc) return;
    if (!boundDocuments.has(doc)) {
      boundDocuments.add(doc);
      doc.addEventListener("keydown", trapTab, true);
      cleanups.push(() => doc.removeEventListener("keydown", trapTab, true));
    }
    for (const child of doc.querySelectorAll("iframe")) {
      if (!boundFrames.has(child)) {
        boundFrames.add(child);
        const onLoad = () => bindFrameKeys(child.contentDocument);
        child.addEventListener("load", onLoad);
        cleanups.push(() => child.removeEventListener("load", onLoad));
      }
      bindFrameKeys(child.contentDocument);
    }
  }

  function send(message) {
    if (frame && frame.contentWindow) frame.contentWindow.postMessage(message, origin);
  }

  function close() {
    if (dialog.open) {
      dialog.close();
      finishClose();
    }
  }

  function finishClose() {
    if (dialog.open || (!frame && !returnTo)) return;
    send({ type: "capstone-viewer:visibility", visible: false });
    window.clearTimeout(loadTimeout);
    loadTimeout = null;
    mount.replaceChildren();
    for (const cleanup of cleanups.splice(0)) cleanup();
    boundDocuments = new WeakSet();
    boundFrames = new WeakSet();
    frame = null;
    loaded = false;
    document.documentElement.classList.remove("capstone-open");
    if (returnTo) {
      returnTo.trigger.focus({ preventScroll: true });
      window.scrollTo({ left: returnTo.x, top: returnTo.y, behavior: "instant" });
      returnTo = null;
    }
  }

  function open(trigger) {
    if (dialog.open) return;
    returnTo = { trigger, x: window.scrollX, y: window.scrollY };
    loaded = false;
    status.textContent = "Loading the guided presentation. Full view opens it on its own page.";
    status.hidden = false;
    frame = document.createElement("iframe");
    frame.title = "Azure Local static presentation with readable viewing guidance";
    frame.allow = "fullscreen";
    frame.src = viewer.href;
    const openedFrame = frame;
    function fail(message) {
      if (frame !== openedFrame) return;
      window.clearTimeout(loadTimeout);
      loadTimeout = null;
      loaded = false;
      status.textContent = message;
      status.hidden = false;
    }
    function checkPresentation() {
      if (frame !== openedFrame) return;
      const doc = openedFrame.contentDocument;
      const guidance = doc && doc.getElementById("viewer");
      const presentation = doc && doc.getElementById("presentation");
      if (!guidance || !presentation) {
        fail("The guided presentation could not load here. Use Full view, or Exit view to return to the portfolio.");
        return;
      }
      const deck = presentation.contentDocument;
      if (!deck || deck.readyState !== "complete") return;
      if (!deck.getElementById("gateGo") || !deck.getElementById("btnNext")) {
        fail("The presentation did not load. Use Full view to open it directly, or Exit view to return.");
        return;
      }
      if (!guidance.getClientRects().length || !presentation.getClientRects().length) return;
      window.clearTimeout(loadTimeout);
      loadTimeout = null;
      loaded = true;
      status.hidden = true;
      bindFrameKeys(doc);
      send({ type: "capstone-viewer:visibility", visible: dialog.open });
    }
    frame.addEventListener("load", () => {
      if (frame !== openedFrame) return;
      const doc = openedFrame.contentDocument;
      const presentation = doc && doc.getElementById("presentation");
      if (presentation) {
        presentation.addEventListener("load", checkPresentation);
        cleanups.push(() => presentation.removeEventListener("load", checkPresentation));
      }
      checkPresentation();
    });
    frame.addEventListener("error", () => {
      fail("The presentation could not load. Use Full view to open it directly, or Exit view to return.");
    });
    mount.replaceChildren(frame);
    document.documentElement.classList.add("capstone-open");
    dialog.showModal();
    exit.focus({ preventScroll: true });
    loadTimeout = window.setTimeout(() => {
      fail("The presentation is taking too long to load. Use Full view to open it directly, or Exit view to return.");
    }, 15000);
    send({ type: "capstone-viewer:visibility", visible: true });
  }

  for (const trigger of triggers) {
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-controls", dialog.id);
    trigger.addEventListener("click", event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      event.preventDefault();
      open(trigger);
    });
  }

  exit.addEventListener("click", close);
  dialog.addEventListener("cancel", event => {
    event.preventDefault();
    if (loaded) send({ type: "capstone-viewer:escape" });
    else close();
  });
  dialog.addEventListener("close", finishClose);
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  });
  dialog.addEventListener("keydown", trapTab, true);
  document.addEventListener("focusin", event => {
    if (dialog.open && !dialog.contains(event.target)) exit.focus({ preventScroll: true });
  });
  window.addEventListener("message", event => {
    if (!dialog.open || !frame || event.origin !== origin || event.source !== frame.contentWindow) return;
    const message = event.data;
    if (!message || typeof message !== "object" || Array.isArray(message)) return;
    if (Object.keys(message).length === 1 && message.type === "capstone-viewer:exit") close();
  });
})();
