import type { ReactElement } from 'react';
import styles from './visuals.module.css';

export interface BreadcrumbItem {
  label: string;
  /** If provided, renders an anchor; otherwise renders plain text. */
  href?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

/** Text-muted breadcrumb trail with "/" separators. */
export function Breadcrumbs({ items }: BreadcrumbsProps): ReactElement {
  return (
    <nav aria-label="Breadcrumb" className={styles.breadcrumbs}>
      {items.map((item, idx) => (
        <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {idx > 0 && <span className={styles.crumbSep} aria-hidden="true">/</span>}
          {item.href != null ? (
            <a href={item.href} className={styles.crumbLink}>
              {item.label}
            </a>
          ) : (
            <span aria-current={idx === items.length - 1 ? 'page' : undefined}>
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
