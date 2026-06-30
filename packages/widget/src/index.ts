import { ChatWidget } from "./ui.js";

function init(): void {
  new ChatWidget().mount();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
