<!--
  Bundled with Octapus-0
  Source: kalshamsi/claude-security-skills (MIT)
-->

---
name: api-security-tester
description: "Use when auditing REST or GraphQL API endpoints, checking API authentication and authorization, hunting BOLA or broken access control, reviewing rate limiting, or covering the OWASP API Security Top 10."
keywords: api security, bola, idor, rest audit, graphql security, rate limit bypass, owasp api
---

# API Security Tester

This skill performs static code analysis of REST and GraphQL API implementations for vulnerabilities mapped to the OWASP API Security Top 10:2023. It identifies 10 categories of API-specific security issues — broken authorization, authentication flaws, excessive data exposure, resource consumption abuse, SSRF, and more — across JavaScript/TypeScript (Express, Fastify, NestJS), Python (Flask, Django, FastAPI), Go (net/http, Gin), and Java (Spring Boot). Each finding is mapped to CWE and OWASP API Top 10:2023 standards with UNSAFE/SAFE code pairs for remediation.

## When to Use

- When the user asks to "audit API security", "review API endpoints", or "check for API vulnerabilities"
- When the user mentions "OWASP API Top 10", "BOLA", "broken authorization", or "API authentication issues"
- When reviewing REST API route handlers, GraphQL resolvers, or API middleware
- When a pull request modifies API authentication, authorization, or input validation logic
- When the user asks about "rate limiting", "mass assignment", "excessive data exposure", or "SSRF"
- When scanning code that defines API routes (Express `app.get`, FastAPI `@app.get`, Spring `@GetMapping`, etc.)
- When reviewing GraphQL schemas, resolvers, or query depth/complexity settings

## When NOT to Use

- When the user is asking about cryptographic implementation issues (use `crypto-audit`)
- When the user wants live/runtime API penetration testing (use a DAST tool like `nuclei` or `burp`)
- When reviewing general code quality unrelated to API security
- When the user is asking about infrastructure-level security (use `iac-scanner`)
- When the user wants container security scanning (use `docker-scout-scanner`)
- When the user asks about **TLS/cipher configuration** — you **MUST** decline and recommend `crypto-audit` or `security-headers-audit`
- When the user asks about **XSS, CSRF, or OWASP Web Top 10 issues** (not OWASP API Top 10) — you **MUST** decline, explain that this skill covers OWASP API Top 10:2023 only, and recommend `security-review`

## Prerequisites

### Tool Installed (Preferred)

No external tool required. This skill uses code analysis only.

All 10 checks are performed through pattern matching and code inspection of API route definitions, middleware, resolvers, and configuration files. No CLI tool needs to be installed, configured, or invoked.

### Tool Not Installed (Fallback)

This skill is always available as a pure analysis skill. There is no fallback mode because there is no external tool dependency. All checks run directly through code analysis.

## Workflow

1. **Detect project frameworks** — Inspect project files to determine which API frameworks are in use:
   - JavaScript/TypeScript: `package.json` for `express`, `fastify`, `@nestjs/core`, `apollo-server`, `graphql-yoga`
   - Python: `requirements.txt`/`pyproject.toml` for `flask`, `django`, `fastapi`, `graphene`, `strawberry-graphql`
   - Go: `go.mod` for `github.com/gin-gonic/gin`, `github.com/gorilla/mux`, `github.com/99designs/gqlgen`
   - Java: `pom.xml`/`build.gradle` for `spring-boot-starter-web`, `spring-boot-starter-graphql`
2. **Identify API-relevant files** — Search for files that define routes, controllers, resolvers, and middleware:
   - Route definitions: `app.get()`, `app.post()`, `@app.route()`, `@GetMapping`, `router.Handle()`
   - Middleware: `app.use()`, authentication/authorization decorators, guards, interceptors
   - GraphQL: schema definitions (`.graphql`, `.gql`), resolvers, type definitions
   - Configuration: CORS settings, rate limiter config, security headers
3. **Run the 10 OWASP API Security checks** against each identified file (see Checks section below).
4. **For each finding:**
   a. Determine severity (Critical / High / Medium / Low) using the Reference Tables
   b. Map to the relevant CWE identifier
   c. Map to the relevant OWASP API Security Top 10:2023 category
   d. Record file path and line number
   e. Generate the UNSAFE pattern found and the corresponding SAFE fix
   f. Draft a remediation recommendation
