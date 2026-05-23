/**
 * @deprecated Removed from the header. ⌘K now opens SmartSearchOverlay
 * (mounted globally in App.tsx via SmartSearchProvider). File kept for one
 * release cycle in case external embedders import it; delete after that.
 */
import { Search } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';

const Wrap = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px;
  min-width: 220px;
  background: var(--bg-muted);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-pill);
  color: var(--text-secondary);
  transition: border-color 120ms ease, box-shadow 120ms ease;

  &:focus-within {
    border-color: var(--brand);
    box-shadow: 0 0 0 2px rgba(240, 90, 34, 0.12);
  }
`;

const Input = styled.input`
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 13px;

  &::placeholder {
    color: var(--text-muted);
  }
`;

const Kbd = styled.kbd`
  display: inline-flex;
  align-items: center;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  color: var(--text-muted);
`;

export function SearchBox() {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function isEditable(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        target.isContentEditable === true
      );
    }

    function onKeyDown(e: KeyboardEvent) {
      const isK = e.key === 'k' || e.key === 'K';
      const isShortcut = isK && (e.metaKey || e.ctrlKey);
      if (!isShortcut) return;
      if (isEditable(e.target) && e.target !== inputRef.current) return;
      e.preventDefault();
      inputRef.current?.focus();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <Wrap>
      <Search size={14} strokeWidth={2} aria-hidden />
      <Input
        ref={inputRef}
        type="search"
        aria-label={t('search.placeholder')}
        placeholder={t('search.placeholder')}
      />
      <Kbd aria-hidden>{t('search.shortcut')}</Kbd>
    </Wrap>
  );
}
