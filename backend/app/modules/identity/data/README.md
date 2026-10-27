# common_passwords.txt — local password denylist (plan V2.5)

- **Source:** SecLists `Passwords/Common-Credentials/xato-net-10-million-passwords-100000.txt`
  (top 100,000 passwords from Mark Burnett's 10M dataset, released into the public domain;
  SecLists is MIT-licensed, Copyright (c) 2018 Daniel Miessler).
  Retrieved 2026-10-27; source file SHA-256
  `1472aafa2561df5e3293aee252aee3ca660c12b399a283cf808bb01b39be388b`.
- **Filtering:** only entries 12–128 characters long are kept (lowercased, de-duplicated),
  because the password policy already rejects anything shorter than 12 characters.
  483 entries remain. Breached passwords of any length are additionally caught by the
  Pwned Passwords range check.
- **Regenerate** (if the minimum length changes):

  ```bash
  curl -sSfL https://raw.githubusercontent.com/danielmiessler/SecLists/master/Passwords/Common-Credentials/xato-net-10-million-passwords-100000.txt \
    | tr -d '\r' | awk 'length($0)>=12 && length($0)<=128' | tr 'A-Z' 'a-z' | LC_ALL=C sort -u \
    > common_passwords.txt
  ```
