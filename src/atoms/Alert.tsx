import styled from 'styled-components';
import { Alert as AntdAlert } from 'antd';

export const TYPES: any = {
  error: {
    border: 'var(--destructive-border)',
    background: 'var(--destructive-soft)',
    color: 'var(--destructive-ink)',
  },
  warning: {
    border: 'var(--warning-border)',
    background: 'var(--warning-soft)',
  },
  info: {
    border: 'var(--info-border)',
    background: 'var(--info-soft)',
  },
  success: {
    border: 'var(--success-border)',
    background: 'var(--success-soft)',
  },
};

export const Alert: typeof AntdAlert = styled(AntdAlert)`
  && {
    background: ${(props) => TYPES[props.type || 'info'].background};
    border: 1px solid ${(props) => TYPES[props.type || 'info'].border};
    color: ${(props) => (props.type && TYPES[props.type]?.color) || 'inherit'};
    box-sizing: border-box;
    border-radius: 2px;
  }
`;
