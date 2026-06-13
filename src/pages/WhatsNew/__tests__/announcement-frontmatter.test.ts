/**
 * Frontmatter parser for What's New release markdown — scalar parse, kind
 * coercion, slug/date fallbacks, and newest-first sorting.
 */

import { describe, it, expect } from 'vitest';
import { splitFrontmatter, parseAnnouncement, sortAnnouncements } from '../announcement-frontmatter';

describe('splitFrontmatter', () => {
  it('splits a frontmatter block from the body', () => {
    const { data, body } = splitFrontmatter('---\ntitle: Hi\nkind: new\n---\nHello **world**');
    expect(data).toEqual({ title: 'Hi', kind: 'new' });
    expect(body).toBe('Hello **world**');
  });

  it('treats a file with no frontmatter as all-body', () => {
    const { data, body } = splitFrontmatter('Just body, no block');
    expect(data).toEqual({});
    expect(body).toBe('Just body, no block');
  });

  it('strips surrounding quotes from values', () => {
    const { data } = splitFrontmatter('---\ntitle: "Quoted Title"\n---\nx');
    expect(data.title).toBe('Quoted Title');
  });
});

describe('parseAnnouncement', () => {
  it('maps frontmatter into an Announcement', () => {
    const a = parseAnnouncement('---\nid: x\ntitle: X\ndate: 2026-06-14\nkind: improved\narea: Segments\ndeepLink: /admin\n---\nbody', 'file-slug');
    expect(a).toMatchObject({ id: 'x', title: 'X', date: '2026-06-14', kind: 'improved', area: 'Segments', deepLink: '/admin', body: 'body' });
  });

  it('falls back to the filename slug for a missing id and defaults kind/area', () => {
    const a = parseAnnouncement('---\ntitle: No Id\n---\nbody', 'my-slug');
    expect(a.id).toBe('my-slug');
    expect(a.kind).toBe('new'); // unknown/absent kind → 'new'
    expect(a.area).toBe('General');
  });

  it('coerces an unrecognised kind to new', () => {
    expect(parseAnnouncement('---\nkind: bogus\n---\nb', 's').kind).toBe('new');
  });
});

describe('sortAnnouncements', () => {
  it('orders newest date first', () => {
    const items = [
      parseAnnouncement('---\nid: a\ndate: 2026-01-01\n---\n', 'a'),
      parseAnnouncement('---\nid: b\ndate: 2026-06-01\n---\n', 'b'),
      parseAnnouncement('---\nid: c\ndate: 2026-03-01\n---\n', 'c'),
    ];
    expect(sortAnnouncements(items).map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });
});
