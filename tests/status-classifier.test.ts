import { describe, it, expect } from 'vitest';
import { classifyStatus } from '../src/modules/status-classifier.js';

describe('status-classifier', () => {
  it('returns "draft" by default for short general content', () => {
    expect(classifyStatus('Short text here.', 'chat')).toBe('draft');
  });

  it('returns "review_needed" for plan type', () => {
    expect(classifyStatus('A detailed plan for the project.', 'plan')).toBe('review_needed');
  });

  it('returns "review_needed" for design_note type', () => {
    expect(classifyStatus('Design decisions made today.', 'design_note')).toBe('review_needed');
  });

  it('returns "review_needed" when content contains [plan] marker', () => {
    expect(classifyStatus('[plan] Implement the auth module first.', 'chat')).toBe('review_needed');
  });

  it('returns "review_needed" when content contains [spec] marker', () => {
    expect(classifyStatus('[spec] The API should return JSON-LD.', 'chat')).toBe('review_needed');
  });

  it('returns "needs_sources" for vulnerability_finding without source link', () => {
    expect(classifyStatus(
      'This function is vulnerable to reentrancy attacks.',
      'vulnerability_finding',
    )).toBe('needs_sources');
  });

  it('returns "draft" for vulnerability_finding WITH source link', () => {
    expect(classifyStatus(
      'Reentrancy found. See https://example.com/audit for reference.',
      'vulnerability_finding',
    )).toBe('draft');
  });

  it('returns "needs_sources" for long chat content without sources', () => {
    const longContent = 'a'.repeat(301);
    expect(classifyStatus(longContent, 'chat')).toBe('needs_sources');
  });

  it('returns "draft" for long content WITH https link', () => {
    const content = 'a'.repeat(250) + ' see https://example.com for more info.';
    expect(classifyStatus(content, 'chat')).toBe('draft');
  });

  it('override beats all rules', () => {
    expect(classifyStatus('[plan] design stuff', 'plan', 'validated')).toBe('validated');
    expect(classifyStatus('short', 'chat', 'ready_to_share')).toBe('ready_to_share');
    expect(classifyStatus('long vulnerability finding text '.repeat(15), 'vulnerability_finding', 'draft')).toBe('draft');
  });

  it('[source] marker prevents needs_sources', () => {
    const longContent = 'a'.repeat(310) + ' [source] Internal audit report';
    expect(classifyStatus(longContent, 'chat')).toBe('draft');
  });
});
