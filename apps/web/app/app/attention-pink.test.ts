import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');
const tokens = read('../../../../packages/ui/src/tokens.css');
const tok = (name: string) => new RegExp(`^\\s*${name}:\\s*(#[0-9a-f]{6});`, 'm').exec(tokens)?.[1];

// Dash.dc, 24 Nov: attention is hot pink, not amber. What is not attention stays amber.
describe('attention is pink', () => {
  it('draws the urgent stat card, the warn banner and a receipt not received in pink, with dark twins', () => {
    expect(tok('--calm-urgent')).toBe('#fdf0f7');
    expect(tok('--calm-urgent-ring')).toBe('#f6cfe5');
    expect(tok('--calm-urgent-label')).toBe('#ae1e74');
    expect(tok('--calm-urgent-ink')).toBe('#8e1660');
    expect(tok('--calm-urgent-hover-ring')).toBe('#efa9d2');
    expect(tokens).toContain('--calm-urgent-hover-shadow: 0 8px 20px -14px rgba(174, 30, 116, 0.35);');
    expect(tok('--calm-dark-urgent')).toBe('#3a1430');
    expect(tok('--calm-dark-urgent-ring')).toBe('#5c1f4a');
    expect(tok('--calm-dark-urgent-label')).toBe('#f7a8d4');
    const banner = read('_ui/alert-slot.module.css');
    expect(banner).toMatch(/--ban-warn:\s*var\(--calm-urgent\);/);
    expect(banner).toMatch(/\.ban\[data-tone='warn'\] \{[^}]*--ban-bg:\s*var\(--ban-warn\);[^}]*--ban-edge:\s*var\(--ban-warn-edge\);/);
  });

  it('draws the waiting tag in pink, with dark twins', () => {
    expect(tok('--tag-attn')).toBe('#fce6f2');
    expect(tok('--tag-attn-ink')).toBe('#ae1e74');
    expect(tok('--calm-dark-tag-attn')).toBe('#4a1636');
    expect(tok('--calm-dark-tag-attn-ink')).toBe('#f7a8d4');
    expect(read('_ui/inbox.module.css')).toMatch(/\.tag\[data-tone='wait'\] \{\s*background: var\(--tag-attn\);\s*color: var\(--tag-attn-ink\);/);
  });

  it('keeps amber on the to-check row avatar and the warn banner icon badge', () => {
    expect(tok('--tag-wait')).toBe('#fdf0d8');
    expect(tok('--tag-wait-ink')).toBe('#a1640c');
    expect(read('_ui/inbox.module.css')).toMatch(/\.av\[data-tone='wait'\] \{\s*background: var\(--tag-wait\);\s*color: var\(--tag-wait-ink\);/);
    const banner = read('_ui/alert-slot.module.css');
    expect(banner).toMatch(/--ban-badge:\s*color-mix\(in srgb, var\(--ban-wait\) 85%, var\(--ban-wait-ink\) 15%\);/);
  });
});
