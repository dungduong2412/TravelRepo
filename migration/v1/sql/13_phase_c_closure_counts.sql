SET NOCOUNT ON;

DECLARE @TenantId uniqueidentifier = TRY_CONVERT(uniqueidentifier, '$(TenantId)');
IF @TenantId IS NULL
  THROW 50001, 'TenantId must be a verified UUID supplied with sqlcmd -v.', 1;

-- Aggregate-only evidence for classifying tables that do not carry a literal
-- TenantId. No values, payloads, secrets, personal records, or blob bytes are
-- returned.
SELECT * FROM (
  SELECT 'Administration.AbpFeatureValues' AS ObjectName,
         COUNT_BIG(*) AS TotalRows,
         SUM(CASE WHEN ProviderName = N'T' AND TRY_CONVERT(uniqueidentifier, ProviderKey) = @TenantId THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END) AS VnoScopedRows
  FROM Emos_Administration.dbo.AbpFeatureValues
  UNION ALL
  SELECT 'Administration.GdprRequests', COUNT_BIG(*),
         SUM(CASE WHEN u.Id IS NOT NULL THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END)
  FROM Emos_Administration.dbo.GdprRequests r
  LEFT JOIN Emos_Identity.dbo.AbpUsers u ON u.Id = r.UserId AND u.TenantId = @TenantId
  UNION ALL
  SELECT 'Administration.GdprInfo', COUNT_BIG(*),
         SUM(CASE WHEN u.Id IS NOT NULL THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END)
  FROM Emos_Administration.dbo.GdprInfo i
  LEFT JOIN Emos_Administration.dbo.GdprRequests r ON r.Id = i.RequestId
  LEFT JOIN Emos_Identity.dbo.AbpUsers u ON u.Id = r.UserId AND u.TenantId = @TenantId
  UNION ALL
  SELECT 'Identity.AbpLinkUsers', COUNT_BIG(*),
         SUM(CASE WHEN SourceTenantId = @TenantId OR TargetTenantId = @TenantId THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END)
  FROM Emos_Identity.dbo.AbpLinkUsers
  UNION ALL
  SELECT 'Mdm.DomainVerificationAttempts', COUNT_BIG(*),
         SUM(CASE WHEN d.TenantId = @TenantId THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END)
  FROM Emos_MdmService.dbo.DomainVerificationAttempts a
  LEFT JOIN Emos_MdmService.dbo.TenantCustomDomains d ON d.Id = a.TenantCustomDomainId
  UNION ALL
  SELECT 'Cms.CmsBlogFeatures', COUNT_BIG(*),
         SUM(CASE WHEN b.TenantId = @TenantId THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END)
  FROM Emos_Cms.dbo.CmsBlogFeatures f
  LEFT JOIN Emos_Cms.dbo.CmsBlogs b ON b.Id = f.BlogId
) AS Scoped
ORDER BY ObjectName;

