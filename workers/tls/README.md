# Public laboratory TLS fixture

`lab.crt` and `lab.key` are intentionally public synthetic test material generated for this project; they are not copied from a user or test server. The certificate name is `protocol-target-lab.test`. Built-in HTTPS and DNS-over-TLS clients validate this certificate and name, even when connecting to an IP address. External clients can use `lab.crt` as their test trust anchor and set the same server name.

These fixtures serve protocol testing. No management Web TLS or private credential upload is provided by this profile.
