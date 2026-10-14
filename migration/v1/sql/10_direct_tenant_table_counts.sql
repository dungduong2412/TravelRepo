SET NOCOUNT ON;

DECLARE @TenantId uniqueidentifier = TRY_CONVERT(uniqueidentifier, '$(TenantId)');
IF @TenantId IS NULL
  THROW 50001, 'TenantId must be a verified UUID supplied with sqlcmd -v.', 1;

-- Aggregate-only inventory for every table that carries TenantId directly.
-- This intentionally returns table names and counts, never source row values.
DECLARE @Databases table (DatabaseName sysname primary key);
INSERT INTO @Databases(DatabaseName) VALUES
  (N'Emos_Saas'),
  (N'Emos_Administration'),
  (N'Emos_Identity'),
  (N'Emos_MdmService'),
  (N'Emos_Cms'),
  (N'Emos_Aeretha');

CREATE TABLE #Counts (
  DatabaseName sysname not null,
  SchemaName sysname not null,
  TableName sysname not null,
  TenantRows bigint not null,
  TotalRows bigint not null
);

DECLARE @DatabaseName sysname;
DECLARE @SchemaName sysname;
DECLARE @TableName sysname;
DECLARE @Sql nvarchar(max);

DECLARE db_cursor CURSOR LOCAL FAST_FORWARD FOR
  SELECT DatabaseName FROM @Databases ORDER BY DatabaseName;

OPEN db_cursor;
FETCH NEXT FROM db_cursor INTO @DatabaseName;
WHILE @@FETCH_STATUS = 0
BEGIN
  SET @Sql = N'USE ' + QUOTENAME(@DatabaseName) + N';
    SELECT s.name, t.name
    FROM sys.tables AS t
    JOIN sys.schemas AS s ON s.schema_id = t.schema_id
    WHERE EXISTS (
      SELECT 1 FROM sys.columns AS c
      WHERE c.object_id = t.object_id AND c.name = N''TenantId''
    )
    ORDER BY s.name, t.name;';

  CREATE TABLE #TenantTables (SchemaName sysname, TableName sysname);
  INSERT INTO #TenantTables EXEC sys.sp_executesql @Sql;

  DECLARE table_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT SchemaName, TableName FROM #TenantTables ORDER BY SchemaName, TableName;

  OPEN table_cursor;
  FETCH NEXT FROM table_cursor INTO @SchemaName, @TableName;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    SET @Sql = N'INSERT INTO #Counts(DatabaseName, SchemaName, TableName, TenantRows, TotalRows)
      SELECT ' + QUOTENAME(@DatabaseName, '''') + N', '
        + QUOTENAME(@SchemaName, '''') + N', '
        + QUOTENAME(@TableName, '''') + N',
        COALESCE(SUM(CASE WHEN TenantId = @TenantId THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END), CONVERT(bigint, 0)),
        COUNT_BIG(*)
      FROM ' + QUOTENAME(@DatabaseName) + N'.' + QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@TableName) + N';';
    EXEC sys.sp_executesql @Sql, N'@TenantId uniqueidentifier', @TenantId;
    FETCH NEXT FROM table_cursor INTO @SchemaName, @TableName;
  END

  CLOSE table_cursor;
  DEALLOCATE table_cursor;
  DROP TABLE #TenantTables;

  FETCH NEXT FROM db_cursor INTO @DatabaseName;
END

CLOSE db_cursor;
DEALLOCATE db_cursor;

SELECT DatabaseName, SchemaName, TableName, TenantRows, TotalRows
FROM #Counts
ORDER BY DatabaseName, SchemaName, TableName;

SELECT DatabaseName,
       COUNT_BIG(*) AS DirectTenantTables,
       SUM(CASE WHEN TenantRows > 0 THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END) AS PopulatedTenantTables,
       SUM(TenantRows) AS TenantRows
FROM #Counts
GROUP BY DatabaseName
ORDER BY DatabaseName;

DROP TABLE #Counts;