SELECT * FROM (
  SELECT 'Administration.AbpFeatureGroups' AS ObjectName, COUNT_BIG(*) AS TotalRows FROM Emos_Administration.dbo.AbpFeatureGroups
  UNION ALL SELECT 'Administration.AbpFeatures', COUNT_BIG(*) FROM Emos_Administration.dbo.AbpFeatures
  UNION ALL SELECT 'Administration.AbpLanguages', COUNT_BIG(*) FROM Emos_Administration.dbo.AbpLanguages
  UNION ALL SELECT 'Administration.AbpLocalizationResources', COUNT_BIG(*) FROM Emos_Administration.dbo.AbpLocalizationResources
  UNION ALL SELECT 'Administration.AbpLocalizationTexts', COUNT_BIG(*) FROM Emos_Administration.dbo.AbpLocalizationTexts
  UNION ALL SELECT 'Administration.AbpPermissionGroups', COUNT_BIG(*) FROM Emos_Administration.dbo.AbpPermissionGroups
  UNION ALL SELECT 'Administration.AbpPermissions', COUNT_BIG(*) FROM Emos_Administration.dbo.AbpPermissions
  UNION ALL SELECT 'Administration.AbpSettingDefinitions', COUNT_BIG(*) FROM Emos_Administration.dbo.AbpSettingDefinitions
  UNION ALL SELECT 'Administration.AbpTextTemplateDefinitionContentRecords', COUNT_BIG(*) FROM Emos_Administration.dbo.AbpTextTemplateDefinitionContentRecords
  UNION ALL SELECT 'Administration.AbpTextTemplateDefinitionRecords', COUNT_BIG(*) FROM Emos_Administration.dbo.AbpTextTemplateDefinitionRecords
  UNION ALL SELECT 'Identity.AbpClaimTypes', COUNT_BIG(*) FROM Emos_Identity.dbo.AbpClaimTypes
  UNION ALL SELECT 'Identity.OpenIddictApplications', COUNT_BIG(*) FROM Emos_Identity.dbo.OpenIddictApplications
  UNION ALL SELECT 'Identity.OpenIddictScopes', COUNT_BIG(*) FROM Emos_Identity.dbo.OpenIddictScopes
  UNION ALL SELECT 'Mdm.AbpEventInbox', COUNT_BIG(*) FROM Emos_MdmService.dbo.AbpEventInbox
  UNION ALL SELECT 'Mdm.NumberingTypeDefinition', COUNT_BIG(*) FROM Emos_MdmService.dbo.NumberingTypeDefinition
  UNION ALL SELECT 'Saas.PayGatewayPlans', COUNT_BIG(*) FROM Emos_Saas.dbo.PayGatewayPlans
  UNION ALL SELECT 'Saas.PayPaymentRequestProducts', COUNT_BIG(*) FROM Emos_Saas.dbo.PayPaymentRequestProducts
  UNION ALL SELECT 'Saas.PayPaymentRequests', COUNT_BIG(*) FROM Emos_Saas.dbo.PayPaymentRequests
  UNION ALL SELECT 'Saas.PayPlans', COUNT_BIG(*) FROM Emos_Saas.dbo.PayPlans
  UNION ALL SELECT 'Saas.SaasEditions', COUNT_BIG(*) FROM Emos_Saas.dbo.SaasEditions
  UNION ALL SELECT 'Aeretha.AerethaDonators', COUNT_BIG(*) FROM Emos_Aeretha.dbo.AerethaDonators
) AS GlobalCounts
ORDER BY ObjectName;

SELECT
  (SELECT COUNT_BIG(*) FROM Emos_MdmService.dbo.NumberingConfigs WHERE TenantId = @TenantId) AS VnoNumberingConfigs,
  (SELECT COUNT_BIG(*) FROM Emos_MdmService.dbo.NumberingConfigDetails WHERE TenantId = @TenantId) AS VnoNumberingConfigDetails,
  (SELECT COUNT_BIG(*) FROM Emos_MdmService.dbo.AbpEventInbox WHERE Processed = 0) AS GlobalUnprocessedInboxEvents,
  (SELECT COUNT_BIG(*) FROM Emos_MdmService.dbo.AbpEventInbox WHERE Processed = 1) AS GlobalProcessedInboxEvents;

SELECT COUNT_BIG(*) AS VnoTenantRows,
       SUM(CASE WHEN EditionId IS NULL THEN CONVERT(bigint, 0) ELSE CONVERT(bigint, 1) END) AS VnoTenantsWithEdition
FROM Emos_Saas.dbo.SaasTenants
WHERE Id = @TenantId;

-- Configuration names and aggregate membership counts are required to assess
-- capability parity. No user identity, setting value, permission grant value,
-- secret, or payload is returned.
SELECT r.Name AS RoleName,
       COUNT_BIG(DISTINCT ur.UserId) AS VnoUserCount,
       COUNT_BIG(DISTINCT pg.Id) AS PermissionGrantCount
FROM Emos_Identity.dbo.AbpRoles r
LEFT JOIN Emos_Identity.dbo.AbpUserRoles ur
  ON ur.RoleId = r.Id AND ur.TenantId = @TenantId
LEFT JOIN Emos_Administration.dbo.AbpPermissionGrants pg
  ON pg.ProviderName = N'R' AND pg.ProviderKey = CONVERT(nvarchar(36), r.Id)
 AND pg.TenantId = @TenantId
WHERE r.TenantId = @TenantId
GROUP BY r.Name
ORDER BY r.Name;

SELECT Name AS FeatureName, Value AS FeatureValue, COUNT_BIG(*) AS VnoValueRows
FROM Emos_Administration.dbo.AbpFeatureValues
WHERE ProviderName = N'T'
  AND TRY_CONVERT(uniqueidentifier, ProviderKey) = @TenantId
GROUP BY Name, Value
ORDER BY Name, Value;

SELECT d.TypeName, d.OwningService,
       COUNT_BIG(DISTINCT c.Id) AS VnoConfigRows,
       COUNT_BIG(cd.Id) AS VnoDetailRows
