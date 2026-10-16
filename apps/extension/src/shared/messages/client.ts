import type { BackgroundMessage, TabMessage } from './protocol';

export function sendToBackground<Response>(message: BackgroundMessage): Promise<Response> {
  return chrome.runtime.sendMessage(message) as Promise<Response>;
}

export function sendToTab<Response>(tabId: number, message: TabMessage): Promise<Response> {
  return chrome.tabs.sendMessage(tabId, message) as Promise<Response>;
}
