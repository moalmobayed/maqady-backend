---
title: 0004 — Send email through Resend; keep SMS simulated
status: Accepted
date: 2026-10-20
owner: Mohamed Tarek
last_verified: 2026-10-20
tags: [messaging, email, providers]
---

# 0004 — Send email through Resend; keep SMS simulated

## Context
The approved design first simulated email and SMS. Every message was stored in a `messages`
table that admins could read, and nothing left the platform.

Simulated email has a hidden cost. Verification, password-reset and staff-invite links must
reach a person, so the design let admins reveal those secret links in the Message log. That let
any admin act as a staff member before they set their password. The owner chose to send real
email through a free provider.

Resend's free plan covers about 3,000 emails a month and 100 a day. Sending to any address
other than the account owner's requires a domain verified in Resend. There is no free SMS
service that can text arbitrary numbers.

## Decision
- Email is sent through Resend's HTTP API, behind an `EmailSender` interface. SMS stays
  simulated behind an `SmsSender` interface.
- `messages` becomes an outbox and delivery log. A message is written as `queued` in the
  transaction that caused it and sent after commit. Its status (`queued`, `sent`, `failed`), its
  attempts and Resend's message id are recorded. Queued and failed messages are retried
  opportunistically.
- One-time links appear only in the email itself. The stored copy has them redacted, and the
  Message log never reveals them. The reveal setting and PRD veto call 16 are withdrawn.
- The decision register's D-05 changes from "simulated payment, email and SMS" to "simulated
  payment and SMS; email through Resend".

## Consequences
- **Real email, no admin back door.** Customers and staff receive real verification, reset,
  invite and ticket emails, and no admin can see a usable one-time link.
- **A verified domain is needed.** Until one is set up, Resend delivers only to the account
  owner's own address. That is enough for development, not for real customers.
- **The daily cap can delay email.** At 100 emails a day, cancelling a full showtime can exceed
  the cap. Emails over it wait in the queue and go out the next day.
- **A new external dependency.** Integration tests replace Resend at the adapter boundary, as
  the testing policy allows for genuinely external services. Delivery failures are visible in
  the Message log.
- **Retries happen on activity.** No timer runs, so a queued email waits for the next write
  request or the daily keep-alive ping. Delivery can be late, but data is never wrong.

## Alternatives considered
- **Keep email simulated.** No domain is needed, but someone must see secret links in the
  Message log, which lets admins impersonate staff.
- **Gmail SMTP with an app password.** No domain is needed and the limit is higher, but it
  sends from a personal mailbox. Deliverability and From-address limits make it a poor fit
  for a product.
- **Other free email APIs (for example Brevo).** Similar free limits. The owner chose Resend for
  its simple API.

## Amendments
- **2026-10-20, U3 (#3): `failed` is terminal.** The Decision's "Queued and failed messages are
  retried opportunistically" is narrowed: only `queued` messages are retried. A temporary failure
  is retried at most 10 times and then marked `failed` (`attempts_exhausted`); a refusal that can
  never succeed is marked `failed` at once. Nothing resends a `failed` message. See design §13.1
  and `docs/gh-3-messaging/spec.md` ("Decisions taken here").

Sources: [Resend free tier summary](https://automationatlas.io/answers/resend-free-tier-explained-2026/),
[Resend: sending with the test domain](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).
