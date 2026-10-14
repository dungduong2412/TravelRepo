SET NOCOUNT ON;

DECLARE @TenantId uniqueidentifier = TRY_CONVERT(uniqueidentifier, '$(TenantId)');
IF @TenantId IS NULL
  THROW 50001, 'TenantId must be a verified UUID supplied with sqlcmd -v.', 1;

-- Metadata-only relationship manifest. Blob Content is deliberately omitted;
-- transfer tooling must stream it separately and verify size plus SHA-256.
SELECT
  mi.Id AS MerchantImageId,
  mi.ResId AS RestaurantId,
  mi.ImageId AS MediaAssetId,
  mi.IsHero,
  mi.[Order] AS DisplayOrder,
  ma.BlobContainerName,
  ma.BlobName,
  ma.FileName,
  ma.ContentType,
  ma.SizeInBytes,
  ma.AssetType,
  ma.Width,
  ma.Height,
  ma.DurationInSeconds,
  ma.IsArchived,
  ma.LastAccessedDate,
  ma.Title,
  ma.Caption,
  ma.AltText,
  ma.Description,
  b.Id AS BlobId,
  b.ContainerId AS BlobContainerId,
  b.Name AS StoredBlobName,
  DATALENGTH(b.Content) AS BlobSizeBytes
FROM Emos_MdmService.dbo.MerchantImages AS mi
JOIN Emos_MdmService.dbo.Restaurant AS r ON r.Id = mi.ResId
LEFT JOIN Emos_MdmService.dbo.MediaAssets AS ma ON ma.Id = mi.ImageId
LEFT JOIN Emos_MdmService.dbo.AbpBlobs AS b
  ON (b.TenantId = @TenantId OR b.TenantId IS NULL)
 AND b.Name = CONVERT(nvarchar(36), mi.ImageId)
WHERE r.TenantId = @TenantId
ORDER BY mi.ResId, mi.[Order], mi.Id;

SELECT Id, TenantId, EntityType, Name, MimeType, Size, CreationTime,
       LastModificationTime, IsDeleted, DeletionTime, ExtraProperties
FROM Emos_Cms.dbo.CmsMediaDescriptors
WHERE TenantId = @TenantId ORDER BY Id;

SELECT Id, TenantId, DirectoryId, MediaDescriptorId, Name, MimeType, Size,
       CreationTime, LastModificationTime, ExtraProperties
FROM Emos_Cms.dbo.FmFileDescriptors
WHERE TenantId = @TenantId ORDER BY Id;

SELECT Id, TenantId, ContainerId, Name, DATALENGTH(Content) AS BlobSizeBytes,
       ExtraProperties
FROM Emos_Cms.dbo.AbpBlobs
WHERE TenantId = @TenantId ORDER BY Id;
