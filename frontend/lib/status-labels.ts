/**
 * One place that decides how a business / profile STATUS is shown to people.
 * The value stored in the database ("pending", "active", ...) is never translated or changed; only this label is displayed.
 * "pending" (database) is always shown as "Chờ phê duyệt" (Vietnamese display label), never as "Pending" / "Chờ duyệt" / "đang chờ duyệt".
 */
export const STATUS_LABEL: Readonly<Record<string, string>> = {
  pending: 'Chờ phê duyệt',
  active: 'Đã duyệt',
  approved: 'Đã duyệt',
  inactive: 'Ngừng hoạt động',
  blocked: 'Cần chỉnh sửa / bị từ chối',
  rejected: 'Bị từ chối',
  cancelled: 'Đã hủy',
};

export const PENDING_LABEL = STATUS_LABEL.pending;

export function statusKey(status?: string | null): string {
  return (status ?? '').toString().trim().toLowerCase();
}

export function isKnownStatus(status?: string | null): boolean {
  return statusKey(status) in STATUS_LABEL;
}

/** Display label for a database status value. Unknown (legacy / unmapped) values stay visible instead of being hidden. */
export function statusLabel(status?: string | null): string {
  const key = statusKey(status);
  if (!key) return 'Chưa xác định';
  return STATUS_LABEL[key] ?? `Trạng thái cũ: ${key}`;
}
