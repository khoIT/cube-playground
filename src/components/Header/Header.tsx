import { MenuOutlined } from '@ant-design/icons';
import { Dropdown, Layout, Menu } from 'antd';
import { Database, LayoutDashboard } from 'lucide-react';
import { useMediaQuery } from 'react-responsive';
import { Link } from 'react-router-dom';
import styled from 'styled-components';

import { BrandBlock } from './brand-block';
import { NavPill } from './nav-pill';

const StyledHeader = styled(Layout.Header)`
  && {
    background-color: var(--bg-card);
    color: var(--text-primary);
    border-bottom: 1px solid var(--border-card);
    padding: 0 16px;
    line-height: 1;
    height: 44px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
`;

const PillRow = styled.nav`
  display: inline-flex;
  align-items: center;
  gap: 4px;
`;

const Spacer = styled.div`
  flex: 1;
`;

const MobileTrigger = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: var(--bg-card);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  color: var(--text-primary);
  cursor: pointer;

  &:hover {
    border-color: var(--brand);
    color: var(--brand);
  }
`;

type Props = {
  selectedKeys: string[];
};

function isActive(selectedKeys: string[], to: string): boolean {
  return selectedKeys.some((key) => key === to || key.startsWith(`${to}/`));
}

export default function Header({ selectedKeys }: Props) {
  const isDesktopOrLaptop = useMediaQuery({ query: '(min-width: 992px)' });
  const isMobileOrTable = useMediaQuery({ query: '(max-width: 991px)' });

  return (
    <StyledHeader>
      <BrandBlock />

      {isDesktopOrLaptop && (
        <PillRow>
          <NavPill
            to="/build"
            icon={LayoutDashboard}
            active={isActive(selectedKeys, '/build')}
          >
            Playground
          </NavPill>
          <NavPill
            to="/schema"
            icon={Database}
            active={isActive(selectedKeys, '/schema')}
          >
            Models
          </NavPill>
        </PillRow>
      )}

      <Spacer />

      {isMobileOrTable && (
        <Dropdown
          overlay={
            <Menu>
              <Menu.Item key="/build">
                <Link to="/build">Playground</Link>
              </Menu.Item>
              <Menu.Item key="/schema">
                <Link to="/schema">Models</Link>
              </Menu.Item>
            </Menu>
          }
        >
          <MobileTrigger aria-label="Open navigation">
            <MenuOutlined />
          </MobileTrigger>
        </Dropdown>
      )}
    </StyledHeader>
  );
}
