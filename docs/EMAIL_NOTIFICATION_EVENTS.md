# Maritime Link — Email notification events

Priority-tier events are wired in the API. Later-phase events are listed for reference.

## Implemented (priority)

| Event | Trigger location |
| --- | --- |
| Email verification | `sendOTPEmail` — auth registration |
| Password reset | `sendPasswordResetEmail` — auth |
| Account approved / rejected | `notifyAccountStage1Decision` — `PATCH /api/admin/recruiters/:id/status` |
| KYC submitted | `notifyKycSubmitted` — KYC selfie upload when pack complete |
| KYC approved / rejected | `notifyKycStatusChange` — admin KYC status endpoints |
| KYC resubmission requested | `notifyKycResubmissionRequested` — admin sets KYC status to `PENDING` |
| Document expiring / expired | `scripts/send-document-expiry-emails.ts` (daily cron) |
| Job application submitted | `notifyJobApplicationSubmitted` — `applyToJob` |
| New application received | (same — emails recruiter) |
| Invited to apply | `notifyJobInvitation` — job invite |
| Application status changed | `notifyApplicationStatusChanged` — recruiter updates status |
| Message received | `notifyMessageReceived` — `POST .../messages` |
| Course booking confirmed | `notifyCourseBookingPaymentSuccess` — Stripe webhook |
| New training booking | (same — emails trainer) |
| Support case created / updated | `notifySupportCaseEvent` — user + admin support APIs |
| Payment success / failure | `notifyPaymentOutcome` — Stripe membership + failed PI |

## Later phase

Job published, job expiring, trial ending, high demand signal, secure link shared confirmation, compliance status summary, training recommendations, account suspended/reinstated, etc.

## Environment

- `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- `FRONTEND_URL` — production app URL for all CTA links (e.g. `https://maritme-link-web.vercel.app`, not localhost)
