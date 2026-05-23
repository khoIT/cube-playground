import { describe, expect, it } from 'vitest';

import i18n from '../index';

describe('i18n init', () => {
  it('registers en + vi resources under the common namespace', () => {
    expect(i18n.hasResourceBundle('en', 'common')).toBe(true);
    expect(i18n.hasResourceBundle('vi', 'common')).toBe(true);
  });

  it('returns english nav.playground by default', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('nav.playground')).toBe('Playground');
  });

  it('switches to vietnamese on changeLanguage("vi")', async () => {
    await i18n.changeLanguage('vi');
    expect(i18n.t('nav.playground')).toBe('Sân chơi');
    expect(i18n.t('nav.newDataModel')).toBe('Mô hình dữ liệu mới');
    expect(i18n.t('nav.catalog')).toBe('Danh mục');
  });

  it('updates document.documentElement.lang on language change', async () => {
    await i18n.changeLanguage('vi');
    expect(document.documentElement.getAttribute('lang')).toBe('vi');
    await i18n.changeLanguage('en');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });
});
