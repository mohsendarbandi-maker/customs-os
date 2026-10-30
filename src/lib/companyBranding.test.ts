import { describe, expect, it } from 'vitest';
import { buildCompanyLogoSvg, buildCompanyStampSvg, deriveCompanyLogoMark, normalizeBrandColor } from './companyBranding';

describe('company branding generator', () => {
  it('derives a short mark from Persian or English company names', () => {
    expect(deriveCompanyLogoMark('شرکت کشتیرانی خزر')).toBe('شک');
    expect(deriveCompanyLogoMark('North Sea Logistics')).toBe('NS');
    expect(deriveCompanyLogoMark('')).toBe('ش');
  });

  it('normalizes colours and falls back from invalid values', () => {
    expect(normalizeBrandColor('#12abEF')).toBe('#12ABEF');
    expect(normalizeBrandColor('url(javascript:alert(1))')).toBe('#173B57');
  });

  it('builds a safe vector logo without injecting untrusted markup', () => {
    const svg = buildCompanyLogoSvg({ companyName: '<script>alert(1)</script>', mark: '<s>', color: '#123456', style: 'shield' });
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('&lt;s&gt;');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('M120 24');
  });

  it('builds a rectangular stamp that includes the company registration number', () => {
    const svg = buildCompanyStampSvg({ companyName: 'شرکت حمل و نقل', registrationNumber: '۱۲۳۴۵', color: '#243B61' });
    expect(svg).toContain('<rect');
    expect(svg).toContain('شماره ثبت: ۱۲۳۴۵');
    expect(svg).toContain('شرکت حمل و نقل');
  });
});