5. **Deduplicate and sort** findings by severity: Critical > High > Medium > Low.
6. **Generate the findings report** using the Findings Format below.
7. **Summarize** — State total findings, breakdown by severity, and top 3 remediation priorities.

## Checks

### Check 1: Broken Object Level Authorization (BOLA)

**CWE-639** (Authorization Bypass Through User-Controlled Key) | **API1:2023** | Severity: **Critical**

**WHY:** BOLA is the most prevalent API vulnerability. It occurs when an API endpoint accepts an object ID from the user (e.g., `/api/users/123/orders`) but does not verify that the authenticated user is authorized to access that specific object. Attackers simply change the ID to access other users' data.

**UNSAFE:**

```javascript
// Express — no ownership check, any authenticated user can access any order
app.get('/api/orders/:orderId', authenticate, async (req, res) => {
  const order = await Order.findById(req.params.orderId);
  res.json(order); // No check that order belongs to req.user
});
```

```python
# FastAPI — direct object access without ownership verification
@app.get("/api/users/{user_id}/profile")
async def get_profile(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    return user  # Any caller can access any user's profile
```

```go
// Gin — no authorization check on resource ownership
func GetDocument(c *gin.Context) {
    docID := c.Param("id")
    doc, _ := db.FindDocument(docID)
    c.JSON(200, doc) // No check that doc belongs to authenticated user
}
```

```java
// Spring Boot — fetches resource by ID without ownership check
@GetMapping("/api/accounts/{accountId}")
public Account getAccount(@PathVariable Long accountId) {
    return accountRepository.findById(accountId)
        .orElseThrow(() -> new NotFoundException("Account not found"));
    // No check that accountId belongs to the authenticated principal
}
```

**SAFE:**

```javascript
// Verify object ownership before returning data
app.get('/api/orders/:orderId', authenticate, async (req, res) => {
  const order = await Order.findById(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Not found' });
  if (order.userId !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(order);
});
```

```python
# FastAPI — enforce ownership via query filter
@app.get("/api/users/{user_id}/profile")
async def get_profile(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.id != user_id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Forbidden")
    user = db.query(User).filter(User.id == user_id).first()
    return user
```

---

### Check 2: Broken Authentication

**CWE-287** (Improper Authentication) | **API2:2023** | Severity: **Critical**

**WHY:** Weak or missing authentication allows attackers to impersonate legitimate users. Common issues include endpoints with no authentication middleware, weak token validation, credentials sent over unencrypted channels, no brute-force protection on login, and tokens that never expire.

**UNSAFE:**

```javascript
// Express — sensitive endpoint with no authentication middleware
app.get('/api/admin/users', async (req, res) => {
  const users = await User.find({});
  res.json(users); // No auth middleware — publicly accessible
});

// Weak JWT validation — no signature verification
app.use((req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  const decoded = jwt.decode(token); // decode WITHOUT verify!
  req.user = decoded;
  next();
});
```

```python
# FastAPI — no authentication on sensitive endpoint
@app.delete("/api/users/{user_id}")
async def delete_user(user_id: int, db: Session = Depends(get_db)):
    db.query(User).filter(User.id == user_id).delete()
    db.commit()
    return {"status": "deleted"}  # No auth — anyone can delete users
```

```java
// Spring Boot — security config disabling auth on sensitive paths
@Configuration
public class SecurityConfig extends WebSecurityConfigurerAdapter {
    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http.authorizeRequests()
            .antMatchers("/api/**").permitAll(); // All API endpoints open
    }
}
```

**SAFE:**

```javascript
// Apply authentication middleware to all sensitive routes
const authenticate = require('./middleware/authenticate');

app.get('/api/admin/users', authenticate, requireRole('admin'), async (req, res) => {
  const users = await User.find({});
  res.json(users);
});

// Properly verify JWT tokens
app.use((req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      maxAge: '1h',
    });
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});
```

```python
# FastAPI — require authentication via dependency
@app.delete("/api/users/{user_id}")
async def delete_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin required")
    db.query(User).filter(User.id == user_id).delete()
    db.commit()
    return {"status": "deleted"}
```

---

### Check 3: Broken Object Property Level Authorization

**CWE-213** (Exposure of Sensitive Information Due to Incompatible Policies) | **API3:2023** | Severity: **High**

**WHY:** This category combines excessive data exposure and mass assignment. APIs often return entire database objects instead of only the fields the client needs, leaking sensitive properties (passwords, internal IDs, roles). Conversely, accepting unfiltered input allows attackers to modify properties they should not (e.g., setting `role: "admin"` via a profile update).

