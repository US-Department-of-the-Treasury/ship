/**
 * Email service using AWS SES for transactional emails.
 *
 * Follows the lazy-initialization pattern from ssm.ts to avoid keeping
 * Node.js alive during tests. Configuration is loaded from SSM parameters.
 *
 * SSM Parameters required:
 * - /ship/{env}/ses/from-email - Sender email address
 * - /ship/{env}/ses/from-name - Sender display name
 * - /ship/{env}/app-url - Application URL for invite links
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { getSSMSecret } from '../config/ssm.js';

// Lazy-initialized SES client
let sesClient: SESClient | null = null;

// Cached configuration
let cachedConfig: {
  fromEmail: string;
  fromName: string;
  appUrl: string;
} | null = null;

/**
 * Get or create the SES client (lazy initialization)
 */
function getSESClient(): SESClient {
  if (!sesClient) {
    sesClient = new SESClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }
  return sesClient;
}

/**
 * Load email configuration from SSM parameters
 */
async function loadConfig(): Promise<typeof cachedConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const environment = process.env.ENVIRONMENT || 'prod';
  const basePath = `/ship/${environment}`;

  try {
    const [fromEmail, fromName, appUrl] = await Promise.all([
      getSSMSecret(`${basePath}/ses/from-email`),
      getSSMSecret(`${basePath}/ses/from-name`),
      getSSMSecret(`${basePath}/app-url`),
    ]);

    cachedConfig = {
      fromEmail,
      fromName,
      appUrl,
    };

    return cachedConfig;
  } catch (error) {
    console.error('[Email] Failed to load configuration from SSM:', error);
    return null;
  }
}

/**
 * HTML escape helper to prevent XSS in email content
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Build workspace invitation email content
 *
 * @param workspaceName - Name of the workspace
 * @param inviterName - Name of the person sending the invite
 * @param inviteUrl - Full URL to accept the invite
 * @returns Object with subject, html, and text versions of the email
 */
export function buildInviteEmail(
  workspaceName: string,
  inviterName: string,
  inviteUrl: string
): { subject: string; html: string; text: string } {
  const safeWorkspaceName = escapeHtml(workspaceName);
  const safeInviterName = escapeHtml(inviterName);

  const subject = `You've been invited to ${workspaceName} on Ship`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Workspace Invitation</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f5f5f5;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid #eaeaea;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #171717;">Ship</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px;">
              <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #171717;">
                You've been invited to join a workspace
              </h2>

              <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.5; color: #525252;">
                <strong>${safeInviterName}</strong> has invited you to join
                <strong>${safeWorkspaceName}</strong> on Ship.
              </p>

              <p style="margin: 0 0 32px; font-size: 16px; line-height: 1.5; color: #525252;">
                Ship is a collaborative project management platform. Click the button below to accept the invitation and get started.
              </p>

              <!-- CTA Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="text-align: center;">
                    <a href="${inviteUrl}"
                       style="display: inline-block; padding: 14px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
                      Accept Invitation
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 32px 0 0; font-size: 14px; line-height: 1.5; color: #737373;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin: 8px 0 0; font-size: 14px; line-height: 1.5; color: #2563eb; word-break: break-all;">
                ${inviteUrl}
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #fafafa; border-top: 1px solid #eaeaea; border-radius: 0 0 8px 8px;">
              <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #737373; text-align: center;">
                This invitation was sent by Ship. If you didn't expect this email,
                you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

  const text = `
You've been invited to join ${workspaceName} on Ship

${inviterName} has invited you to join ${workspaceName} on Ship.

Ship is a collaborative project management platform. Click the link below to accept the invitation and get started.

Accept Invitation: ${inviteUrl}

If you didn't expect this email, you can safely ignore it.
`.trim();

  return { subject, html, text };
}

/**
 * Send an email via AWS SES
 *
 * @param recipientEmail - Recipient email address
 * @param subject - Email subject
 * @param html - HTML body
 * @param text - Plain text body
 * @returns true if email was sent successfully, false otherwise
 */
export async function sendEmail(
  recipientEmail: string,
  subject: string,
  html: string,
  text: string
): Promise<boolean> {
  try {
    const config = await loadConfig();
    if (!config) {
      console.error('[Email] Cannot send email: configuration not available');
      return false;
    }

    const client = getSESClient();
    const command = new SendEmailCommand({
      Source: `${config.fromName} <${config.fromEmail}>`,
      Destination: {
        ToAddresses: [recipientEmail],
      },
      Message: {
        Subject: {
          Data: subject,
          Charset: 'UTF-8',
        },
        Body: {
          Html: {
            Data: html,
            Charset: 'UTF-8',
          },
          Text: {
            Data: text,
            Charset: 'UTF-8',
          },
        },
      },
    });

    await client.send(command);
    console.log(`[Email] Successfully sent email to ${recipientEmail}`);
    return true;
  } catch (error) {
    console.error(`[Email] Failed to send email to ${recipientEmail}:`, error);
    return false;
  }
}

/**
 * Send a workspace invitation email
 *
 * This is the main interface for sending invite emails. It builds the
 * invite URL, generates the email content, and sends via SES.
 *
 * @param recipientEmail - Email address of the invited user
 * @param workspaceName - Name of the workspace they're invited to
 * @param inviterName - Name of the person who created the invite
 * @param inviteToken - The invite token for the acceptance URL
 * @returns true if email was sent successfully, false otherwise
 */
export async function sendInviteEmail(
  recipientEmail: string,
  workspaceName: string,
  inviterName: string,
  inviteToken: string
): Promise<boolean> {
  try {
    const config = await loadConfig();
    if (!config) {
      console.error('[Email] Cannot send invite email: configuration not available');
      return false;
    }

    const inviteUrl = `${config.appUrl}/invite/${inviteToken}`;
    const { subject, html, text } = buildInviteEmail(workspaceName, inviterName, inviteUrl);

    return await sendEmail(recipientEmail, subject, html, text);
  } catch (error) {
    console.error(`[Email] Failed to send invite email to ${recipientEmail}:`, error);
    return false;
  }
}
