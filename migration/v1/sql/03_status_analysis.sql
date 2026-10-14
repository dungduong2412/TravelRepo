SET NOCOUNT ON;

DECLARE @TenantId uniqueidentifier = TRY_CONVERT(uniqueidentifier, '$(TenantId)');
IF @TenantId IS NULL
  THROW 50001, 'TenantId must be a verified UUID supplied with sqlcmd -v.', 1;

SELECT 'Restaurant' AS SourceTable, 'Status' AS SourceColumn, Status AS NumericValue,
       COUNT_BIG(*) AS [RowCount],
       MIN(CreationTime) AS FirstObservedAt,
       MAX(CreationTime) AS LastObservedAt
FROM Emos_MdmService.dbo.Restaurant
WHERE TenantId = @TenantId
GROUP BY Status
UNION ALL
SELECT 'RestaurantMiddleman', 'Status', Status, COUNT_BIG(*),
       MIN(CreationTime), MAX(CreationTime)
FROM Emos_MdmService.dbo.RestaurantMiddleman
WHERE TenantId = @TenantId
GROUP BY Status
UNION ALL
SELECT 'RestaurantComTrack', 'Status', Status, COUNT_BIG(*),
       MIN(CreationTime), MAX(CreationTime)
FROM Emos_MdmService.dbo.RestaurantComTrack
WHERE TenantId = @TenantId
GROUP BY Status
UNION ALL
SELECT 'MerchantUpdateRequests', 'Status', Status, COUNT_BIG(*),
       MIN(CreationTime), MAX(CreationTime)
FROM Emos_MdmService.dbo.MerchantUpdateRequests
WHERE TenantId = @TenantId
GROUP BY Status
ORDER BY SourceTable, NumericValue;

-- Timing evidence for transaction-state investigation. CommissionDate or
-- ConfirmDate being populated is not proof that payment occurred.
SELECT Status,
       COUNT_BIG(*) AS [RowCount],
       SUM(CASE WHEN ConfirmDate IS NOT NULL THEN 1 ELSE 0 END) AS WithConfirmDate,
       SUM(CASE WHEN CommissionDate IS NOT NULL THEN 1 ELSE 0 END) AS WithCommissionDate,
       SUM(CASE WHEN CommissionAmt <> 0 THEN 1 ELSE 0 END) AS WithNonZeroCommission,
       MIN(CommissionAmt) AS MinCommissionAmount,
       MAX(CommissionAmt) AS MaxCommissionAmount
FROM Emos_MdmService.dbo.RestaurantComTrack
WHERE TenantId = @TenantId
GROUP BY Status
ORDER BY Status;
