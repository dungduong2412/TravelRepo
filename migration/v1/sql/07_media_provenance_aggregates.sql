SET NOCOUNT ON;

DECLARE @TenantId uniqueidentifier = TRY_CONVERT(uniqueidentifier, '$(TenantId)');
IF @TenantId IS NULL
  THROW 50001, 'TenantId must be a verified UUID supplied with sqlcmd -v.', 1;

-- Authoritative FK evidence for image, media and blob relationships.
SELECT
  OBJECT_NAME(fk.parent_object_id) AS SourceTable,
  fk.name AS ForeignKeyName,
  COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS SourceColumn,
  OBJECT_NAME(fk.referenced_object_id) AS TargetTable,
  COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS TargetColumn
FROM Emos_MdmService.sys.foreign_keys AS fk
JOIN Emos_MdmService.sys.foreign_key_columns AS fkc
  ON fkc.constraint_object_id = fk.object_id
WHERE OBJECT_NAME(fk.parent_object_id) IN
  (N'MerchantImages', N'MediaAssets', N'AbpBlobs')
ORDER BY SourceTable, ForeignKeyName, fkc.constraint_column_id;

SELECT
  COUNT_BIG(*) AS MerchantImageLinks,
  COUNT_BIG(DISTINCT mi.Id) AS DistinctMerchantImageIds,
  COUNT_BIG(DISTINCT mi.ImageId) AS DistinctImageIds,
  COUNT_BIG(DISTINCT mi.ResId) AS RestaurantsWithLinks,
  SUM(CASE WHEN ma.Id IS NOT NULL THEN 1 ELSE 0 END) AS LinksMatchingMediaAssetId,
  SUM(CASE WHEN b.Id IS NOT NULL THEN 1 ELSE 0 END) AS LinksMatchingBlobId
FROM Emos_MdmService.dbo.MerchantImages AS mi
JOIN Emos_MdmService.dbo.Restaurant AS r ON r.Id = mi.ResId
LEFT JOIN Emos_MdmService.dbo.MediaAssets AS ma ON ma.Id = mi.ImageId
LEFT JOIN Emos_MdmService.dbo.AbpBlobs AS b ON b.Id = mi.ImageId
WHERE r.TenantId = @TenantId;

SELECT
  (SELECT COUNT_BIG(*) FROM Emos_MdmService.dbo.MediaAssets
    WHERE TenantId = @TenantId) AS TenantMediaAssets,
  (SELECT COUNT_BIG(*) FROM Emos_MdmService.dbo.AbpBlobs
    WHERE TenantId = @TenantId) AS TenantMdmBlobs,
  (SELECT COALESCE(SUM(CONVERT(bigint, DATALENGTH(Content))), 0)
     FROM Emos_MdmService.dbo.AbpBlobs WHERE TenantId = @TenantId) AS TenantMdmBlobBytes,
  (SELECT COUNT_BIG(*) FROM Emos_Cms.dbo.CmsMediaDescriptors
    WHERE TenantId = @TenantId) AS TenantCmsMediaDescriptors,
  (SELECT COUNT_BIG(*) FROM Emos_Cms.dbo.FmFileDescriptors
    WHERE TenantId = @TenantId) AS TenantCmsFileDescriptors,
  (SELECT COUNT_BIG(*) FROM Emos_Cms.dbo.AbpBlobs
    WHERE TenantId = @TenantId) AS TenantCmsBlobs,
  (SELECT COALESCE(SUM(CONVERT(bigint, DATALENGTH(Content))), 0)
     FROM Emos_Cms.dbo.AbpBlobs WHERE TenantId = @TenantId) AS TenantCmsBlobBytes;

-- Proven blob convention: MerchantImages.ImageId is stored as the GUID text in
-- AbpBlobs.Name; it is not AbpBlobs.Id and does not reference MediaAssets.Id.
SELECT
  COUNT_BIG(*) AS LinkedBlobRows,
  COUNT_BIG(DISTINCT b.Id) AS DistinctLinkedBlobs,
  SUM(CONVERT(bigint, DATALENGTH(b.Content))) AS LinkedBlobBytes,
  SUM(CASE WHEN b.Content IS NULL THEN 1 ELSE 0 END) AS NullBlobContents,
  SUM(CASE WHEN b.TenantId = @TenantId THEN 1 ELSE 0 END) AS TenantOwnedBlobLinks,
  SUM(CASE WHEN b.TenantId IS NULL THEN 1 ELSE 0 END) AS HostOwnedBlobLinks,
  SUM(CASE WHEN b.TenantId IS NOT NULL AND b.TenantId <> @TenantId THEN 1 ELSE 0 END) AS CrossTenantBlobLinks
FROM Emos_MdmService.dbo.MerchantImages AS mi
JOIN Emos_MdmService.dbo.Restaurant AS r ON r.Id = mi.ResId
JOIN Emos_MdmService.dbo.AbpBlobs AS b
  ON b.Name = CONVERT(nvarchar(36), mi.ImageId)
 AND (b.TenantId = @TenantId OR b.TenantId IS NULL)
WHERE r.TenantId = @TenantId;

-- Diagnose the single transaction-to-merchant mismatch without returning IDs or
-- customer fields.
SELECT
  COUNT_BIG(*) AS MissingInAllRestaurantRows,
  SUM(CASE WHEN any_r.Id IS NOT NULL THEN 1 ELSE 0 END) AS ExistsUnderAnotherTenant,
  SUM(CASE WHEN any_r.Id IS NULL THEN 1 ELSE 0 END) AS MissingGlobally,
  SUM(CONVERT(decimal(38,4), ct.DocTotal)) AS OrphanDocumentTotal,
  SUM(CONVERT(decimal(38,4), ct.CommissionAmt)) AS OrphanCommissionAmount
FROM Emos_MdmService.dbo.RestaurantComTrack AS ct
LEFT JOIN Emos_MdmService.dbo.Restaurant AS tenant_r
  ON tenant_r.Id = ct.RestaurantId AND tenant_r.TenantId = @TenantId
LEFT JOIN Emos_MdmService.dbo.Restaurant AS any_r ON any_r.Id = ct.RestaurantId
WHERE ct.TenantId = @TenantId AND tenant_r.Id IS NULL;
