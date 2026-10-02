import { safeJsonForScript } from '../bridge/injected';
import { isSameOrigin } from '../url';

export const PAGE_READY_TYPE = 'pos.shell.ready';

// Presentation only; these messages never authorize a printer operation.
export function isPageReadyMessage(
  data: string,
  url: string,
  origin: string,
): boolean {
  if (data.length > 512 || !isSameOrigin(url, origin)) return false;
  try {
    const value: unknown = JSON.parse(data);
    if (typeof value !== 'object' || value === null) return false;
    const message = value as Record<string, unknown>;
    return message.type === PAGE_READY_TYPE && message.origin === origin;
  } catch {
    return false;
  }
}

// Older deployments have no hydrated-page signal. Wait for the compositor
// after onLoad, without polling the DOM or forcing synchronous layout.
export function buildPagePaintScript(origin: string): string {
  return `(function(){
    if(window.top!==window.self || location.origin!==${safeJsonForScript(
      origin,
    )}) return;
    requestAnimationFrame(function(){requestAnimationFrame(function(){
      if(location.origin===${safeJsonForScript(
        origin,
      )} && document.body && document.body.childElementCount && window.ReactNativeWebView){
        window.ReactNativeWebView.postMessage(JSON.stringify({type:${safeJsonForScript(
          PAGE_READY_TYPE,
        )},origin:location.origin}));
      }
    });});
  })();true;`;
}
