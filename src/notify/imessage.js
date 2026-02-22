import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function escapeAppleScriptString(value) {
  return value.replace(/\\/g, "\\\\").replace(/\"/g, '\\"');
}

export class IMessageNotifier {
  constructor({ recipient, service = "iMessage" }) {
    this.recipient = recipient;
    this.service = service;
  }

  isEnabled() {
    return Boolean(this.recipient);
  }

  async send(message) {
    if (!this.isEnabled()) {
      return;
    }

    const safeMessage = escapeAppleScriptString(message);
    const safeRecipient = escapeAppleScriptString(this.recipient);
    const serviceType =
      this.service.toLowerCase() === "sms" ? "SMS" : "iMessage";

    const script = `tell application "Messages"
set targetService to 1st service whose service type = ${serviceType}
send "${safeMessage}" to buddy "${safeRecipient}" of targetService
end tell`;

    try {
      await execFileAsync("osascript", ["-e", script]);
    } catch (error) {
      throw new Error(`iMessage send failed: ${error.message}`);
    }
  }
}
