import {
  LockIcon,
  ThunderboltIcon,
  MoreIcon,
  Panel,
  Space,
  Button,
  Menu,
  MenuTrigger,
  tasty,
} from '@cube-dev/ui-kit';
import { CubeProvider } from '@cubejs-client/react';
import { Card } from 'antd';
import { useLayoutEffect } from 'react';
import { useHistory } from 'react-router-dom';
import styled from 'styled-components';

import { CubeLoader } from '../../atoms';
import { useCloud } from '../../cloud';
import { useAppContext, useCubejsApi, useSecurityContext } from '../../hooks';
import {
  RollupDesignerContext,
  useRollupDesignerContext,
} from '../../rollup-designer';
import { ChartRendererStateProvider } from '../QueryTabs/ChartRendererStateProvider';
import { QueryTabs, QueryTabsProps } from '../QueryTabs/QueryTabs';
import {
  QueryBuilder,
  QueryBuilderProps,
  RequestStatusProps,
} from '../../QueryBuilderV2/index';

import { PreAggregationStatus } from './components/index';
import { PlaygroundVizard } from './playground-vizard';

const StyledCard = styled(Card)`
  border-radius: 0;
  border-bottom: 1px;
  min-height: 100%;
  background: var(--layout-body-background);

  & .ant-card-body {
    padding: 0;
  }
`;

const SettingsButton = tasty(Button, {
  styles: {
    position: 'relative',
  },
});

const ActiveDot = tasty({
  styles: {
    position: 'absolute',
    top: '2px',
    right: '2px',
    width: '6px',
    height: '6px',
    radius: '50%',
    fill: '#success',
    boxShadow: '0 0 0 2px var(--purple-color, #fff)',
  },
});

function RequestStatusComponent({
  isAggregated,
  external,
  extDbType,
  preAggregationType,
}: RequestStatusProps) {
  return (
    <Space direction="vertical" gap="0" placeItems="end" margin="-1x 0">
      <PreAggregationStatus
        preAggregationType={preAggregationType}
        isAggregated={isAggregated}
        external={external}
        extDbType={extDbType}
      />
    </Space>
  );
}

type QueryBuilderContainerProps = Pick<
  QueryBuilderProps,
  | 'defaultQuery'
  | 'initialVizState'
  | 'schemaVersion'
  | 'extra'
  | 'onSchemaChange'
  | 'onQueryChange'
> &
  Pick<QueryTabsProps, 'onTabChange'>;

export function QueryBuilderContainer(props: QueryBuilderContainerProps) {
  const { apiUrl } = useAppContext();
  const {
    currentToken,
    token: securityContextToken,
    setIsModalOpen,
  } = useSecurityContext();

  useLayoutEffect(() => {
    if (apiUrl && currentToken) {
      window['__cubejsPlayground'] = {
        ...window['__cubejsPlayground'],
        apiUrl,
        token: currentToken,
      };
    }
  }, [apiUrl, currentToken]);

  const cubejsApi = useCubejsApi(apiUrl, currentToken);

  if (!cubejsApi) {
    return <CubeLoader />;
  }

  return (
    <CubeProvider cubeApi={cubejsApi}>
      <RollupDesignerContext apiUrl={apiUrl!}>
        <ChartRendererStateProvider>
          <StyledCard bordered={false}>
            <QueryTabsRenderer
              apiUrl={apiUrl!}
              token={currentToken!}
              securityContextToken={securityContextToken}
              extra={props.extra}
              schemaVersion={props.schemaVersion}
              onSchemaChange={props.onSchemaChange}
              onQueryChange={props.onQueryChange}
              onTabChange={props.onTabChange}
              onSecurityContextModalOpen={() => setIsModalOpen(true)}
            />
          </StyledCard>
        </ChartRendererStateProvider>
      </RollupDesignerContext>
    </CubeProvider>
  );
}

type QueryTabsRendererProps = {
  apiUrl: string;
  token: string;
  securityContextToken: string | null;
  onSecurityContextModalOpen: () => void;
} & Pick<
  QueryBuilderProps,
  'schemaVersion' | 'onSchemaChange' | 'onQueryChange' | 'extra'
> &
  Pick<QueryTabsProps, 'onTabChange'>;

function QueryTabsRenderer({
  apiUrl,
  token,
  onQueryChange,
  securityContextToken,
  onSecurityContextModalOpen,
  ...props
}: QueryTabsRendererProps) {
  const { location } = useHistory();
  const { setQuery, toggleModal, isLoading } = useRollupDesignerContext();
  const { isAddRollupButtonVisible } = useCloud();

  const params = new URLSearchParams(location.search);
  const query = JSON.parse(params.get('query') || 'null');

  const rollupVisible =
    isAddRollupButtonVisible == null || isAddRollupButtonVisible;

  const settingsItems: {
    key: string;
    label: string;
    icon: JSX.Element;
    testId: string;
  }[] = [
    {
      key: 'security-context',
      label: `${securityContextToken ? 'Edit' : 'Add'} Security Context`,
      icon: <LockIcon />,
      testId: 'security-context-menuitem',
    },
  ];

  if (rollupVisible) {
    settingsItems.push({
      key: 'add-rollup',
      label: 'Add Rollup to Data Model',
      icon: <ThunderboltIcon />,
      testId: 'add-rollup-menuitem',
    });
  }

  function handleSettingsAction(key: string | number) {
    if (key === 'security-context') {
      onSecurityContextModalOpen();
    } else if (key === 'add-rollup') {
      toggleModal();
    }
  }

  return (
    <QueryTabs
      query={query}
      sidebar={
        <MenuTrigger>
          <SettingsButton
            qa="SettingsDropdown"
            data-testid="settings-dropdown-btn"
            isLoading={isLoading}
            icon={<MoreIcon />}
            size="small"
            type={securityContextToken ? 'primary' : 'secondary'}
          >
            Settings
            {securityContextToken ? <ActiveDot aria-hidden="true" /> : null}
          </SettingsButton>
          <Menu onAction={(key) => handleSettingsAction(key as string)}>
            {settingsItems.map((item) => (
              <Menu.Item
                key={item.key}
                data-testid={item.testId}
                icon={item.icon}
              >
                {item.label}
              </Menu.Item>
            ))}
          </Menu>
        </MenuTrigger>
      }
      onTabChange={(tab) => {
        props.onTabChange?.(tab);
        setQuery(tab.query);
      }}
    >
      {({ id, query, chartType }, saveTab) => (
        <Panel key={id} height="(100vh - 12.5x) (100vh - 12.5x)" fill="#white">
          <QueryBuilder
            apiUrl={apiUrl}
            apiToken={token}
            defaultQuery={query}
            defaultChartType={chartType}
            schemaVersion={props.schemaVersion}
            extra={props.extra ?? null}
            RequestStatusComponent={RequestStatusComponent}
            VizardComponent={PlaygroundVizard}
            onSchemaChange={props.onSchemaChange}
            onQueryChange={(data) => {
              saveTab(data);
              onQueryChange?.(data);
            }}
          />
        </Panel>
      )}
    </QueryTabs>
  );
}