FROM Emos_MdmService.dbo.NumberingTypeDefinition d
JOIN Emos_MdmService.dbo.NumberingConfigs c
  ON c.NumberingTypeDefinitionId = d.Id AND c.TenantId = @TenantId
LEFT JOIN Emos_MdmService.dbo.NumberingConfigDetails cd
  ON cd.NumberingConfigId = c.Id AND cd.TenantId = @TenantId
GROUP BY d.TypeName, d.OwningService
ORDER BY d.TypeName;

SELECT
  COUNT_BIG(*) AS VnoUsers,
  SUM(CASE WHEN Email IS NULL OR LTRIM(RTRIM(Email)) = N'' THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END) AS MissingEmails,
  (SELECT COUNT_BIG(*) FROM (
     SELECT NormalizedEmail FROM Emos_Identity.dbo.AbpUsers
     WHERE TenantId = @TenantId AND NormalizedEmail IS NOT NULL
     GROUP BY NormalizedEmail HAVING COUNT_BIG(*) > 1
   ) d) AS DuplicateNormalizedEmailGroups,
  (SELECT COUNT_BIG(*) FROM (
     SELECT NormalizedUserName FROM Emos_Identity.dbo.AbpUsers
     WHERE TenantId = @TenantId AND NormalizedUserName IS NOT NULL
     GROUP BY NormalizedUserName HAVING COUNT_BIG(*) > 1
   ) d) AS DuplicateNormalizedUserNameGroups,
  (SELECT COUNT_BIG(*) FROM (
     SELECT NormalizedEmail FROM Emos_Identity.dbo.AbpUsers
     WHERE TenantId = @TenantId AND IsDeleted = 0 AND NormalizedEmail IS NOT NULL
     GROUP BY NormalizedEmail HAVING COUNT_BIG(*) > 1
   ) d) AS ActiveDuplicateEmailGroups,
  (SELECT COUNT_BIG(*) FROM (
     SELECT NormalizedUserName FROM Emos_Identity.dbo.AbpUsers
     WHERE TenantId = @TenantId AND IsDeleted = 0 AND NormalizedUserName IS NOT NULL
     GROUP BY NormalizedUserName HAVING COUNT_BIG(*) > 1
   ) d) AS ActiveDuplicateUserNameGroups
FROM Emos_Identity.dbo.AbpUsers
WHERE TenantId = @TenantId;

SELECT
  COUNT_BIG(*) AS VnoRoleMembershipRows,
  COUNT_BIG(DISTINCT ur.UserId) AS UsersWithRole,
  (SELECT COUNT_BIG(*) FROM (
     SELECT UserId FROM Emos_Identity.dbo.AbpUserRoles
     WHERE TenantId = @TenantId GROUP BY UserId HAVING COUNT_BIG(*) > 1
   ) d) AS UsersWithMultipleRoles,
  (SELECT COUNT_BIG(*) FROM Emos_Identity.dbo.AbpUsers u
   WHERE u.TenantId = @TenantId AND NOT EXISTS (
     SELECT 1 FROM Emos_Identity.dbo.AbpUserRoles ur2
     WHERE ur2.TenantId = @TenantId AND ur2.UserId = u.Id
   )) AS UsersWithoutRole
FROM Emos_Identity.dbo.AbpUserRoles ur
WHERE ur.TenantId = @TenantId;

SELECT IsActive, IsDeleted, COUNT_BIG(*) AS UsersWithoutRole
FROM Emos_Identity.dbo.AbpUsers u
WHERE u.TenantId = @TenantId
  AND NOT EXISTS (
    SELECT 1 FROM Emos_Identity.dbo.AbpUserRoles ur
    WHERE ur.TenantId = @TenantId AND ur.UserId = u.Id
  )
GROUP BY IsActive, IsDeleted
ORDER BY IsDeleted, IsActive;

SELECT IsActive, IsShow, COUNT_BIG(*) AS CategoryRows
FROM Emos_MdmService.dbo.RestaurantCategory
WHERE TenantId = @TenantId
GROUP BY IsActive, IsShow
ORDER BY IsActive, IsShow;

SELECT COUNT_BIG(*) AS CategoryRows,
       COUNT_BIG(DISTINCT Name) AS DistinctCategoryNames,
       SUM(CASE WHEN Name IS NULL OR LTRIM(RTRIM(Name)) = N'' THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END) AS MissingCategoryNames
FROM Emos_MdmService.dbo.RestaurantCategory
WHERE TenantId = @TenantId;
