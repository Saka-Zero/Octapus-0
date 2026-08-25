<!--
  Bundled with Octapus-0
  Source: kalshamsi/claude-security-skills (MIT)
-->

---
name: crypto-audit
description: "Use when reviewing code for weak encryption, hardcoded cryptographic keys, insecure TLS/SSL configuration, broken hashing, bad randomness, or any cryptographic implementation concern — regardless of language."
keywords: crypto, cryptography, encryption, aes, rsa, jwt secret, hashing, md5, sha1 weak, tls, certificate
---

# Crypto Audit

This skill performs static code analysis for cryptographic vulnerabilities across JavaScript/TypeScript, Python, Go, Java, and Rust projects. It identifies 12 common crypto anti-patterns — weak algorithms, hardcoded keys, insecure randomness, insufficient key sizes, and more — mapping each finding to CWE and OWASP Top 10:2021 standards with concrete UNSAFE/SAFE code pairs for remediation.

## When to Use

- When the user asks to "audit crypto", "review cryptographic code", or "check for weak encryption"
- When the user mentions "crypto audit", "cryptographic review", or "insecure crypto"
- When scanning code that imports cryptographic libraries (e.g., `crypto`, `hashlib`, `javax.crypto`, `crypto/tls`)
- When reviewing code for compliance with cryptographic standards (FIPS, PCI-DSS)
- When a pull request modifies encryption, hashing, TLS configuration, or key management code
- When the user asks about "hardcoded keys", "weak hashing", "insecure random", or "deprecated TLS"

## When NOT to Use

- When the user is asking about non-cryptographic security issues (use `bandit-sast` or `security-review`)
- When the user wants runtime TLS scanning of live servers (use a DAST tool like `testssl.sh`)
- When reviewing general code quality unrelated to cryptography
- When the `security-review` skill already covers the request at a general level
- When the user is asking about SQL injection, API security, or input validation — you **MUST** decline and recommend `api-security-tester`, `security-review`, or `bandit-sast`
- When the user wants to scan dependencies for supply chain issues — you **MUST** decline and recommend `socket-sca`

## Prerequisites

### Tool Installed (Preferred)

No external tool required. This skill uses code analysis only.

All 12 checks are performed through pattern matching and code inspection — no CLI tool needs to be installed, configured, or invoked.

### Tool Not Installed (Fallback)

This skill is always available as a pure analysis skill. There is no fallback mode because there is no external tool dependency. All checks run directly through code analysis.

## Workflow

1. **Detect project languages** — Inspect project files to determine which languages are in use: `package.json` or `*.ts`/`*.js` (JavaScript/TypeScript), `requirements.txt`/`*.py` (Python), `go.mod`/`*.go` (Go), `pom.xml`/`*.java` (Java), `Cargo.toml`/`*.rs` (Rust).
2. **Identify crypto-relevant files** — Search for files that import cryptographic modules:
   - JavaScript/TypeScript: `require('crypto')`, `import crypto`, `require('node-forge')`
   - Python: `import hashlib`, `from cryptography`, `from Crypto`, `import ssl`
   - Go: `import "crypto/`, `import "crypto/tls"`, `import "crypto/rsa"`
   - Java: `import javax.crypto`, `import java.security`, `import javax.net.ssl`
   - Rust: `use ring::`, `use openssl::`, `use aes::`, `use sha2::`
3. **Run the 12 crypto anti-pattern checks** against each identified file (see Checks section below).
4. **For each finding:**
   a. Determine severity (Critical / High / Medium / Low) using the Reference Tables
   b. Map to the relevant CWE identifier
   c. Map to the relevant OWASP Top 10:2021 category
   d. Record file path and line number
   e. Generate the UNSAFE pattern found and the corresponding SAFE fix
   f. Draft a remediation recommendation
5. **Deduplicate and sort** findings by severity: Critical > High > Medium > Low.
6. **Generate the findings report** using the Findings Format below.
7. **Summarize** — State total findings, breakdown by severity, and top 3 remediation priorities.

## Checks

### Check 1: Weak Hash Algorithms (MD5, SHA1) for Security Purposes

**CWE-328** (Use of Weak Hash) | **A02:2021** - Cryptographic Failures | Severity: **High**

**WHY:** MD5 and SHA1 are cryptographically broken. MD5 collisions can be generated in seconds; SHA1 collisions have been demonstrated practically (SHAttered attack). Using them for password hashing, integrity verification, or digital signatures allows attackers to forge data or crack passwords.

