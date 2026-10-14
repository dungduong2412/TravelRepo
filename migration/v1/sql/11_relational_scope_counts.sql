SET NOCOUNT ON;

DECLARE @TenantId uniqueidentifier = TRY_CONVERT(uniqueidentifier, '$(TenantId)');
IF @TenantId IS NULL
  THROW 50001, 'TenantId must be a verified UUID supplied with sqlcmd -v.', 1;

-- Tables without a literal TenantId column that can still be scoped by an
-- explicit relationship or ABP tenant-provider key. Aggregate counts only.
SELECT N'Emos_Saas' AS DatabaseName, N'SaasTenants' AS TableName,
       COUNT_BIG(*) AS TenantRows
FROM Emos_Saas.dbo.SaasTenants WHERE Id = @TenantId
UNION ALL
SELECT N'Emos_Administration', N'AbpSettings', COUNT_BIG(*)
FROM Emos_Administration.dbo.AbpSettings
WHERE ProviderName = N'T' AND TRY_CONVERT(uniqueidentifier, ProviderKey) = @TenantId
UNION ALL
SELECT N'Emos_Administration', N'GdprRequests', COUNT_BIG(*)
FROM Emos_Administration.dbo.GdprRequests AS gr
WHERE EXISTS (
  SELECT 1 FROM Emos_Identity.dbo.AbpUsers AS u
  WHERE u.Id = gr.UserId AND u.TenantId = @TenantId
)
UNION ALL
SELECT N'Emos_Administration', N'GdprInfo', COUNT_BIG(*)
FROM Emos_Administration.dbo.GdprInfo AS gi
WHERE EXISTS (
  SELECT 1
  FROM Emos_Administration.dbo.GdprRequests AS gr
  JOIN Emos_Identity.dbo.AbpUsers AS u ON u.Id = gr.UserId
  WHERE gr.Id = gi.RequestId AND u.TenantId = @TenantId
)
UNION ALL
SELECT N'Emos_Identity', N'AbpLinkUsers', COUNT_BIG(*)
FROM Emos_Identity.dbo.AbpLinkUsers
WHERE SourceTenantId = @TenantId OR TargetTenantId = @TenantId
UNION ALL
SELECT N'Emos_Identity', N'OpenIddictAuthorizations', COUNT_BIG(*)
FROM Emos_Identity.dbo.OpenIddictAuthorizations AS oa
WHERE EXISTS (
  SELECT 1 FROM Emos_Identity.dbo.AbpUsers AS u
  WHERE u.TenantId = @TenantId
    AND oa.Subject = CONVERT(nvarchar(36), u.Id)
)
UNION ALL
SELECT N'Emos_Identity', N'OpenIddictTokens', COUNT_BIG(*)
FROM Emos_Identity.dbo.OpenIddictTokens AS ot
WHERE EXISTS (
  SELECT 1 FROM Emos_Identity.dbo.AbpUsers AS u
  WHERE u.TenantId = @TenantId
    AND ot.Subject = CONVERT(nvarchar(36), u.Id)
)
UNION ALL
SELECT N'Emos_MdmService', N'MerchantImages', COUNT_BIG(*)
FROM Emos_MdmService.dbo.MerchantImages AS mi
JOIN Emos_MdmService.dbo.Restaurant AS r ON r.Id = mi.ResId
WHERE r.TenantId = @TenantId
UNION ALL
SELECT N'Emos_MdmService', N'RestaurantUserMap', COUNT_BIG(*)
FROM Emos_MdmService.dbo.RestaurantUserMap AS rum
JOIN Emos_MdmService.dbo.Restaurant AS r ON r.Id = rum.ResId
WHERE r.TenantId = @TenantId
UNION ALL
SELECT N'Emos_MdmService', N'DomainVerificationAttempts', COUNT_BIG(*)
FROM Emos_MdmService.dbo.DomainVerificationAttempts AS dva
JOIN Emos_MdmService.dbo.TenantCustomDomains AS tcd
  ON tcd.Id = dva.TenantCustomDomainId
WHERE tcd.TenantId = @TenantId
UNION ALL
SELECT N'Emos_Cms', N'CmsBlogFeatures', COUNT_BIG(*)
FROM Emos_Cms.dbo.CmsBlogFeatures AS cbf
JOIN Emos_Cms.dbo.CmsBlogs AS cb ON cb.Id = cbf.BlogId
WHERE cb.TenantId = @TenantId
ORDER BY DatabaseName, TableName;

-- Relationship integrity for the two active MDM child tables.
SELECT
  (SELECT COUNT_BIG(*)
   FROM Emos_MdmService.dbo.MerchantImages AS mi
   LEFT JOIN Emos_MdmService.dbo.Restaurant AS r ON r.Id = mi.ResId
   WHERE r.Id IS NULL) AS GlobalOrphanMerchantImages,
  (SELECT COUNT_BIG(*)
   FROM Emos_MdmService.dbo.RestaurantUserMap AS rum
   LEFT JOIN Emos_MdmService.dbo.Restaurant AS r ON r.Id = rum.ResId
   WHERE r.Id IS NULL) AS GlobalOrphanRestaurantUserMaps,
  (SELECT COUNT_BIG(*)
   FROM Emos_MdmService.dbo.RestaurantUserMap AS rum
   JOIN Emos_MdmService.dbo.Restaurant AS r ON r.Id = rum.ResId
   LEFT JOIN Emos_Identity.dbo.AbpUsers AS u ON u.Id = rum.UserId
   WHERE r.TenantId = @TenantId AND u.Id IS NULL) AS TenantUserMapsMissingIdentityUser,
  (SELECT COUNT_BIG(*)
   FROM Emos_MdmService.dbo.RestaurantUserMap AS rum
   JOIN Emos_MdmService.dbo.Restaurant AS r ON r.Id = rum.ResId
   JOIN Emos_Identity.dbo.AbpUsers AS u ON u.Id = rum.UserId
   WHERE r.TenantId = @TenantId
     AND (u.TenantId IS NULL OR u.TenantId <> @TenantId)) AS TenantUserMapsCrossTenant;
