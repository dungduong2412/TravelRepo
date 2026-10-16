import assert from 'node:assert/strict';
import { AdminUpdateMerchantSchema, CreateMerchantMemberSchema, UpdateMerchantSchema } from '../src/modules/merchants/merchants.dto';
import { AdminUpdateCollaboratorSchema, UpdateCollaboratorSchema } from '../src/modules/collaborators/collaborators.dto';
import { UpdateManagedUserProfileSchema } from '../src/modules/user-profiles/user-profiles.dto';
import { UploadMediaSchema } from '../src/modules/media/media.dto';
import { hasExpectedImageSignature } from '../src/modules/media/media.service';

const uuidA = '11111111-1111-4111-8111-111111111111';
const uuidB = '22222222-2222-4222-8222-222222222222';

assert.equal(UpdateMerchantSchema.safeParse({ merchant_name: 'Safe edit', owner_phone: '0900000000' }).success, true);
assert.equal(UpdateMerchantSchema.safeParse({ merchant_verified: true }).success, false);
assert.equal(UpdateMerchantSchema.safeParse({ merchants_status: 'active' }).success, false);
assert.equal(AdminUpdateMerchantSchema.safeParse({ merchant_verified: true, merchants_status: 'active' }).success, true);

assert.equal(UpdateCollaboratorSchema.safeParse({ collaborators_name: 'Safe edit' }).success, true);
assert.equal(UpdateCollaboratorSchema.safeParse({ collaborators_verified: true }).success, false);
assert.equal(UpdateCollaboratorSchema.safeParse({ collaborators_status: 'active' }).success, false);
assert.equal(AdminUpdateCollaboratorSchema.safeParse({ collaborators_verified: true, collaborators_status: 'active' }).success, true);

assert.equal(UpdateManagedUserProfileSchema.safeParse({ role: 'merchant', user_profiles_status: 'active', merchant_id: uuidA, collaborator_id: null }).success, true);
assert.equal(UpdateManagedUserProfileSchema.safeParse({ role: 'merchant', user_profiles_status: 'active', merchant_id: null, collaborator_id: uuidB }).success, false);
assert.equal(UpdateManagedUserProfileSchema.safeParse({ role: 'admin', user_profiles_status: 'active', merchant_id: uuidA, collaborator_id: null }).success, false);

assert.equal(CreateMerchantMemberSchema.safeParse({ collaborators_name: 'Member', collaborators_phone: '0900000000', collaborators_email: 'member@example.test', collaborators_password: 'StrongPassword1!' }).success, true);
assert.equal(CreateMerchantMemberSchema.safeParse({ collaborators_name: 'Member', collaborators_phone: '0900000000', collaborators_email: 'member@example.test', collaborators_password: 'weak' }).success, false);

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const webp = Buffer.from('RIFF0000WEBP', 'ascii');
assert.equal(hasExpectedImageSignature(png, 'image/png'), true);
assert.equal(hasExpectedImageSignature(jpeg, 'image/jpeg'), true);
assert.equal(hasExpectedImageSignature(webp, 'image/webp'), true);
assert.equal(hasExpectedImageSignature(png, 'image/jpeg'), false);
assert.equal(UploadMediaSchema.safeParse({ filename: 'a.png', mime_type: 'image/png', size_bytes: png.length, base64_data: png.toString('base64') }).success, true);
assert.equal(UploadMediaSchema.safeParse({ filename: 'a.gif', mime_type: 'image/gif', size_bytes: 4, base64_data: 'R0lG' }).success, false);
assert.equal(UploadMediaSchema.safeParse({ filename: 'a.png', mime_type: 'image/png', size_bytes: png.length, base64_data: 'not base64!' }).success, false);

console.log('D6 contract tests: PASS (20 assertions)');
