/**
 * FieldChip — clickable inline pill linking to the Schema Cartographer
 * (phase-02). Rendered in place of a `{{field:cube.member}}` token in
 * assistant message text.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { T } from '../../../shell/theme';
import { postChatAudit } from '../../../api/chat-audit-client';

interface Props {
  fqn: string;
  label?: string;
}

export function FieldChip({ fqn, label }: Props) {
  const href = `/catalog/schema?focus=${encodeURIComponent(fqn)}`;
  return (
    <Link
      to={href}
      onClick={() => postChatAudit({ kind: 'field_chip_clicked', detail: { fqn } })}
      style={{
        display: 'inline-block',
        padding: '0 6px',
        marginInline: 1,
        borderRadius: 4,
        background: T.brandSoft,
        color: T.brand,
        fontSize: 12.5,
        textDecoration: 'none',
        fontFamily: T.fMono,
      }}
    >
      {label ?? fqn}
    </Link>
  );
}
