import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const nativeCss = read('src/styles/mobile-native-workspace.css');
const main = read('src/main.tsx');
const shell = read('src/components/AppShell.tsx');
const dashboard = read('src/pages/DesktopHomePage.tsx');
const operations = read('src/pages/OperationsPage.tsx');
const shipment = read('src/pages/ShipmentFirstPage.tsx');
const pdf = read('src/pages/PdfStudioPage.tsx');
const fileManager = read('src/pages/FileManagerPage.tsx');
const settings = read('src/pages/SettingsEnterprisePage.tsx');

describe('native mobile workspace screens', () => {
  it('loads the mobile screen system after legacy responsive and palette styles', () => {
    expect(main).toContain("import './styles/mobile-native-workspace.css';");
    expect(main.indexOf("import './styles/mobile-native-workspace.css';"))
      .toBeGreaterThan(main.indexOf("import './styles/ocean-pro-ui.css';"));
  });

  it('uses a safe-area-aware, fixed iPhone bottom tab bar and a sticky app header', () => {
    expect(nativeCss).toContain('.app-shell.is-touch-layout .app-mobilebar');
    expect(nativeCss).toContain('position: sticky !important');
    expect(nativeCss).toContain('.app-mobile-viewport-dock');
    expect(nativeCss).toContain('inset-block-end: 0 !important');
    expect(nativeCss).toContain('env(safe-area-inset-bottom)');
    expect(shell).toContain('aria-label="پیمایش اصلی برنامه"');
    expect(shell).toContain('native-bottom-tabs');
    expect(shell).toContain('<span>چت</span>');
  });

  it('adds visible mobile dashboard shortcuts as real navigation links', () => {
    expect(dashboard).toContain('className="mobile-dashboard-actions"');
    expect(dashboard).toContain('to="/operations?tab=pre-declaration"');
    expect(dashboard).toContain('to="/registration-orders"');
    expect(dashboard).toContain('to="/pdf-studio"');
    expect(dashboard).toContain('to="/file-manager"');
    expect(nativeCss).toContain('.mobile-dashboard-actions > a');
  });

  it('has dedicated mobile form layouts for operations and new shipment', () => {
    expect(operations).toContain('className="operations-page');
    expect(shipment).toContain('className="shipment-first-page');
    expect(nativeCss).toContain('.operations-page');
    expect(nativeCss).toContain('.shipment-first-page');
    expect(nativeCss).toContain('min-width: 0 !important');
  });

  it('has dedicated mobile workspaces for PDF Studio, file manager and settings', () => {
    expect(pdf).toContain('className="mobile-app-page pdf-studio-page');
    expect(fileManager).toContain('className="mobile-app-page file-manager-page');
    expect(settings).toContain('className="settings-enterprise-page');
    expect(nativeCss).toContain('.pdf-studio-page nav[aria-label="بخش‌های PDF Studio"]');
    expect(nativeCss).toContain('.file-manager-page');
    expect(nativeCss).toContain('.settings-enterprise-page');
  });

  it('keeps the touch shell and chat composer compatible with the mobile dock', () => {
    expect(nativeCss).toContain('.app-shell.is-chat-route .chat-standalone');
    expect(nativeCss).toContain('height: var(--chat-visible-height, 100dvh) !important');
    expect(nativeCss).toContain('.app-shell.is-chat-route .chat-composer');
  });
});
