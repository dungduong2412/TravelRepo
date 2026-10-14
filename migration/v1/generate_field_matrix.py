#!/usr/bin/env python3
"""Generate the complete, deterministic V1-to-V2 field accountability matrix.

The source inventory is metadata only. No source or destination database
connection is made. Every inventory COLUMN record receives exactly one row.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path


FIELDS = (
    "database_name",
    "schema_name",
    "table_name",
    "column_name",
    "source_type",
    "source_details",
    "classification",
    "destination_relation",
    "destination_column",
    "transformation",
    "tenant_scope",
    "verification_status",
    "justification",
)

SCHEMA_OBJECT_FIELDS = (
    "record_type", "database_name", "schema_name", "table_name", "object_name",
    "source_definition", "source_details", "classification", "v2_destination",
    "verification_status", "justification",
)

MIGRATION_TABLE_MARKERS = ("__", "Migration", "Migrations", "History")

# Tables without a literal TenantId that were proven tenant-scoped through a
# parent/foreign-key path in the live read-only Phase C evidence.
RELATIONAL_SCOPE = {
    ("Emos_Saas", "SaasTenants"),
    ("Emos_Administration", "AbpSettings"),
    ("Emos_Identity", "OpenIddictAuthorizations"),
    ("Emos_Identity", "OpenIddictTokens"),
    ("Emos_MdmService", "MerchantImages"),
    ("Emos_MdmService", "RestaurantUserMap"),
    ("Emos_Administration", "AbpFeatureValues"),
    ("Emos_Administration", "GdprInfo"),
    ("Emos_Administration", "GdprRequests"),
    ("Emos_Identity", "AbpLinkUsers"),
    ("Emos_MdmService", "DomainVerificationAttempts"),
    ("Emos_MdmService", "NumberingTypeDefinition"),
    ("Emos_Cms", "CmsBlogFeatures"),
}

# Aggregate source evidence and V2 repository searches establish that these are
# shared framework catalogs, empty/transient infrastructure, or separate
# non-VNO modules. They are explicitly excluded from customer-data export; the
# inventory and this matrix retain their structure and the reason for exclusion.
EXCLUDED_TABLE_REASONS = {
    "AbpFeatureGroups": "Shared ABP feature-definition catalog; tenant state is separately captured from AbpFeatureValues",
    "AbpFeatures": "Shared ABP feature-definition catalog; V2 behavior is code/config based",
    "AbpLanguages": "Shared ABP language catalog; V2 has no tenant-owned rows or legacy runtime dependency",
    "AbpLocalizationResources": "Shared ABP localization-definition catalog; application text is source-controlled in V2",
    "AbpLocalizationTexts": "Shared ABP localization text catalog; application text is source-controlled in V2",
    "AbpPermissionGroups": "Shared ABP permission-definition catalog; VNO has zero role permission grants",
    "AbpPermissions": "Shared ABP permission-definition catalog; VNO has zero role permission grants",
    "AbpSettingDefinitions": "Shared ABP setting-definition catalog; tenant setting values are handled separately",
    "AbpTextTemplateDefinitionContentRecords": "Shared ABP template-definition content, not tenant-owned customer data",
    "AbpTextTemplateDefinitionRecords": "Shared ABP template-definition metadata, not tenant-owned customer data",
    "AbpClaimTypes": "Shared identity claim-definition table with zero source rows",
    "AbpEventInbox": "Transient integration inbox with zero source rows and zero unprocessed events",
    "PayGatewayPlans": "Shared SaaS billing infrastructure with zero source rows",
    "PayPaymentRequestProducts": "Shared SaaS billing infrastructure with zero source rows",
    "PayPaymentRequests": "Shared SaaS billing infrastructure with zero source rows",
    "PayPlans": "Shared SaaS billing infrastructure with zero source rows",
    "SaasEditions": "Shared SaaS edition catalog; the verified VNO tenant has no EditionId",
    "AerethaDonators": "Separate Aeretha service, no tenant key, no V2/VNO application references",
}

ARCHIVE_TABLE_REASONS = {
    "AbpFeatureValues": "21 rows are scoped to the verified VNO provider key; preserve feature state losslessly",
    "GdprInfo": "Tenant relationship is through the VNO user/request chain; current VNO row count is zero",
    "GdprRequests": "Tenant relationship is through VNO identity users; current VNO row count is zero",
    "AbpLinkUsers": "Tenant relationship is explicit in source/target tenant IDs; current VNO row count is zero",
    "DomainVerificationAttempts": "Tenant relationship is through TenantCustomDomains; current VNO row count is zero",
    "NumberingTypeDefinition": "Three shared definitions are referenced by 34 VNO numbering configurations; preserve the referenced definitions",
    "CmsBlogFeatures": "Tenant relationship is through CmsBlogs; current VNO row count is zero",
}

# Exact live V2 equivalents verified through pg_indexes / FK introspection on
# project hsezyogfxgnkpweoqqny. Composite index records appear once per column.
SCHEMA_OBJECT_MAP = {
    ("Emos_Identity", "AbpRoles", "INDEX", "IX_AbpRoles_NormalizedName"): "public.user_profiles.user_profiles_role_check (verified admin/BUS/CTV translation)",
    ("Emos_Identity", "AbpRoles", "INDEX", "PK_AbpRoles"): "public.user_profiles.user_profiles_role_check + archived legacy role ID",
    ("Emos_Identity", "AbpUserRoles", "FOREIGN_KEY", "FK_AbpUserRoles_AbpRoles_RoleId"): "public.user_profiles.user_profiles_role_check",
    ("Emos_Identity", "AbpUserRoles", "FOREIGN_KEY", "FK_AbpUserRoles_AbpUsers_UserId"): "public.user_profiles.user_profiles_user_id_fkey",
    ("Emos_Identity", "AbpUserRoles", "INDEX", "IX_AbpUserRoles_RoleId_UserId"): "public.user_profiles.role + user_id",
    ("Emos_Identity", "AbpUserRoles", "INDEX", "PK_AbpUserRoles"): "public.user_profiles.user_id unique + role check",
    ("Emos_MdmService", "Restaurant", "INDEX", "PK_Restaurant"): "public.merchant_details.merchant_details_legacy_restaurant_id_uq",
    ("Emos_MdmService", "RestaurantMiddleman", "INDEX", "PK_RestaurantMiddleman"): "public.collaborators.collaborators_legacy_middleman_id_uq",
    ("Emos_MdmService", "RestaurantComTrack", "INDEX", "PK_RestaurantComTrack"): "public.referral_transactions.referral_transactions_legacy_transaction_id_key",
    ("Emos_MdmService", "RestaurantCategory", "INDEX", "PK_RestaurantCategory"): "public.categories.categories_legacy_category_id_uq",
    ("Emos_MdmService", "MerchantUpdateRequests", "INDEX", "PK_MerchantUpdateRequests"): "public.merchant_update_requests.merchant_update_requests_legacy_request_id_key",
    ("Emos_MdmService", "MerchantImages", "INDEX", "PK_MerchantImages"): "public.media_assets.media_assets_legacy_merchant_image_id_uq",
    ("Emos_MdmService", "MerchantImages", "INDEX", "IX_MerchantImages_ResId"): "public.media_assets.media_assets_merchant_idx",
    ("Emos_MdmService", "RestaurantCategoryMap", "INDEX", "PK_RestaurantCategoryMap"): "public.merchant_category_links.merchant_category_links_pkey",
    ("Emos_MdmService", "RestaurantCategoryMap", "INDEX", "IX_RestaurantCategoryMap_ResId"): "public.merchant_category_links.merchant_category_links_pkey (merchant_id prefix)",
    ("Emos_MdmService", "RestaurantUserMap", "INDEX", "PK_RestaurantUserMap"): "public.merchant_user_links.merchant_user_links_pkey",
    ("Emos_MdmService", "RestaurantUserMap", "INDEX", "IX_RestaurantUserMap_ResId"): "public.merchant_user_links.merchant_user_links_pkey (merchant_id prefix)",
    ("Emos_Identity", "AbpUsers", "INDEX", "PK_AbpUsers"): "public.legacy_identity_map.legacy_identity_map_pkey",
    ("Emos_MdmService", "MerchantImages", "FOREIGN_KEY", "FK_MerchantImages_Restaurant_ResId"): "public.media_assets.media_assets_merchant_id_fkey",
    ("Emos_MdmService", "RestaurantCategoryMap", "FOREIGN_KEY", "FK_RestaurantCategoryMap_Restaurant_ResId"): "public.merchant_category_links.merchant_category_links_merchant_id_fkey",
    ("Emos_MdmService", "RestaurantCategoryMap", "FOREIGN_KEY", "FK_RestaurantCategoryMap_RestaurantCategory_ResCatId"): "public.merchant_category_links.merchant_category_links_category_id_fkey",
    ("Emos_MdmService", "RestaurantUserMap", "FOREIGN_KEY", "FK_RestaurantUserMap_Restaurant_ResId"): "public.merchant_user_links.merchant_user_links_merchant_id_fkey",
}

OPERATIONAL_TABLES = {
    "Restaurant", "RestaurantMiddleman", "RestaurantComTrack", "RestaurantCategory",
    "RestaurantCategoryMap", "RestaurantUserMap", "MerchantUpdateRequests",
    "MerchantImages", "MediaAssets", "AbpUsers", "AbpRoles", "AbpUserRoles",
}


def mapping(relation: str, column: str, *, transformed: bool = False,
            transformation: str = "copy source value without semantic reinterpretation",
            status: str = "verified", justification: str = "Dedicated V2 field; original row is also archived") -> dict[str, str]:
    return {
        "classification": "transformed_lossless" if transformed else "direct",
        "destination_relation": relation,
        "destination_column": column,
        "transformation": transformation,
        "verification_status": status,
        "justification": justification,
    }


def table_map(relation: str, pairs: dict[str, str]) -> dict[str, dict[str, str]]:
    return {source: mapping(relation, destination) for source, destination in pairs.items()}


EXPLICIT: dict[tuple[str, str], dict[str, dict[str, str]]] = {
    ("Emos_MdmService", "Restaurant"): table_map("public.merchant_details", {
        "Id": "legacy_restaurant_id", "TenantId": "legacy_tenant_id",
        "Code": "merchant_code", "Name": "merchant_name", "Email": "merchant_email",
        "Phone": "merchant_phone", "ContactPhone": "merchant_contact_phone",
        "Description": "merchant_description", "Priority": "merchant_priority",
        "IsVerified": "merchant_verified", "OwnerName": "owner_name",
        "Address": "new_address_line", "Status": "legacy_status",
        "IsBanned": "legacy_is_banned", "MinCommission": "legacy_min_commission",
        "TaxCode": "legacy_tax_code", "GeoPosition": "legacy_geo_position",
        "ExtraProperties": "legacy_extra_properties", "ShortName": "legacy_short_name",
        "Rating": "legacy_rating", "OwnerId": "legacy_owner_user_id",
        "IsUpdateRequesting": "legacy_is_update_requesting",
        "LastBannedDate": "legacy_last_banned_at",
        "LastUpdateRequestDate": "legacy_last_update_request_at",
        "Province": "legacy_province", "District": "legacy_district", "Ward": "legacy_ward",
        "Country": "legacy_country", "CountryId": "legacy_country_id",
        "ProvinceId": "legacy_province_id", "DistrictId": "legacy_district_id",
        "WardId": "legacy_ward_id",
    }),
    ("Emos_MdmService", "RestaurantMiddleman"): table_map("public.collaborators", {
        "Id": "legacy_middleman_id", "TenantId": "legacy_tenant_id",
        "Code": "collaborators_code", "Name": "collaborators_name",
        "Rating": "collaborators_rating", "Phone": "collaborators_phone",
        "Email": "collaborators_email", "BankName": "collaborators_bank_name",
        "AccountName": "collaborators_bank_acc_name",
        "AccountNumber": "collaborators_bank_acc_number",
        "CreationTime": "collaborators_registered_date", "IsVerified": "collaborators_verified",
        "Status": "legacy_status", "IsBanned": "legacy_is_banned",
        "ExtraProperties": "legacy_extra_properties", "VerifiedDate": "legacy_verified_at",
        "LastBannedDate": "legacy_last_banned_at", "Image": "legacy_image_id",
    }),
    ("Emos_MdmService", "RestaurantComTrack"): table_map("public.referral_transactions", {
        "Id": "legacy_transaction_id", "TenantId": "legacy_tenant_id",
        "BranchId": "legacy_branch_id", "Status": "legacy_status",
        "DocNbr": "document_number", "DocInx": "document_index",
        "DocDate": "document_date", "PostingDate": "posting_date",
        "ConfirmDate": "confirmed_at", "CommissionDate": "commission_date",
        "DocTotal": "document_total", "DocDiscountAmt": "document_discount_amount",
        "DocDiscountPerc": "document_discount_percent", "CommissionPer": "commission_percent",
        "CommissionAmt": "commission_amount", "ExtraProperties": "legacy_extra_properties",
        "CreatorId": "legacy_creator_id", "Note": "legacy_notes",
        "CreatorName": "legacy_creator_name",
        "RestaurantDisplayName": "legacy_restaurant_display_name",
        "MiddlemanDisplayName": "legacy_middleman_display_name",
        "LastModificationTime": "legacy_last_modified_at",
        "LastModifierId": "legacy_last_modifier_id",
        "ConcurrencyStamp": "legacy_concurrency_stamp", "CreationTime": "legacy_creation_time",
    }),
    ("Emos_MdmService", "RestaurantCategory"): table_map("public.categories", {
        "Id": "legacy_category_id", "TenantId": "legacy_tenant_id", "Icon": "category_icon",
        "Order": "display_order",
    }),
    ("Emos_MdmService", "RestaurantCategoryMap"): table_map("public.merchant_category_links", {
        "TenantId": "legacy_tenant_id",
    }),
    ("Emos_MdmService", "RestaurantUserMap"): table_map("public.merchant_user_links", {
        "UserId": "legacy_user_id",
    }),
    ("Emos_MdmService", "MerchantUpdateRequests"): table_map("public.merchant_update_requests", {
        "Id": "legacy_request_id", "TenantId": "legacy_tenant_id",
        "MerchantId": "legacy_merchant_id", "Status": "legacy_status",
        "CreationTime": "requested_at",
    }),
    ("Emos_MdmService", "MerchantImages"): table_map("public.media_assets", {
        "Id": "legacy_merchant_image_id", "ImageId": "legacy_image_id",
        "IsHero": "is_hero", "Order": "display_order",
    }),
    ("Emos_MdmService", "MediaAssets"): table_map("public.media_assets", {
        "Id": "legacy_media_asset_id", "TenantId": "legacy_tenant_id",
        "BlobContainerName": "legacy_blob_container_name", "BlobName": "legacy_blob_name",
        "FileName": "original_filename", "ContentType": "mime_type",
        "SizeInBytes": "size_bytes", "AltText": "alt_text", "Title": "title",
        "Caption": "caption", "Description": "description", "Width": "width",
        "Height": "height", "DurationInSeconds": "duration_seconds",
        "AssetType": "legacy_asset_type", "IsArchived": "legacy_is_archived",
        "LastAccessedDate": "legacy_last_accessed_at",
    }),
    ("Emos_Identity", "AbpUsers"): table_map("public.legacy_identity_map", {
        "Id": "legacy_user_id", "TenantId": "legacy_tenant_id",
    }),
}

# Relationship fields require stable-ID lookup, not a literal copy.
for key, source, destination, relation in (
    (("Emos_MdmService", "RestaurantComTrack"), "RestaurantId", "merchant_id", "public.referral_transactions"),
    (("Emos_MdmService", "RestaurantComTrack"), "MiddlemanId", "collaborator_id", "public.referral_transactions"),
    (("Emos_MdmService", "RestaurantCategoryMap"), "ResId", "merchant_id", "public.merchant_category_links"),
    (("Emos_MdmService", "RestaurantCategoryMap"), "ResCatId", "category_id", "public.merchant_category_links"),
    (("Emos_MdmService", "RestaurantUserMap"), "ResId", "merchant_id", "public.merchant_user_links"),
    (("Emos_MdmService", "MerchantImages"), "ResId", "merchant_id", "public.media_assets"),
):
    EXPLICIT[key][source] = mapping(
        relation, destination, transformed=True,
        transformation="resolve through stable legacy source ID; preserve the source ID in the archived row",
    )

# Fields requiring an explicit coercion or fan-out policy.
EXPLICIT[("Emos_MdmService", "Restaurant")].update({
    "CommissionPerc": mapping("public.merchant_details", "merchant_commission_value", transformed=True,
        transformation="copy exact decimal and set merchant_commission_type='percent'"),
    "DiscountPerc": mapping("public.merchant_details", "merchant_discount_value", transformed=True,
        transformation="copy exact decimal and set merchant_discount_type='percent'"),
    "CreationTime": mapping("public.merchant_details", "merchant_registered_date", transformed=True,
        transformation="convert SQL datetime2 using the approved source timezone; archive original text", status="unverified"),
    "VerifiedDate": mapping("public.merchant_details", "merchant_verified_date", transformed=True,
        transformation="convert SQL datetime2 using the approved source timezone; archive original text", status="unverified"),
})
EXPLICIT[("Emos_MdmService", "RestaurantCategory")].update({
    "Name": mapping("public.categories", "category_name_vi;category_name", transformed=True,
        transformation="copy the source name to both V2 name fields; all 18 VNO names are present and unique"),
    "IsActive": mapping("public.categories", "is_active", transformed=True,
        transformation="preserve NULL; all 18 VNO source values are NULL and the V2 column is nullable; archive original"),
})

EXPLICIT[("Emos_MdmService", "RestaurantMiddleman")]["CreationTime"] = mapping(
    "public.collaborators", "collaborators_registered_date", transformed=True,
    transformation="convert SQL datetime2 using the approved source timezone; archive original text",
    status="unverified",
)
EXPLICIT[("Emos_MdmService", "MerchantUpdateRequests")]["MerchantId"] = mapping(
    "public.merchant_update_requests", "legacy_merchant_id;merchant_id", transformed=True,
    transformation="copy stable source ID and resolve merchant_id through legacy_restaurant_id",
)
EXPLICIT[("Emos_MdmService", "RestaurantUserMap")]["UserId"] = mapping(
    "public.merchant_user_links", "legacy_user_id;user_profile_id", transformed=True,
    transformation="copy stable source ID and resolve user_profile_id through legacy_identity_map",
)

# V1 role capabilities cannot be collapsed into the three V2 profile roles until
# each observed role is reviewed. Preserve the source rows and make the required
# Auth metadata transformation explicit and blocked, rather than silently
# discarding role membership.
EXPLICIT[("Emos_Identity", "AbpRoles")] = {
    "Name": mapping("public.user_profiles", "role", transformed=True,
        transformation="verified mapping: admin→admin, BUS→merchant, CTV→collaborator; archive original role row"),
}
EXPLICIT[("Emos_Identity", "AbpUserRoles")] = {
    "UserId": mapping("public.user_profiles", "user_id", transformed=True,
        transformation="resolve through legacy_identity_map and create the verified V2 profile role"),
    "RoleId": mapping("public.user_profiles", "role", transformed=True,
        transformation="resolve through AbpRoles using verified admin/BUS/CTV mapping; archive original IDs"),
}

# Request payload fields are losslessly represented together in one JSON object.
for column in {
    "Address", "Categories", "CommissionPerc", "ContactPhone", "Country", "CountryId",
    "Description", "DiscountPerc", "District", "DistrictId", "Email", "GeoPosition",
    "Name", "OwnerName", "Phone", "Province", "ProvinceId", "ShortName", "TaxCode",
    "Ward", "WardId",
}:
    EXPLICIT[("Emos_MdmService", "MerchantUpdateRequests")][column] = mapping(
        "public.merchant_update_requests", "payload", transformed=True,
        transformation="store under the original V1 column name in JSONB without semantic coercion",
    )


def parse_inventory(path: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    seen: set[tuple[str, str, str, str]] = set()
    with path.open(encoding="utf-8", newline="") as handle:
        for raw in handle:
            raw = raw.rstrip("\n\r")
            if not raw.startswith("COLUMN|"):
                continue
            parts = raw.split("|", 6)
            if len(parts) != 7:
                raise ValueError(f"Malformed inventory line: {raw[:120]}")
            _, database, schema, table, column, source_type, details = parts
            identity = (database, schema, table, column)
            if identity in seen:
                raise ValueError(f"Duplicate inventory column: {identity}")
            seen.add(identity)
            rows.append({
                "database_name": database,
                "schema_name": schema,
                "table_name": table,
                "column_name": column,
                "source_type": source_type,
                "source_details": details,
            })
    if not rows:
        raise ValueError("No COLUMN records found")
    return rows


def parse_schema_objects(path: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with path.open(encoding="utf-8", newline="") as handle:
        for raw in handle:
            raw = raw.rstrip("\n\r")
            if not (raw.startswith("FOREIGN_KEY|") or raw.startswith("INDEX|")):
                continue
            parts = raw.split("|", 6)
            if len(parts) != 7:
                raise ValueError(f"Malformed schema-object line: {raw[:120]}")
            record_type, database, schema, table, name, definition, details = parts
            rows.append({
                "record_type": record_type, "database_name": database,
                "schema_name": schema, "table_name": table, "object_name": name,
                "source_definition": definition, "source_details": details,
            })
    return rows


def default_disposition(row: dict[str, str], literal_tenant_tables: set[tuple[str, str]]) -> dict[str, str]:
    key = (row["database_name"], row["table_name"])
    table = row["table_name"]
    if table in EXCLUDED_TABLE_REASONS or table.startswith("__") and table.endswith("_Migrations"):
        scope = "shared/non-VNO infrastructure explicitly excluded"
        status = "verified"
        classification = "excluded"
        justification = EXCLUDED_TABLE_REASONS.get(
            table, "Framework migration-history metadata; implementation history is not customer data or runtime capability",
        )
    elif table in ARCHIVE_TABLE_REASONS:
        scope = "verified provider-key or relational tenant path"
        status = "verified"
        classification = "legacy_archive"
        justification = ARCHIVE_TABLE_REASONS[table]
    elif key in literal_tenant_tables:
        scope = "literal TenantId filter"
        status = "verified"
        classification = "legacy_archive"
        justification = "VNO-owned row is losslessly retained in the restricted archive"
    elif key in RELATIONAL_SCOPE:
        scope = "verified relational tenant path"
        status = "verified"
        classification = "legacy_archive"
        justification = "VNO ownership was proven through a parent/key relationship; row is retained in the restricted archive"
    elif any(marker in table for marker in MIGRATION_TABLE_MARKERS):
        scope = "global metadata candidate"
        status = "blocked"
        classification = "unresolved"
        justification = "Candidate framework migration metadata; exclusion requires explicit approval"
    else:
        scope = "shared/non-literal tenant scope unresolved"
        status = "blocked"
        classification = "unresolved"
        justification = "Tenant ownership is not yet proven; do not export or exclude"
    return {
        "classification": classification,
        "destination_relation": "public.legacy_source_records" if classification == "legacy_archive" else "",
        "destination_column": "source_payload" if classification == "legacy_archive" else "",
        "transformation": "encode original typed value in canonical lossless JSON representation" if classification == "legacy_archive" else "",
        "tenant_scope": scope,
        "verification_status": status,
        "justification": justification,
    }


def special_disposition(row: dict[str, str], base: dict[str, str]) -> dict[str, str]:
    key = (row["database_name"], row["table_name"])
    column = row["column_name"]
    explicit = EXPLICIT.get(key, {}).get(column)
    if explicit:
        return {**base, **explicit}

    if key == ("Emos_Identity", "OpenIddictApplications"):
        if column in {
            "Id", "ConcurrencyStamp", "CreationTime", "CreatorId", "DeleterId",
            "DeletionTime", "ExtraProperties", "IsDeleted", "LastModificationTime",
            "LastModifierId", "ClientSecret", "JsonWebKeySet",
        }:
            return {
                **base, "classification": "excluded", "destination_relation": "",
                "destination_column": "", "transformation": "",
                "tenant_scope": "shared identity infrastructure explicitly excluded",
                "verification_status": "verified",
                "justification": "OpenIddict implementation/audit metadata is not migrated; cryptographic credentials must be regenerated, never copied",
            }
        return {
            **base, "classification": "unresolved",
            "destination_relation": "Supabase Auth project configuration + V2 backend authorization",
            "destination_column": "provider URLs, redirect allow-list, client policy or application authorization contract",
            "transformation": "identify VNO-owned client configuration, then recreate semantically without copying secrets",
            "tenant_scope": "global OpenIddict application ownership unresolved",
            "verification_status": "blocked",
            "justification": "Five global OpenIddict applications exist and V2 currently implements only password login; VNO ownership and scope contract are not proven",
        }

    if key == ("Emos_Identity", "OpenIddictScopes"):
        if column in {
            "Id", "ConcurrencyStamp", "CreationTime", "CreatorId", "DeleterId",
            "DeletionTime", "ExtraProperties", "IsDeleted", "LastModificationTime",
            "LastModifierId",
        }:
            return {
                **base, "classification": "excluded", "destination_relation": "",
                "destination_column": "", "transformation": "",
                "tenant_scope": "shared identity infrastructure explicitly excluded",
                "verification_status": "verified",
                "justification": "OpenIddict implementation/audit metadata is not customer data and has no V2 runtime destination",
            }
        return {
            **base, "classification": "unresolved",
            "destination_relation": "V2 backend authorization contract",
            "destination_column": "role/scope policy",
            "transformation": "identify VNO-required scopes and reproduce their authorization semantics",
            "tenant_scope": "global OpenIddict scope ownership unresolved",
            "verification_status": "blocked",
            "justification": "Nine global scopes exist but V2 has no scope-based authorization layer; required VNO scope semantics are not proven",
        }

    if key in {("Emos_MdmService", "AbpBlobs"), ("Emos_Cms", "AbpBlobs")}:
        blob_map = {
            "Id": mapping("public.media_assets", "legacy_blob_id"),
            "TenantId": mapping("public.media_assets", "legacy_tenant_id"),
            "Name": mapping("public.media_assets", "legacy_blob_name"),
            "Content": mapping("storage.objects + public.media_assets", "object_path;sha256_hex;size_bytes",
                transformed=True, transformation="stream to the approved private bucket; require source/destination byte length and SHA-256 equality"),
        }
        if column in blob_map:
            return {**base, **blob_map[column]}

    if key == ("Emos_Cms", "CmsMediaDescriptors") and column == "Id":
        return {**base, **mapping("public.media_assets", "legacy_cms_media_descriptor_id")}
    if key == ("Emos_Cms", "FmFileDescriptors") and column == "Id":
        return {**base, **mapping("public.media_assets", "legacy_file_descriptor_id")}

    if key == ("Emos_Identity", "AbpUsers") and column == "Email":
        return {**base, **mapping("auth.users + public.user_profiles + public.legacy_identity_map",
            "email;email;source_email_sha256", transformed=True,
            transformation="create controlled Supabase Auth identity, copy normalized operational email, store SHA-256 control hash; require password reset",
            status="blocked", justification="Auth import awaits accepted source snapshot and collision review; original row remains restricted archive content")}
    if key == ("Emos_Identity", "AbpUsers") and column in {"Name", "Surname", "UserName"}:
        return {**base, **mapping("public.user_profiles", "full_name", transformed=True,
            transformation="compose Name + Surname and fall back to UserName; archive every original component")}

    return base


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--summary", type=Path, required=True)
    parser.add_argument("--schema-object-output", type=Path, required=True)
    args = parser.parse_args()

    source_rows = parse_inventory(args.inventory)
    schema_objects = parse_schema_objects(args.inventory)
    literal_tenant_tables = {
        (row["database_name"], row["table_name"])
        for row in source_rows if row["column_name"] == "TenantId"
    }

    output_rows: list[dict[str, str]] = []
    for source in source_rows:
        base = default_disposition(source, literal_tenant_tables)
        disposition = special_disposition(source, base)
        output_rows.append({**source, **disposition})

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(output_rows)

    table_classes: dict[tuple[str, str], set[str]] = {}
    for row in output_rows:
        table_classes.setdefault((row["database_name"], row["table_name"]), set()).add(row["classification"])

    schema_output_rows: list[dict[str, str]] = []
    for item in schema_objects:
        key = (item["database_name"], item["table_name"])
        object_key = (item["database_name"], item["table_name"], item["record_type"], item["object_name"])
        destination = SCHEMA_OBJECT_MAP.get(object_key)
        if destination:
            disposition = {
                "classification": "mapped_equivalent", "v2_destination": destination,
                "verification_status": "verified",
                "justification": "Live V2 index/constraint introspection confirms the stable-ID or relationship equivalent",
            }
        elif table_classes.get(key) == {"excluded"}:
            disposition = {
                "classification": "excluded_non_vno_infrastructure", "v2_destination": "",
                "verification_status": "verified",
                "justification": "Owning source table is explicitly excluded from VNO customer-data export",
            }
        elif "unresolved" in table_classes.get(key, set()):
            disposition = {
                "classification": "unresolved", "v2_destination": "",
                "verification_status": "blocked",
                "justification": "Owning global configuration table is not safely attributable to VNO",
            }
        elif item["table_name"] in OPERATIONAL_TABLES:
            disposition = {
                "classification": "unresolved", "v2_destination": "",
                "verification_status": "blocked",
                "justification": "Operational source relationship/index lacks a verified V2 equivalent",
            }
        else:
            disposition = {
                "classification": "preserved_archive_metadata",
                "v2_destination": "public.legacy_source_records + versioned schema-object matrix",
                "verification_status": "verified",
                "justification": "Original keys remain in lossless payloads and this matrix preserves the source relationship/index definition",
            }
        schema_output_rows.append({**item, **disposition})

    args.schema_object_output.parent.mkdir(parents=True, exist_ok=True)
    with args.schema_object_output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=SCHEMA_OBJECT_FIELDS)
        writer.writeheader()
        writer.writerows(schema_output_rows)

    tables = {(row["database_name"], row["schema_name"], row["table_name"]) for row in output_rows}
    summary = {
        "inventory": str(args.inventory),
        "output": str(args.output),
        "column_count": len(output_rows),
        "table_count": len(tables),
        "database_count": len({row["database_name"] for row in output_rows}),
        "classification_counts": dict(sorted(Counter(row["classification"] for row in output_rows).items())),
        "verification_status_counts": dict(sorted(Counter(row["verification_status"] for row in output_rows).items())),
        "tenant_scope_counts": dict(sorted(Counter(row["tenant_scope"] for row in output_rows).items())),
        "excluded_count": sum(row["classification"] == "excluded" for row in output_rows),
        "schema_object_output": str(args.schema_object_output),
        "foreign_key_record_count": sum(row["record_type"] == "FOREIGN_KEY" for row in schema_objects),
        "index_column_record_count": sum(row["record_type"] == "INDEX" for row in schema_objects),
        "schema_object_classification_counts": dict(sorted(Counter(row["classification"] for row in schema_output_rows).items())),
    }
    args.summary.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
