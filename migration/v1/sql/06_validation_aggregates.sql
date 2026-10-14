SET NOCOUNT ON;

DECLARE @TenantId uniqueidentifier = TRY_CONVERT(uniqueidentifier, '$(TenantId)');
IF @TenantId IS NULL
  THROW 50001, 'TenantId must be a verified UUID supplied with sqlcmd -v.', 1;

SELECT 'Restaurant' AS Entity, COUNT_BIG(*) AS [RowCount],
       COUNT_BIG(DISTINCT Id) AS DistinctPrimaryKeys
FROM Emos_MdmService.dbo.Restaurant WHERE TenantId = @TenantId
UNION ALL
SELECT 'RestaurantMiddleman', COUNT_BIG(*), COUNT_BIG(DISTINCT Id)
FROM Emos_MdmService.dbo.RestaurantMiddleman WHERE TenantId = @TenantId
UNION ALL
SELECT 'RestaurantComTrack', COUNT_BIG(*), COUNT_BIG(DISTINCT Id)
FROM Emos_MdmService.dbo.RestaurantComTrack WHERE TenantId = @TenantId
UNION ALL
SELECT 'RestaurantCategoryMap', COUNT_BIG(*),
       COUNT_BIG(DISTINCT CONCAT(CONVERT(nvarchar(36), ResId), ':', CONVERT(nvarchar(36), ResCatId)))
FROM Emos_MdmService.dbo.RestaurantCategoryMap WHERE TenantId = @TenantId
UNION ALL
SELECT 'MerchantUpdateRequests', COUNT_BIG(*), COUNT_BIG(DISTINCT Id)
FROM Emos_MdmService.dbo.MerchantUpdateRequests WHERE TenantId = @TenantId;

SELECT
  COUNT_BIG(*) AS TransactionCount,
  SUM(CONVERT(decimal(38,4), DocTotal)) AS DocumentTotalSum,
  SUM(CONVERT(decimal(38,4), DocDiscountAmt)) AS DiscountAmountSum,
  SUM(CONVERT(decimal(38,4), CommissionAmt)) AS CommissionAmountSum,
  MIN(DocDate) AS FirstDocumentDate,
  MAX(DocDate) AS LastDocumentDate
FROM Emos_MdmService.dbo.RestaurantComTrack
WHERE TenantId = @TenantId;

SELECT
  SUM(CASE WHEN r.Id IS NULL THEN 1 ELSE 0 END) AS MissingRestaurantLinks,
  SUM(CASE WHEN rm.Id IS NULL AND ct.MiddlemanId IS NOT NULL THEN 1 ELSE 0 END) AS MissingMiddlemanLinks
FROM Emos_MdmService.dbo.RestaurantComTrack AS ct
LEFT JOIN Emos_MdmService.dbo.Restaurant AS r ON r.Id = ct.RestaurantId
LEFT JOIN Emos_MdmService.dbo.RestaurantMiddleman AS rm ON rm.Id = ct.MiddlemanId
WHERE ct.TenantId = @TenantId;

SELECT
  COUNT_BIG(*) AS MerchantImageLinks,
  SUM(CASE WHEN b.Id IS NOT NULL THEN 1 ELSE 0 END) AS ResolvedBlobLinks,
  SUM(CASE WHEN b.Id IS NULL THEN 1 ELSE 0 END) AS MissingBlobs,
  SUM(COALESCE(CONVERT(bigint, DATALENGTH(b.Content)), 0)) AS BlobBytes
FROM Emos_MdmService.dbo.MerchantImages AS mi
JOIN Emos_MdmService.dbo.Restaurant AS r ON r.Id = mi.ResId
LEFT JOIN Emos_MdmService.dbo.AbpBlobs AS b
  ON (b.TenantId = @TenantId OR b.TenantId IS NULL)
 AND b.Name = CONVERT(nvarchar(36), mi.ImageId)
WHERE r.TenantId = @TenantId;
