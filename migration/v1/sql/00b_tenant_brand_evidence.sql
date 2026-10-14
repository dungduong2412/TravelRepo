SET NOCOUNT ON;

DECLARE @TenantId uniqueidentifier = TRY_CONVERT(uniqueidentifier, '$(TenantId)');
IF @TenantId IS NULL
  THROW 50001, 'TenantId must be a candidate UUID supplied with sqlcmd -v.', 1;

-- Brand-level settings are tenant ownership evidence, not customer rows. Limit
-- output to the product identity fields needed to distinguish VNO from peers.
SELECT ProviderKey, Name AS SettingName, Value AS SettingValue
FROM Emos_Administration.dbo.AbpSettings
WHERE ProviderName = N'T'
  AND TRY_CONVERT(uniqueidentifier, ProviderKey) = @TenantId
  AND Name IN (
    N'Emos.Global.DisplayName',
    N'Emos.Global.ShortName',
    N'Emos.Global.Description',
    N'Emos.Global.Copyright'
  )
ORDER BY Name;
