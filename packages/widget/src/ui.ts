import { LIMITS, type ChatMessage } from "@recover/shared";
import { widgetConfig } from "./config.js";
import { streamChat } from "./api.js";

const SESSION_KEY = "recover_chat_session";

function getSessionId(): string {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() ?? String(Date.now() + Math.random())).slice(0, LIMITS.maxSessionIdChars);
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return String(Date.now());
  }
}

/** Escape HTML, then turn bare URLs into safe links and newlines into <br>. */
function renderText(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`,
  );
  return linked.replace(/\n/g, "<br>");
}

const styles = (color: string) => `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .launcher {
    position: fixed; bottom: 20px; right: 20px; width: 60px; height: 60px;
    border-radius: 50%; background: ${color}; color: #fff; border: none;
    cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,.25); font-size: 26px;
    display: flex; align-items: center; justify-content: center; z-index: 2147483646;
  }
  .launcher:hover { filter: brightness(1.05); }
  .panel {
    position: fixed; bottom: 92px; right: 20px; width: 380px; max-width: calc(100vw - 40px);
    height: 560px; max-height: calc(100vh - 120px); background: #fff; border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0,0,0,.28); display: none; flex-direction: column;
    overflow: hidden; z-index: 2147483647;
  }
  .panel.open { display: flex; }
  .header { background: ${color}; color: #fff; padding: 14px 16px; font-weight: 600; font-size: 15px;
    display: flex; align-items: center; justify-content: space-between; }
  .header button { background: transparent; border: none; color: #fff; cursor: pointer; font-size: 20px; line-height: 1; }
  .messages { flex: 1; overflow-y: auto; padding: 16px; background: #f7f8fa; }
  .msg { max-width: 84%; padding: 10px 13px; border-radius: 14px; margin-bottom: 10px; font-size: 14px; line-height: 1.45; white-space: normal; word-wrap: break-word; }
  .msg.user { background: ${color}; color: #fff; margin-left: auto; border-bottom-right-radius: 4px; }
  .msg.assistant { background: #fff; color: #1a1a1a; border: 1px solid #e6e8eb; border-bottom-left-radius: 4px; }
  .msg a { color: inherit; text-decoration: underline; }
  .status { font-size: 12px; color: #6b7280; margin: 0 0 10px 2px; font-style: italic; }
  .footer { border-top: 1px solid #eef0f2; padding: 10px; background: #fff; }
  .row { display: flex; gap: 8px; }
  textarea { flex: 1; resize: none; border: 1px solid #d8dbe0; border-radius: 10px; padding: 9px 11px; font-size: 14px; max-height: 96px; outline: none; }
  textarea:focus { border-color: ${color}; }
  .send { background: ${color}; color: #fff; border: none; border-radius: 10px; padding: 0 16px; cursor: pointer; font-size: 14px; font-weight: 600; }
  .send:disabled { opacity: .5; cursor: default; }
  .human { background: none; border: none; color: ${color}; cursor: pointer; font-size: 12px; margin-top: 6px; padding: 2px; }
  .dots span { animation: blink 1.2s infinite; }
  .dots span:nth-child(2) { animation-delay: .2s; }
  .dots span:nth-child(3) { animation-delay: .4s; }
  @keyframes blink { 0%, 60%, 100% { opacity: .2; } 30% { opacity: 1; } }
`;

export class ChatWidget {
  private readonly sessionId = getSessionId();
  private readonly messages: ChatMessage[] = [];
  private root!: ShadowRoot;
  private panel!: HTMLDivElement;
  private list!: HTMLDivElement;
  private input!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private statusEl: HTMLDivElement | null = null;
  private streaming = false;
  private opened = false;

  mount(): void {
    if (!widgetConfig.apiBase) {
      console.error("[chat-widget] Missing data-api attribute on the script tag.");
      return;
    }
    const host = document.createElement("div");
    host.id = "recover-chat-widget";
    document.body.appendChild(host);
    this.root = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = styles(widgetConfig.color);
    this.root.appendChild(style);

    const launcher = document.createElement("button");
    launcher.className = "launcher";
    launcher.setAttribute("aria-label", "Open chat");
    launcher.textContent = "💬";
    launcher.onclick = () => this.toggle();
    this.root.appendChild(launcher);

    this.panel = document.createElement("div");
    this.panel.className = "panel";
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-label", widgetConfig.title);
    this.panel.innerHTML = `
      <div class="header"><span>${escapeAttr(widgetConfig.title)}</span><button aria-label="Close chat">×</button></div>
      <div class="messages"></div>
      <div class="footer">
        <div class="row">
          <textarea rows="1" placeholder="Type your message…" aria-label="Message"></textarea>
          <button class="send">Send</button>
        </div>
        <button class="human">Talk to a human</button>
      </div>`;
    this.root.appendChild(this.panel);

    this.list = this.panel.querySelector(".messages")!;
    this.input = this.panel.querySelector("textarea")!;
    this.sendBtn = this.panel.querySelector(".send")!;
    this.panel.querySelector(".header button")!.addEventListener("click", () => this.toggle());
    this.sendBtn.addEventListener("click", () => this.send());
    this.panel.querySelector(".human")!.addEventListener("click", () => {
      this.input.value = "I'd like to talk to a human, please.";
      this.send();
    });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });
  }

  private toggle(): void {
    this.opened = !this.opened;
    this.panel.classList.toggle("open", this.opened);
    if (this.opened) {
      if (this.list.childElementCount === 0) {
        this.addBubble("assistant", widgetConfig.greeting);
      }
      this.input.focus();
    }
  }

  private addBubble(role: "user" | "assistant", text: string): HTMLDivElement {
    const el = document.createElement("div");
    el.className = `msg ${role}`;
    el.innerHTML = renderText(text);
    this.list.appendChild(el);
    this.scrollDown();
    return el;
  }

  private setStatus(label: string | null): void {
    if (!label) {
      this.statusEl?.remove();
      this.statusEl = null;
      return;
    }
    if (!this.statusEl) {
      this.statusEl = document.createElement("div");
      this.statusEl.className = "status";
      this.list.appendChild(this.statusEl);
    }
    this.statusEl.textContent = label;
    this.scrollDown();
  }

  private scrollDown(): void {
    this.list.scrollTop = this.list.scrollHeight;
  }

  private async send(): Promise<void> {
    if (this.streaming) return;
    const text = this.input.value.trim().slice(0, LIMITS.maxUserMessageChars);
    if (!text) return;

    this.input.value = "";
    this.messages.push({ role: "user", content: text });
    this.addBubble("user", text);

    this.streaming = true;
    this.sendBtn.disabled = true;
    this.setStatus("Thinking");

    let assistantEl: HTMLDivElement | null = null;
    let assistantText = "";
    const ensureBubble = () => {
      if (!assistantEl) assistantEl = this.addBubble("assistant", "");
      return assistantEl;
    };

    const history = this.messages.slice(-LIMITS.maxHistoryMessages);

    await streamChat(widgetConfig.apiBase, this.sessionId, history, (event) => {
      switch (event.type) {
        case "text":
          this.setStatus(null);
          assistantText += event.delta;
          ensureBubble().innerHTML = renderText(assistantText);
          this.scrollDown();
          break;
        case "tool_status":
          this.setStatus(event.label);
          break;
        case "done":
          this.setStatus(null);
          if (assistantText.trim()) {
            this.messages.push({ role: "assistant", content: assistantText });
          }
          break;
        case "error":
          this.setStatus(null);
          ensureBubble().innerHTML = renderText(
            assistantText ? assistantText + "\n\n" + event.message : event.message,
          );
          break;
      }
    });

    this.streaming = false;
    this.sendBtn.disabled = false;
    this.input.focus();
  }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