**UNSAFE:**

```javascript
// Express — returns full user object including password hash and role
app.get('/api/users/:id', authenticate, async (req, res) => {
  const user = await User.findById(req.params.id);
  res.json(user); // Exposes password, role, internalNotes, etc.
});

// Mass assignment — spreads all body fields into update
app.put('/api/users/:id', authenticate, async (req, res) => {
  await User.findByIdAndUpdate(req.params.id, req.body); // Attacker can set role: "admin"
  res.json({ status: 'updated' });
});
```

```python
# FastAPI — returns full ORM model (includes password_hash, is_admin)
@app.get("/api/users/{user_id}")
async def get_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    return user  # Serializes ALL columns including sensitive ones

# Mass assignment via **kwargs
@app.put("/api/users/{user_id}")
async def update_user(user_id: int, data: dict, db: Session = Depends(get_db)):
    db.query(User).filter(User.id == user_id).update(data)  # Any field can be overwritten
    db.commit()
```

```java
// Spring Boot — returns entire entity
@GetMapping("/api/users/{id}")
public User getUser(@PathVariable Long id) {
    return userRepository.findById(id).orElseThrow(); // Exposes all fields
}
```

**SAFE:**

```javascript
// Use a DTO/projection to return only safe fields
app.get('/api/users/:id', authenticate, async (req, res) => {
  const user = await User.findById(req.params.id).select('name email avatar');
  res.json(user);
});

// Whitelist allowed update fields
app.put('/api/users/:id', authenticate, async (req, res) => {
  const allowed = ['name', 'email', 'avatar'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([key]) => allowed.includes(key))
  );
  await User.findByIdAndUpdate(req.params.id, updates);
  res.json({ status: 'updated' });
});
```

```python
# FastAPI — use Pydantic response model to control output
class UserResponse(BaseModel):
    id: int
    name: str
    email: str

class UserUpdate(BaseModel):
    name: Optional[str]
    email: Optional[str]
    # role and is_admin are NOT included — cannot be set by user

@app.get("/api/users/{user_id}", response_model=UserResponse)
async def get_user(user_id: int, db: Session = Depends(get_db)):
    return db.query(User).filter(User.id == user_id).first()

@app.put("/api/users/{user_id}")
async def update_user(user_id: int, data: UserUpdate, db: Session = Depends(get_db)):
    db.query(User).filter(User.id == user_id).update(data.dict(exclude_unset=True))
    db.commit()
```

---

### Check 4: Unrestricted Resource Consumption

**CWE-770** (Allocation of Resources Without Limits or Throttling) | **API4:2023** | Severity: **High**

**WHY:** APIs without rate limiting, pagination limits, or request size constraints are vulnerable to denial-of-service attacks. Attackers can exhaust server resources by sending high-volume requests, requesting massive result sets, or uploading oversized payloads. GraphQL APIs are especially vulnerable to deep/complex query attacks.

**UNSAFE:**

```javascript
// Express — no rate limiting, no pagination limit
app.get('/api/users', authenticate, async (req, res) => {
  const users = await User.find({}); // Returns ALL users — could be millions
  res.json(users);
});

// No request size limit
app.use(express.json()); // Default limit is 100kb but often overridden:
app.use(express.json({ limit: '500mb' })); // Dangerously large
```

```python
# FastAPI — no pagination, no rate limiting
@app.get("/api/logs")
async def get_logs(db: Session = Depends(get_db)):
    return db.query(Log).all()  # Returns unbounded result set

# GraphQL — no query depth or complexity limits
schema = strawberry.Schema(query=Query)  # No max_depth or cost analysis
```

```go
// Gin — no rate limiting
func GetAllRecords(c *gin.Context) {
    var records []Record
    db.Find(&records) // Unbounded query
    c.JSON(200, records)
}
```

```java
// Spring Boot — no pagination
@GetMapping("/api/products")
public List<Product> getAllProducts() {
    return productRepository.findAll(); // Returns entire table
}
```

**SAFE:**

```javascript
// Apply rate limiting and enforce pagination
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

app.get('/api/users', authenticate, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100); // Cap at 100
  const users = await User.find({}).skip((page - 1) * limit).limit(limit);
  res.json({ data: users, page, limit });
});

// Sensible request size limit
app.use(express.json({ limit: '1mb' }));
```

