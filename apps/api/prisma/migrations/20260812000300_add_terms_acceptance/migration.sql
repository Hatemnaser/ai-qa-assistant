-- Existing accounts predate auditable terms acceptance, so both columns stay
-- nullable. Every new registration is required to write both values.
ALTER TABLE "User"
ADD COLUMN "acceptedTermsVersion" TEXT,
ADD COLUMN "acceptedTermsAt" TIMESTAMP(3),
ADD CONSTRAINT "User_terms_acceptance_pair_check"
CHECK (
  ("acceptedTermsVersion" IS NULL AND "acceptedTermsAt" IS NULL)
  OR
  (
    "acceptedTermsVersion" IS NOT NULL
    AND char_length("acceptedTermsVersion") BETWEEN 1 AND 64
    AND "acceptedTermsAt" IS NOT NULL
  )
);
