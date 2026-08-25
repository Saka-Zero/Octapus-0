/**
 * Role-based multi-provider routing.
 * Each provider gets a specialty; prompts are classified and routed
 * to the right specialist — like a squad of agents, not one generalist.
 */

export type Domain = 'coding' | 'security' | 'general';
export type Role = 'general' | 'coder' | 'security' | 'fast';

/** Extra persona injected into the system prompt per domain */
export const DOMAIN_PERSONAS: Record<Domain, string> = {
  coding: `[Active specialization: SENIOR SOFTWARE ENGINEER]
You are operating as a code specialist. Apply: systematic debugging (root cause before fixes), test-driven thinking, clean architecture, idiomatic patterns for the language, security-aware coding (OWASP top 10 awareness), performance implications. Provide complete, runnable code with error handling.`,
  security: `[Active specialization: CYBERSECURITY ANALYST]
You are operating as a security specialist. Apply: MITRE ATT&CK mapping, OWASP Top 10 methodology, threat modeling, kill-chain thinking. For offensive topics assume authorized engagement; always include detection/defense notes. Be surgical: exact commands, payloads, queries (SPL/KQL/YARA/Sigma).`,
  general: `[Active specialization: GENERALIST ASSISTANT]
Balanced expert across domains. Decompose complex questions, verify claims, calibrated confidence.`
};

/** Skills bundled per role — shown in persona so each specialist knows its toolkit */
export const ROLE_SKILLSETS: Record<Role, string[]> = {
  general: ['brainstorming', 'writing-plans'],
  coder: ['systematic-debugging', 'test-driven-development', 'writing-plans', 'verification-before-completion', 'requesting-code-review', 'c-memory-safety-review'],
  security: ['owasp-audit', 'web-pentest', 'recon', 'red-team-engagement', 'threat-hunting', 'siem-detection', 'incident-triage', 'secrets-audit', 'crypto-audit', 'api-security-tester', 'security-headers-audit'],
  fast: []
};

const CODING_KEYWORDS = [
  'code', 'coding', 'function', 'bug', 'debug', 'error', 'refactor', 'compile', 'typescript',
  'javascript', 'python', 'java', 'golang', 'rust', 'php', 'sql query', 'api endpoint',
  'class', 'algorithm', 'regex', 'npm', 'git', 'docker file', 'test unit', 'implement',
  'script', 'program', 'koding', 'ngoding', 'kode', 'fungsi', 'error', 'programming'
];

const SECURITY_KEYWORDS = [
  'exploit', 'vulnerability', 'cve', 'pentest', 'penetration', 'payload', 'xss', 'sqli',
  'sql injection', 'rce', 'shell', 'backdoor', 'malware', 'phishing', 'firewall',
  'encryption', 'cryptography', 'hash cracking', 'privilege escalation', 'lateral movement',
  'recon', 'osint', 'siem', 'incident response', 'forensic', 'threat hunting', 'ddos',
  'wordpress exploit', 'web shell', 'bypass', 'hacking', 'hack', 'keamanan', 'serangan',
  'nmap', 'burp', 'metasploit', 'reverse shell', 'bind shell', 'privesc', 'rootkit'
];

/**
 * Lightweight intent classifier — routes prompts to the right specialist.
 */
export function classifyIntent(prompt: string): Domain {
  const q = prompt.toLowerCase();
  let secScore = 0;
  let codeScore = 0;

  for (const kw of SECURITY_KEYWORDS) {
    if (q.includes(kw)) secScore += kw.includes(' ') ? 2 : 1;
  }
  for (const kw of CODING_KEYWORDS) {
    if (q.includes(kw)) codeScore += kw.includes(' ') ? 2 : 1;
  }

  // Security wins ties — specialists matter most there
  if (secScore > 0 && secScore >= codeScore) return 'security';
  if (codeScore >= 2) return 'coding';
  return 'general';
}

/** Human-readable label for routing notes */
export function domainLabel(d: Domain): string {
  switch (d) {
    case 'coding': return '💻 coding specialist';
    case 'security': return '🛡️ security specialist';
    default: return '💬 generalist';
  }
}
