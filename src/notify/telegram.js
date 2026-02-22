export class TelegramNotifier {
  constructor({ token, chatId }) {
    this.token = token;
    this.chatId = chatId;
  }

  isEnabled() {
    return Boolean(this.token && this.chatId);
  }

  async send(message) {
    if (!this.isEnabled()) {
      return;
    }

    const endpoint = `https://api.telegram.org/bot${this.token}/sendMessage`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: this.chatId,
        text: message,
        disable_web_page_preview: true
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram API error ${response.status}: ${body}`);
    }
  }
}
