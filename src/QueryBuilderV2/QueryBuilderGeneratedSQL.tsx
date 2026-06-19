import { PlayCircleOutlined } from '@ant-design/icons';
import { Alert, Block, Button, tasty } from '@cube-dev/ui-kit';
import { QueryRenderer } from '@cubejs-client/react';
import sqlFormatter from 'sql-formatter';

import { runnableSqlFromSqlQuery } from '../utils/inline-sql-params';
import { deriveTrinoSourceSql, sourceSqlNote } from '../utils/rollup-source-sql';
import { CopyButton } from './components/CopyButton';
import { useDeepMemo } from './hooks';
import { useQueryBuilderContext } from './context';
import { ScrollableCodeContainer } from './components/ScrollableCodeContainer';
import { TabPaneWithToolbar } from './components/TabPaneWithToolbar';

const EditSQLQueryButton = tasty(Button, {
  size: 'small',
  icon: <PlayCircleOutlined />,
  children: 'Open in SQL Runner',
});

export function QueryBuilderGeneratedSQL() {
  let { query, queryHash, cubeApi, isQueryEmpty, verificationError, openSqlRunner } =
    useQueryBuilderContext();

  return useDeepMemo(() => {
    if (!isQueryEmpty) {
      if (verificationError) {
        return (
          <Block padding="1x">
            <Alert theme="danger">{verificationError.toString()}</Alert>
          </Block>
        );
      }

      return (
        <QueryRenderer
          loadSql="only"
          query={query}
          cubeApi={cubeApi}
          render={({ sqlQuery, error }) => {
            if (error) {
              return (
                <Block padding="1x">
                  <Alert theme="danger">{error.toString()}</Alert>
                </Block>
              );
            }

            // in the case of a compareDateRange query the SQL will be the same
            const [query] = Array.isArray(sqlQuery) ? sqlQuery : [sqlQuery];
            // When the query is served from a pre-aggregation, query.sql() is
            // CubeStore dialect against a rollup table absent from the source DB.
            // Prefer a derived Trino source SQL so the tab stays paste-and-run;
            // otherwise inline the bound `?` params on the normal source SQL.
            const derived = query && deriveTrinoSourceSql(query.rawQuery?.());
            const runnable = derived ? derived.sql : query && runnableSqlFromSqlQuery(query);
            let value = runnable && sqlFormatter.format(runnable);
            if (value && derived) value = `${sourceSqlNote(derived)}\n\n${value}`;

            return (
              <TabPaneWithToolbar
                actions={
                  <>
                    <CopyButton type="secondary" value={value}>
                      Copy
                    </CopyButton>
                    {openSqlRunner ? (
                      <EditSQLQueryButton onPress={() => openSqlRunner?.(value)} />
                    ) : undefined}
                  </>
                }
              >
                <ScrollableCodeContainer value={value} />
              </TabPaneWithToolbar>
            );
          }}
        />
      );
    } else {
      return (
        <Block padding="1x">
          <Alert theme="note">Compose a query to see a generated SQL.</Alert>
        </Block>
      );
    }
  }, [queryHash, verificationError]);
}