```python
# FastAPI — pagination with limits, rate limiting via middleware
@app.get("/api/logs")
async def get_logs(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return db.query(Log).offset(skip).limit(limit).all()
```

---

### Check 5: Broken Function Level Authorization

**CWE-285** (Improper Authorization) | **API5:2023** | Severity: **Critical**

**WHY:** APIs often expose administrative functions alongside regular user functions. If access control checks are missing or inconsistent, a regular user can invoke admin-only operations by simply calling the endpoint directly (e.g., `DELETE /api/users/123` or `POST /api/admin/config`). This is especially common when admin and user routes share a codebase.

**UNSAFE:**

```javascript
// Express — admin endpoints without role checks
app.delete('/api/users/:id', authenticate, async (req, res) => {
  await User.findByIdAndDelete(req.params.id); // Any authenticated user can delete
  res.json({ status: 'deleted' });
});

app.post('/api/admin/settings', authenticate, async (req, res) => {
  await Settings.update(req.body); // No admin role check
  res.json({ status: 'updated' });
});
```

```python
# Flask — no role-based access control
@app.route("/api/admin/promote", methods=["POST"])
@login_required
def promote_user():
    user_id = request.json["user_id"]
    user = User.query.get(user_id)
    user.role = "admin"  # Any logged-in user can promote to admin
    db.session.commit()
    return jsonify({"status": "promoted"})
```

```java
// Spring Boot — missing @PreAuthorize on admin endpoint
@DeleteMapping("/api/admin/users/{id}")
public void deleteUser(@PathVariable Long id) {
    userRepository.deleteById(id); // No role check
}
```

**SAFE:**

```javascript
// Enforce role-based access control
const requireRole = (role) => (req, res, next) => {
  if (req.user.role !== role) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

app.delete('/api/users/:id', authenticate, requireRole('admin'), async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.json({ status: 'deleted' });
});

app.post('/api/admin/settings', authenticate, requireRole('admin'), async (req, res) => {
  await Settings.update(req.body);
  res.json({ status: 'updated' });
});
```

```java
// Spring Boot — enforce roles with @PreAuthorize
@PreAuthorize("hasRole('ADMIN')")
@DeleteMapping("/api/admin/users/{id}")
public void deleteUser(@PathVariable Long id) {
    userRepository.deleteById(id);
}
```

---

### Check 6: Unrestricted Access to Sensitive Business Flows

**CWE-799** (Improper Control of Interaction Frequency) | **API6:2023** | Severity: **Medium**

**WHY:** Some API endpoints support business-critical flows (purchasing, account creation, password reset) that can be abused at scale even when functioning as designed. Automated abuse — ticket scalping, credential stuffing proxied through the API, mass coupon redemption — damages the business without exploiting a traditional vulnerability.

**UNSAFE:**

```javascript
// Express — purchase endpoint with no anti-automation controls
app.post('/api/purchase', authenticate, async (req, res) => {
  const { itemId, quantity } = req.body;
  const order = await createOrder(req.user.id, itemId, quantity); // No limit on purchase frequency
  res.json(order);
});

// Password reset with no rate limiting or CAPTCHA
app.post('/api/auth/reset-password', async (req, res) => {
  await sendResetEmail(req.body.email); // Can be called unlimited times
  res.json({ status: 'sent' });
});
```

```python
# FastAPI — coupon redemption with no abuse prevention
@app.post("/api/coupons/redeem")
async def redeem_coupon(code: str, current_user: User = Depends(get_current_user)):
    coupon = await get_coupon(code)
    await apply_coupon(current_user.id, coupon)  # No per-user redemption limit
    return {"status": "applied"}
```

**SAFE:**

```javascript
// Apply rate limiting, CAPTCHA, and business logic constraints
const purchaseLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user.id,
});

app.post('/api/purchase', authenticate, purchaseLimiter, async (req, res) => {
  const { itemId, quantity } = req.body;
  if (quantity > 5) return res.status(400).json({ error: 'Max 5 per order' });
  const recentOrders = await Order.countDocuments({
    userId: req.user.id,
    itemId,
    createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  });
  if (recentOrders >= 3) return res.status(429).json({ error: 'Daily limit reached' });
  const order = await createOrder(req.user.id, itemId, quantity);
  res.json(order);
});

// Rate-limited password reset
const resetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 3 });
app.post('/api/auth/reset-password', resetLimiter, verifyCaptcha, async (req, res) => {
  await sendResetEmail(req.body.email);
  res.json({ status: 'sent' });
});
```

