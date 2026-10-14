SET NOCOUNT ON;

-- Read-only metadata needed to identify which tenant owns the VNO workload.
SELECT TABLE_CATALOG AS DatabaseName, TABLE_NAME, COLUMN_NAME, DATA_TYPE,
       IS_NULLABLE, ORDINAL_POSITION
FROM Emos_Identity.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'EmosOrganizationInfos'
UNION ALL
SELECT TABLE_CATALOG, TABLE_NAME, COLUMN_NAME, DATA_TYPE,
       IS_NULLABLE, ORDINAL_POSITION
FROM Emos_Administration.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AbpSettings'
ORDER BY DatabaseName, TABLE_NAME, ORDINAL_POSITION;

-- Cross-service activity signature. These are aggregate counts only.
SELECT t.Id AS TenantId, t.Name AS TenantRegistryName,
       (SELECT COUNT_BIG(*) FROM Emos_Identity.dbo.AbpUsers u WHERE u.TenantId=t.Id) AS Users,
       (SELECT COUNT_BIG(*) FROM Emos_MdmService.dbo.Restaurant r WHERE r.TenantId=t.Id) AS Restaurants,
       (SELECT COUNT_BIG(*) FROM Emos_MdmService.dbo.RestaurantMiddleman m WHERE m.TenantId=t.Id) AS Partners,
       (SELECT COUNT_BIG(*) FROM Emos_MdmService.dbo.RestaurantComTrack c WHERE c.TenantId=t.Id) AS Transactions,
       (SELECT COUNT_BIG(*) FROM Emos_MdmService.dbo.RestaurantCategory rc WHERE rc.TenantId=t.Id) AS Categories,
       (SELECT COUNT_BIG(*) FROM Emos_MdmService.dbo.MerchantUpdateRequests mur WHERE mur.TenantId=t.Id) AS UpdateRequests,
       (SELECT COUNT_BIG(*) FROM Emos_MdmService.dbo.MerchantImages mi
          JOIN Emos_MdmService.dbo.Restaurant r2 ON r2.Id=mi.ResId
         WHERE r2.TenantId=t.Id) AS MerchantImageLinks
FROM Emos_Saas.dbo.SaasTenants t
WHERE t.IsDeleted=0
ORDER BY t.Name;

-- Setting values are deliberately omitted. Provider keys can encode tenancy in
-- ABP versions where the settings table has no direct TenantId column, so only
-- the provider/name distribution is returned here.
SELECT ProviderName, Name AS SettingName, COUNT_BIG(*) AS SettingRows
FROM Emos_Administration.dbo.AbpSettings
GROUP BY ProviderName, Name
ORDER BY ProviderName, Name;
