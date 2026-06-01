-- Pinned-chart parity: persist the exact QueryBuilder chart spec on a tile and
-- the full Cube load response in its cache, so a dashboard tile renders through
-- the same chart engine as the playground (chart type + pivot + series).
--
-- chart_type  : full Cube chart type (line|bar|area|table|number|pie). viz_type
--               stays for back-compat + the lightweight legacy renderer.
-- pivot_config: serialised Cube PivotConfig (row/column member distribution).
-- resp_json   : the whole Cube /load response (annotation + data) so the client
--               can rebuild a real ResultSet and call chartPivot(pivotConfig).
--               Legacy rows_json stays for KPI/table + legacy tiles.

ALTER TABLE dashboard_tiles ADD COLUMN chart_type TEXT;
ALTER TABLE dashboard_tiles ADD COLUMN pivot_config TEXT;

ALTER TABLE dashboard_tile_cache ADD COLUMN resp_json TEXT;
