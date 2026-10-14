SET NOCOUNT ON;

DECLARE @TenantId uniqueidentifier = TRY_CONVERT(uniqueidentifier, '$(TenantId)');
IF @TenantId IS NULL
  THROW 50001, 'TenantId must be a verified UUID supplied with sqlcmd -v.', 1;

USE Emos_MdmService;

CREATE TABLE #IdMatches (
  TargetSchema sysname not null,
  TargetTable sysname not null,
  MatchingImageLinks bigint not null,
  DistinctMatchingImageIds bigint not null
);

DECLARE @Sql nvarchar(max) = N'';

SELECT @Sql = @Sql + N'
INSERT INTO #IdMatches(TargetSchema, TargetTable, MatchingImageLinks, DistinctMatchingImageIds)
SELECT N''' + REPLACE(s.name, '''', '''''') + N''', N''' + REPLACE(t.name, '''', '''''') + N''',
       COUNT_BIG(*), COUNT_BIG(DISTINCT mi.ImageId)
FROM dbo.MerchantImages AS mi
JOIN dbo.Restaurant AS r ON r.Id = mi.ResId
JOIN ' + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name) + N' AS candidate
  ON candidate.' + QUOTENAME(c.name) + N' = mi.ImageId
WHERE r.TenantId = @TenantId
HAVING COUNT_BIG(*) > 0;'
FROM sys.tables AS t
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
JOIN sys.columns AS c ON c.object_id = t.object_id
JOIN sys.types AS ty ON ty.user_type_id = c.user_type_id
WHERE ty.name = N'uniqueidentifier'
  AND c.name = N'Id'
  AND t.name <> N'MerchantImages';

EXEC sys.sp_executesql @Sql, N'@TenantId uniqueidentifier', @TenantId;

SELECT * FROM #IdMatches
ORDER BY MatchingImageLinks DESC, TargetSchema, TargetTable;

DROP TABLE #IdMatches;

-- Test common ABP blob-name conventions without returning any name value.
SELECT
  COUNT_BIG(*) AS MerchantImageLinks,
  SUM(CASE WHEN b_exact.Id IS NOT NULL THEN 1 ELSE 0 END) AS ExactGuidNameMatches,
  SUM(CASE WHEN b_contains.Id IS NOT NULL THEN 1 ELSE 0 END) AS GuidContainedInNameMatches,
  SUM(CASE WHEN b_container.Id IS NOT NULL THEN 1 ELSE 0 END) AS ContainerIdMatches
FROM dbo.MerchantImages AS mi
JOIN dbo.Restaurant AS r ON r.Id = mi.ResId
OUTER APPLY (
  SELECT TOP (1) b.Id
  FROM dbo.AbpBlobs AS b
  WHERE b.Name = CONVERT(nvarchar(36), mi.ImageId)
    AND (b.TenantId = @TenantId OR b.TenantId IS NULL)
) AS b_exact
OUTER APPLY (
  SELECT TOP (1) b.Id
  FROM dbo.AbpBlobs AS b
  WHERE b.Name LIKE N'%' + CONVERT(nvarchar(36), mi.ImageId) + N'%'
    AND (b.TenantId = @TenantId OR b.TenantId IS NULL)
) AS b_contains
OUTER APPLY (
  SELECT TOP (1) b.Id
  FROM dbo.AbpBlobs AS b
  WHERE b.ContainerId = mi.ImageId
    AND (b.TenantId = @TenantId OR b.TenantId IS NULL)
) AS b_container
WHERE r.TenantId = @TenantId;

SELECT
  LEN(Name) AS BlobNameLength,
  COUNT_BIG(*) AS BlobRows,
  SUM(CASE WHEN TRY_CONVERT(uniqueidentifier, Name) IS NOT NULL THEN 1 ELSE 0 END) AS GuidOnlyNames
FROM dbo.AbpBlobs
WHERE TenantId = @TenantId
GROUP BY LEN(Name)
ORDER BY BlobNameLength;
