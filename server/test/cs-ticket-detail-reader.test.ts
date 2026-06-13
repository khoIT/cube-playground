/**
 * Unit tests for the CS-ticket detail PURE layer (signals + assembly). Trino I/O
 * is not exercised here — the SQL shape was validated live against jus_vn (832);
 * these lock the derivations + caveat handling over fixtures modeled on the 6
 * real jus_vn tickets (ms timestamps, HTML content, reopen, ★1 + feedback, a
 * benign Web-portal login, and an account-security takeover ticket).
 */

import { describe, it, expect } from 'vitest';
import {
  stripHtml,
  htmlSnippet,
  firstResponseLatencyMin,
  buildSecurityFlag,
  assembleDetails,
  toTicketSummary,
  type ScalarRow,
  type FlatLabel,
  type FlatMessage,
  type FlatRating,
} from '../src/lakehouse/cs-ticket-detail-signals.js';

function scalar(over: Partial<ScalarRow> = {}): ScalarRow {
  return {
    uid: '3326386729574596608',
    ticketId: '26530832',
    source: 'Web',
    formName: 'Gửi Yêu Cầu Hỗ Trợ',
    openedAt: '2026-02-05',
    status: 'Closed',
    priority: 5,
    staffDept: 'CTS',
    staffDomain: 'khuongnb2',
    createdAt: '2026-02-05 15:04:41.000000',
    firstResponseAt: '2026-02-05 15:27:13.000000',
    reopenCount: 2,
    sentFirst: 'Neutral',
    sentLast: 'Negative',
    sentChange: 'Change Status',
    loginInfo: 'meomeoonthefloor',
    tagName: '#NTH-Question',
    ratingScore: 1,
    vip: { tierId: 4, vipGameProportion: 0.75, loginChannel: null, gender: null },
    ...over,
  };
}

describe('stripHtml / htmlSnippet', () => {
  it('strips tags + decodes entities + collapses whitespace', () => {
    expect(stripHtml('<p>Chào&nbsp;Bạn,</p>\n  <b>OK</b> &amp; thanks')).toBe('Chào Bạn, OK & thanks');
    expect(stripHtml(null)).toBe('');
  });
  it('truncates with ellipsis past max', () => {
    expect(htmlSnippet('<p>abcdefghij</p>', 5)).toBe('abcde…');
    expect(htmlSnippet('<p>abc</p>', 5)).toBe('abc');
  });
});

describe('firstResponseLatencyMin', () => {
  it('computes minutes between created and first response', () => {
    expect(firstResponseLatencyMin('2026-02-05 15:04:41.000000', '2026-02-05 15:27:13.000000')).toBe(23);
  });
  it('returns null when either timestamp is missing/unparseable', () => {
    expect(firstResponseLatencyMin(null, '2026-02-05 15:27:13')).toBeNull();
    expect(firstResponseLatencyMin('nope', '2026-02-05 15:27:13')).toBeNull();
  });
});

describe('buildSecurityFlag', () => {
  const secLabel: FlatLabel[] = [{ ticketId: 't', category: 'Account', name: 'Account_SecurityIssue' }];
  it('flags takeover: login_info ≠ uid AND account/security label', () => {
    expect(buildSecurityFlag('105450116336727645020', '3383821913410994176', secLabel)).toBe(true);
  });
  it('does NOT flag a benign differing login (Web-portal username, no security label)', () => {
    const benign: FlatLabel[] = [{ ticketId: 't', category: 'Payment', name: 'Payment_Question' }];
    expect(buildSecurityFlag('meomeoonthefloor', '3326386729574596608', benign)).toBe(false);
  });
  it('does NOT flag when login_info equals uid even with a security label', () => {
    expect(buildSecurityFlag('3383821913410994176', '3383821913410994176', secLabel)).toBe(false);
  });
  it('does NOT flag when login_info is null', () => {
    expect(buildSecurityFlag(null, 'u', secLabel)).toBe(false);
  });
});

describe('assembleDetails', () => {
  const labels: FlatLabel[] = [
    { ticketId: '26530832', category: 'Payment', name: 'Payment_ItemsNotReceived' },
    { ticketId: '26530832', category: 'Gameplay', name: 'Gameplay_Question' },
  ];
  const messages: FlatMessage[] = [
    { ticketId: '26530832', isCustomer: false, at: '2026-02-05 15:27:13', text: 'staff 1', attachments: [] },
    { ticketId: '26530832', isCustomer: true, at: '2026-02-05 15:33:45', text: 'player 1', attachments: ['a.jpg'] },
    { ticketId: '26530832', isCustomer: false, at: '2026-02-05 17:27:00', text: 'staff last', attachments: [] },
  ];
  const ratings: FlatRating[] = [
    { ticketId: '26530832', rating: 1, feedback: 'check the account', feedbackOptions: ['Unclear response content'] },
  ];

  it('assembles one detail per scalar with grouped sub-entities + signals', () => {
    const [d] = assembleDetails([scalar()], labels, messages, ratings, 80);
    expect(d.ticketId).toBe('26530832');
    expect(d.labels).toHaveLength(2);
    expect(d.latencyMin).toBe(23);
    expect(d.reopenCount).toBe(2);
    expect(d.sentiment).toEqual({ first: 'Neutral', last: 'Negative', change: 'Change Status' });
    expect(d.tags).toEqual(['#NTH-Question']);
    expect(d.rating?.rating).toBe(1);
    expect(d.vip?.tierId).toBe(4);
    expect(d.securityFlag).toBe(false); // benign Web-portal login
  });

  it('sorts messages chronologically and preserves attachments', () => {
    const [d] = assembleDetails([scalar()], [], messages, [], 80);
    expect(d.messages.map((m) => m.text)).toEqual(['staff 1', 'player 1', 'staff last']);
    expect(d.messages[1].attachments).toEqual(['a.jpg']);
    expect(d.messagesTruncated).toBe(false);
  });

  it('caps messages to the most recent N and flags truncation', () => {
    const [d] = assembleDetails([scalar()], [], messages, [], 2);
    expect(d.messages).toHaveLength(2);
    expect(d.messagesTruncated).toBe(true);
    // keeps the LATEST 2, still chronological
    expect(d.messages.map((m) => m.text)).toEqual(['player 1', 'staff last']);
  });

  it('returns vip:null when all customers_v2 fields are absent', () => {
    const [d] = assembleDetails([scalar({ vip: null })], [], [], [], 80);
    expect(d.vip).toBeNull();
  });
});

describe('toTicketSummary', () => {
  it('drops the message array but keeps count + stripped snippet', () => {
    const messages: FlatMessage[] = [
      { ticketId: '26530832', isCustomer: false, at: '2026-02-05 15:27:13', text: 'first', attachments: [] },
      { ticketId: '26530832', isCustomer: true, at: '2026-02-05 17:27:00', text: 'the latest message', attachments: [] },
    ];
    const [d] = assembleDetails([scalar()], [], messages, [], 80);
    const s = toTicketSummary(d);
    expect(s).not.toHaveProperty('messages');
    expect(s.messageCount).toBe(2);
    expect(s.lastMessageSnippet).toBe('the latest message');
    expect(s.securityFlag).toBe(false);
    expect(s.labels).toEqual(d.labels);
  });
});
