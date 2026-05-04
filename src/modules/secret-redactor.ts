/** Combined regex avoids multiple passes and redundant string allocations. */
const REDACT_RE =
  /sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|ghr_[a-zA-Z0-9]{36}|ghs_[a-zA-Z0-9]{36}|0x[0-9a-fA-F]{64}\b|-----BEGIN [A-Z ]+-----[\s\S]+?-----END [A-Z ]+-----|(?:password|passwd|secret|api[_-]?key|private[_-]?key|token|auth(?:orization)?)\s*[:=]\s*\S{8,}|Authorization:\s*Bearer\s+\S+|(?:PRIVATE[_ ]KEY|SECRET|API_KEY|TOKEN|PASSWORD)\s*=\s*[^\s\n]{8,}/gi;

export function redact(content: string): string {
  return content.replace(REDACT_RE, '[REDACTED]');
}
