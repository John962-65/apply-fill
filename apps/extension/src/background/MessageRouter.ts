export type MessageHandler = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
) => Promise<unknown> | undefined;

export class MessageRouter {
  private readonly handlers = new Map<string, MessageHandler>();

  register(type: string, handler: MessageHandler): void {
    this.handlers.set(type, handler);
  }

  attach(): void {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const type =
        typeof message === 'object' && message !== null && 'type' in message
          ? String((message as { type: unknown }).type)
          : '';
      const handler = this.handlers.get(type);
      if (handler === undefined) {
        return undefined;
      }
      const result = handler(message, sender);
      if (result === undefined) {
        return undefined;
      }
      void result.then(
        (value) => sendResponse(value),
        (error: unknown) =>
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
      return true;
    });
  }
}
