# Password Policy Review

Last reviewed: 2026-06-20

This document reviews the current password validation and hashing behavior.
Slice 4B is implemented: password policy constants are explicit, and login now
has the same maximum password length guard as register/reset before password
verification work can run.

## 1. Current Password Validation Rules

The password policy is defined in
`apps/api/src/modules/auth/auth.schema.ts` as `passwordSchema`:

- Password must be a string.
- Minimum length: 8 characters.
- Maximum length: 128 characters.
- Must include at least one ASCII letter: `[A-Za-z]`.
- Must include at least one digit: `[0-9]`.

The schema is used by:

- `registerRequestSchema.password`.
- `resetPasswordRequestSchema.newPassword`.

Login uses a separate minimal validation rule:

- `loginRequestSchema.password`: string with at least 1 character and at most
  128 characters.

Passwords are not trimmed or normalized before hashing or verification. This is
good because spaces and exact user input remain part of the password.

## 2. Do Register And Reset Password Use The Same Policy?

Yes.

Register and reset-password both use the same shared `passwordSchema` from
`auth.schema.ts`:

- Register validates `password`.
- Reset-password validates `newPassword`.

The policy is enforced at the controller/schema boundary before
`auth.service.register` hashes a new account password and before
`auth.service.resetPassword` hashes a replacement password.

Important boundary note:

- `auth.service.ts` and `auth.security.ts` do not independently validate
  password strength or length.
- This is acceptable for the current route flow because controllers parse Zod
  schemas first.
- Future internal callers must either reuse the same schema or password
  validation should be centralized in a service-level helper.

## 3. Current Minimum Length

The current minimum length for new passwords is:

- 8 characters.

This applies to:

- Registration.
- Reset-password.

Login only requires a non-empty password because login should verify an
existing secret rather than apply creation policy.

## 4. Empty Or Very Short Passwords

Registration:

- Empty passwords are rejected.
- Passwords shorter than 8 characters are rejected.
- Passwords without at least one letter and one number are rejected.

Reset-password:

- Empty `newPassword` values are rejected.
- `newPassword` values shorter than 8 characters are rejected.
- `newPassword` values without at least one letter and one number are rejected.

Login:

- Empty passwords are rejected.
- Very short passwords are allowed through validation and then checked against
  the stored hash. This is normal for login correctness.
- Passwords longer than 128 characters are rejected before password
  verification.

## 5. Maximum Length / Hashing DoS Protection

New password flows have a max length:

- Registration password max: 128 characters.
- Reset-password `newPassword` max: 128 characters.

This is good because it prevents extremely large new passwords from being sent
into `crypto.scrypt` during account creation and reset.

Slice 4B hardening:

- Login password validation now has the same 128-character maximum length.
- Oversized login passwords are rejected with `VALIDATION_ERROR` before
  password verification and `crypto.scrypt` work.
- Login still does not apply the register/reset letter-plus-number creation
  policy, which keeps credential verification generic for existing users.

## 6. Error Message Sensitivity

Creation/reset validation errors:

- Zod validation returns `VALIDATION_ERROR`.
- The response includes `issues` with field paths and messages such as:
  - `Password must be at least 8 characters.`
  - `Password must be 128 characters or fewer.`
  - `Password must include at least one letter.`
  - `Password must include at least one number.`

These messages reveal the password policy, but they do not reveal account
existence, stored credentials, reset tokens, session tokens, or password
hashes. This is acceptable for user-facing password creation feedback.

Login errors:

- Missing user and wrong password return the same generic
  `INVALID_CREDENTIALS` response.
- This is good.

Reset-token errors:

- Invalid, expired, and used reset tokens return the same generic
  `INVALID_RESET_TOKEN` response.
- This is good.

Forgot-password:

- Existing and missing emails return the same generic response.
- This is good.

## 7. Is The Policy Suitable For MVP / Real Users?

MVP/private demo:

- Risk level: low.
- The current policy is acceptable for an MVP because it blocks empty,
  extremely short, digit-only, letter-only, and overly long new passwords.
- Oversized login passwords are blocked before hashing work.
- Password hashing uses `scrypt` with per-password random salts.
- Auth rate limiting and reset-password rate limiting are already present.

Real users:

- Risk level: low-to-medium.
- The current policy is usable, but common-password and breached-password
  checks remain deferred.

Main concerns before real users:

- The current composition requirement, letter plus number, may reject strong
  passphrases while still allowing predictable passwords such as
  `Password1`.
- There is no common-password or breached-password check.
- There is no password strength meter or frontend reset-completion page yet.
- Full register/login/reset success flows against a real test database are
  still broader auth smoke-test work.

## 8. Recommended Slice 4B Implementation Plan

### Implemented In Slice 4B

- Added named password policy constants for minimum and maximum length.
- Reused the maximum length in register, reset-password, and login validation.
- Added a max length to login password validation before `verifyPassword` runs.
- Added explicit tests for register password boundaries:
  - empty.
  - shorter than minimum.
  - exactly minimum.
  - over maximum.
  - missing letter.
  - missing number.
- Added explicit tests for reset-password `newPassword` boundaries.
- Added login tests for empty, oversized, and composition-free password
  validation.
- Added security helper tests for password hashing and verification behavior.

### Must Have Before Real Users

- Review whether to replace the letter/number composition rule with a longer
  minimum length plus common-password blocking.
- Add common-password rejection for very common values such as `Password1`,
  `Password123`, and similar known weak choices.

### Should Have Soon

- Consider using a maintained password-strength estimator if product scope
  needs richer guidance.
- Add frontend form hints that match backend policy without duplicating hidden
  business rules.

### Optional Later

- Add breached-password screening, for example through a privacy-preserving
  k-anonymity API or offline list, if real-user risk justifies it.
- Add password-change flow for signed-in users.
- Add password history or reuse prevention only if product/security needs it;
  avoid adding it by default because it can create extra storage and UX
  complexity.
- Revisit hashing parameters and possible migration path if the user base or
  threat model grows.

## 9. Required Tests

Backend schema/API tests:

- [x] Register rejects an empty password.
- [x] Register rejects a password shorter than 8 characters.
- [x] Register accepts a password exactly at the minimum when it has a letter and
  number.
- [x] Register rejects a password over 128 characters.
- [x] Register rejects a password without a letter.
- [x] Register rejects a password without a number.
- [x] Reset-password rejects an empty `newPassword`.
- [x] Reset-password rejects a `newPassword` shorter than 8 characters.
- [x] Reset-password accepts a `newPassword` exactly at the minimum when it has a
  letter and number.
- [x] Reset-password rejects a `newPassword` over 128 characters.
- [x] Reset-password rejects a `newPassword` without a letter.
- [x] Reset-password rejects a `newPassword` without a number.
- [x] Login rejects an empty password.
- [x] Login rejects an oversized password before password verification.
- [x] Password validation failures return `VALIDATION_ERROR`.
- [x] Login with missing user and wrong password keeps the same generic
  `INVALID_CREDENTIALS` response.

Service/security tests:

- [x] `hashPassword` produces different hashes for the same password because salts
  are random.
- [x] `verifyPassword` accepts the correct password and rejects an incorrect one.
- [x] `verifyPassword` rejects malformed or unknown hash versions.
- [x] Reset-password still invalidates existing sessions after a valid password
  update.

Frontend tests, when Slice 4B includes frontend hints:

- Register form prevents or surfaces backend policy failures cleanly.
- Reset-password form, once implemented, surfaces backend policy failures
  cleanly.
- Frontend messages match backend password-policy messages closely enough to
  avoid user confusion.
