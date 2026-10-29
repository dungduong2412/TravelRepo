import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AdminUpdateMerchantSchema,
  CreateMerchantSchema,
} from '../src/modules/merchants/merchants.dto';
import { CreateCollaboratorSchema } from '../src/modules/collaborators/collaborators.dto';
import { CreateUatSimulationTransactionSchema } from '../src/modules/transactions/transactions.dto';
import {
  fractionToPercentagePoints,
  percentagePointsToFraction,
} from '../../frontend/lib/rates';

let controls = 0;
function check(value: unknown, message: string) { assert.ok(value, message); controls += 1; }

check(fractionToPercentagePoints('0.0000') === '0', 'zero fraction');
check(fractionToPercentagePoints('0.0001') === '0.01', 'fractional percentage');
check(fractionToPercentagePoints('0.1000') === '10', 'ten percent display');
check(fractionToPercentagePoints('1.0000') === '100', 'upper boundary display');
check(percentagePointsToFraction('0') === '0.0000', 'zero percentage input');
check(percentagePointsToFraction('0.01') === '0.0001', 'small percentage input');
check(percentagePointsToFraction('10') === '0.1000', 'ten percentage points input');
check(percentagePointsToFraction('100') === '1.0000', 'upper boundary input');
for (const invalid of ['-1', '100.01', '10.001', 'abc']) {
  assert.throws(() => percentagePointsToFraction(invalid)); controls += 1;
}

for (const rate of ['0', '0.0001', '0.1', '1.0000']) {
  check(AdminUpdateMerchantSchema.safeParse({ merchant_commission_type: 'percentage', merchant_commission_value: rate }).success, `valid fractional rate ${rate}`);
}
check(!AdminUpdateMerchantSchema.safeParse({ merchant_commission_type: 'percentage', merchant_commission_value: '1.0001' }).success, 'fraction above one rejected');
check(AdminUpdateMerchantSchema.safeParse({ merchant_commission_type: 'fixed', merchant_commission_value: '100000.0000' }).success, 'fixed amount is not treated as a fraction');
check(AdminUpdateMerchantSchema.safeParse({ merchant_commission_type: 'percentage', merchant_commission_value: null }).success, 'null is preserved');

const merchantApplication = {
  owner_email: 'merchant@example.test',
  merchant_name: 'Synthetic Merchant',
};
check(CreateMerchantSchema.safeParse(merchantApplication).success, 'verified Merchant application contract');
check(!CreateMerchantSchema.safeParse({ ...merchantApplication, owner_password: 'MustNotReachBackend!42' }).success, 'Merchant password rejected by business API');
check(!CreateMerchantSchema.safeParse({ ...merchantApplication, merchant_commission_value: 10 }).success, 'Applicant commercial rate rejected');

const collaboratorApplication = {
  collaborators_name: 'Synthetic Collaborator',
  collaborators_phone: '0900000000',
  collaborators_email: 'collaborator@example.test',
};
check(CreateCollaboratorSchema.safeParse(collaboratorApplication).success, 'verified Collaborator application contract');
check(!CreateCollaboratorSchema.safeParse({ ...collaboratorApplication, collaborators_password: 'MustNotReachBackend!42' }).success, 'Collaborator password rejected by business API');

const repository = resolve(__dirname, '../..');
const merchantController = readFileSync(resolve(repository, 'backend/src/modules/merchants/merchants.controller.ts'), 'utf8');
const collaboratorController = readFileSync(resolve(repository, 'backend/src/modules/collaborators/collaborators.controller.ts'), 'utf8');
const transactionController = readFileSync(resolve(repository, 'backend/src/modules/transactions/transactions.controller.ts'), 'utf8');
const qrService = readFileSync(resolve(repository, 'backend/src/modules/collaborators/collaborators.service.ts'), 'utf8');
check(!/@Post\(\)\s*\n\s*@Public\(\)/.test(merchantController), 'Merchant application API requires JWT');
check(!/@Post\(\)\s*\n\s*@Public\(\)/.test(collaboratorController), 'Collaborator application API requires JWT');
check(transactionController.includes("@Post('simulation')"), 'isolated UAT simulation endpoint exists');
for (const forbiddenMutation of ['confirm', 'cancel', 'reverse', 'pay', 'settle', 'payout']) {
  check(!transactionController.includes(`@Post('${forbiddenMutation}')`), `${forbiddenMutation} mutation remains disabled`);
}
check(qrService.includes('qr_payload_format: \'collaborator_code\''), 'QR payload remains collaborator code only');

check(CreateUatSimulationTransactionSchema.safeParse({
  collaborator_code: 'D2-TEST-C', gross_amount: '1234.5678', idempotency_key: '13000000-0000-5000-8000-000000000001',
}).success, 'four-decimal UAT simulation input accepted');
check(!CreateUatSimulationTransactionSchema.safeParse({
  collaborator_code: 'D2-TEST-C', gross_amount: '1234.56789', idempotency_key: '13000000-0000-5000-8000-000000000001',
}).success, 'more than four decimals rejected');
check(!CreateUatSimulationTransactionSchema.safeParse({
  collaborator_code: 'D2-TEST-C', gross_amount: '1234.0000', idempotency_key: 'not-a-uuid',
}).success, 'invalid idempotency key rejected');

console.log(`D13A contracts: PASS (${controls} assertions)`);
