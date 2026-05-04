import { describe, it, expect } from 'vitest';
import { redact } from '../src/modules/secret-redactor.js';

describe('secret-redactor', () => {
  it('redacts OpenAI-style sk- key', () => {
    const result = redact('Key: sk-abcdefghijklmnopqrstuvwxyz12345');
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('sk-abc');
  });

  it('redacts GitHub PAT ghp_ token', () => {
    const result = redact('token: ghp_' + 'a'.repeat(36));
    expect(result).toContain('[REDACTED]');
  });

  it('redacts Ethereum private key', () => {
    const ethKey = '0x' + 'a'.repeat(64);
    const result = redact(`private key: ${ethKey}`);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('0x' + 'a'.repeat(64));
  });

  it('redacts PEM block', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQ==\n-----END RSA PRIVATE KEY-----';
    const result = redact(pem);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('MIIEowIBAAKCAQ==');
  });

  it('redacts API_KEY=value pattern', () => {
    const result = redact('API_KEY=abc123def456ghi789');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts Authorization Bearer header', () => {
    const result = redact('Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.payload.signature');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts password= pattern', () => {
    const result = redact('password=supersecretpassword123');
    expect(result).toContain('[REDACTED]');
  });

  it('leaves normal research text unchanged', () => {
    const text = 'The reentrancy vulnerability occurs when external calls are made before state updates.';
    expect(redact(text)).toBe(text);
  });

  it('leaves URLs with token in path unchanged', () => {
    const url = 'See https://example.com/docs/getting-started for details.';
    const result = redact(url);
    expect(result).toBe(url);
  });

  it('handles multiple secrets in one string', () => {
    const text = `key: sk-${'x'.repeat(25)} and also ${`0x` + `b`.repeat(64)}`;
    const result = redact(text);
    expect(result).not.toContain('sk-');
    expect(result).not.toContain('0x' + 'b'.repeat(64));
  });
});
