// Native messages can start with a connection ID and duration before the logger tag.
const loggerPrefix =
  /^(?:(?:TRACE|DEBUG|INFO|WARN|ERROR|FATAL|PANIC)(?:\[\d+\])? )?(?:\[\d+ [\d.ms]+\] )?(dns|inbound|outbound|router)[:/]/;

export function logSource(text: string) {
  return loggerPrefix.exec(text)?.[1] ?? "other";
}