**UNSAFE:**

```javascript
// JavaScript — MD5 for password hashing
const crypto = require('crypto');
const hash = crypto.createHash('md5').update(password).digest('hex');
```

```python
# Python — SHA1 for token generation
import hashlib
token = hashlib.sha1(user_id.encode()).hexdigest()
```

```go
// Go — MD5 for file integrity
import "crypto/md5"
h := md5.Sum(data)
```

```java
// Java — MD5 digest
import java.security.MessageDigest;
MessageDigest md = MessageDigest.getInstance("MD5");
```

**SAFE:**

```javascript
// Use SHA-256 or SHA-3 for integrity; bcrypt/scrypt/argon2 for passwords
const crypto = require('crypto');
const hash = crypto.createHash('sha256').update(data).digest('hex');
// For passwords: use bcrypt
const bcrypt = require('bcrypt');
const hashed = await bcrypt.hash(password, 12);
```

```python
# Use SHA-256 for integrity; bcrypt/argon2 for passwords
import hashlib
digest = hashlib.sha256(data).hexdigest()
# For passwords:
import bcrypt
hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt())
```

---

### Check 2: Hardcoded Cryptographic Keys and IVs

**CWE-321** (Use of Hard-coded Cryptographic Key) | **A02:2021** - Cryptographic Failures | Severity: **Critical**

**WHY:** Hardcoded keys are extractable from source code, version control, or compiled binaries. Anyone with access to the codebase can decrypt all data encrypted with that key. Key rotation becomes impossible without redeploying code.

**UNSAFE:**

```python
# Python — hardcoded AES key and IV
from Crypto.Cipher import AES
KEY = b'mysecretkey12345'
IV = b'0000000000000000'
cipher = AES.new(KEY, AES.MODE_CBC, IV)
```

```javascript
// JavaScript — hardcoded encryption key
const key = 'hardcoded-secret-key-1234567890ab';
const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
```

```java
// Java — hardcoded key bytes
byte[] keyBytes = "MySuperSecretKey".getBytes();
SecretKeySpec keySpec = new SecretKeySpec(keyBytes, "AES");
```

**SAFE:**

```python
# Load keys from environment variables or a secrets manager
import os
from Crypto.Cipher import AES
KEY = os.environ['ENCRYPTION_KEY'].encode()
IV = os.urandom(16)  # Generate random IV per encryption
cipher = AES.new(KEY, AES.MODE_CBC, IV)
```

```javascript
// Load key from environment, generate IV per operation
const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
const iv = crypto.randomBytes(16);
const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
```

---

### Check 3: Insecure Random Number Generation

**CWE-330** (Use of Insufficiently Random Values) | **A02:2021** - Cryptographic Failures | Severity: **High**

**WHY:** Non-cryptographic PRNGs like `Math.random()`, Python's `random.random()`, and Go's `math/rand` produce predictable output. An attacker who knows or guesses the seed can reproduce the entire sequence, compromising session tokens, OTPs, password reset tokens, and nonces.

**UNSAFE:**

```javascript
// JavaScript — Math.random() for session token
const sessionId = Math.random().toString(36).substring(2);
```

```typescript
// TypeScript — Math.random() for OTP
const otp = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
```

```python
# Python — random module for token generation
import random
token = ''.join(random.choices('abcdef0123456789', k=32))
```

```go
// Go — math/rand for secret generation
import "math/rand"
token := rand.Intn(999999)
```

**SAFE:**

```javascript
// Use crypto.randomBytes or crypto.randomUUID
const crypto = require('crypto');
const sessionId = crypto.randomBytes(32).toString('hex');
// Or: const sessionId = crypto.randomUUID();
```

```python
# Use secrets module
import secrets
token = secrets.token_hex(32)
otp = secrets.randbelow(1000000)
```

```go
// Use crypto/rand
import "crypto/rand"
import "math/big"
n, _ := rand.Int(rand.Reader, big.NewInt(999999))
```

---

### Check 4: Weak Key Sizes

**CWE-326** (Inadequate Encryption Strength) | **A02:2021** - Cryptographic Failures | Severity: **High**

**WHY:** Short keys reduce the cost of brute-force attacks. RSA keys under 2048 bits can be factored with modern hardware. AES-128 is acceptable but AES-256 is recommended for long-term security. EC keys under 256 bits are insufficient.

**UNSAFE:**