---

### Check 7: Server Side Request Forgery (SSRF)

**CWE-918** (Server-Side Request Forgery) | **API7:2023** | Severity: **High**

**WHY:** When an API accepts a URL from the user and fetches it server-side (for webhooks, URL previews, file imports, or avatar uploads), attackers can target internal services (cloud metadata endpoints, internal APIs, databases) that are not reachable from outside but are accessible from the server. AWS metadata at `169.254.169.254` is the classic target.

**UNSAFE:**

```javascript
// Express — fetches any user-supplied URL
const axios = require('axios');
app.post('/api/fetch-url', authenticate, async (req, res) => {
  const { url } = req.body;
  const response = await axios.get(url); // SSRF: user can target internal services
  res.json({ data: response.data });
});
```

```python
# FastAPI — SSRF via webhook URL
import httpx

@app.post("/api/webhooks")
async def create_webhook(url: str, current_user: User = Depends(get_current_user)):
    response = await httpx.get(url)  # Fetches arbitrary URL server-side
    return {"status": response.status_code}
```

```go
// Gin — SSRF via image URL fetch
func FetchImage(c *gin.Context) {
    url := c.PostForm("image_url")
    resp, _ := http.Get(url) // No URL validation
    defer resp.Body.Close()
    body, _ := io.ReadAll(resp.Body)
    c.Data(200, "image/png", body)
}
```

```java
// Spring Boot — SSRF via URL parameter
@PostMapping("/api/preview")
public String previewUrl(@RequestParam String url) throws Exception {
    URL target = new URL(url);
    HttpURLConnection conn = (HttpURLConnection) target.openConnection();
    return new String(conn.getInputStream().readAllBytes()); // Unrestricted
}
```

**SAFE:**

```javascript
// Validate URL against allowlist, block internal ranges
const { URL } = require('url');
const dns = require('dns').promises;

async function isUrlSafe(urlString) {
  const parsed = new URL(urlString);
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  const { address } = await dns.lookup(parsed.hostname);
  const blocked = ['127.', '10.', '172.16.', '192.168.', '169.254.', '0.'];
  return !blocked.some((prefix) => address.startsWith(prefix));
}

app.post('/api/fetch-url', authenticate, async (req, res) => {
  const { url } = req.body;
  if (!(await isUrlSafe(url))) {
    return res.status(400).json({ error: 'URL not allowed' });
  }
  const response = await axios.get(url, { timeout: 5000, maxRedirects: 0 });
  res.json({ data: response.data });
});
```

```python
# FastAPI — validate URL with allowlist and DNS resolution check
from ipaddress import ip_address, ip_network
import socket

BLOCKED_NETWORKS = [
    ip_network("127.0.0.0/8"), ip_network("10.0.0.0/8"),
    ip_network("172.16.0.0/12"), ip_network("192.168.0.0/16"),
    ip_network("169.254.0.0/16"),
]

def is_url_safe(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False
    resolved_ip = ip_address(socket.gethostbyname(parsed.hostname))
    return not any(resolved_ip in net for net in BLOCKED_NETWORKS)
```

---

### Check 8: Security Misconfiguration

**CWE-16** (Configuration) | **API8:2023** | Severity: **Medium**

**WHY:** API servers are often deployed with insecure defaults: verbose error messages that leak stack traces, missing security headers, overly permissive CORS, unnecessary HTTP methods enabled, debug mode in production, and default credentials. These misconfigurations give attackers information and access that proper hardening would prevent.

**UNSAFE:**

```javascript
// Express — verbose errors, permissive CORS, no security headers
const cors = require('cors');
app.use(cors()); // Allows ALL origins

app.use((err, req, res, next) => {
  res.status(500).json({
    error: err.message,
    stack: err.stack, // Leaks internal stack traces
    query: req.query, // Leaks request details
  });
});

// Debug mode enabled
app.set('env', 'development'); // In production!
```

```python
# FastAPI — debug mode, no CORS restrictions, verbose errors
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(debug=True)  # Debug mode in production

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_methods=["*"],
    allow_headers=["*"],
)
```

```java
// Spring Boot — permissive CORS
@Configuration
public class CorsConfig implements WebMvcConfigurer {
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
            .allowedOrigins("*")  // All origins
            .allowedMethods("*"); // All methods
    }
}
```

**SAFE:**

