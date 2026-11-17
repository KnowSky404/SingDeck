import { Code, ConnectError } from "@connectrpc/connect";

// Server text may echo secrets. Only fixed, actionable messages cross into the UI.
export function describeError(error: unknown): string {
  switch (ConnectError.from(error).code) {
    case Code.Unauthenticated:
      return "Authentication failed. Disconnect and check the Bearer token on the entry page.";
    case Code.PermissionDenied:
      return "This instance denied access. Check its access policy.";
    case Code.Unimplemented:
      return "This capability is unavailable on the connected instance.";
    case Code.NotFound:
      return "The requested resource or capability is unavailable.";
    case Code.InvalidArgument:
      return "The instance rejected this request. Check the selected resource.";
    case Code.DeadlineExceeded:
      return "The API timed out. Check the endpoint and connection.";
    case Code.Canceled:
      return "The request was canceled.";
    default:
      return "Connection interrupted. Check endpoint, TLS, CORS and browser local-network permissions.";
  }
}

export function canRetry(error: unknown): boolean {
  return [
    Code.Unavailable,
    Code.Unknown,
    Code.Internal,
    Code.DeadlineExceeded,
    Code.ResourceExhausted,
  ].includes(ConnectError.from(error).code);
}

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
}
