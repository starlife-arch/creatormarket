# Manual Market verification

No external age-verification provider is connected yet. Until one is selected, an authorized Market administrator can record a manual verification decision through the Market admin console.

Before enabling either flag, the administrator must personally review reliable evidence:
- Age verification must establish the account holder is at least 18.
- Creator identity verification must establish the real-world identity of the person who will publish and receive creator earnings.

The admin endpoint requires an authenticated administrator session, a written reason, and an explicit confirmation token. It records the reviewer, timestamps, flags and reason in the shared user record and appends an immutable Market audit event.

Do not set either flag from a browser client, a self-entered date of birth, or a creator application alone. If a third-party verification provider is later selected, its server-to-server callback should replace manual flag setting.