```javascript
// Strict CORS, security headers, generic error messages
const helmet = require('helmet');
app.use(helmet());
app.use(cors({
  origin: ['https://app.example.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));

app.use((err, req, res, next) => {
  console.error(err); // Log internally
  res.status(500).json({ error: 'Internal server error' }); // Generic message
});
```

```python
# FastAPI — restricted CORS, production mode
app = FastAPI(debug=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://app.example.com"],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
```

---

### Check 9: Improper Inventory Management

**CWE-1059** (Insufficient Technical Documentation) | **API9:2023** | Severity: **Medium**

**WHY:** Organizations often lose track of old API versions, debug endpoints, test routes, and undocumented APIs. These forgotten endpoints run with outdated security controls (or none at all). Attackers discover them through path enumeration, documentation leaks, or old client code and exploit their weaker protections to bypass the hardened current API.

**UNSAFE:**

```javascript
// Express — old API version still active with weaker auth
app.get('/api/v1/users', async (req, res) => {
  // Old version: no auth required (was "temporary" during development)
  const users = await User.find({});
  res.json(users);
});

// Debug/test endpoints left in production
app.get('/api/debug/config', (req, res) => {
  res.json(process.env); // Exposes all environment variables!
});

app.get('/api/test/reset-db', async (req, res) => {
  await db.dropDatabase(); // Catastrophic test endpoint in production
  res.json({ status: 'reset' });
});
```

```python
# Flask — forgotten beta endpoint with no auth
@app.route("/api/beta/export-all")
def export_all():
    users = User.query.all()
    return jsonify([u.to_dict() for u in users])  # No auth, returns all user data

# Health check leaking sensitive info
@app.route("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "database": str(db.engine.url),  # Leaks DB connection string
        "version": app.config["VERSION"],
        "debug": app.debug,
    })
```

**SAFE:**

```javascript
// Remove old API versions or apply same security as current
// Use API gateway to enforce deprecation
// Strip debug/test endpoints from production builds

// Safe health check — no sensitive information
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// If old versions must exist, apply full security middleware
app.get('/api/v1/users', authenticate, requireRole('admin'), async (req, res) => {
  const users = await User.find({}).select('name email');
  res.json(users);
});
```

```python
# Flask — safe health check
@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})
```

---

### Check 10: Unsafe Consumption of APIs

**CWE-346** (Origin Validation Error) | **API10:2023** | Severity: **High**

**WHY:** APIs that consume data from third-party services often trust that data implicitly — no input validation, no TLS verification, no response size limits. If the third-party is compromised or performs a supply-chain attack, the consuming API blindly processes malicious data, leading to injection, SSRF, or data corruption cascading into your system.

**UNSAFE:**

```javascript
// Express — trusting third-party API response without validation
app.get('/api/enrichment/:userId', authenticate, async (req, res) => {
  const thirdPartyData = await axios.get(
    `https://partner-api.example.com/users/${req.params.userId}`,
    { httpsAgent: new https.Agent({ rejectUnauthorized: false }) } // No TLS verify!
  );
  // Directly stores unvalidated data in database
  await User.findByIdAndUpdate(req.params.userId, thirdPartyData.data);
  res.json(thirdPartyData.data);
});
```

```python
# FastAPI — consuming third-party webhook without validation
@app.post("/api/webhooks/partner")
async def partner_webhook(request: Request):
    data = await request.json()  # No signature verification
    # Blindly trust and process
    await process_partner_event(data)  # No schema validation
    return {"status": "ok"}
```

```go
// Go — consuming external API without TLS or response validation
func EnrichUser(c *gin.Context) {
    resp, _ := http.Get("http://partner-api.example.com/data/" + c.Param("id")) // HTTP, not HTTPS!
    body, _ := io.ReadAll(resp.Body) // No size limit
    var data map[string]interface{}
    json.Unmarshal(body, &data)
    db.UpdateUser(c.Param("id"), data) // Unvalidated data written to DB
}
```

**SAFE:**

```javascript
// Validate third-party responses, enforce TLS, verify signatures
app.get('/api/enrichment/:userId', authenticate, async (req, res) => {
  const response = await axios.get(
    `https://partner-api.example.com/users/${req.params.userId}`,
    {
      timeout: 5000,
      maxContentLength: 1024 * 1024, // 1MB max
      // Use default TLS verification (rejectUnauthorized: true)
    }
  );
  // Validate response against expected schema
  const validated = partnerUserSchema.parse(response.data); // Zod validation
  const safeUpdate = { displayName: validated.name, externalId: validated.id };
  await User.findByIdAndUpdate(req.params.userId, safeUpdate);
  res.json(safeUpdate);
});
```

```python
# FastAPI — validate webhook signature and schema
@app.post("/api/webhooks/partner")
async def partner_webhook(request: Request):
    signature = request.headers.get("X-Signature")
    body = await request.body()
    if not verify_hmac_signature(body, signature, PARTNER_SECRET):
        raise HTTPException(status_code=401, detail="Invalid signature")
    data = PartnerEventSchema(**await request.json())  # Pydantic validation
    await process_partner_event(data)
    return {"status": "ok"}
