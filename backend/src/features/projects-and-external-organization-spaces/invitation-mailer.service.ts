import { Injectable, Logger } from '@nestjs/common';

/**
 * Sends project invitation emails. The default transport logs the accept link
 * (no SMTP relay in dev/test). Set INVITE_MAIL_RELAY_DOWN=true to simulate an
 * unavailable relay; callers must treat a throw as delivery "failed".
 */
@Injectable()
export class InvitationMailerService {
  private readonly logger = new Logger('InvitationMailer');

  async sendInvitation(email: string, token: string, projectName: string): Promise<void> {
    if (process.env.INVITE_MAIL_RELAY_DOWN === 'true') {
      throw new Error('email relay unavailable');
    }
    this.logger.log(`[invitation] ${email} invited to "${projectName}": /accept-invite/${token}`);
  }
}
