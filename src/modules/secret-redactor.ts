const PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /ghp_[a-zA-Z0-9]{36}/g,
  /ghr_[a-zA-Z0-9]{36}/g,
  /0x[0-9a-fA-F]{64}\b/g,
  /-----BEGIN [A-Z ]+-----[\s\S]+?-----END [A-Z ]+-----/g,
  /(?:password|passwd|secret|api[_-]?key|private[_-]?key|token|auth(?:orization)?)\s*[:=]\s*\S{8,}/gi,
  /Authorization:\s*Bearer\s+\S+/gi,
  /(?:PRIVATE KEY|SECRET|API_KEY|TOKEN|PASSWORD)\s*=\s*[^\s\n]{8,}/g,
];

export function redact(content: string): string {
  let result = content;
  for (const pattern of PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}
