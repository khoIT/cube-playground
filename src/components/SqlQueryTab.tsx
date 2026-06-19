import { useEffect } from 'react';
import { Query } from '@cubejs-client/core';
import { QueryRenderer } from '@cubejs-client/react';
import { format } from 'sql-formatter';

import PrismCode from '../PrismCode';
import { runnableSqlFromSqlQuery } from '../utils/inline-sql-params';
import { deriveTrinoSourceSql, sourceSqlNote } from '../utils/rollup-source-sql';
import { FatalError } from '../components/Error/FatalError';

type SqlEmitterOnChangeProps = {
  sql?: string;
  loading: boolean;
};

type SqlEmitterProps = {
  loading: boolean;
  sql?: string;
  onChange: (props: SqlEmitterOnChangeProps) => void;
};

function SqlEmitter({ sql, loading, onChange }: SqlEmitterProps) {
  useEffect(() => {
    onChange({ sql, loading });
  }, [sql, loading]);

  return null;
}

type SqlQueryTabProps = {
  query: Query;
  onChange: (sql: { loading: boolean; value?: string }) => void;
};

export default function SqlQueryTab({ query, onChange }: SqlQueryTabProps) {
  return (
    <QueryRenderer
      loadSql="only"
      query={query}
      render={({ sqlQuery, loadingState, error }) => {
        if (error) {
          return <FatalError error={error} />;
        }

        // in the case of a compareDateRange query the SQL will be the same
        const [query] = Array.isArray(sqlQuery) ? sqlQuery : [sqlQuery];
        // When the query is served from a pre-aggregation, query.sql() is
        // CubeStore dialect against a rollup table absent from the source DB.
        // Prefer a derived Trino source SQL so the tab stays paste-and-run;
        // otherwise inline the bound `?` params on the normal source SQL.
        const derived = query && deriveTrinoSourceSql(query.rawQuery?.());
        const runnable = derived ? derived.sql : query && runnableSqlFromSqlQuery(query);
        let value = runnable && format(runnable);
        if (value && derived) value = `${sourceSqlNote(derived)}\n\n${value}`;

        return (
          <>
            <PrismCode code={value} />
            <SqlEmitter
              loading={loadingState.isLoading}
              sql={value}
              onChange={({ sql, loading }) => {
                onChange({
                  loading,
                  value: sql,
                });
              }}
            />
          </>
        );
      }}
    />
  );
}