```go
// Go — 1024-bit RSA key (factorable)
import "crypto/rsa"
key, _ := rsa.GenerateKey(rand.Reader, 1024)
```

```java
// Java — 1024-bit RSA
KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
kpg.initialize(1024);
```

```python
# Python — 1024-bit RSA
from cryptography.hazmat.primitives.asymmetric import rsa
private_key = rsa.generate_private_key(public_exponent=65537, key_size=1024)
```

**SAFE:**

```go
// Use at least 2048-bit RSA (4096 recommended for long-term)
key, _ := rsa.GenerateKey(rand.Reader, 4096)
```

```java
// Use 2048+ bit RSA or 256+ bit EC
KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
kpg.initialize(4096);
```

```python
# Use 2048+ bit RSA
private_key = rsa.generate_private_key(public_exponent=65537, key_size=4096)
```

---

### Check 5: AES in ECB Mode

**CWE-327** (Use of a Broken or Risky Cryptographic Algorithm) | **A02:2021** - Cryptographic Failures | Severity: **High**

**WHY:** ECB mode encrypts each block independently, so identical plaintext blocks produce identical ciphertext blocks. This leaks patterns in the data (the "ECB penguin" problem) and makes the ciphertext vulnerable to block swapping and replay attacks.

**UNSAFE:**

```java
// Java — AES in ECB mode
import javax.crypto.Cipher;
Cipher cipher = Cipher.getInstance("AES/ECB/PKCS5Padding");
```

```python
# Python — ECB mode
from Crypto.Cipher import AES
cipher = AES.new(key, AES.MODE_ECB)
```

```go
// Go — ECB-like usage (manually encrypting blocks)
block, _ := aes.NewCipher(key)
block.Encrypt(dst, src) // single block encryption = ECB behavior
```

**SAFE:**

```java
// Use AES-GCM (authenticated encryption) or AES-CBC with HMAC
Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
GCMParameterSpec spec = new GCMParameterSpec(128, iv);
cipher.init(Cipher.ENCRYPT_MODE, keySpec, spec);
```

```python
# Use AES-GCM
from Crypto.Cipher import AES
cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
ciphertext, tag = cipher.encrypt_and_digest(plaintext)
```

---

### Check 6: Missing HMAC Verification (Verify Before Decrypt)

**CWE-327** (Use of a Broken or Risky Cryptographic Algorithm) | **A02:2021** - Cryptographic Failures | Severity: **Medium**

**WHY:** Decrypting without first verifying message integrity enables padding oracle attacks, bit-flipping attacks, and chosen-ciphertext attacks. The decrypt-then-verify pattern (or skipping verification entirely) allows attackers to manipulate ciphertext and recover plaintext.

**UNSAFE:**

```javascript
// JavaScript — decrypt without verifying HMAC
const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
plaintext += decipher.final('utf8');
// No HMAC check — ciphertext may have been tampered with
```

```python
# Python — no integrity check before decrypt
cipher = AES.new(key, AES.MODE_CBC, iv)
plaintext = cipher.decrypt(ciphertext)
```

**SAFE:**

```javascript
// Verify HMAC before decrypting, or use AES-GCM which includes authentication
const hmac = crypto.createHmac('sha256', hmacKey);
hmac.update(ciphertext);
const computedMac = hmac.digest();
if (!crypto.timingSafeEqual(computedMac, receivedMac)) {
  throw new Error('HMAC verification failed — ciphertext tampered');
}
// Only then decrypt
const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
```

```python
# Use AES-GCM (built-in authentication)
cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
plaintext = cipher.decrypt_and_verify(ciphertext, tag)
```

---

### Check 7: IV Reuse / Static IV

**CWE-329** (Generation of Predictable IV with CBC Mode) | **A02:2021** - Cryptographic Failures | Severity: **High**

**WHY:** Reusing an IV with the same key in CBC mode leaks information about whether two plaintexts share a common prefix. In CTR/GCM mode, IV reuse is catastrophic — it allows XOR of plaintexts and complete key recovery via nonce-misuse attacks.

**UNSAFE:**

```javascript
// JavaScript — static IV
const iv = Buffer.from('0000000000000000');
const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
```

```python
# Python — reusing IV constant
IV = b'\x00' * 16
cipher = AES.new(key, AES.MODE_CBC, IV)
```

```java
// Java — hardcoded IV
byte[] iv = new byte[16]; // all zeros
IvParameterSpec ivSpec = new IvParameterSpec(iv);
```

