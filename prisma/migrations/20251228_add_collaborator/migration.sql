-- Migration for Collaborator model and CollaboratorStatus enum

CREATE TYPE "CollaboratorStatus" AS ENUM ('DRAFT', 'ACTIVE');

CREATE TABLE "Collaborator" (
    "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "ownerUserId"        VARCHAR(255) NOT NULL,
    "fullName"           VARCHAR(255) NOT NULL,
    "phone"              VARCHAR(255) NOT NULL,
    "email"              VARCHAR(255) NOT NULL,
    "bankName"           VARCHAR(255) NOT NULL,
    "bankAccountNumber"  VARCHAR(255) NOT NULL,
    "status"             "CollaboratorStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt"          TIMESTAMP NOT NULL DEFAULT NOW(),
    "updatedAt"          TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT "Collaborator_ownerUserId_idx" INDEX ("ownerUserId")
);

CREATE INDEX "Collaborator_ownerUserId_idx" ON "Collaborator" ("ownerUserId");
