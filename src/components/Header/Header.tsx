import { MenuOutlined } from '@ant-design/icons';
import { Dropdown, Layout, Menu } from 'antd';
import { BookOpen, LayoutDashboard, Sparkles, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMediaQuery } from 'react-responsive';
import { Link } from 'react-router-dom';
import styled from 'styled-components';

import { BrandBlock } from './brand-block';
import { NavPill } from './nav-pill';
import { RightCluster } from './right-cluster';

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

const RightClusterSlot = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
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
  const { t } = useTranslation();
  const isDesktopOrLaptop = useMediaQuery({ query: '(min-width: 992px)' });
  const isMobileOrTable = useMediaQuery({ query: '(max-width: 991px)' });

  return (
    <StyledHeader>
      <BrandBlock />

      <Spacer />

      {isDesktopOrLaptop && (
        <PillRow>
          <NavPill
            to="/build"
            icon={LayoutDashboard}
            active={isActive(selectedKeys, '/build')}
          >
            {t('nav.playground')}
          </NavPill>
          <NavPill
            to="/metrics/new?v=2"
            icon={Sparkles}
            active={isActive(selectedKeys, '/metrics/new')}
          >
            {t('nav.newMetric')}
          </NavPill>
          <NavPill
            to="/catalog"
            icon={BookOpen}
            active={isActive(selectedKeys, '/catalog')}
          >
            {t('nav.catalog')}
          </NavPill>
          <NavPill
            to="/segments"
            icon={Users}
            active={isActive(selectedKeys, '/segments')}
          >
            {t('nav.segments')}
          </NavPill>
        </PillRow>
      )}

      <Spacer />

      {isDesktopOrLaptop && (
        <RightClusterSlot>
          <RightCluster />
        </RightClusterSlot>
      )}

      {isMobileOrTable && (
        <Dropdown
          overlay={
            <Menu>
              <Menu.Item key="/build">
                <Link to="/build">{t('nav.playground')}</Link>
              </Menu.Item>
              <Menu.Item key="/metrics/new">
                <Link to="/metrics/new?v=2">{t('nav.newMetric')}</Link>
              </Menu.Item>
              <Menu.Item key="/catalog">
                <Link to="/catalog">{t('nav.catalog')}</Link>
              </Menu.Item>
              <Menu.Item key="/segments">
                <Link to="/segments">{t('nav.segments')}</Link>
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
