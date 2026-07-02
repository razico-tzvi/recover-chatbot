import { ChatWidget } from "./ui.js";

function init(): void {
  void new ChatWidget().mount().catch((err) => console.error("[chat-widget]", err));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
