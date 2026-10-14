SET NOCOUNT ON;

DECLARE @TenantId uniqueidentifier = TRY_CONVERT(uniqueidentifier, '$(TenantId)');
IF @TenantId IS NULL
  THROW 50001, 'TenantId must be a verified UUID supplied with sqlcmd -v.', 1;

-- Keep source UUIDs, original statuses, exact decimal values, nulls and source
-- timestamps. Downstream loading must be idempotent on each source primary key.
SELECT * FROM Emos_MdmService.dbo.Restaurant
WHERE TenantId = @TenantId ORDER BY Id;

SELECT * FROM Emos_MdmService.dbo.RestaurantMiddleman
WHERE TenantId = @TenantId ORDER BY Id;

SELECT * FROM Emos_MdmService.dbo.RestaurantComTrack
WHERE TenantId = @TenantId ORDER BY Id;

SELECT DISTINCT rc.*
FROM Emos_MdmService.dbo.RestaurantCategory AS rc
LEFT JOIN Emos_MdmService.dbo.RestaurantCategoryMap AS rcm
  ON rcm.ResCatId = rc.Id
LEFT JOIN Emos_MdmService.dbo.Restaurant AS r
  ON r.Id = rcm.ResId AND r.TenantId = @TenantId
WHERE rc.TenantId = @TenantId OR r.Id IS NOT NULL
ORDER BY rc.Id;

SELECT * FROM Emos_MdmService.dbo.RestaurantCategoryMap
WHERE TenantId = @TenantId ORDER BY ResId, ResCatId;

SELECT rum.*
FROM Emos_MdmService.dbo.RestaurantUserMap AS rum
JOIN Emos_MdmService.dbo.Restaurant AS r ON r.Id = rum.ResId
WHERE r.TenantId = @TenantId
ORDER BY rum.ResId, rum.UserId;

SELECT * FROM Emos_MdmService.dbo.MerchantUpdateRequests
WHERE TenantId = @TenantId ORDER BY Id;

SELECT mi.*
FROM Emos_MdmService.dbo.MerchantImages AS mi
JOIN Emos_MdmService.dbo.Restaurant AS r ON r.Id = mi.ResId
WHERE r.TenantId = @TenantId
ORDER BY mi.ResId, mi.[Order], mi.Id;

SELECT DISTINCT ma.*
FROM Emos_MdmService.dbo.MediaAssets AS ma
LEFT JOIN Emos_MdmService.dbo.MerchantImages AS mi ON mi.ImageId = ma.Id
LEFT JOIN Emos_MdmService.dbo.Restaurant AS r
  ON r.Id = mi.ResId AND r.TenantId = @TenantId
WHERE ma.TenantId = @TenantId OR r.Id IS NOT NULL
ORDER BY ma.Id;

-- This result contains credential verifiers and security stamps. It must go only
-- to encrypted migration staging, never logs or V2 application-facing tables.
SELECT Id, TenantId, UserName, NormalizedUserName, Name, Surname, Email,
       NormalizedEmail, EmailConfirmed, PasswordHash, SecurityStamp,
       ConcurrencyStamp, PhoneNumber, PhoneNumberConfirmed, IsActive, IsDeleted,
       IsExternal, LockoutEnabled, LockoutEnd, AccessFailedCount,
       TwoFactorEnabled, ShouldChangePasswordOnNextLogin, UserTypeId,
       CreationTime, CreatorId, LastModificationTime, LastModifierId,
       DeletionTime, DeleterId, EntityVersion, LastPasswordChangeTime,
       ExtraProperties
FROM Emos_Identity.dbo.AbpUsers
WHERE TenantId = @TenantId ORDER BY Id;

SELECT DISTINCT ur.*
FROM Emos_Identity.dbo.AbpUserRoles AS ur
JOIN Emos_Identity.dbo.AbpUsers AS u ON u.Id = ur.UserId
WHERE u.TenantId = @TenantId
ORDER BY ur.UserId, ur.RoleId;

SELECT DISTINCT r.*
FROM Emos_Identity.dbo.AbpRoles AS r
LEFT JOIN Emos_Identity.dbo.AbpUserRoles AS ur ON ur.RoleId = r.Id
LEFT JOIN Emos_Identity.dbo.AbpUsers AS u
  ON u.Id = ur.UserId AND u.TenantId = @TenantId
WHERE r.TenantId = @TenantId OR u.Id IS NOT NULL
ORDER BY r.Id;