**SAFE:**

```javascript
// Generate a fresh random IV for every encryption operation
const iv = crypto.randomBytes(16);
const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
// Prepend IV to ciphertext for storage/transmission
```

```python
# Generate random IV per operation
iv = os.urandom(16)
cipher = AES.new(key, AES.MODE_CBC, iv)
```

```java
// Generate random IV
SecureRandom random = new SecureRandom();
byte[] iv = new byte[16];
random.nextBytes(iv);
IvParameterSpec ivSpec = new IvParameterSpec(iv);
```

---

### Check 8: Improper Certificate Validation

**CWE-295** (Improper Certificate Validation) | **A07:2021** - Security Misconfiguration | Severity: **Critical**

**WHY:** Disabling TLS certificate verification allows man-in-the-middle attacks. An attacker on the network can intercept, read, and modify all traffic — even though it is "encrypted" — because the client accepts any certificate, including the attacker's.

**UNSAFE:**

```python
# Python — disabled certificate verification
import requests
response = requests.get('https://api.example.com', verify=False)
```

```javascript
// Node.js — disabling TLS verification
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
// Or:
const agent = new https.Agent({ rejectUnauthorized: false });
```

```go
// Go — InsecureSkipVerify
import "crypto/tls"
tlsConfig := &tls.Config{
    InsecureSkipVerify: true,
}
```

```java
// Java — trust all certificates
TrustManager[] trustAll = new TrustManager[]{
    new X509TrustManager() {
        public void checkClientTrusted(X509Certificate[] certs, String authType) {}
        public void checkServerTrusted(X509Certificate[] certs, String authType) {}
        public X509Certificate[] getAcceptedIssuers() { return null; }
    }
};
```

**SAFE:**

```python
# Always verify certificates (default behavior)
response = requests.get('https://api.example.com')  # verify=True is default
# For custom CA: verify='/path/to/ca-bundle.crt'
```

```go
// Use default TLS config (verifies certificates)
tlsConfig := &tls.Config{
    MinVersion: tls.VersionTLS12,
}
```

---

### Check 9: Timing Attacks via Non-Constant-Time Comparison

**CWE-208** (Observable Timing Discrepancy) | **A02:2021** - Cryptographic Failures | Severity: **Medium**

**WHY:** Comparing secrets with `==` or `===` short-circuits on the first differing byte, leaking information about how many leading bytes are correct. Over many requests, an attacker can reconstruct the secret byte-by-byte (e.g., HMAC tokens, API keys, password hashes).

**UNSAFE:**

```javascript
// JavaScript — string equality for HMAC comparison
if (computedHmac === receivedHmac) {
  // Vulnerable to timing attack
}
```

```python
# Python — direct comparison
if computed_hmac == received_hmac:
    pass  # Timing side-channel
```

```go
// Go — bytes.Equal leaks timing
if bytes.Equal(computedMAC, receivedMAC) {
    // Vulnerable
}
```

**SAFE:**

```javascript
// Use constant-time comparison
const crypto = require('crypto');
if (crypto.timingSafeEqual(Buffer.from(computedHmac), Buffer.from(receivedHmac))) {
  // Safe — constant-time comparison
}
```

```python
# Use hmac.compare_digest
import hmac
if hmac.compare_digest(computed_hmac, received_hmac):
    pass  # Constant-time comparison
```

```go
// Use crypto/subtle
import "crypto/subtle"
if subtle.ConstantTimeCompare(computedMAC, receivedMAC) == 1 {
    // Safe
}
```

---

### Check 10: Deprecated TLS Versions

**CWE-327** (Use of a Broken or Risky Cryptographic Algorithm) | **A07:2021** - Security Misconfiguration | Severity: **High**

**WHY:** TLS 1.0 and 1.1 have known vulnerabilities (BEAST, POODLE, Lucky13). SSLv3 is completely broken. PCI DSS, NIST, and major browsers have deprecated these versions. Using them exposes traffic to downgrade attacks and known protocol-level exploits.

**UNSAFE:**

```go
// Go — allowing TLS 1.0
tlsConfig := &tls.Config{
    MinVersion: tls.VersionTLS10,
}
```

```python
# Python — SSLv3
import ssl
ctx = ssl.SSLContext(ssl.PROTOCOL_SSLv3)
```

```java
// Java — TLS 1.0
SSLContext ctx = SSLContext.getInstance("TLSv1");
```

