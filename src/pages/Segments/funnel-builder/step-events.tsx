/**
 * Step 1 — Events picker.
 *
 * Shows a typeahead populated from the ordered-funnel cube's step_name
 * filter-only dimension values (fetched via Cube /members endpoint).
 * Selected events are displayed as a drag-reorder list (HTML5 DnD, no new deps).
 * Min 2, max 6 events.
 */

import { ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { GripVertical, X } from 'lucide-react';
import { useAppContext } from '../../../hooks';
import { useSecurityContext } from '../../../hooks/security-context';
import { useCubejsApi } from '../../../hooks/cubejs-api';
import styles from './funnel-builder.module.css';

export const MIN_EVENTS = 2;
export const MAX_EVENTS = 6;

interface Props {
  cubeName: string;
  events: string[];
  onChange: (events: string[]) => void;
}

interface CubejsLike {
  members(
    dimension: string,
    type: 'dimensions' | 'measures',
  ): Promise<{ name: string }[]>;
}

/** Fetches possible values for step_name via Cube /meta members. */
async function fetchStepNames(
  cubejsApi: CubejsLike,
  cubeName: string,
): Promise<string[]> {
  try {
    const results = await cubejsApi.members(`${cubeName}.step_name`, 'dimensions');
    return results.map((r) => r.name).filter(Boolean);
  } catch {
    return [];
  }
}

export function StepEvents({ cubeName, events, onChange }: Props): ReactElement {
  const { apiUrl } = useAppContext();
  const { currentToken } = useSecurityContext();
  const cubejsApi = useCubejsApi(apiUrl ?? null, currentToken ?? null);

  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeOption, setActiveOption] = useState(-1);
  const [loadingOptions, setLoadingOptions] = useState(false);

  // Drag state — track which index is being dragged and which is hovered
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Load step name options once on mount
  useEffect(() => {
    if (!cubejsApi) return;
    setLoadingOptions(true);
    fetchStepNames(cubejsApi as unknown as CubejsLike, cubeName).then((names) => {
      setOptions(names);
      setLoadingOptions(false);
    });
  }, [cubejsApi, cubeName]);

  const filtered = options
    .filter((o) => !events.includes(o) && o.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 50);

  // Allow free-text entry when no matching option exists
  const canAddFreeText =
    query.trim().length > 0 &&
    !events.includes(query.trim()) &&
    !filtered.includes(query.trim()) &&
    events.length < MAX_EVENTS;

  const addEvent = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || events.includes(trimmed) || events.length >= MAX_EVENTS) return;
      onChange([...events, trimmed]);
      setQuery('');
      setShowDropdown(false);
      setActiveOption(-1);
    },
    [events, onChange],
  );

  const removeEvent = (idx: number) => {
    const next = events.filter((_, i) => i !== idx);
    onChange(next);
  };

  // ── HTML5 drag-and-drop reorder ──────────────────────────────
  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragEnter = (idx: number) => setOverIdx(idx);

  const handleDrop = (toIdx: number) => {
    if (dragIdx === null || dragIdx === toIdx) {
      setDragIdx(null);
      setOverIdx(null);
      return;
    }
    const next = [...events];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(toIdx, 0, moved);
    onChange(next);
    setDragIdx(null);
    setOverIdx(null);
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    setOverIdx(null);
  };

  // ── Keyboard navigation in dropdown ─────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const totalOpts = filtered.length + (canAddFreeText ? 1 : 0);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveOption((p) => Math.min(p + 1, totalOpts - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveOption((p) => Math.max(p - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeOption >= 0 && activeOption < filtered.length) {
        addEvent(filtered[activeOption]);
      } else if (canAddFreeText && activeOption === filtered.length) {
        addEvent(query.trim());
      } else if (canAddFreeText) {
        addEvent(query.trim());
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>Choose events in order</h3>
      <p className={styles.cardDesc}>
        Add 2–6 events. Drag rows to reorder. The funnel measures users who
        completed all steps in the sequence you define.
      </p>

      {/* Ordered event list */}
      {events.length > 0 && (
        <div className={styles.eventList} role="list" aria-label="Funnel steps">
          {events.map((ev, idx) => (
            <div
              key={ev}
              role="listitem"
              className={[
                styles.eventRow,
                dragIdx === idx ? styles.eventRowDragging : '',
                overIdx === idx && dragIdx !== idx ? styles.eventRowOver : '',
              ]
                .filter(Boolean)
                .join(' ')}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragEnter={() => handleDragEnter(idx)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(idx)}
              onDragEnd={handleDragEnd}
              aria-grabbed={dragIdx === idx}
            >
              <span className={styles.eventDragHandle} aria-hidden>
                <GripVertical size={14} />
              </span>
              <span className={styles.eventIndex}>{idx + 1}</span>
              <span className={styles.eventName} title={ev}>{ev}</span>
              <button
                type="button"
                className={styles.eventRemove}
                onClick={() => removeEvent(idx)}
                aria-label={`Remove ${ev}`}
              >
                <X size={13} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add event typeahead */}
      {events.length < MAX_EVENTS && (
        <div className={styles.addEventRow}>
          <div className={styles.typeaheadWrap} style={{ flex: 1 }}>
            <input
              ref={inputRef}
              type="text"
              className={styles.typeaheadInput}
              placeholder={
                loadingOptions
                  ? 'Loading events…'
                  : options.length > 0
                  ? 'Search or type an event name…'
                  : 'Type an event name…'
              }
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowDropdown(true);
                setActiveOption(-1);
              }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              onKeyDown={handleKeyDown}
              aria-label="Add event"
              aria-autocomplete="list"
              aria-expanded={showDropdown && (filtered.length > 0 || canAddFreeText)}
            />
            {showDropdown && (filtered.length > 0 || canAddFreeText) && (
              <div className={styles.typeaheadDropdown} role="listbox">
                {filtered.map((opt, i) => (
                  <button
                    key={opt}
                    type="button"
                    role="option"
                    aria-selected={i === activeOption}
                    className={[
                      styles.typeaheadOption,
                      i === activeOption ? styles.typeaheadOptionActive : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onMouseDown={() => addEvent(opt)}
                  >
                    {opt}
                  </button>
                ))}
                {canAddFreeText && (
                  <button
                    type="button"
                    role="option"
                    aria-selected={activeOption === filtered.length}
                    className={[
                      styles.typeaheadOption,
                      activeOption === filtered.length ? styles.typeaheadOptionActive : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onMouseDown={() => addEvent(query.trim())}
                  >
                    Add &ldquo;{query.trim()}&rdquo;
                  </button>
                )}
                {filtered.length === 0 && !canAddFreeText && (
                  <span className={styles.typeaheadEmpty}>No matching events</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {events.length >= MAX_EVENTS && (
        <p className={styles.cardDesc} style={{ color: 'var(--text-muted)' }}>
          Maximum of {MAX_EVENTS} events reached.
        </p>
      )}
    </div>
  );
}
