SET NOCOUNT ON;

DECLARE @TenantId uniqueidentifier = TRY_CONVERT(uniqueidentifier, '$(TenantId)');
IF @TenantId IS NULL
  THROW 50001, 'TenantId must be a verified UUID supplied with sqlcmd -v.', 1;

-- Container names are configuration metadata. No file names or blob bytes are
-- returned by this aggregate provenance query.
SELECT c.Name AS ContainerName,
       COUNT_BIG(*) AS BlobRows,
       SUM(CONVERT(bigint, DATALENGTH(b.Content))) AS BlobBytes,
       SUM(CASE WHEN b.Content IS NULL THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END) AS NullContentRows
FROM Emos_Cms.dbo.AbpBlobs AS b
JOIN Emos_Cms.dbo.AbpBlobContainers AS c ON c.Id = b.ContainerId
WHERE b.TenantId = @TenantId
GROUP BY c.Name
ORDER BY c.Name;

SELECT
  COUNT_BIG(*) AS TenantCmsBlobRows,
  SUM(CASE WHEN md.Id IS NOT NULL THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END) AS ExactMediaNameMatches,
  SUM(CASE WHEN fd.Id IS NOT NULL THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END) AS ExactFileNameMatches,
  SUM(CASE WHEN md_by_id.Id IS NOT NULL THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END) AS MediaIdNameMatches,
  SUM(CASE WHEN fd_by_id.Id IS NOT NULL THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END) AS FileIdNameMatches
FROM Emos_Cms.dbo.AbpBlobs AS b
LEFT JOIN Emos_Cms.dbo.CmsMediaDescriptors AS md ON md.Name = b.Name
LEFT JOIN Emos_Cms.dbo.FmFileDescriptors AS fd ON fd.Name = b.Name
LEFT JOIN Emos_Cms.dbo.CmsMediaDescriptors AS md_by_id
  ON CONVERT(nvarchar(36), md_by_id.Id) = b.Name
LEFT JOIN Emos_Cms.dbo.FmFileDescriptors AS fd_by_id
  ON CONVERT(nvarchar(36), fd_by_id.Id) = b.Name
WHERE b.TenantId = @TenantId;

-- Detect legacy descriptors whose TenantId is null but whose creator belongs
-- to VNO. Counts only, because names and customer content remain private.
SELECT
  (SELECT COUNT_BIG(*)
   FROM Emos_Cms.dbo.CmsMediaDescriptors AS md
   JOIN Emos_Identity.dbo.AbpUsers AS u ON u.Id = md.CreatorId
   WHERE md.TenantId IS NULL AND u.TenantId = @TenantId) AS HostMediaDescriptorsCreatedByTenantUsers,
  (SELECT COUNT_BIG(*)
   FROM Emos_Cms.dbo.FmFileDescriptors AS fd
   JOIN Emos_Identity.dbo.AbpUsers AS u ON u.Id = fd.CreatorId
   WHERE fd.TenantId IS NULL AND u.TenantId = @TenantId) AS HostFileDescriptorsCreatedByTenantUsers,
  (SELECT COUNT_BIG(*)
   FROM Emos_Cms.dbo.CmsBlogs AS cb
   JOIN Emos_Identity.dbo.AbpUsers AS u ON u.Id = cb.CreatorId
   WHERE cb.TenantId IS NULL AND u.TenantId = @TenantId) AS HostBlogsCreatedByTenantUsers;
