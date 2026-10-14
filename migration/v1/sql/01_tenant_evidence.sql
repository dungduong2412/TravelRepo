SET NOCOUNT ON;

-- Read-only tenant discovery. No TenantId parameter is accepted here because
-- the purpose is to establish it from independent evidence before extraction.
SELECT
  t.Id AS TenantId,
  t.Name,
  t.NormalizedName,
  t.ActivationState,
  t.IsDeleted,
  d.DomainName,
  d.IsActive AS DomainIsActive,
  d.IsVerified AS DomainIsVerified
FROM Emos_Saas.dbo.SaasTenants AS t
LEFT JOIN Emos_MdmService.dbo.TenantCustomDomains AS d
  ON d.AppTenantId = t.Id OR d.TenantId = t.Id
ORDER BY t.Name, d.DomainName;

-- Aggregate cross-database evidence only; no customer detail is returned.
SELECT TenantId, COUNT_BIG(*) AS RestaurantCount
FROM Emos_MdmService.dbo.Restaurant
GROUP BY TenantId
ORDER BY TenantId;

SELECT TenantId, COUNT_BIG(*) AS MiddlemanCount
FROM Emos_MdmService.dbo.RestaurantMiddleman
GROUP BY TenantId
ORDER BY TenantId;

SELECT TenantId, COUNT_BIG(*) AS TransactionCount,
       MIN(CreationTime) AS FirstTransactionCreatedAt,
       MAX(CreationTime) AS LastTransactionCreatedAt
FROM Emos_MdmService.dbo.RestaurantComTrack
GROUP BY TenantId
ORDER BY TenantId;

SELECT TenantId, COUNT_BIG(*) AS IdentityUserCount
FROM Emos_Identity.dbo.AbpUsers
GROUP BY TenantId
ORDER BY TenantId;
