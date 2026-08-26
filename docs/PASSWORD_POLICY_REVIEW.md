# Password Policy Review

Last reviewed: 2026-08-12

This document records the password policy enforced by Oddpath for new and
reset passwords. The policy follows the length-first direction in
[NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html) and the
[OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).

## Current Policy

`apps/api/src/modules/auth/auth.schema.ts` is the source of truth:

- Minimum: 15 characters because password auth is currently single-factor.
- Maximum: 128 characters, preventing unbounded `scrypt` work while allowing
  long passphrases and password-manager generated values.
- No letter, number, uppercase, lowercase, or symbol composition rule.
- Spaces, Unicode, and exact user input are allowed. Passwords are not trimmed
  or silently truncated.
- A case-insensitive exact-match blocklist rejects a local baseline of common,
  predictable, and Oddpath/Eluthira-specific passwords.
- Register `password` and reset-password `newPassword` share the same schema.
- Login accepts any non-empty value up to 128 characters. Creation rules are
  deliberately not reapplied while verifying existing credentials.

The blocklist comparison never changes the password that is hashed. Only a
lowercased comparison value is used to detect a blocked choice.

## Storage And Abuse Controls

- Passwords use Node `crypto.scrypt` with a random 16-byte salt and a 64-byte
  derived key.
- The stored form is `scrypt-v1$<salt>$<key>`; plaintext passwords are not
  stored.
- Login, register, forgot-password, reset-password, resend-verification, and
  verify-email have endpoint-specific throttles.
- The limiter combines per-IP throttling with a normalized-email throttle that
  remains effective when an attacker rotates IP addresses.
- A successful password reset invalidates every existing session for the user.
- Issuing a newer password-reset link invalidates older unused reset links.

## Remaining Production Work

The local blocklist is a useful baseline, not a complete compromised-password
corpus. Before a broad public launch, choose and test one of these approaches:

- A privacy-preserving breached-password check such as k-anonymity lookup.
- A maintained offline compromised-password dataset with an update process.

Do not send full candidate passwords to an external service. Also consider a
client-side strength meter as guidance, not as a replacement for the backend
policy.

The current in-memory rate limiter is correct for the planned single API
instance. Multiple API instances require a shared atomic store such as Redis.

## Test Coverage

Automated tests cover:

- Empty, too-short, exact-minimum, and over-maximum values.
- Passphrases and values without composition requirements.
- Common-password rejection for both registration and reset.
- Login maximum-length protection before password hashing work.
- Salted hashing, successful verification, wrong passwords, and malformed
  stored hashes.
- Reset-token expiry, one-time use, superseding links, and session
  invalidation.
- Per-IP and cross-IP normalized-email throttling plus `Retry-After` responses.
