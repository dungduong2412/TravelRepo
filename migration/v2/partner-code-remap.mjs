// Deterministic, pinned remediation for duplicate Partner (collaborator) codes inside Snapshot-5 (exception E1).
// V1 has no Partner->Merchant assignment and no transaction references the affected Partners, so nothing proves which holder of a
// duplicated code is the canonical one. Policy: NO holder keeps the duplicated code; every holder gets "<code>-DUP-<first 8 hex of its V1 id>".
// The original code and both V1 ids are preserved in legacy_import_conflicts. Exact V1 ids are pinned here, not just derived.
export const PARTNER_CODE_REMAP = Object.freeze({
  'C2500228': Object.freeze(['2c495a87-b8ed-8b04-fa15-3a1c073c34dd', '77f4a15e-7676-a87b-ff70-3a1c8bdd7d91']),
  'C2500240': Object.freeze(['2852d043-7c04-6104-8647-3a1d99b383d4', '55cb956a-72e6-0d21-bbd9-3a1e160349a1']),
});
const lower = (v) => (v == null ? null : String(v).toLowerCase());
const normCode = (v) => (v == null ? null : String(v).trim().toLocaleLowerCase('en-US'));
export const replacementCode = (code, legacyId) => `${code}-DUP-${lower(legacyId).slice(0, 8)}`;

/** All duplicated Partner codes in the given rows ({Id, Code}), grouped case/space-insensitively. */
export function derivePartnerCodeDuplicates(partners) {
  const groups = new Map();
  for (const p of partners) { const k = normCode(p.Code); if (k) groups.set(k, [...(groups.get(k) || []), p]); }
  return [...groups.values()].filter((g) => g.length > 1).map((g) => ({ code: g[0].Code, holders: g.map((p) => lower(p.Id)).sort() }));
}

/** Throws unless the derived duplicates are EXACTLY the pinned set; returns [{legacy_id, original_code, replacement_code, sibling_legacy_ids}]. */
export function pinnedPartnerRemap(partners) {
  const derived = derivePartnerCodeDuplicates(partners);
  const key = (d) => `${d.code}|${d.holders.join(',')}`;
  const pinned = Object.entries(PARTNER_CODE_REMAP).map(([code, ids]) => ({ code, holders: [...ids].sort() }));
  if (JSON.stringify(derived.map(key).sort()) !== JSON.stringify(pinned.map(key).sort())) {
    throw new Error('duplicate Partner codes in the snapshot are not exactly the pinned E1 set');
  }
  const out = [];
  for (const d of derived) for (const id of d.holders) out.push({ legacy_id: id, original_code: d.code, replacement_code: replacementCode(d.code, id), sibling_legacy_ids: d.holders.filter((x) => x !== id) });
  out.sort((a, b) => a.legacy_id.localeCompare(b.legacy_id));
  const used = new Set(partners.map((p) => normCode(p.Code)).filter(Boolean));
  const repl = out.map((o) => normCode(o.replacement_code));
  if (new Set(repl).size !== repl.length || repl.some((r) => used.has(r))) throw new Error('replacement Partner code is not unique');
  return out;
}

/** legacy_import_conflicts rows (one per affected Partner) shared by the importer and the standalone remediation. */
export function partnerConflictRows(remap, { batchId, snapshotLabel, v2IdByLegacy, createdByLegacy = new Map() }) {
  return remap.map((m) => ({
    import_batch_id: batchId, entity_type: 'collaborator', legacy_id: m.legacy_id, candidate_v2_id: v2IdByLegacy.get(m.legacy_id),
    reason_code: 'duplicate_collaborator_code', resolution_status: 'approved',
    evidence: { policy: 'uniqueness of the holder could not be proven (no Partner->Merchant assignment in V1, no transaction references the Partners): no holder keeps the duplicated code; each gets <code>-DUP-<first 8 hex of its V1 id>',
      approved_by: 'owner acceptance instruction: allocate new unique codes where uniqueness cannot be proven', snapshot: snapshotLabel,
      original_code: m.original_code, replacement_code: m.replacement_code, printed_qr_replacement_required: true,
      sibling_legacy_ids: m.sibling_legacy_ids, sibling_v2_ids: m.sibling_legacy_ids.map((id) => v2IdByLegacy.get(id)),
      v1_created_at: createdByLegacy.get(m.legacy_id) ?? null },
  }));
}