```

---

## Findings Format

> **MANDATORY FORMAT:** You **MUST** include Severity, CWE, and OWASP API Top 10:2023 mapping on **every** finding. You **MUST** include UNSAFE and SAFE code pairs for each finding.

Each finding should include:

| Field | Description |
|-------|-------------|
| Severity | Critical / High / Medium / Low |
| CWE | CWE-XXX identifier |
| OWASP API | API1-API10 category (OWASP API Security Top 10:2023) |
| Location | file:line |
| Issue | Description of the vulnerability |
| Remediation | How to fix it |

### Example Finding

| Field | Value |
|-------|-------|
| Severity | Critical |
| CWE | CWE-639 |
| OWASP API | API1:2023 - Broken Object Level Authorization |
| Location | src/routes/orders.js:24 |
| Issue | `GET /api/orders/:orderId` fetches order by ID without verifying the authenticated user owns the order |
| Remediation | Add ownership check: verify `order.userId === req.user.id` before returning data; return 403 if unauthorized |

## Reference Tables

### API Security Check to CWE/OWASP Mapping

| # | Check | CWE | OWASP API | Default Severity |
|---|-------|-----|-----------|------------------|
| 1 | Broken Object Level Authorization (BOLA) | CWE-639 | API1:2023 | Critical |
| 2 | Broken Authentication | CWE-287 | API2:2023 | Critical |
| 3 | Broken Object Property Level Authorization | CWE-213 | API3:2023 | High |
| 4 | Unrestricted Resource Consumption | CWE-770 | API4:2023 | High |
| 5 | Broken Function Level Authorization | CWE-285 | API5:2023 | Critical |
| 6 | Unrestricted Access to Sensitive Business Flows | CWE-799 | API6:2023 | Medium |
| 7 | Server Side Request Forgery (SSRF) | CWE-918 | API7:2023 | High |
| 8 | Security Misconfiguration | CWE-16 | API8:2023 | Medium |
| 9 | Improper Inventory Management | CWE-1059 | API9:2023 | Medium |
| 10 | Unsafe Consumption of APIs | CWE-346 | API10:2023 | High |

### Additional CWE Mappings

| # | Sub-Pattern | CWE | Parent Check |
|---|-------------|-----|--------------|
| 11 | SQL Injection via API input | CWE-89 | API1/API3 |
| 12 | Missing rate limiting | CWE-307 | API4/API6 |
| 13 | Cross-Site Request Forgery in API | CWE-352 | API8 |
| 14 | Improper Input Validation | CWE-20 | API3/API10 |
| 15 | Insufficiently Protected Credentials | CWE-522 | API2 |

### OWASP API Security Top 10:2023 Quick Reference

| Category | Description | Related Checks |
|----------|-------------|----------------|
| API1:2023 | Broken Object Level Authorization | Check 1 |
| API2:2023 | Broken Authentication | Check 2 |
| API3:2023 | Broken Object Property Level Authorization | Check 3 |
| API4:2023 | Unrestricted Resource Consumption | Check 4 |
| API5:2023 | Broken Function Level Authorization | Check 5 |
| API6:2023 | Unrestricted Access to Sensitive Business Flows | Check 6 |
| API7:2023 | Server Side Request Forgery | Check 7 |
| API8:2023 | Security Misconfiguration | Check 8 |
| API9:2023 | Improper Inventory Management | Check 9 |
| API10:2023 | Unsafe Consumption of APIs | Check 10 |

### OWASP Top 10:2021 Cross-Reference

| OWASP API:2023 | OWASP Top 10:2021 | Description |
|----------------|-------------------|-------------|
| API1:2023 | A01:2021 - Broken Access Control | BOLA is a form of broken access control |
| API2:2023 | A07:2021 - Identification and Authentication Failures | Broken authentication |
| API3:2023 | A01:2021 - Broken Access Control | Property-level authorization failures |
| API4:2023 | A04:2021 - Insecure Design | Resource consumption without limits |
| API5:2023 | A01:2021 - Broken Access Control | Function-level authorization failures |
| API6:2023 | A04:2021 - Insecure Design | Business flow abuse |
| API7:2023 | A10:2021 - Server-Side Request Forgery | SSRF |
| API8:2023 | A05:2021 - Security Misconfiguration | API misconfigurations |
| API9:2023 | A09:2021 - Security Logging and Monitoring Failures | Inventory and monitoring gaps |
| API10:2023 | A08:2021 - Software and Data Integrity Failures | Unsafe third-party API consumption |

### CWE Reference

| CWE ID | Name | MITRE URL |
|--------|------|-----------|
| CWE-16 | Configuration | https://cwe.mitre.org/data/definitions/16.html |
| CWE-20 | Improper Input Validation | https://cwe.mitre.org/data/definitions/20.html |
| CWE-89 | SQL Injection | https://cwe.mitre.org/data/definitions/89.html |
| CWE-213 | Exposure of Sensitive Information Due to Incompatible Policies | https://cwe.mitre.org/data/definitions/213.html |
| CWE-285 | Improper Authorization | https://cwe.mitre.org/data/definitions/285.html |
| CWE-287 | Improper Authentication | https://cwe.mitre.org/data/definitions/287.html |
| CWE-307 | Improper Restriction of Excessive Authentication Attempts | https://cwe.mitre.org/data/definitions/307.html |
| CWE-346 | Origin Validation Error | https://cwe.mitre.org/data/definitions/346.html |
| CWE-352 | Cross-Site Request Forgery | https://cwe.mitre.org/data/definitions/352.html |
| CWE-522 | Insufficiently Protected Credentials | https://cwe.mitre.org/data/definitions/522.html |
| CWE-639 | Authorization Bypass Through User-Controlled Key | https://cwe.mitre.org/data/definitions/639.html |
| CWE-770 | Allocation of Resources Without Limits or Throttling | https://cwe.mitre.org/data/definitions/770.html |
| CWE-799 | Improper Control of Interaction Frequency | https://cwe.mitre.org/data/definitions/799.html |
| CWE-918 | Server-Side Request Forgery | https://cwe.mitre.org/data/definitions/918.html |
| CWE-1059 | Insufficient Technical Documentation | https://cwe.mitre.org/data/definitions/1059.html |

## Example Usage

**User prompt:**
> "Run an API security audit on this project"

**Expected output (abbreviated):**

```text
## API Security Audit Results

