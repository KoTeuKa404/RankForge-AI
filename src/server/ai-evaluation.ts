import type { AiFix, SeoIssue } from "../shared/types";

export interface AiFixEvaluation {
  score: number;
  passed: boolean;
  warnings: string[];
}

const GUARANTEE_PATTERNS = [
  /guarantee(?:d)?\s+(?:rankings?|results?|traffic)/i,
  /rank\s*#?1/i,
  /guarantee(?:d)?\s+first\s+page/i,
  /instant(?:ly)?\s+(?:rank|traffic)/i,
];

const DANGEROUS_PATTERNS = [
  /hide\s+(?:text|links?)\s+from\s+users/i,
  /keyword\s+stuff/i,
  /cloaking/i,
  /buy\s+backlinks?/i,
  /doorway\s+pages?/i,
];

export function evaluateAiFix(fix: AiFix, issue?: SeoIssue): AiFixEvaluation {
  const warnings: string[] = [];
  let score = 100;
  const combined = [fix.summary, fix.whyItMatters, fix.implementation, fix.code || ""].join("\n");

  if (fix.summary.trim().length < 20) {
    score -= 18;
    warnings.push("Summary is too vague.");
  }
  if (fix.whyItMatters.trim().length < 30) {
    score -= 14;
    warnings.push("Impact explanation is too short.");
  }
  if (fix.implementation.trim().length < 45) {
    score -= 22;
    warnings.push("Implementation guidance lacks detail.");
  }
  if (fix.verification.length < 2) {
    score -= 18;
    warnings.push("At least two verification checks are required.");
  }
  if (fix.verification.some((step) => step.trim().length < 8)) {
    score -= 8;
    warnings.push("Some verification checks are not actionable.");
  }
  if (GUARANTEE_PATTERNS.some((pattern) => pattern.test(combined))) {
    score -= 40;
    warnings.push("Recommendation makes an unsupported ranking guarantee.");
  }
  if (DANGEROUS_PATTERNS.some((pattern) => pattern.test(combined))) {
    score -= 55;
    warnings.push("Recommendation contains a manipulative SEO tactic.");
  }
  if (issue && !combined.toLowerCase().includes(issue.title.toLowerCase().split(/\s+/)[0])) {
    score -= 6;
    warnings.push("Recommendation may not be clearly tied to the selected issue.");
  }
  if (fix.code && fix.code.length > 12_000) {
    score -= 10;
    warnings.push("Suggested code is too large for a focused remediation.");
  }

  const normalized = Math.max(0, Math.min(100, score));
  return { score: normalized, passed: normalized >= 65 && !warnings.some((item) => item.includes("manipulative")), warnings };
}
