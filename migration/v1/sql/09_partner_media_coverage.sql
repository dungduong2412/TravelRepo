SET NOCOUNT ON;

DECLARE @TenantId uniqueidentifier = TRY_CONVERT(uniqueidentifier, '$(TenantId)');
IF @TenantId IS NULL
  THROW 50001, 'TenantId must be a verified UUID supplied with sqlcmd -v.', 1;

SELECT
  COUNT_BIG(*) AS PartnerRows,
  SUM(CASE WHEN rm.Image IS NOT NULL THEN 1 ELSE 0 END) AS PartnersWithImageId,
  COUNT_BIG(DISTINCT rm.Image) AS DistinctPartnerImageIds,
  SUM(CASE WHEN rm.Image IS NOT NULL AND b.Id IS NOT NULL THEN 1 ELSE 0 END) AS ResolvedPartnerBlobLinks,
  SUM(CASE WHEN rm.Image IS NOT NULL AND b.Id IS NULL THEN 1 ELSE 0 END) AS MissingPartnerBlobs,
  SUM(COALESCE(CONVERT(bigint, DATALENGTH(b.Content)), 0)) AS PartnerBlobBytes,
  SUM(CASE WHEN b.Id IS NOT NULL AND b.TenantId = @TenantId THEN 1 ELSE 0 END) AS TenantOwnedPartnerBlobLinks,
  SUM(CASE WHEN b.Id IS NOT NULL AND b.TenantId IS NULL THEN 1 ELSE 0 END) AS HostOwnedPartnerBlobLinks,
  SUM(CASE WHEN b.Id IS NOT NULL AND b.TenantId <> @TenantId THEN 1 ELSE 0 END) AS CrossTenantPartnerBlobLinks
FROM Emos_MdmService.dbo.RestaurantMiddleman AS rm
LEFT JOIN Emos_MdmService.dbo.AbpBlobs AS b
  ON b.Name = CONVERT(nvarchar(36), rm.Image)
 AND (b.TenantId = @TenantId OR b.TenantId IS NULL)
WHERE rm.TenantId = @TenantId;

WITH UsedBlobNames AS (
  SELECT CONVERT(nvarchar(36), mi.ImageId) AS BlobName
  FROM Emos_MdmService.dbo.MerchantImages AS mi
  JOIN Emos_MdmService.dbo.Restaurant AS r ON r.Id = mi.ResId
  WHERE r.TenantId = @TenantId
  UNION
  SELECT CONVERT(nvarchar(36), rm.Image)
  FROM Emos_MdmService.dbo.RestaurantMiddleman AS rm
  WHERE rm.TenantId = @TenantId AND rm.Image IS NOT NULL
)
SELECT
  COUNT_BIG(*) AS TenantBlobRows,
  SUM(CASE WHEN u.BlobName IS NOT NULL THEN 1 ELSE 0 END) AS CoveredBlobRows,
  SUM(CASE WHEN u.BlobName IS NULL THEN 1 ELSE 0 END) AS UnreferencedBlobRows,
  SUM(CONVERT(bigint, DATALENGTH(b.Content))) AS TenantBlobBytes,
  SUM(CASE WHEN u.BlobName IS NOT NULL THEN CONVERT(bigint, DATALENGTH(b.Content)) ELSE 0 END) AS CoveredBlobBytes,
  SUM(CASE WHEN u.BlobName IS NULL THEN CONVERT(bigint, DATALENGTH(b.Content)) ELSE 0 END) AS UnreferencedBlobBytes
FROM Emos_MdmService.dbo.AbpBlobs AS b
LEFT JOIN UsedBlobNames AS u ON u.BlobName = b.Name
WHERE b.TenantId = @TenantId;