```javascript
// Node.js — allowing deprecated protocols
const tls = require('tls');
const options = { secureProtocol: 'TLSv1_method' };
```

**SAFE:**

```go
// Require TLS 1.2 minimum (TLS 1.3 preferred)
tlsConfig := &tls.Config{
    MinVersion: tls.VersionTLS12,
}
```

```python
# Use TLS 1.2+
import ssl
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
ctx.minimum_version = ssl.TLSVersion.TLSv1_2
```

```java
// Use TLS 1.2+
SSLContext ctx = SSLContext.getInstance("TLSv1.2");
```

---

### Check 11: Weak Password Hashing

**CWE-916** (Use of Password Hash With Insufficient Computational Effort) | **A02:2021** - Cryptographic Failures | Severity: **Critical**

**WHY:** Plain SHA-256/SHA-512 and MD5 are fast general-purpose hashes — a modern GPU can compute billions per second. Password hashing requires intentionally slow, memory-hard algorithms (bcrypt, scrypt, argon2) to make brute-force and dictionary attacks infeasible.

**UNSAFE:**

```python
# Python — SHA-256 for password storage
import hashlib
password_hash = hashlib.sha256(password.encode()).hexdigest()
```

```javascript
// JavaScript — MD5 for password hashing
const hash = crypto.createHash('md5').update(password).digest('hex');
```

```java
// Java — SHA-512 for passwords (fast, no salt built in)
MessageDigest md = MessageDigest.getInstance("SHA-512");
byte[] hash = md.digest(password.getBytes());
```

**SAFE:**

```python
# Use bcrypt, scrypt, or argon2
import bcrypt
hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12))
# Or: argon2
from argon2 import PasswordHasher
ph = PasswordHasher()
hashed = ph.hash(password)
```

```javascript
// Use bcrypt
const bcrypt = require('bcrypt');
const hashed = await bcrypt.hash(password, 12);
```

```java
// Use BCrypt
import org.mindrot.jbcrypt.BCrypt;
String hashed = BCrypt.hashpw(password, BCrypt.gensalt(12));
```

---

### Check 12: Broken/Obsolete Ciphers

**CWE-327** (Use of a Broken or Risky Cryptographic Algorithm) | **A02:2021** - Cryptographic Failures | Severity: **High**

**WHY:** DES (56-bit key) can be brute-forced in hours. 3DES is slow and vulnerable to Sweet32 birthday attacks on 64-bit blocks. RC4 has statistical biases exploitable in TLS (RC4 NOMORE attack). Blowfish has a 64-bit block size vulnerable to birthday attacks after ~32GB of data.

**UNSAFE:**

```java
// Java — DES cipher
Cipher cipher = Cipher.getInstance("DES/ECB/PKCS5Padding");
```

```python
# Python — DES
from Crypto.Cipher import DES
cipher = DES.new(key, DES.MODE_ECB)
```

```javascript
// JavaScript — RC4
const cipher = crypto.createCipheriv('rc4', key, '');
```

```go
// Go — DES
import "crypto/des"
block, _ := des.NewCipher(key)
```

**SAFE:**

```java
// Use AES-256-GCM
Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
```

```python
# Use AES-GCM or ChaCha20-Poly1305
from Crypto.Cipher import AES
cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
```

```javascript
// Use AES-256-GCM or ChaCha20-Poly1305
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
```

```go
// Use AES-GCM
import "crypto/aes"
import "crypto/cipher"
block, _ := aes.NewCipher(key)
aesgcm, _ := cipher.NewGCM(block)
```

---

## Findings Format

> **MANDATORY FORMAT:** You **MUST** include Severity, CWE, and OWASP Top 10:2021 mapping on **every** finding. You **MUST** include UNSAFE and SAFE code blocks for each finding.

Each finding should include:

| Field | Description |
|-------|-------------|
| Severity | Critical / High / Medium / Low |
| CWE | CWE-XXX identifier |
| OWASP | A01-A10 category (OWASP Top 10:2021) |
| Location | file:line |
| Issue | Description of the vulnerability |
| Remediation | How to fix it |

### Example Finding

| Field | Value |
|-------|-------|
| Severity | Critical |
| CWE | CWE-321 |
| OWASP | A02:2021 - Cryptographic Failures |
| Location | src/encryption.py:14 |
| Issue | AES encryption key hardcoded as string literal `b'mysecretkey12345'` |
| Remediation | Move key to environment variable or secrets manager; rotate the compromised key immediately |

