/**
 * Stage 2A — foundation checks.
 *
 * These tests prove the project is set up as agreed:
 *  - the test runner works;
 *  - SheetJS is exactly 0.20.3 from the official SheetJS CDN (not the outdated npm 0.18.5);
 *  - no AI provider, API key or database client is installed at this stage;
 *  - the screen text says processing is conventional and rule-based.
 *
 * Any spreadsheet created here is SYNTHETIC — NOT REAL COST DATA.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { APP_INFO } from '../../src/appInfo.ts';

const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

const allDependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

describe('test runner', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2);
  });
});

describe('SheetJS dependency', () => {
  it('is pinned to the official SheetJS CDN package 0.20.3 in package.json', () => {
    expect(packageJson.dependencies?.xlsx).toBe('https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz');
  });

  it('is version 0.20.3 when loaded', () => {
    expect(XLSX.version).toBe('0.20.3');
    expect(XLSX.version).toBe(APP_INFO.sheetJsVersion);
  });

  it('reads back a small SYNTHETIC workbook with its sheet name and cell values intact', () => {
    const rows = [
      ['SYNTHETIC — NOT REAL COST DATA'],
      ['No.', 'Description', 'Unit', 'Qty'],
      ['T1', 'SYNTHETIC TEST ITEM 001', 'nr', 10],
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Synthetic Sheet');

    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const reread = XLSX.read(bytes, { type: 'array' });

    expect(reread.SheetNames).toEqual(['Synthetic Sheet']);
    const sheet = reread.Sheets['Synthetic Sheet'];
    expect(sheet?.['B3']?.v).toBe('SYNTHETIC TEST ITEM 001');
    expect(sheet?.['D3']?.v).toBe(10);
  });
});

describe('Phase 2 restrictions', () => {
  it('installs no AI provider SDK (no Anthropic API key is needed)', () => {
    const names = Object.keys(allDependencies);
    expect(names.some((n) => n.includes('anthropic'))).toBe(false);
  });

  it('installs no Supabase client (no database connection at this stage)', () => {
    const names = Object.keys(allDependencies);
    expect(names.some((n) => n.includes('supabase'))).toBe(false);
  });

  it('labels processing as conventional rule-based, not AI', () => {
    expect(APP_INFO.processingMode).toContain('Conventional rule-based processing');
    expect(APP_INFO.processingMode).toContain('no AI in use');
  });
});
