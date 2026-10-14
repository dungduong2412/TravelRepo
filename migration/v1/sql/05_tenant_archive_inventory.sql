SET NOCOUNT ON;

DECLARE @TenantId uniqueidentifier = TRY_CONVERT(uniqueidentifier, '$(TenantId)');
IF @TenantId IS NULL
  THROW 50001, 'TenantId must be a verified UUID supplied with sqlcmd -v.', 1;

-- Produce a deterministic manifest of every table that can be scoped directly
-- by TenantId. The extractor must export every listed column into the controlled
-- legacy archive. Tables without TenantId require an approved relational join
-- from a tenant-scoped parent and remain blockers until that join is documented.
DECLARE @Databases table (DatabaseName sysname primary key);
INSERT INTO @Databases(DatabaseName) VALUES
  (N'Emos_Saas'),
  (N'Emos_Administration'),
  (N'Emos_Identity'),
  (N'Emos_MdmService'),
  (N'Emos_Cms'),
  (N'Emos_Aeretha');

CREATE TABLE #Manifest (
  DatabaseName sysname not null,
  SchemaName sysname not null,
  TableName sysname not null,
  ColumnName sysname not null,
  ColumnOrdinal int not null,
  TypeName sysname not null,
  MaxLength smallint not null,
  PrecisionValue tinyint not null,
  ScaleValue tinyint not null,
  IsNullable bit not null,
  HasDirectTenantId bit not null
);

DECLARE @DatabaseName sysname;
DECLARE @Sql nvarchar(max);
DECLARE db_cursor CURSOR LOCAL FAST_FORWARD FOR
  SELECT DatabaseName FROM @Databases ORDER BY DatabaseName;

OPEN db_cursor;
FETCH NEXT FROM db_cursor INTO @DatabaseName;
WHILE @@FETCH_STATUS = 0
BEGIN
  SET @Sql = N'USE ' + QUOTENAME(@DatabaseName) + N';
    INSERT INTO #Manifest
    SELECT DB_NAME(), s.name, t.name, c.name, c.column_id, ty.name,
           c.max_length, c.precision, c.scale, c.is_nullable,
           CONVERT(bit, CASE WHEN EXISTS (
             SELECT 1 FROM sys.columns tc
             WHERE tc.object_id = t.object_id AND tc.name = N''TenantId''
           ) THEN 1 ELSE 0 END)
    FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    JOIN sys.columns c ON c.object_id = t.object_id
    JOIN sys.types ty ON ty.user_type_id = c.user_type_id;';
  EXEC sys.sp_executesql @Sql;
  FETCH NEXT FROM db_cursor INTO @DatabaseName;
END
CLOSE db_cursor;
DEALLOCATE db_cursor;

SELECT *
FROM #Manifest
ORDER BY DatabaseName, SchemaName, TableName, ColumnOrdinal;

SELECT DatabaseName, SchemaName, TableName
FROM #Manifest
GROUP BY DatabaseName, SchemaName, TableName, HasDirectTenantId
HAVING HasDirectTenantId = 0
ORDER BY DatabaseName, SchemaName, TableName;

DROP TABLE #Manifest;
