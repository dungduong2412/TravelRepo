import { z } from 'zod';

/** Phone numbers are accepted the way people type them ("+84 912 345 678", "0912.345.678") and stored without separators. */
export const normalisePhone = (raw: string) => raw.replace(/[\s.\-()]/g, '');

/**
 * The ONE registration form: only what the application needs. Everything else (bank details, avatar, ...) is edited in the Partner Portal after
 * activation. `website` is a honeypot field that people never see; a value there means a bot filled the form.
 */
export const PartnerRegistrationSchema = z.object({
  full_name: z.string().trim().min(2).max(200),
  phone: z.string().trim().min(7).max(30).refine((v) => /^\+?[0-9]{9,15}$/.test(normalisePhone(v)), 'Invalid phone number'),
  email: z.string().trim().toLowerCase().max(254).email(),
  website: z.string().max(200).optional(),
}).strict();

export type PartnerRegistrationDto = z.infer<typeof PartnerRegistrationSchema>;

/** `exists` carries a coarse state only: it is enough to tell the person what to do next and reveals no name, role, phone or record id. */
export type RegistrationResult =
  | { outcome: 'created'; status: 'pending'; reference: string }
  | { outcome: 'exists'; state: 'pending' | 'active' | 'support' };