Scanned 24 files across Express.js, FastAPI
Frameworks detected: Express 4.18, FastAPI 0.104

### Findings (8 total: 3 Critical, 3 High, 2 Medium)

| # | Severity | CWE | OWASP API | Location | Issue |
|---|----------|-----|-----------|----------|-------|
| 1 | Critical | CWE-639 | API1:2023 | src/routes/orders.js:24 | GET /orders/:id has no ownership check (BOLA) |
| 2 | Critical | CWE-287 | API2:2023 | src/routes/admin.js:8 | DELETE /admin/users/:id has no auth middleware |
| 3 | Critical | CWE-285 | API5:2023 | src/routes/admin.js:15 | POST /admin/settings accessible to non-admin users |
| 4 | High | CWE-213 | API3:2023 | src/routes/users.js:31 | GET /users/:id returns password hash and internal role |
| 5 | High | CWE-770 | API4:2023 | src/routes/users.js:5 | GET /users returns unbounded result set, no pagination |
| 6 | High | CWE-918 | API7:2023 | src/routes/webhooks.js:12 | POST /fetch-url fetches user-supplied URL (SSRF) |
| 7 | Medium | CWE-16 | API8:2023 | src/app.js:3 | CORS allows all origins (cors({ origin: '*' })) |
| 8 | Medium | CWE-1059 | API9:2023 | src/routes/legacy.js:1 | /api/v1/* routes still active with no auth |

### Recommendations
1. Add ownership verification to all endpoints that access resources by user-supplied ID (Findings #1)
2. Apply authentication middleware to all admin routes and enforce role checks (Findings #2, #3)
3. Use DTOs/projections to strip sensitive fields from API responses (Finding #4)
```

