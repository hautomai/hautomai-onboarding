export type TemplateVars = Record<string, string>;

export function renderTemplate(template: string | undefined, vars: TemplateVars): string {
  if (!template) return '';
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, key: string) => vars[key] ?? '');
}

export const DEFAULT_WELCOME_SUBJECT = 'Welcome to {{clientName}}, {{firstName}}';

export const DEFAULT_WELCOME_TEXT = `Hi {{firstName}},

Welcome to {{clientName}}! We're thrilled to have you on board.

Here is what happens next:
1. You will receive your getting-started materials within the next few hours.
2. Our team checks in after 24 hours to make sure everything is running smoothly.
3. After your first week we share the success guide tailored to your plan.

If you have any questions, just reply to this email.

Best regards,
The {{clientName}} team`;

export const DEFAULT_DOCS_SUBJECT = 'Getting started: your {{clientName}} resources';

export const DEFAULT_DOCS_TEXT = `Hi {{firstName}},

As a {{package}} customer, here are the resources that will help you get the most out of {{clientName}}.

The documents attached cover:
- Getting Started Checklist
- Success Planning Worksheet
- Contact Information Sheet

Open them at your convenience and reach out if you have any questions.

Best regards,
The {{clientName}} team`;

export const DEFAULT_CHECKIN_SUBJECT = 'How is it going, {{firstName}}?';

export const DEFAULT_CHECKIN_TEXT = `Hi {{firstName}},

It has been 24 hours since you joined {{clientName}}. How is it going?

Most successful customers start by completing the Getting Started Checklist and blocking 30 minutes for the Success Planning Worksheet.

Reply to this email if you have a question - a real person will write back. You can also reach us by phone or chat.

Looking forward to your first week with us.

Best regards,
The {{clientName}} team`;

export const DEFAULT_WEEK1_SUBJECT = 'Your week 1 success guide, {{firstName}}';

export const DEFAULT_WEEK1_TEXT = `Hi {{firstName}},

You have made it through your first days with {{clientName}} - congratulations.

At the 3-day mark, most customers:
- Have completed the setup checklist.
- Have scheduled their first planning session.
- Know who their dedicated contact is.

As a {{package}} customer you get access to our exclusive training content and success stories. Ask your account manager for the link.

We are here to help. See you at the finish line.

Best regards,
The {{clientName}} team`;

export const DEFAULT_TEAM_ALERT_TITLE = 'New customer signed up';
export const DEFAULT_TEAM_ALERT_TEXT = `A new {{package}} customer just signed up:
- Name: {{customerName}}
- Email: {{email}}
- Phone: {{phone}}
- Source: {{source}}
- Signup date: {{signupDate}}

Open the dashboard to review the full profile and schedule the welcome call.`;

export const DEFAULT_FAILURE_ALERT_TITLE = 'Onboarding step failed';
export const DEFAULT_FAILURE_ALERT_TEXT = `The step "{{step}}" failed for {{customerName}} ({{email}}) after {{attempts}} attempts.

Error: {{error}}

Open the dashboard to retry this step.`;