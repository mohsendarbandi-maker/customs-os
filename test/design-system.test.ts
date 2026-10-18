import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const tokens = read('src/styles/design-system.css');
const html = read('index.html');
const entry = read('src/main.tsx');
const fontFace = read('public/fonts/font-face.css');
const ui = read('src/components/ui/index.ts');
const primitives = read('src/components/ui/primitives.tsx');
const overlays = read('src/components/ui/overlays.tsx');
const drafts = read('src/components/FormDraftIndicator.tsx');
const shell = read('src/components/AppShell.tsx');

describe('Customs OS shared design system', () => {
  it('uses semantic tokens mapped to existing theme and per-user accent settings', () => {
    for (const token of [
      '--ds-color-bg', '--ds-color-surface', '--ds-color-surface-muted',
      '--ds-color-text', '--ds-color-text-muted', '--ds-color-border',
      '--ds-color-primary', '--ds-color-success', '--ds-color-warning', '--ds-color-danger',
      '--ds-space-1', '--ds-space-2', '--ds-space-3', '--ds-space-4',
      '--ds-radius-sm', '--ds-radius-md', '--ds-radius-lg',
      '--ds-shadow-sm', '--ds-shadow-md', '--ds-control-height',
    ]) {
      expect(tokens).toContain(token);
    }
    expect(tokens).toContain('var(--bg');
    expect(tokens).toContain('var(--surface');
    expect(tokens).toContain('var(--text');
    expect(tokens).toContain('var(--primary');
    expect(entry.indexOf("import './styles/design-system.css';")).toBeGreaterThan(
      entry.indexOf("import './styles/mobile-polish.css';"),
    );
  });

  it('self-hosts and preloads Vazirmatn with a local font-face and bundled OFL license', () => {
    expect(html).toContain('href="/fonts/Vazirmatn-Variable.woff2"');
    expect(html).toContain('href="/fonts/font-face.css"');
    expect(html).not.toContain('cdn.jsdelivr.net/gh/rastikerdar');
    expect(fontFace).toContain('url("./Vazirmatn-Variable.woff2")');
    expect(fontFace).toContain('font-weight: 100 900');
  });

  it('exports shared controls and layouts instead of defining per-section variations', () => {
    for (const component of [
      'Button', 'Input', 'Textarea', 'Select', 'Card', 'CardHeader', 'CardBody',
      'CardFooter', 'ListItem', 'Badge', 'Avatar', 'Modal', 'BottomSheet',
      'Toast', 'EmptyState', 'Skeleton', 'SkeletonList', 'PageHeader',
    ]) {
      expect(ui).toContain(component);
    }
    expect(drafts).toContain("import { Badge, Button, type BadgeTone } from './ui'");
    expect(shell).toContain("import { Avatar } from './ui'");
    expect(shell).toContain('<Avatar name={profile?.full_name || \'کاربر\'}');
  });

  it('preserves accessible target sizes, mobile input sizing, keyboard/focus, safe-area and reduced-motion behavior', () => {
    expect(tokens).toContain('--ds-control-height: 44px');
    expect(tokens).toContain('font-size: 16px');
    expect(tokens).toContain(':focus-visible');
    expect(tokens).toContain('prefers-reduced-motion: reduce');
    expect(tokens).toContain('env(safe-area-inset-top)');
    expect(tokens).toContain('env(safe-area-inset-bottom)');
    expect(overlays).toContain('aria-modal="true"');
    expect(overlays).toContain("event.key === 'Escape'");
    expect(overlays).toContain('focusableSelector');
    expect(primitives).toContain('aria-describedby={describedBy}');
    expect(primitives).toContain('aria-invalid={error ? true : ariaInvalid}');
  });
});
