import type { ContentBrief } from "../shared/types";

export function contentBriefMarkdown(brief: ContentBrief): string {
  const outline = brief.outline.map((item) => `${"#".repeat(item.level)} ${item.heading}\n\n${item.purpose}`).join("\n\n");
  const list = (values: string[]) => values.map((value) => `- ${value}`).join("\n");
  return `# ${brief.name}\n\n` +
    `Status: ${brief.status}\n\n` +
    `## Targeting\n\n- Primary keyword: ${brief.primaryKeyword}\n- Intent: ${brief.intent}\n- Page type: ${brief.pageType}\n- Suggested URL: ${brief.suggestedSlug}\n\n` +
    `### Supporting keywords\n\n${list(brief.supportingKeywords)}\n\n` +
    `## Metadata\n\n- Title: ${brief.title}\n- Meta description: ${brief.metaDescription}\n- H1: ${brief.h1}\n\n` +
    `## Audience\n\n${brief.audience}\n\n## Search intent\n\n${brief.searchIntentSummary}\n\n## Content angle\n\n${brief.angle}\n\n` +
    `## Outline\n\n${outline}\n\n## Questions to answer\n\n${list(brief.questions)}\n\n` +
    `## Internal link ideas\n\n${list(brief.internalLinkIdeas)}\n\n## Schema types\n\n${list(brief.schemaTypes)}\n\n` +
    `## Quality checklist\n\n${list(brief.qualityChecklist)}\n`;
}