## Reference Tables

### Crypto Check to CWE/OWASP Mapping

| # | Check | CWE | OWASP | Default Severity |
|---|-------|-----|-------|------------------|
| 1 | Weak hash algorithms (MD5, SHA1) | CWE-328 | A02:2021 - Cryptographic Failures | High |
| 2 | Hardcoded cryptographic keys/IVs | CWE-321 | A02:2021 - Cryptographic Failures | Critical |
| 3 | Insecure random number generation | CWE-330 | A02:2021 - Cryptographic Failures | High |
| 4 | Weak key sizes (<2048-bit RSA) | CWE-326 | A02:2021 - Cryptographic Failures | High |
| 5 | AES in ECB mode | CWE-327 | A02:2021 - Cryptographic Failures | High |
| 6 | Missing HMAC verification | CWE-327 | A02:2021 - Cryptographic Failures | Medium |
| 7 | IV reuse / static IV | CWE-329 | A02:2021 - Cryptographic Failures | High |
| 8 | Improper certificate validation | CWE-295 | A07:2021 - Security Misconfiguration | Critical |
| 9 | Timing attacks (non-constant-time) | CWE-208 | A02:2021 - Cryptographic Failures | Medium |
| 10 | Deprecated TLS versions | CWE-327 | A07:2021 - Security Misconfiguration | High |
| 11 | Weak password hashing | CWE-916 | A02:2021 - Cryptographic Failures | Critical |
| 12 | Broken/obsolete ciphers | CWE-327 | A02:2021 - Cryptographic Failures | High |

### OWASP Top 10:2021 Quick Reference

| Category | Description | Related Checks |
|----------|-------------|----------------|
| A02:2021 | Cryptographic Failures | Checks 1-7, 9, 11, 12 |
| A07:2021 | Security Misconfiguration | Checks 8, 10 |

### CWE Reference

| CWE ID | Name | MITRE URL |
|--------|------|-----------|
| CWE-208 | Observable Timing Discrepancy | https://cwe.mitre.org/data/definitions/208.html |
| CWE-295 | Improper Certificate Validation | https://cwe.mitre.org/data/definitions/295.html |
| CWE-321 | Use of Hard-coded Cryptographic Key | https://cwe.mitre.org/data/definitions/321.html |
| CWE-326 | Inadequate Encryption Strength | https://cwe.mitre.org/data/definitions/326.html |
| CWE-327 | Use of a Broken or Risky Cryptographic Algorithm | https://cwe.mitre.org/data/definitions/327.html |
| CWE-328 | Use of Weak Hash | https://cwe.mitre.org/data/definitions/328.html |
| CWE-329 | Generation of Predictable IV with CBC Mode | https://cwe.mitre.org/data/definitions/329.html |
| CWE-330 | Use of Insufficiently Random Values | https://cwe.mitre.org/data/definitions/330.html |
| CWE-916 | Use of Password Hash With Insufficient Computational Effort | https://cwe.mitre.org/data/definitions/916.html |

## Example Usage

**User prompt:**
> "Run a crypto audit on this project"

**Expected output (abbreviated):**

```text
## Crypto Audit Results

Scanned 18 files across JavaScript, Python, Go

### Findings (6 total: 2 Critical, 3 High, 1 Medium)

| # | Severity | CWE | OWASP | Location | Issue |
|---|----------|-----|-------|----------|-------|
| 1 | Critical | CWE-321 | A02 | src/encryption.py:14 | AES key hardcoded as string literal |
| 2 | Critical | CWE-916 | A02 | src/auth/password.js:8 | MD5 used for password hashing |
| 3 | High | CWE-328 | A02 | lib/tokens.py:22 | SHA1 used to generate auth tokens |
| 4 | High | CWE-330 | A02 | src/session.ts:15 | Math.random() used for session ID generation |
| 5 | High | CWE-327 | A02 | pkg/crypto/encrypt.go:31 | AES-ECB mode used for encryption |
| 6 | Medium | CWE-208 | A02 | src/auth/verify.js:44 | HMAC compared with === (timing side-channel) |

### Recommendations
1. Move encryption keys to environment variables or a secrets manager (Finding #1)
2. Replace MD5 password hashing with bcrypt or argon2 (Finding #2)
3. Replace Math.random() with crypto.randomBytes() for all security-sensitive values (Finding #4)
```

